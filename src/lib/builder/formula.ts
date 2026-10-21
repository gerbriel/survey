/**
 * Formula source to Expr AST for calculated questions (doc 03 section 3:
 * "formulas parsed at edit time, no eval").
 *
 * Grammar:
 *   expr   = term (("+" | "-") term)*
 *   term   = unary (("*" | "/") unary)*
 *   unary  = "-" unary | atom
 *   atom   = number | ref | "(" expr ")" | fn "(" args ")"
 *   ref    = {{q:question_key}} | {{calc:question_key}} | {{hidden:param}}
 *   fn     = min | max | round(expr, places) | score(ref, ...) | correct(ref, ...)
 */

import type { Expr, SurveyDefinition } from '@/lib/survey'

export type FormulaResult = { ok: true; expr: Expr } | { ok: false; error: string }

type Tok =
  | { t: 'num'; v: number }
  | { t: 'ref'; kind: 'q' | 'calc' | 'hidden'; ref: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const REF_RE = /^\{\{\s*(q|calc|hidden)\s*:\s*([A-Za-z0-9_.-]+)\s*\}\}/

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i] as string
    if (/\s/.test(c)) {
      i++
      continue
    }
    const rest = src.slice(i)
    const ref = rest.match(REF_RE)
    if (ref) {
      out.push({ t: 'ref', kind: ref[1] as 'q' | 'calc' | 'hidden', ref: ref[2] as string })
      i += ref[0].length
      continue
    }
    const num = rest.match(/^\d+(\.\d+)?/)
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const id = rest.match(/^[a-z]+/i)
    if (id) {
      out.push({ t: 'id', v: id[0].toLowerCase() })
      i += id[0].length
      continue
    }
    if ('+-*/(),'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error(`Unexpected "${c}" at position ${i + 1}.`)
  }
  return out
}

export function parseFormula(src: string, def: SurveyDefinition): FormulaResult {
  const byKey = new Map(Object.values(def.questions).map((q) => [q.question_key, q]))
  let toks: Tok[]
  try {
    toks = tokenize(src)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = peek()
    return t?.t === 'op' && t.v === v
  }
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}".`)
    p++
  }
  const questionId = (tok: Tok): string => {
    if (tok.t !== 'ref' || tok.kind === 'hidden') throw new Error('score() and correct() take question references.')
    const q = byKey.get(tok.ref)
    if (!q) throw new Error(`Unknown question ${tok.ref}.`)
    return q.id
  }
  const atom = (): Expr => {
    const t = peek()
    if (!t) throw new Error('The formula ends too early.')
    p++
    if (t.t === 'num') return { num: t.v }
    if (t.t === 'ref') {
      if (t.kind === 'hidden') return { ref: { kind: 'hidden', id: t.ref } }
      const q = byKey.get(t.ref)
      if (!q) throw new Error(`Unknown question ${t.ref}.`)
      return { ref: { kind: t.kind === 'calc' || q.type === 'calculated' ? 'calc' : 'question', id: q.id } }
    }
    if (t.t === 'op' && t.v === '(') {
      const e = expr()
      expect(')')
      return e
    }
    if (t.t === 'id') {
      expect('(')
      if (t.v === 'score' || t.v === 'correct') {
        const ids: string[] = []
        if (!isOp(')')) {
          for (;;) {
            const r = peek()
            if (!r) throw new Error('The formula ends too early.')
            p++
            ids.push(questionId(r))
            if (isOp(',')) {
              p++
              continue
            }
            break
          }
        }
        expect(')')
        return { fn: t.v, ids }
      }
      const args: Expr[] = [expr()]
      while (isOp(',')) {
        p++
        args.push(expr())
      }
      expect(')')
      if (t.v === 'min' || t.v === 'max') return { op: t.v, args }
      if (t.v === 'round') {
        const places = args[1]
        if (args.length !== 2 || !places || !('num' in places)) throw new Error('round(value, places) needs a number of places.')
        return { fn: 'round', arg: args[0] as Expr, places: places.num }
      }
      throw new Error(`Unknown function ${t.v}().`)
    }
    throw new Error(`Unexpected "${t.t === 'op' ? t.v : ''}".`)
  }
  const unary = (): Expr => {
    if (isOp('-')) {
      p++
      return { op: '-', args: [{ num: 0 }, unary()] }
    }
    return atom()
  }
  const term = (): Expr => {
    let left = unary()
    while (isOp('*') || isOp('/')) {
      const op = (peek() as { v: '*' | '/' }).v
      p++
      left = { op, args: [left, unary()] }
    }
    return left
  }
  function expr(): Expr {
    let left = term()
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { v: '+' | '-' }).v
      p++
      left = { op, args: [left, term()] }
    }
    return left
  }
  try {
    if (toks.length === 0) return { ok: false, error: 'Enter a formula.' }
    const e = expr()
    if (p < toks.length) throw new Error('Unexpected text after the formula.')
    return { ok: true, expr: e }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
