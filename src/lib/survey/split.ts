/**
 * splitDefinition (doc 03 section 2.1, 00 R9). Pure and deterministic. The
 * publish route stores `public_definition`; publish_survey_version refuses one
 * that still holds any SERVER_ONLY_KEYS (doc 01 section 4).
 */

import type { ChoiceOption, LogicRule, Question, ServerOnly, SurveyDefinition } from './types'
import { conditionUsesAny, scoredCalcIds } from './definition'

/**
 * Object keys that must never appear anywhere in a public definition. A SQL
 * constant list mirrors this; a test keeps them equal.
 */
export const SERVER_ONLY_KEYS = ['score', 'correct_option_id', 'correct_option_ids', 'yes_score', 'no_score'] as const

export type ServerOnlyKey = (typeof SERVER_ONLY_KEYS)[number]

const SERVER_KEY_SET: ReadonlySet<string> = new Set(SERVER_ONLY_KEYS)

/** Deep check: true when any object at any depth has a key in SERVER_ONLY_KEYS. */
export function containsServerOnlyKeys(obj: unknown): boolean {
  if (Array.isArray(obj)) return obj.some(containsServerOnlyKeys)
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (SERVER_KEY_SET.has(k)) return true
      if (containsServerOnlyKeys(v)) return true
    }
  }
  return false
}

/** Every path (dot notation) holding a server-only key. For lint messages and tests. */
export function findServerOnlyKeys(obj: unknown, path = ''): string[] {
  const out: string[] = []
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...findServerOnlyKeys(v, `${path}[${i}]`)))
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k
      if (SERVER_KEY_SET.has(k)) out.push(p)
      out.push(...findServerOnlyKeys(v, p))
    }
  }
  return out
}

function stripOption(o: ChoiceOption): ChoiceOption {
  const { score: _score, ...rest } = o
  void _score
  return rest
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function emptyServerOnly(): ServerOnly {
  return { option_scores: {}, correct: {}, yes_no_scores: {}, matrix_column_scores: {}, scored_calcs: {}, scored_rules: [] }
}

export function splitDefinition(definition: SurveyDefinition): { public_definition: SurveyDefinition; server_only: ServerOnly } {
  const def = clone(definition)
  const server = emptyServerOnly()
  const scored = scoredCalcIds(definition)

  const questions: Record<string, Question> = {}
  for (const id of Object.keys(def.questions).sort()) {
    const q = def.questions[id] as Question
    if (scored.has(id)) {
      server.scored_calcs[id] = q
      continue
    }
    switch (q.type) {
      case 'single_choice':
      case 'dropdown':
      case 'multiple_choice':
      case 'ranking': {
        const scores: Record<string, number> = {}
        for (const o of q.settings.options) if (o.score !== undefined) scores[o.id] = o.score
        if (Object.keys(scores).length > 0) server.option_scores[id] = scores
        q.settings.options = q.settings.options.map(stripOption)
        if ((q.type === 'single_choice' || q.type === 'dropdown') && q.settings.correct_option_id !== undefined) {
          server.correct[id] = q.settings.correct_option_id
          delete q.settings.correct_option_id
        }
        if (q.type === 'multiple_choice' && q.settings.correct_option_ids !== undefined) {
          server.correct[id] = q.settings.correct_option_ids
          delete q.settings.correct_option_ids
        }
        break
      }
      case 'yes_no': {
        const s: { yes?: number; no?: number } = {}
        if (q.settings.yes_score !== undefined) s.yes = q.settings.yes_score
        if (q.settings.no_score !== undefined) s.no = q.settings.no_score
        if (s.yes !== undefined || s.no !== undefined) server.yes_no_scores[id] = s
        delete q.settings.yes_score
        delete q.settings.no_score
        break
      }
      case 'matrix': {
        const scores: Record<string, number> = {}
        q.settings.columns = q.settings.columns.map((c) => {
          if (c.score !== undefined) scores[c.id] = c.score
          const { score: _s, ...rest } = c
          void _s
          return rest
        })
        if (Object.keys(scores).length > 0) server.matrix_column_scores[id] = scores
        break
      }
      default:
        break
    }
    questions[id] = q
  }
  // Keep the original key order for a stable JSON shape.
  def.questions = Object.fromEntries(Object.keys(definition.questions).filter((id) => questions[id]).map((id) => [id, questions[id] as Question]))

  def.pages = def.pages.map((p) => ({
    ...p,
    question_ids: p.question_ids.filter((id) => !scored.has(id)),
    ...(p.randomize_questions ? { randomize_questions: { pinned_ids: p.randomize_questions.pinned_ids.filter((id) => !scored.has(id)) } } : {}),
  }))

  // Decision: any rule reading a scored calc is stripped, not only set_ending
  // (the linter forbids the others, this is defense in depth).
  const keep: LogicRule[] = []
  for (const r of def.logic) {
    if (conditionUsesAny(r.when, scored)) server.scored_rules.push(r)
    else keep.push(r)
  }
  def.logic = keep

  return { public_definition: def, server_only: server }
}
