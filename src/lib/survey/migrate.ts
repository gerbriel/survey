/**
 * migrateDefinition (doc 03 section 2): validate shape and upgrade older
 * schema_version values in memory, step by step. Frozen rows are never
 * rewritten.
 *
 * Decision: hand-written guards, not zod. zod is only a transitive dependency
 * (via eslint-config-next) and is not declared in package.json, so importing
 * it would break under pnpm's strict node_modules.
 */

import { CURRENT_SCHEMA_VERSION, OPERATORS, QUESTION_TYPES, type SurveyDefinition } from './types'

export class DefinitionShapeError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid survey definition: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ''}`)
    this.name = 'DefinitionShapeError'
    this.issues = issues
  }
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isRich = (v: unknown): boolean => isObj(v) && v.format === 'md-lite' && isStr(v.text)

const QTYPES: ReadonlySet<string> = new Set(QUESTION_TYPES)
const OPS: ReadonlySet<string> = new Set(OPERATORS)

class Checker {
  issues: string[] = []
  need(ok: boolean, path: string, what: string): boolean {
    if (!ok) this.issues.push(`${path}: ${what}`)
    return ok
  }
  optRich(o: Obj, key: string, path: string) {
    if (o[key] !== undefined) this.need(isRich(o[key]), `${path}.${key}`, 'expected rich text')
  }
  strArray(v: unknown, path: string) {
    this.need(Array.isArray(v) && v.every(isStr), path, 'expected string[]')
  }
}

function checkOptions(c: Checker, v: unknown, path: string) {
  if (!c.need(Array.isArray(v), path, 'expected options array')) return
  ;(v as unknown[]).forEach((o, i) => {
    const p = `${path}[${i}]`
    if (!c.need(isObj(o), p, 'expected object')) return
    const opt = o as Obj
    c.need(isStr(opt.id), `${p}.id`, 'expected string')
    c.need(isStr(opt.label), `${p}.label`, 'expected string')
    if (opt.score !== undefined) c.need(isNum(opt.score), `${p}.score`, 'expected number')
  })
}

function checkExpr(c: Checker, e: unknown, path: string, depth: number) {
  if (!c.need(depth < 64, path, 'expression too deep')) return
  if (!c.need(isObj(e), path, 'expected expression')) return
  const x = e as Obj
  if ('num' in x) c.need(isNum(x.num), path, 'num must be a number')
  else if ('ref' in x) c.need(isObj(x.ref) && ['question', 'hidden', 'calc'].includes(String(x.ref.kind)) && isStr(x.ref.id), path, 'bad ref')
  else if ('op' in x) {
    c.need(['+', '-', '*', '/', 'min', 'max'].includes(String(x.op)), path, 'bad op')
    if (c.need(Array.isArray(x.args), path, 'args must be an array')) (x.args as unknown[]).forEach((a, i) => checkExpr(c, a, `${path}.args[${i}]`, depth + 1))
  } else if (x.fn === 'score' || x.fn === 'correct') c.strArray(x.ids, `${path}.ids`)
  else if (x.fn === 'round') {
    c.need(isNum(x.places), path, 'places must be a number')
    checkExpr(c, x.arg, `${path}.arg`, depth + 1)
  } else if (x.fn === 'if') {
    checkCondition(c, x.cond, `${path}.cond`, depth + 1)
    checkExpr(c, x.then, `${path}.then`, depth + 1)
    checkExpr(c, x.else, `${path}.else`, depth + 1)
  } else c.need(false, path, 'unknown expression')
}

function checkCondition(c: Checker, v: unknown, path: string, depth: number) {
  if (!c.need(depth < 64, path, 'condition too deep')) return
  if (!c.need(isObj(v), path, 'expected condition')) return
  const x = v as Obj
  if ('all' in x || 'any' in x) {
    const list = (x.all ?? x.any) as unknown
    if (c.need(Array.isArray(list), path, 'group must be an array')) (list as unknown[]).forEach((y, i) => checkCondition(c, y, `${path}[${i}]`, depth + 1))
    return
  }
  if ('not' in x) return checkCondition(c, x.not, `${path}.not`, depth + 1)
  c.need(OPS.has(String(x.op)), `${path}.op`, 'unknown operator')
  const f = x.field
  if (!c.need(isObj(f), `${path}.field`, 'expected field')) return
  const fo = f as Obj
  if (fo.kind === 'question' || fo.kind === 'calc') c.need(isStr(fo.id), `${path}.field.id`, 'expected string')
  else if (fo.kind === 'hidden') c.need(isStr(fo.param), `${path}.field.param`, 'expected string')
  else c.need(false, `${path}.field.kind`, 'unknown field kind')
}

function checkQuestion(c: Checker, id: string, v: unknown) {
  const p = `questions.${id}`
  if (!c.need(isObj(v), p, 'expected object')) return
  const q = v as Obj
  c.need(q.id === id, `${p}.id`, 'must equal its record key')
  c.need(isStr(q.question_key), `${p}.question_key`, 'expected string')
  if (!c.need(QTYPES.has(String(q.type)), `${p}.type`, 'unknown question type')) return
  c.need(isRich(q.label), `${p}.label`, 'expected rich text')
  c.optRich(q, 'help', p)
  c.need(isBool(q.required), `${p}.required`, 'expected boolean')
  if (q.validation !== undefined) c.need(isObj(q.validation), `${p}.validation`, 'expected object')
  if (!c.need(isObj(q.settings), `${p}.settings`, 'expected object')) return
  const s = q.settings as Obj
  const sp = `${p}.settings`
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
    case 'ranking':
      checkOptions(c, s.options, `${sp}.options`)
      c.need(isBool(s.randomize), `${sp}.randomize`, 'expected boolean')
      break
    case 'yes_no':
      c.need(isStr(s.yes_label) && isStr(s.no_label), sp, 'yes_label and no_label required')
      break
    case 'rating':
      c.need(isNum(s.points) && Number.isInteger(s.points) && s.points >= 3 && s.points <= 10, `${sp}.points`, 'integer 3 to 10')
      break
    case 'matrix':
      for (const k of ['rows', 'columns'] as const) {
        if (c.need(Array.isArray(s[k]), `${sp}.${k}`, 'expected array')) {
          ;(s[k] as unknown[]).forEach((r, i) => c.need(isObj(r) && isStr(r.id) && isStr(r.label), `${sp}.${k}[${i}]`, 'expected { id, label }'))
        }
      }
      c.need(isBool(s.randomize_rows) && isBool(s.all_rows_required), sp, 'randomize_rows and all_rows_required required')
      break
    case 'time':
      c.need(isNum(s.minute_step) && s.minute_step >= 1, `${sp}.minute_step`, 'positive number')
      break
    case 'phone':
      c.need(isStr(s.default_country), `${sp}.default_country`, 'expected string')
      break
    case 'date':
      c.need(['MDY', 'DMY', 'YMD'].includes(String(s.display_format)), `${sp}.display_format`, 'MDY, DMY or YMD')
      break
    case 'address':
      c.need(isObj(s.parts_required), `${sp}.parts_required`, 'expected object')
      break
    case 'consent':
      c.need(s.text_source === 'workspace' || s.text_source === 'custom', `${sp}.text_source`, 'workspace or custom')
      c.need(isBool(s.gates_tracking), `${sp}.gates_tracking`, 'expected boolean')
      break
    case 'hidden':
      c.need(isStr(s.param) && s.param !== '', `${sp}.param`, 'expected non-empty string')
      break
    case 'calculated':
      checkExpr(c, s.formula, `${sp}.formula`, 0)
      c.need(isStr(s.formula_source), `${sp}.formula_source`, 'expected string')
      c.need(isBool(s.visible), `${sp}.visible`, 'expected boolean')
      break
    case 'statement':
      c.need(isRich(s.body), `${sp}.body`, 'expected rich text')
      break
    case 'image':
      c.need(isStr(s.path) && isStr(s.alt), sp, 'path and alt required')
      break
    default:
      break
  }
}

function checkRule(c: Checker, v: unknown, i: number) {
  const p = `logic[${i}]`
  if (!c.need(isObj(v), p, 'expected object')) return
  const r = v as Obj
  c.need(isStr(r.id), `${p}.id`, 'expected string')
  checkCondition(c, r.when, `${p}.when`, 0)
  switch (r.kind) {
    case 'show_question':
    case 'hide_question':
    case 'show_page':
      c.need(isStr(r.target_id), `${p}.target_id`, 'expected string')
      break
    case 'jump':
      c.need(isStr(r.from_page_id), `${p}.from_page_id`, 'expected string')
      c.need(isObj(r.to) && (isStr(r.to.page_id) || isStr(r.to.ending_id)), `${p}.to`, 'expected { page_id } or { ending_id }')
      c.need(isNum(r.order), `${p}.order`, 'expected number')
      break
    case 'set_ending':
      c.need(isStr(r.ending_id), `${p}.ending_id`, 'expected string')
      c.need(isNum(r.order), `${p}.order`, 'expected number')
      break
    default:
      c.need(false, `${p}.kind`, 'unknown rule kind')
  }
}

/** L5: a CSS hex color, #rgb or #rrggbb, nothing else (no `;`, no url()). */
export const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR_RE.test(v)
}

/** Full shape check of a current-version definition. Returns issue strings. */
export function checkDefinitionShape(v: unknown): string[] {
  const c = new Checker()
  if (!c.need(isObj(v), '$', 'expected object')) return c.issues
  const d = v as Obj
  c.need(d.schema_version === CURRENT_SCHEMA_VERSION, 'schema_version', `expected ${CURRENT_SCHEMA_VERSION}`)
  if (c.need(isObj(d.settings), 'settings', 'expected object')) {
    const s = d.settings as Obj
    c.need(isStr(s.title), 'settings.title', 'expected string')
    for (const k of ['show_progress', 'show_question_numbers', 'allow_back', 'one_question_per_screen', 'autosave_partial', 'trust_hidden_identity']) {
      c.need(isBool(s[k]), `settings.${k}`, 'expected boolean')
    }
    c.optRich(s, 'description', 'settings')
    if (s.quiz !== undefined) c.need(isObj(s.quiz) && isStr(s.quiz.score_calc_id) && isBool(s.quiz.show_correct_answers), 'settings.quiz', 'expected { score_calc_id, show_correct_answers }')
    if (s.randomize_pages !== undefined) c.need(isObj(s.randomize_pages) && Array.isArray(s.randomize_pages.page_ids), 'settings.randomize_pages', 'expected { page_ids }')
  }
  if (c.need(isObj(d.theme), 'theme', 'expected object')) {
    // L5: theme colors reach inline CSS; only #rgb or #rrggbb is accepted.
    const colors = (d.theme as Obj).colors
    if (colors !== undefined && c.need(isObj(colors), 'theme.colors', 'expected object')) {
      for (const [k, v] of Object.entries(colors as Obj)) c.need(isHexColor(v), `theme.colors.${k}`, 'expected #rgb or #rrggbb')
    }
  }
  if (c.need(Array.isArray(d.pages), 'pages', 'expected array')) {
    ;(d.pages as unknown[]).forEach((pg, i) => {
      const p = `pages[${i}]`
      if (!isObj(pg)) return void c.need(false, p, 'expected object')
      c.need(isStr(pg.id), `${p}.id`, 'expected string')
      c.strArray(pg.question_ids, `${p}.question_ids`)
      c.optRich(pg, 'description', p)
      if (pg.randomize_questions !== undefined) c.need(isObj(pg.randomize_questions) && Array.isArray(pg.randomize_questions.pinned_ids), `${p}.randomize_questions`, 'expected { pinned_ids }')
    })
  }
  if (c.need(isObj(d.questions), 'questions', 'expected object')) {
    for (const [id, q] of Object.entries(d.questions as Obj)) checkQuestion(c, id, q)
  }
  if (c.need(Array.isArray(d.logic), 'logic', 'expected array')) (d.logic as unknown[]).forEach((r, i) => checkRule(c, r, i))
  if (c.need(Array.isArray(d.endings), 'endings', 'expected array')) {
    ;(d.endings as unknown[]).forEach((e, i) => {
      const p = `endings[${i}]`
      if (!isObj(e)) return void c.need(false, p, 'expected object')
      c.need(isStr(e.id), `${p}.id`, 'expected string')
      c.need(isRich(e.message), `${p}.message`, 'expected rich text')
      c.need(isBool(e.show_score) && isBool(e.show_summary), p, 'show_score and show_summary required')
      if (e.redirect_url !== undefined) c.need(isStr(e.redirect_url), `${p}.redirect_url`, 'expected string')
    })
  }
  c.need(isRich(d.closed_message), 'closed_message', 'expected rich text')
  c.need(isObj(d.identity), 'identity', 'expected object')
  c.strArray(d.pixel_exclusions, 'pixel_exclusions')
  return c.issues
}

/**
 * One step per historical version. To add version 2: bump
 * CURRENT_SCHEMA_VERSION, add `case 1: d = v1ToV2(d); break` here, and the
 * loop carries any v1 row forward.
 */
function upgradeOnce(d: Obj, from: number): Obj {
  switch (from) {
    default:
      throw new DefinitionShapeError([`schema_version: no upgrade path from ${from}`])
  }
}

/** Fill collections an older editor may have omitted. Decision: missing collections default to empty instead of failing. */
function fillDefaults(d: Obj): Obj {
  return {
    ...d,
    logic: d.logic ?? [],
    identity: d.identity ?? {},
    pixel_exclusions: d.pixel_exclusions ?? [],
  }
}

/**
 * Validate and upgrade. Never mutates the input. Throws DefinitionShapeError
 * with every issue found.
 */
export function migrateDefinition(def: unknown): SurveyDefinition {
  if (!isObj(def)) throw new DefinitionShapeError(['$: expected object'])
  let d: Obj = JSON.parse(JSON.stringify(def)) as Obj
  const v = d.schema_version
  if (!isNum(v) || !Number.isInteger(v) || v < 1) throw new DefinitionShapeError(['schema_version: expected a positive integer'])
  if (v > CURRENT_SCHEMA_VERSION) throw new DefinitionShapeError([`schema_version: ${v} is newer than this code (${CURRENT_SCHEMA_VERSION})`])
  for (let from = v; from < CURRENT_SCHEMA_VERSION; from++) d = upgradeOnce(d, from)
  d = fillDefaults(d)
  const issues = checkDefinitionShape(d)
  if (issues.length > 0) throw new DefinitionShapeError(issues)
  return d as unknown as SurveyDefinition
}

export function safeMigrateDefinition(def: unknown): { ok: true; definition: SurveyDefinition } | { ok: false; issues: string[] } {
  try {
    return { ok: true, definition: migrateDefinition(def) }
  } catch (e) {
    if (e instanceof DefinitionShapeError) return { ok: false, issues: e.issues }
    throw e
  }
}
