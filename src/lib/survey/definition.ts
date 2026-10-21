/**
 * Lookup tables built once per definition. Internal helper shared by the
 * engine, validator, splitter and linter.
 */

import type { Condition, Expr, LeafField, Page, Question, SurveyDefinition } from './types'

export interface DefinitionIndex {
  byId: Map<string, Question>
  byKey: Map<string, Question>
  /** question id -> page id */
  pageOf: Map<string, string>
  /** page id -> index in definition order */
  pageIndex: Map<string, number>
  pagesById: Map<string, Page>
  /** hidden param -> hidden question */
  hiddenByParam: Map<string, Question>
}

const cache = new WeakMap<SurveyDefinition, DefinitionIndex>()

export function indexDefinition(def: SurveyDefinition): DefinitionIndex {
  const hit = cache.get(def)
  if (hit) return hit
  const byId = new Map<string, Question>()
  const byKey = new Map<string, Question>()
  const hiddenByParam = new Map<string, Question>()
  for (const [id, q] of Object.entries(def.questions)) {
    byId.set(id, q)
    if (!byKey.has(q.question_key)) byKey.set(q.question_key, q)
    if (q.type === 'hidden' && !hiddenByParam.has(q.settings.param)) hiddenByParam.set(q.settings.param, q)
  }
  const pageOf = new Map<string, string>()
  const pageIndex = new Map<string, number>()
  const pagesById = new Map<string, Page>()
  def.pages.forEach((p, i) => {
    pageIndex.set(p.id, i)
    pagesById.set(p.id, p)
    for (const qid of p.question_ids) if (!pageOf.has(qid)) pageOf.set(qid, p.id)
  })
  const idx = { byId, byKey, pageOf, pageIndex, pagesById, hiddenByParam }
  cache.set(def, idx)
  return idx
}

export function isGroup(c: Condition): c is { all: Condition[] } | { any: Condition[] } | { not: Condition } {
  return 'all' in c || 'any' in c || 'not' in c
}

/** Group nesting depth: a leaf is 0, `{ all: [leaf] }` is 1. `not` counts as a level. */
export function conditionDepth(c: Condition): number {
  if ('all' in c) return 1 + Math.max(0, ...c.all.map(conditionDepth))
  if ('any' in c) return 1 + Math.max(0, ...c.any.map(conditionDepth))
  if ('not' in c) return 1 + conditionDepth(c.not)
  return 0
}

export function conditionLeaves(c: Condition, out: LeafField[] = []): LeafField[] {
  if ('all' in c) c.all.forEach((x) => conditionLeaves(x, out))
  else if ('any' in c) c.any.forEach((x) => conditionLeaves(x, out))
  else if ('not' in c) conditionLeaves(c.not, out)
  else out.push(c.field)
  return out
}

export interface ExprRefs {
  questions: string[]
  hidden: string[]
  calcs: string[]
  /** ids used inside score() or correct() */
  scored: string[]
  usesScoring: boolean
}

export function exprRefs(e: Expr, out: ExprRefs = { questions: [], hidden: [], calcs: [], scored: [], usesScoring: false }): ExprRefs {
  if ('num' in e) return out
  if ('ref' in e) {
    if (e.ref.kind === 'question') out.questions.push(e.ref.id)
    else if (e.ref.kind === 'hidden') out.hidden.push(e.ref.id)
    else out.calcs.push(e.ref.id)
    return out
  }
  if ('op' in e) {
    e.args.forEach((a) => exprRefs(a, out))
    return out
  }
  switch (e.fn) {
    case 'score':
    case 'correct':
      out.usesScoring = true
      out.scored.push(...e.ids)
      return out
    case 'round':
      return exprRefs(e.arg, out)
    case 'if':
      for (const f of conditionLeaves(e.cond)) {
        if (f.kind === 'question') out.questions.push(f.id)
        else if (f.kind === 'hidden') out.hidden.push(f.param)
        else out.calcs.push(f.id)
      }
      exprRefs(e.then, out)
      exprRefs(e.else, out)
      return out
  }
}

/** Rules sorted by `order`, ties broken by array position (stable sort). */
export function byOrder<T extends { order: number }>(rules: T[]): T[] {
  return rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.order - b.r.order || a.i - b.i)
    .map((x) => x.r)
}

const scoredCache = new WeakMap<SurveyDefinition, Set<string>>()

/**
 * Calculated questions whose formula uses `score` or `correct`, directly or
 * through another calc (doc 03 section 2.1). Fixed point over calc refs.
 */
export function scoredCalcIds(def: SurveyDefinition): Set<string> {
  const hit = scoredCache.get(def)
  if (hit) return hit
  const refs = new Map<string, ExprRefs>()
  for (const [id, q] of Object.entries(def.questions)) {
    if (q.type === 'calculated') refs.set(id, exprRefs(q.settings.formula))
  }
  const scored = new Set<string>()
  for (const [id, r] of refs) if (r.usesScoring) scored.add(id)
  let changed = true
  while (changed) {
    changed = false
    for (const [id, r] of refs) {
      if (!scored.has(id) && [...r.calcs, ...r.questions].some((c) => scored.has(c))) {
        scored.add(id)
        changed = true
      }
    }
  }
  scoredCache.set(def, scored)
  return scored
}

/** True when any leaf reads one of `calcIds`, as a calc field or as a question field. */
export function conditionUsesAny(c: Condition, calcIds: Set<string>): boolean {
  return conditionLeaves(c).some((f) => f.kind !== 'hidden' && calcIds.has(f.id))
}
