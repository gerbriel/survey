/**
 * Piping tokens (doc 03 section 3, Piping).
 *
 *   {{q:question_key}}  {{q:question_key|fallback}}  {{hidden:param}}  {{calc:question_key}}
 *
 * resolvePipes returns segments so the renderer inserts piped values as text
 * nodes, never as markup: a piped "**x**" is never parsed as md-lite bold.
 */

import type { AnswerValue, Question, QuestionType, SurveyDefinition } from './types'
import type { EvalState } from './engine'
import { indexDefinition } from './definition'
import { choiceIds, otherText } from './normalize'

export type PipeTokenKind = 'q' | 'hidden' | 'calc'

export interface PipeToken {
  raw: string
  kind: PipeTokenKind
  ref: string
  fallback?: string
  start: number
  end: number
}

export type PipeSegment = { kind: 'text'; text: string } | { kind: 'value'; text: string; token: PipeToken }

const TOKEN_RE = /\{\{\s*(q|hidden|calc)\s*:\s*([A-Za-z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g

export function parsePipeTokens(text: string): PipeToken[] {
  const out: PipeToken[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0
    out.push({
      raw: m[0],
      kind: m[1] as PipeTokenKind,
      ref: m[2] as string,
      ...(m[3] !== undefined ? { fallback: m[3] } : {}),
      start,
      end: start + m[0].length,
    })
  }
  return out
}

/** Decision: address, consent and signature join matrix and files as not pipeable (no single readable value). */
const NOT_PIPEABLE: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'matrix',
  'file_upload',
  'signature',
  'address',
  'consent',
  'statement',
  'image',
])

export function isPipeableType(type: QuestionType): boolean {
  return !NOT_PIPEABLE.has(type)
}

export function formatCalc(q: Question | undefined, value: number): string {
  const d = q?.type === 'calculated' ? q.settings.decimals : undefined
  return d !== undefined ? value.toFixed(Math.max(0, Math.min(10, d))) : String(value)
}

/** Text shown for a piped answer, or null when the type is not pipeable. */
export function formatAnswer(q: Question, v: AnswerValue): string | null {
  if (!isPipeableType(q.type)) return null
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
    case 'ranking': {
      const other = otherText(v)
      return choiceIds(v)
        .map((id) => {
          const o = q.settings.options.find((x) => x.id === id)
          if (!o) return id
          return o.is_other && other ? other : o.label
        })
        .join(', ')
    }
    case 'yes_no':
      return v === 1 ? q.settings.yes_label : q.settings.no_label
    case 'calculated':
      return typeof v === 'number' ? formatCalc(q, v) : null
    default:
      return typeof v === 'string' || typeof v === 'number' ? String(v) : null
  }
}

export interface PipeOptions {
  /**
   * Calc values by question_key that the engine could not compute, for
   * example the scored quiz calc returned by the submit result for ending piping.
   */
  calcOverrides?: Record<string, number>
}

function resolveToken(t: PipeToken, def: SurveyDefinition, state: EvalState, opts: PipeOptions): string {
  const fb = t.fallback ?? ''
  if (t.kind === 'hidden') return state.hidden[t.ref] || fb
  const q = indexDefinition(def).byKey.get(t.ref)
  if (t.kind === 'calc') {
    const override = opts.calcOverrides?.[t.ref]
    if (override !== undefined) return formatCalc(q, override)
    if (!q || q.type !== 'calculated') return fb
    const v = state.calcs[q.id]
    return v === undefined ? fb : formatCalc(q, v)
  }
  if (!q || !state.visible.has(q.id)) return fb
  if (q.type === 'calculated') {
    const v = state.calcs[q.id]
    return v === undefined ? fb : formatCalc(q, v)
  }
  const v = state.answers[q.id]
  if (v === undefined) return fb
  return formatAnswer(q, v) || fb
}

export function resolvePipes(text: string, def: SurveyDefinition, state: EvalState, opts: PipeOptions = {}): PipeSegment[] {
  const out: PipeSegment[] = []
  let at = 0
  for (const t of parsePipeTokens(text)) {
    if (t.start > at) out.push({ kind: 'text', text: text.slice(at, t.start) })
    out.push({ kind: 'value', text: resolveToken(t, def, state, opts), token: t })
    at = t.end
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

/**
 * Plain string with tokens replaced. `encode: 'url'` URL-encodes each piped
 * value, for ending redirect URLs.
 */
export function pipeText(text: string, def: SurveyDefinition, state: EvalState, opts: PipeOptions & { encode?: 'none' | 'url' } = {}): string {
  return resolvePipes(text, def, state, opts)
    .map((s) => (s.kind === 'value' && opts.encode === 'url' ? encodeURIComponent(s.text) : s.text))
    .join('')
}
