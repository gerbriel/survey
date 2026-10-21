/**
 * Logic engine (doc 03 section 3). Pure and deterministic: no Date.now, no
 * Math.random, no DOM, no network. The renderer runs it in the browser and the
 * submit route runs the same code on Node.
 *
 * Decision: the engine lives in src/lib/survey/ rather than the
 * src/lib/survey-engine/ folder doc 03 names, because the build plan gives
 * Phase 1B src/lib/survey/ only. Same framework-free rule applies.
 */

import type {
  AnswerValue,
  ChoiceOption,
  Condition,
  Expr,
  Leaf,
  MatrixRow,
  Operand,
  Operator,
  Page,
  Question,
  QuestionType,
  SurveyDefinition,
} from './types'
import { byOrder, conditionDepth, exprRefs, indexDefinition, scoredCalcIds, type DefinitionIndex } from './definition'
import { choiceIds, normalizeAnswer } from './normalize'
import { rngFor, shuffleWithPins } from './random'
import { isSafeRegex } from './regex'

export const MAX_CONDITION_DEPTH = 3
export const MAX_EVAL_PASSES = 3

// ---------------------------------------------------------------- operators

const TEXT_OPS: readonly Operator[] = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'matches', 'is_answered', 'is_not_answered']
const NUMBER_OPS: readonly Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_answered', 'is_not_answered']
const SINGLE_CHOICE_OPS: readonly Operator[] = ['eq', 'neq', 'includes_any', 'includes_none', 'is_answered', 'is_not_answered']
const MULTI_CHOICE_OPS: readonly Operator[] = ['includes_any', 'includes_all', 'includes_none', 'is_answered', 'is_not_answered']
const BOOL_OPS: readonly Operator[] = ['eq', 'neq', 'is_answered', 'is_not_answered']
const DATE_OPS: readonly Operator[] = ['before', 'after', 'on', 'between', 'is_answered', 'is_not_answered']
const TIME_OPS: readonly Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_answered', 'is_not_answered']
const PRESENCE_OPS: readonly Operator[] = ['is_answered', 'is_not_answered']
const NO_OPS: readonly Operator[] = []

const OPERATOR_TABLE: Record<QuestionType, readonly Operator[]> = {
  short_text: TEXT_OPS,
  long_text: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  hidden: TEXT_OPS,
  number: NUMBER_OPS,
  rating: NUMBER_OPS,
  nps: NUMBER_OPS,
  calculated: NUMBER_OPS,
  single_choice: SINGLE_CHOICE_OPS,
  dropdown: SINGLE_CHOICE_OPS,
  multiple_choice: MULTI_CHOICE_OPS,
  // Decision: ranking compares which options were ranked at all, not positions.
  ranking: MULTI_CHOICE_OPS,
  yes_no: BOOL_OPS,
  consent: BOOL_OPS,
  date: DATE_OPS,
  time: TIME_OPS,
  file_upload: PRESENCE_OPS,
  signature: PRESENCE_OPS,
  address: PRESENCE_OPS,
  // Matrix without row_id: presence. With row_id: see operatorsForField.
  matrix: PRESENCE_OPS,
  statement: NO_OPS,
  image: NO_OPS,
}

/** Operators allowed for a question type. Used by the editor dropdowns and the linter. */
export function operatorsFor(type: QuestionType): readonly Operator[] {
  return OPERATOR_TABLE[type]
}

/** Matrix rows compare like a single choice (column ids). */
export function operatorsForField(type: QuestionType, hasRowId: boolean): readonly Operator[] {
  return type === 'matrix' && hasRowId ? SINGLE_CHOICE_OPS : operatorsFor(type)
}

// ---------------------------------------------------------------- context and state

export interface EvalContext {
  /** ISO timestamp; the engine never reads the clock. */
  now?: string
  /** URL params captured at load (or from response metadata on the server). */
  hidden?: Record<string, string>
  /** responses.metadata.random_seed. Without it nothing is shuffled. */
  seed?: string
}

export interface EvalState {
  /** Page ids on the path, in walk order. */
  path: string[]
  /** Question ids visible on the path (display-only types included). */
  visible: Set<string>
  /**
   * question_keys that hold answers and are visible on the path: what
   * submit_response receives as `visible_keys`. Excludes statement and image,
   * and excludes scored calcs so client and server agree exactly.
   */
  visible_keys: string[]
  /** Effective answers by question id: normalized, on path, visible, calcs included. */
  answers: Record<string, AnswerValue>
  /** Calculated values by question id. */
  calcs: Record<string, number>
  /** Resolved hidden field values by param, defaults applied. */
  hidden: Record<string, string>
  /** Quiz score; null without quiz settings or when the score calc is absent (public definition). */
  score: { value: number; max: number } | null
  ending_id: string | null
  ended_early: boolean
}

// ---------------------------------------------------------------- answered and comparison helpers

export function isAnswered(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

function normText(v: unknown): string {
  if (typeof v === 'string') return v.trim().toLowerCase()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).toLowerCase()
  return ''
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function operandList(v: Operand | undefined): string[] {
  if (Array.isArray(v)) return v
  if (v === undefined || v === null) return []
  return [String(v)]
}

function cmp(a: number | string, b: number | string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

type Kind = 'text' | 'number' | 'choice' | 'multi' | 'bool' | 'date' | 'time' | 'other'

function kindOf(type: QuestionType | 'matrix_row'): Kind {
  switch (type) {
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'hidden':
      return 'text'
    case 'number':
    case 'rating':
    case 'nps':
    case 'calculated':
      return 'number'
    case 'single_choice':
    case 'dropdown':
    case 'matrix_row':
      return 'choice'
    case 'multiple_choice':
    case 'ranking':
      return 'multi'
    case 'yes_no':
    case 'consent':
      return 'bool'
    case 'date':
      return 'date'
    case 'time':
      return 'time'
    default:
      return 'other'
  }
}

function scalarFor(kind: Kind, v: unknown): number | string | null {
  if (kind === 'number' || kind === 'bool') return toNum(v)
  if (kind === 'date') return typeof v === 'string' ? v.slice(0, 10) : null
  if (kind === 'time') return typeof v === 'string' ? v : null
  if (kind === 'text') return normText(v)
  return typeof v === 'string' ? v : null
}

const regexCache = new Map<string, RegExp | null>()
function compileMatch(src: string): RegExp | null {
  if (regexCache.has(src)) return regexCache.get(src) ?? null
  let re: RegExp | null = null
  if (isSafeRegex(src)) {
    try {
      re = new RegExp(src, 'i')
    } catch {
      re = null
    }
  }
  if (regexCache.size > 500) regexCache.clear()
  regexCache.set(src, re)
  return re
}

/**
 * Compare one resolved field value against a leaf. Exported for tests and for
 * the builder's live preview of a single rule.
 */
export function compareLeaf(type: QuestionType | 'matrix_row', value: unknown, op: Operator, operand: Operand | undefined): boolean {
  if (!isAnswered(value)) return op === 'is_not_answered' || op === 'neq' || op === 'includes_none'
  const kind = kindOf(type)
  switch (op) {
    case 'is_answered':
      return true
    case 'is_not_answered':
      return false
    case 'eq':
    case 'neq': {
      let eq: boolean
      if (kind === 'choice') eq = choiceIds(value as AnswerValue)[0] === operand
      else if (kind === 'multi') {
        const a = new Set(choiceIds(value as AnswerValue))
        const b = operandList(operand)
        eq = a.size === new Set(b).size && b.every((x) => a.has(x))
      } else {
        const a = scalarFor(kind, value)
        const b = scalarFor(kind, operand)
        eq = a !== null && b !== null && a === b
      }
      return op === 'eq' ? eq : !eq
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'before':
    case 'after':
    case 'on': {
      const a = scalarFor(kind, value)
      const b = scalarFor(kind, operand)
      if (a === null || b === null || typeof a !== typeof b) return false
      const c = cmp(a, b)
      if (op === 'gt' || op === 'after') return c > 0
      if (op === 'gte') return c >= 0
      if (op === 'lt' || op === 'before') return c < 0
      if (op === 'lte') return c <= 0
      return c === 0
    }
    case 'between': {
      if (!Array.isArray(operand) || operand.length !== 2) return false
      const a = scalarFor(kind, value)
      const lo = scalarFor(kind, operand[0])
      const hi = scalarFor(kind, operand[1])
      if (a === null || lo === null || hi === null || typeof a !== typeof lo || typeof a !== typeof hi) return false
      return cmp(a, lo) >= 0 && cmp(a, hi) <= 0
    }
    case 'contains':
    case 'not_contains':
    case 'starts_with':
    case 'ends_with': {
      const a = normText(value)
      const b = normText(operand)
      if (op === 'contains') return a.includes(b)
      if (op === 'not_contains') return !a.includes(b)
      if (op === 'starts_with') return a.startsWith(b)
      return a.endsWith(b)
    }
    case 'matches': {
      if (typeof operand !== 'string') return false
      const re = compileMatch(operand)
      return re ? re.test(typeof value === 'string' ? value.trim() : String(value)) : false
    }
    case 'includes_any':
    case 'includes_all':
    case 'includes_none': {
      const have = new Set(choiceIds(value as AnswerValue))
      const want = operandList(operand)
      if (op === 'includes_any') return want.some((x) => have.has(x))
      if (op === 'includes_all') return want.length > 0 && want.every((x) => have.has(x))
      return !want.some((x) => have.has(x))
    }
  }
}

// ---------------------------------------------------------------- environment

interface Env {
  def: SurveyDefinition
  idx: DefinitionIndex
  /** Answers readable by conditions right now, by question id. */
  value(id: string): AnswerValue | undefined
  calcs: Record<string, number>
  hidden: Record<string, string>
}

function evalLeaf(leaf: Leaf, env: Env): boolean {
  const f = leaf.field
  if (f.kind === 'hidden') return compareLeaf('hidden', env.hidden[f.param], leaf.op, leaf.value)
  if (f.kind === 'calc') return compareLeaf('calculated', env.calcs[f.id], leaf.op, leaf.value)
  const q = env.idx.byId.get(f.id)
  if (!q) return compareLeaf('short_text', undefined, leaf.op, leaf.value)
  if (q.type === 'calculated') return compareLeaf('calculated', env.calcs[q.id], leaf.op, leaf.value)
  const v = env.value(q.id)
  if (q.type === 'matrix' && f.row_id) {
    const row = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[f.row_id] : undefined
    return compareLeaf('matrix_row', row, leaf.op, leaf.value)
  }
  return compareLeaf(q.type, v, leaf.op, leaf.value)
}

function evalCond(c: Condition, env: Env): boolean {
  if ('all' in c) return c.all.every((x) => evalCond(x, env))
  if ('any' in c) return c.any.some((x) => evalCond(x, env))
  if ('not' in c) return !evalCond(c.not, env)
  return evalLeaf(c, env)
}

/**
 * Evaluate a condition. Conditions deeper than MAX_CONDITION_DEPTH are false.
 * Decision: an over-deep condition evaluates false instead of throwing, so an
 * unlinted draft cannot crash the renderer; the linter blocks it at publish.
 */
function evaluateConditionIn(c: Condition, env: Env): boolean {
  if (conditionDepth(c) > MAX_CONDITION_DEPTH) return false
  return evalCond(c, env)
}

/**
 * Evaluate a condition against answers keyed by question id. Convenience for
 * the builder and tests; evaluate() uses the same code internally.
 */
export function evaluateCondition(
  def: SurveyDefinition,
  cond: Condition,
  answersById: Record<string, AnswerValue>,
  extra: { calcs?: Record<string, number>; hidden?: Record<string, string> } = {},
): boolean {
  const idx = indexDefinition(def)
  return evaluateConditionIn(cond, {
    def,
    idx,
    value: (id) => answersById[id],
    calcs: extra.calcs ?? {},
    hidden: extra.hidden ?? {},
  })
}

// ---------------------------------------------------------------- scoring and calcs

function optionScore(options: ChoiceOption[], id: string): number {
  return options.find((o) => o.id === id)?.score ?? 0
}

/** Score contribution of one question's answer. Unscored or unanswered = 0. */
export function questionScore(q: Question, v: AnswerValue | undefined): number {
  if (v === undefined) return 0
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
      return optionScore(q.settings.options, choiceIds(v)[0] ?? '')
    case 'multiple_choice':
      return choiceIds(v).reduce((s, id) => s + optionScore(q.settings.options, id), 0)
    case 'ranking': {
      // Decision: a ranking scores the option ranked first.
      const first = choiceIds(v)[0]
      return first ? optionScore(q.settings.options, first) : 0
    }
    case 'yes_no':
      return v === 1 ? (q.settings.yes_score ?? 0) : v === 0 ? (q.settings.no_score ?? 0) : 0
    case 'matrix': {
      if (typeof v !== 'object' || Array.isArray(v)) return 0
      let s = 0
      for (const col of Object.values(v as Record<string, string>)) {
        s += q.settings.columns.find((c) => c.id === col)?.score ?? 0
      }
      return s
    }
    case 'rating':
      return typeof v === 'number' ? v : 0
    default:
      return 0
  }
}

/** Highest score one question can contribute. */
export function questionMaxScore(q: Question): number {
  const pos = (n: number | undefined) => Math.max(0, n ?? 0)
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
    case 'ranking':
      return Math.max(0, ...q.settings.options.map((o) => pos(o.score)))
    case 'multiple_choice':
      return q.settings.options.reduce((s, o) => s + pos(o.score), 0)
    case 'yes_no':
      return Math.max(pos(q.settings.yes_score), pos(q.settings.no_score))
    case 'matrix':
      return q.settings.rows.length * Math.max(0, ...q.settings.columns.map((c) => pos(c.score)))
    case 'rating':
      return q.settings.points
    default:
      return 0
  }
}

export function isCorrect(q: Question, v: AnswerValue | undefined): boolean {
  if (v === undefined) return false
  if ((q.type === 'single_choice' || q.type === 'dropdown') && q.settings.correct_option_id !== undefined) {
    return choiceIds(v)[0] === q.settings.correct_option_id
  }
  if (q.type === 'multiple_choice' && q.settings.correct_option_ids) {
    const have = new Set(choiceIds(v))
    const want = q.settings.correct_option_ids
    return have.size === want.length && want.every((x) => have.has(x))
  }
  return false
}

/** Numeric value of an answer for formulas. Unanswered = 0. */
export function numericValue(q: Question, v: AnswerValue | undefined): number {
  if (v === undefined) return 0
  if (typeof v === 'number') return v
  if (q.type === 'multiple_choice' || q.type === 'ranking') return choiceIds(v).length
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

function roundTo(n: number, places: number): number {
  const p = Math.max(0, Math.min(10, Math.floor(places)))
  // Scrub binary float noise first (3 * 1.255 is 3.7649999...), then round half away from zero.
  const x = Number(n.toPrecision(12))
  const sign = x < 0 ? -1 : 1
  const abs = Math.abs(x)
  const str = String(abs)
  const r = str.includes('e') ? Math.round(abs * 10 ** p) / 10 ** p : Number(`${Math.round(Number(`${str}e${p}`))}e-${p}`)
  return r === 0 ? 0 : sign * r
}

function evalExpr(e: Expr, env: Env): number {
  if ('num' in e) return finite(e.num)
  if ('ref' in e) {
    if (e.ref.kind === 'hidden') return finite(Number(env.hidden[e.ref.id] ?? 0))
    if (e.ref.kind === 'calc') return env.calcs[e.ref.id] ?? 0
    const q = env.idx.byId.get(e.ref.id)
    if (!q) return 0
    if (q.type === 'calculated') return env.calcs[q.id] ?? 0
    return numericValue(q, env.value(q.id))
  }
  if ('op' in e) {
    const xs = e.args.map((a) => evalExpr(a, env))
    if (xs.length === 0) return 0
    const [first, ...rest] = xs as [number, ...number[]]
    switch (e.op) {
      case '+':
        return finite(xs.reduce((a, b) => a + b, 0))
      case '-':
        return rest.length === 0 ? -first : finite(rest.reduce((a, b) => a - b, first))
      case '*':
        return finite(xs.reduce((a, b) => a * b, 1))
      case '/':
        return finite(rest.reduce((a, b) => (b === 0 ? 0 : a / b), first))
      case 'min':
        return Math.min(...xs)
      case 'max':
        return Math.max(...xs)
    }
  }
  switch (e.fn) {
    case 'score':
      return e.ids.reduce((s, id) => {
        const q = env.idx.byId.get(id)
        return q ? s + questionScore(q, env.value(id)) : s
      }, 0)
    case 'correct':
      return e.ids.reduce((s, id) => {
        const q = env.idx.byId.get(id)
        return q && isCorrect(q, env.value(id)) ? s + 1 : s
      }, 0)
    case 'round':
      return roundTo(evalExpr(e.arg, env), e.places)
    case 'if':
      return evaluateConditionIn(e.cond, env) ? evalExpr(e.then, env) : evalExpr(e.else, env)
  }
}

/**
 * Calc ids in dependency order. Members of a cycle come last and evaluate
 * with their unresolved inputs as 0. Decision: cycles degrade instead of
 * throwing; the linter blocks them at publish.
 */
export function calcOrder(def: SurveyDefinition): string[] {
  const calcs = Object.values(def.questions).filter((q) => q.type === 'calculated')
  const deps = new Map<string, Set<string>>()
  for (const q of calcs) {
    const r = exprRefs(q.settings.formula)
    const d = new Set<string>()
    for (const id of [...r.calcs, ...r.questions]) {
      if (id !== q.id && def.questions[id]?.type === 'calculated') d.add(id)
    }
    deps.set(q.id, d)
  }
  const out: string[] = []
  const done = new Set<string>()
  let progress = true
  while (progress) {
    progress = false
    for (const q of calcs) {
      if (done.has(q.id)) continue
      if ([...(deps.get(q.id) ?? [])].every((d) => done.has(d))) {
        out.push(q.id)
        done.add(q.id)
        progress = true
      }
    }
  }
  for (const q of calcs) if (!done.has(q.id)) out.push(q.id)
  return out
}

function computeCalcs(env: Env): Record<string, number> {
  const out: Record<string, number> = {}
  env.calcs = out
  for (const id of calcOrder(env.def)) {
    const q = env.def.questions[id]
    if (q?.type !== 'calculated') continue
    const raw = evalExpr(q.settings.formula, env)
    out[id] = q.settings.decimals !== undefined ? roundTo(raw, q.settings.decimals) : roundTo(raw, 10)
  }
  return out
}

function exprMax(e: Expr, def: SurveyDefinition, seen: Set<string>): number {
  if ('num' in e) return e.num
  if ('ref' in e) {
    if (e.ref.kind !== 'calc' && def.questions[e.ref.id]?.type !== 'calculated') return 0
    const q = def.questions[e.ref.id]
    if (q?.type !== 'calculated' || seen.has(q.id)) return 0
    return exprMax(q.settings.formula, def, new Set([...seen, q.id]))
  }
  if ('op' in e) {
    const xs = e.args.map((a) => exprMax(a, def, seen))
    if (xs.length === 0) return 0
    if (e.op === '+') return xs.reduce((a, b) => a + b, 0)
    if (e.op === 'min') return Math.min(...xs)
    if (e.op === 'max') return Math.max(...xs)
    if (e.op === '*') return xs.reduce((a, b) => a * b, 1)
    return xs[0] as number
  }
  switch (e.fn) {
    case 'score':
      return e.ids.reduce((s, id) => {
        const q = def.questions[id]
        return q ? s + questionMaxScore(q) : s
      }, 0)
    case 'correct':
      return e.ids.filter((id) => def.questions[id]).length
    case 'round':
      return roundTo(exprMax(e.arg, def, seen), e.places)
    case 'if':
      return Math.max(exprMax(e.then, def, seen), exprMax(e.else, def, seen))
  }
}

/**
 * Maximum quiz score. Decision: exact for sums of score(), correct() and
 * constants; for '-', '/' and other shapes it is an upper estimate.
 */
export function maxScore(def: SurveyDefinition): number | null {
  const id = def.settings.quiz?.score_calc_id
  const q = id ? def.questions[id] : undefined
  if (q?.type !== 'calculated') return null
  return finite(exprMax(q.settings.formula, def, new Set([q.id])))
}

// ---------------------------------------------------------------- randomization

function pinnedOption(o: ChoiceOption): boolean {
  return Boolean(o.pin_last || o.is_other || o.is_exclusive)
}

/** Options in display order. Shuffled only when `randomize` is on and a seed is given. */
export function orderOptions(q: Question, seed: string | undefined): ChoiceOption[] {
  if (q.type !== 'single_choice' && q.type !== 'dropdown' && q.type !== 'multiple_choice' && q.type !== 'ranking') return []
  const opts = q.settings.options
  if (!q.settings.randomize || !seed) return opts.slice()
  return shuffleWithPins(opts, rngFor(seed, q.id), pinnedOption)
}

export function orderMatrixRows(q: Question, seed: string | undefined): MatrixRow[] {
  if (q.type !== 'matrix') return []
  if (!q.settings.randomize_rows || !seed) return q.settings.rows.slice()
  return shuffleWithPins(q.settings.rows, rngFor(seed, q.id), () => false)
}

/** Question ids of a page in display order. `pinned_ids` keep their positions. */
export function orderPageQuestions(page: Page, seed: string | undefined): string[] {
  if (!page.randomize_questions || !seed) return page.question_ids.slice()
  const pinned = new Set(page.randomize_questions.pinned_ids)
  return shuffleWithPins(page.question_ids, rngFor(seed, page.id), (id) => pinned.has(id))
}

/**
 * Page ids in walk order. Only pages listed in `settings.randomize_pages`
 * move, and only among their own positions.
 * Decision: page randomization changes the path walk (it is navigation);
 * question and option shuffles are display only and never touch logic.
 */
export function orderPages(def: SurveyDefinition, seed: string | undefined): string[] {
  const ids = def.pages.map((p) => p.id)
  const subset = def.settings.randomize_pages?.page_ids
  if (!subset || subset.length < 2 || !seed) return ids
  const move = new Set(subset)
  return shuffleWithPins(ids, rngFor(seed, 'pages'), (id) => !move.has(id))
}

// ---------------------------------------------------------------- evaluate

/** Maps wire answers (keyed by question_key, or by id as a fallback) to normalized values by id. */
export function normalizeAnswers(def: SurveyDefinition, answers: Record<string, unknown>): Record<string, AnswerValue> {
  const idx = indexDefinition(def)
  const out: Record<string, AnswerValue> = {}
  for (const [k, raw] of Object.entries(answers)) {
    const q = idx.byKey.get(k) ?? idx.byId.get(k)
    if (!q || q.type === 'calculated' || q.type === 'hidden') continue
    const n = normalizeAnswer(q, raw)
    if (n.kind === 'value') out[q.id] = n.value
  }
  return out
}

/** Hidden param values: context first, then the hidden question's default. */
export function resolveHidden(def: SurveyDefinition, hidden: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(hidden ?? {})) if (typeof v === 'string') out[k] = v
  for (const q of Object.values(def.questions)) {
    if (q.type === 'hidden' && out[q.settings.param] === undefined && q.settings.default_value !== undefined) {
      out[q.settings.param] = q.settings.default_value
    }
  }
  return out
}

/** Hidden and calculated questions placed on no page are always on the path. */
function isPageless(q: Question, idx: DefinitionIndex): boolean {
  return (q.type === 'hidden' || q.type === 'calculated') && !idx.pageOf.has(q.id)
}

interface WalkResult {
  path: string[]
  visible: Set<string>
  ending_id: string | null
  ended_early: boolean
}

function walk(def: SurveyDefinition, idx: DefinitionIndex, base: Record<string, AnswerValue>, calcs: Record<string, number>, hidden: Record<string, string>, seed: string | undefined): WalkResult {
  const known = new Set<string>()
  const env: Env = {
    def,
    idx,
    calcs,
    hidden,
    value: (id) => {
      const q = idx.byId.get(id)
      if (!q) return undefined
      if (q.type === 'hidden' || known.has(id)) return base[id]
      return undefined
    },
  }
  const showQ = new Map<string, Condition[]>()
  const hideQ = new Map<string, Condition[]>()
  const showP = new Map<string, Condition[]>()
  const jumps = new Map<string, Extract<SurveyDefinition['logic'][number], { kind: 'jump' }>[]>()
  const setEndings: Extract<SurveyDefinition['logic'][number], { kind: 'set_ending' }>[] = []
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
    const arr = m.get(k)
    if (arr) arr.push(v)
    else m.set(k, [v])
  }
  for (const r of def.logic) {
    if (r.kind === 'show_question') push(showQ, r.target_id, r.when)
    else if (r.kind === 'hide_question') push(hideQ, r.target_id, r.when)
    else if (r.kind === 'show_page') push(showP, r.target_id, r.when)
    else if (r.kind === 'jump') push(jumps, r.from_page_id, r)
    else setEndings.push(r)
  }
  const questionVisible = (id: string) => {
    const shows = showQ.get(id)
    const hides = hideQ.get(id)
    if (shows && !shows.some((c) => evaluateConditionIn(c, env))) return false
    if (hides && hides.some((c) => evaluateConditionIn(c, env))) return false
    return true
  }

  const visible = new Set<string>()
  const path: string[] = []
  const order = orderPages(def, seed)
  let ending_id: string | null = null
  let ended_early = false
  let i = 0
  while (i < order.length) {
    const page = idx.pagesById.get(order[i] as string) as Page
    const shows = showP.get(page.id)
    if (shows && !shows.some((c) => evaluateConditionIn(c, env))) {
      i++
      continue
    }
    path.push(page.id)
    for (const qid of page.question_ids) {
      if (!idx.byId.has(qid) || idx.pageOf.get(qid) !== page.id) continue
      if (questionVisible(qid)) {
        visible.add(qid)
        known.add(qid)
      }
    }
    const match = byOrder(jumps.get(page.id) ?? []).find((r) => evaluateConditionIn(r.when, env))
    if (match) {
      if ('ending_id' in match.to) {
        const target = match.to.ending_id
        if (def.endings.some((e) => e.id === target)) {
          ending_id = target
          ended_early = true
          break
        }
      } else {
        // Decision: a jump to an unknown, earlier, or same page is ignored (linter blocks it).
        const j = order.indexOf(match.to.page_id)
        if (j > i) {
          i = j
          continue
        }
      }
    }
    i++
  }
  for (const q of Object.values(def.questions)) {
    if (isPageless(q, idx) && questionVisible(q.id)) visible.add(q.id)
  }
  if (!ended_early) {
    const hit = byOrder(setEndings).find((r) => def.endings.some((e) => e.id === r.ending_id) && evaluateConditionIn(r.when, env))
    ending_id = hit?.ending_id ?? def.endings[0]?.id ?? null
  }
  return { path, visible, ending_id, ended_early }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function sameCalcs(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * Evaluate a definition against answers (doc 03 section 3, Evaluation order).
 * `answers` use the wire format: keyed by question_key (question id accepted
 * as a fallback). Unknown keys and client calc values are dropped.
 */
export function evaluate(def: SurveyDefinition, answers: Record<string, unknown>, context: EvalContext = {}): EvalState {
  return evaluateNormalized(def, normalizeAnswers(def, answers), context)
}

/** Same as evaluate() for answers already normalized and keyed by question id. */
export function evaluateNormalized(def: SurveyDefinition, normalized: Record<string, AnswerValue>, context: EvalContext = {}): EvalState {
  const idx = indexDefinition(def)
  const hidden = resolveHidden(def, context.hidden)
  // Step 2: hidden questions take their value from the URL params only.
  const base: Record<string, AnswerValue> = {}
  for (const [id, v] of Object.entries(normalized)) {
    const q = idx.byId.get(id)
    if (q && q.type !== 'hidden' && q.type !== 'calculated') base[id] = v
  }
  for (const q of Object.values(def.questions)) {
    if (q.type === 'hidden' && hidden[q.settings.param] !== undefined && hidden[q.settings.param] !== '') {
      base[q.id] = hidden[q.settings.param] as string
    }
  }

  let masked: Record<string, AnswerValue> = base
  let prev: { visible: Set<string>; calcs: Record<string, number> } | null = null
  let result!: WalkResult
  let calcs: Record<string, number> = {}
  for (let pass = 0; pass < MAX_EVAL_PASSES; pass++) {
    const calcEnv: Env = { def, idx, calcs: {}, hidden, value: (id) => masked[id] }
    calcs = computeCalcs(calcEnv)
    result = walk(def, idx, base, calcs, hidden, context.seed)
    if (prev && sameSet(prev.visible, result.visible) && sameCalcs(prev.calcs, calcs)) break
    prev = { visible: result.visible, calcs }
    const vis = result.visible
    masked = Object.fromEntries(Object.entries(base).filter(([id]) => vis.has(id) || idx.byId.get(id)?.type === 'hidden'))
  }

  const scored = scoredCalcIds(def)
  const effective: Record<string, AnswerValue> = {}
  const visible_keys: string[] = []
  const seenKeys = new Set<string>()
  const ordered = [...result.path.flatMap((pid) => idx.pagesById.get(pid)?.question_ids ?? []), ...Object.keys(def.questions)]
  for (const id of ordered) {
    if (seenKeys.has(id) || !result.visible.has(id)) continue
    seenKeys.add(id)
    const q = idx.byId.get(id) as Question
    if (q.type === 'statement' || q.type === 'image') continue
    if (q.type === 'calculated') {
      if (calcs[id] !== undefined) effective[id] = calcs[id]
      if (scored.has(id)) continue
    } else if (base[id] !== undefined) {
      effective[id] = base[id]
    }
    visible_keys.push(q.question_key)
  }

  const quizId = def.settings.quiz?.score_calc_id
  const scoreValue = quizId !== undefined ? calcs[quizId] : undefined
  const max = scoreValue !== undefined ? maxScore(def) : null
  return {
    path: result.path,
    visible: result.visible,
    visible_keys,
    answers: effective,
    calcs,
    hidden,
    score: scoreValue !== undefined && max !== null ? { value: scoreValue, max } : null,
    ending_id: result.ending_id,
    ended_early: result.ended_early,
  }
}
