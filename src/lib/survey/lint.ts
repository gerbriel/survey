/**
 * Publish lint (doc 03 section 7) and change classification (diffDefinitions).
 * Errors block publish; warnings do not.
 */

import type { Condition, LeafField, LogicRule, Question, QuestionType, RichText, SurveyDefinition } from './types'
import { STORAGE_COLUMN } from './types'
import { conditionDepth, exprRefs, indexDefinition, scoredCalcIds } from './definition'
import { MAX_CONDITION_DEPTH, operatorsForField } from './engine'
import { isId, isQuestionKey } from './ids'
import { isPipeableType, parsePipeTokens } from './pipe'
import { isSafeRegex } from './regex'
import { containsServerOnlyKeys, splitDefinition } from './split'

export const MAX_QUESTIONS = 300
export const MAX_DEFINITION_BYTES = 1024 * 1024

export type LintSeverity = 'error' | 'warning'

export type LintCode =
  | 'question_cap'
  | 'size_cap'
  | 'question_id_mismatch'
  | 'question_key_format'
  | 'question_key_duplicate'
  | 'question_key_collides_with_id'
  | 'option_id_duplicate'
  | 'option_id_format'
  | 'options_empty'
  | 'option_label_empty'
  | 'page_id_duplicate'
  | 'page_unknown_question'
  | 'question_on_many_pages'
  | 'question_orphan'
  | 'identity_type'
  | 'identity_missing'
  | 'endings_empty'
  | 'ending_id_duplicate'
  | 'redirect_url'
  | 'rule_id_duplicate'
  | 'logic_ref'
  | 'logic_operator'
  | 'logic_depth'
  | 'jump_backward'
  | 'calc_ref'
  | 'calc_cycle'
  | 'pipe_ref'
  | 'pipe_later'
  | 'pipe_not_pipeable'
  | 'regex_invalid'
  | 'scored_calc_visible'
  | 'scored_calc_use'
  | 'quiz_calc'
  | 'server_only_leak'
  | 'contact_field_type'
  | 'contact_field_missing'
  | 'consent_tracking_missing'
  | 'randomized_page_jump'

export interface LintIssue {
  code: LintCode
  severity: LintSeverity
  message: string
  /** Dot path into the definition, for the builder to highlight. */
  path?: string
  question_id?: string
}

export interface LintOptions {
  /** contact_field_defs keys of the workspace; when given, custom targets are checked. */
  contactFieldKeys?: string[]
  /** Workspace pixel_consent_mode (00 R7). */
  pixelConsentMode?: 'banner' | 'notice' | 'in_form'
  /** True when at least one workspace pixel loads for this survey. */
  loadsPixels?: boolean
  /** Override the 300 question cap (workspace_limits). */
  maxQuestions?: number
  /** Override the 1 MB size cap (workspace_limits). */
  maxDefinitionBytes?: number
}

export interface LintResult {
  ok: boolean
  issues: LintIssue[]
}

const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set(['single_choice', 'dropdown', 'multiple_choice', 'ranking'])

/** contact_field compatibility (doc 03 section 2). */
const CONTACT_FIELD_TYPES: ReadonlySet<QuestionType> = new Set(['short_text', 'phone', 'email', 'number', 'date', 'single_choice', 'dropdown', 'yes_no'])

export function lintDefinition(def: SurveyDefinition, opts: LintOptions = {}): LintResult {
  const issues: LintIssue[] = []
  const add = (severity: LintSeverity, code: LintCode, message: string, extra: { path?: string; question_id?: string } = {}) =>
    issues.push({ code, severity, message, ...extra })
  const error = (code: LintCode, message: string, extra?: { path?: string; question_id?: string }) => add('error', code, message, extra)
  const warn = (code: LintCode, message: string, extra?: { path?: string; question_id?: string }) => add('warning', code, message, extra)

  const idx = indexDefinition(def)
  const questions = Object.entries(def.questions)
  const scored = scoredCalcIds(def)

  // Caps
  const maxQ = opts.maxQuestions ?? MAX_QUESTIONS
  if (questions.length > maxQ) error('question_cap', `A survey can have at most ${maxQ} questions (has ${questions.length}).`)
  const bytes = new TextEncoder().encode(JSON.stringify(def)).length
  const maxB = opts.maxDefinitionBytes ?? MAX_DEFINITION_BYTES
  if (bytes > maxB) error('size_cap', `The survey definition is ${bytes} bytes; the limit is ${maxB}.`)

  // Questions: ids, keys, options
  const keys = new Map<string, string>()
  for (const [id, q] of questions) {
    const path = `questions.${id}`
    if (q.id !== id) error('question_id_mismatch', `Question record key ${id} does not match its id ${q.id}.`, { path, question_id: id })
    if (!isQuestionKey(q.question_key)) error('question_key_format', `Question key "${q.question_key}" must match q_ plus 8 lowercase letters or digits.`, { path: `${path}.question_key`, question_id: id })
    const dup = keys.get(q.question_key)
    if (dup) error('question_key_duplicate', `Question key "${q.question_key}" is used twice.`, { path: `${path}.question_key`, question_id: id })
    else keys.set(q.question_key, id)
  }
  // Decision: a question id may not equal another question's key, so answers
  // keyed by either resolve to one question.
  for (const [id, q] of questions) {
    const owner = keys.get(id)
    if (owner && owner !== id) error('question_key_collides_with_id', `Question id ${id} equals the key of another question.`, { question_id: q.id })
  }
  for (const [id, q] of questions) {
    const path = `questions.${id}.settings`
    if (CHOICE_TYPES.has(q.type)) {
      const opts2 = (q.settings as { options: { id: string; label: string }[] }).options
      if (opts2.length === 0) error('options_empty', 'Add at least one option.', { path: `${path}.options`, question_id: id })
      checkIds(opts2, 'option', `${path}.options`, id)
    }
    if (q.type === 'matrix') {
      if (q.settings.rows.length === 0 || q.settings.columns.length === 0) error('options_empty', 'A matrix needs at least one row and one column.', { path, question_id: id })
      checkIds(q.settings.rows, 'row', `${path}.rows`, id)
      checkIds(q.settings.columns, 'column', `${path}.columns`, id)
    }
    if (q.validation?.pattern && !isSafeRegex(q.validation.pattern.regex)) {
      error('regex_invalid', 'The pattern is invalid, longer than 200 characters, or may be slow (nested quantifiers).', { path: `questions.${id}.validation.pattern`, question_id: id })
    }
    if (q.contact_field) {
      const cf = q.contact_field
      const ok =
        CONTACT_FIELD_TYPES.has(q.type) &&
        !(q.type === 'email' && cf.kind === 'core') &&
        !(cf.kind === 'core' && cf.field === 'phone' && q.type !== 'phone') &&
        !(cf.kind === 'core' && cf.field !== 'phone' && q.type !== 'short_text')
      if (!ok) error('contact_field_type', `This question type cannot fill that contact field.`, { path: `questions.${id}.contact_field`, question_id: id })
      if (cf.kind === 'custom' && opts.contactFieldKeys && !opts.contactFieldKeys.includes(cf.key)) {
        error('contact_field_missing', `Contact field "${cf.key}" does not exist in this workspace.`, { path: `questions.${id}.contact_field`, question_id: id })
      }
    }
  }

  function checkIds(items: { id: string; label: string }[], kind: 'option' | 'row' | 'column', path: string, qid: string) {
    const seen = new Set<string>()
    items.forEach((it, i) => {
      if (seen.has(it.id)) error('option_id_duplicate', `Duplicate ${kind} id ${it.id}.`, { path: `${path}[${i}].id`, question_id: qid })
      seen.add(it.id)
      // Decision: id format is a warning; SQL only enforces uniqueness, and imported templates may predate the generator.
      if (!isId(kind, it.id)) warn('option_id_format', `The ${kind} id ${it.id} does not use the standard format.`, { path: `${path}[${i}].id`, question_id: qid })
      if (it.label.trim() === '') error('option_label_empty', `A ${kind} has an empty label.`, { path: `${path}[${i}].label`, question_id: qid })
    })
  }

  // Pages
  const pageSeen = new Set<string>()
  const onPage = new Map<string, number>()
  def.pages.forEach((p, i) => {
    if (pageSeen.has(p.id)) error('page_id_duplicate', `Duplicate page id ${p.id}.`, { path: `pages[${i}].id` })
    pageSeen.add(p.id)
    p.question_ids.forEach((qid, j) => {
      if (!def.questions[qid]) error('page_unknown_question', `Page ${i + 1} lists a question that does not exist (${qid}).`, { path: `pages[${i}].question_ids[${j}]` })
      onPage.set(qid, (onPage.get(qid) ?? 0) + 1)
    })
  })
  for (const [id, q] of questions) {
    const n = onPage.get(id) ?? 0
    if (n > 1) error('question_on_many_pages', 'A question may appear on only one page.', { question_id: id })
    // Decision: hidden and calculated questions may live on no page (always evaluated).
    if (n === 0 && q.type !== 'hidden' && q.type !== 'calculated') error('question_orphan', 'This question is not on any page.', { question_id: id })
  }

  // Identity
  const em = def.identity.email_question_id
  if (em !== undefined && def.questions[em]?.type !== 'email') error('identity_type', 'The identity email must point at an email question.', { path: 'identity.email_question_id' })
  const ph = def.identity.phone_question_id
  if (ph !== undefined && def.questions[ph]?.type !== 'phone') error('identity_type', 'The identity phone must point at a phone question.', { path: 'identity.phone_question_id' })
  if (em === undefined) {
    const firstEmail = Object.values(def.questions).find((x) => x.type === 'email')
    if (firstEmail) warn('identity_missing', 'There is an email question but no identity key, so responses will not be matched to contacts. Mark the email question as the identity key in its settings.', { question_id: firstEmail.id })
  }

  // Endings
  if (def.endings.length === 0) error('endings_empty', 'Add at least one ending.', { path: 'endings' })
  const endingIds = new Set<string>()
  def.endings.forEach((e, i) => {
    if (endingIds.has(e.id)) error('ending_id_duplicate', `Duplicate ending id ${e.id}.`, { path: `endings[${i}].id` })
    endingIds.add(e.id)
    if (e.redirect_url !== undefined) {
      const stripped = e.redirect_url.replace(/\{\{[^}]*\}\}/g, 'x')
      let ok = /^https?:\/\//i.test(stripped)
      if (ok) {
        try {
          new URL(stripped)
        } catch {
          ok = false
        }
      }
      if (!ok) error('redirect_url', 'Redirect URLs must start with http:// or https://.', { path: `endings[${i}].redirect_url` })
    }
  })

  // Logic
  const pageIdx = idx.pageIndex
  const pageOfQ = (qid: string) => idx.pageOf.get(qid)
  const randomized = new Set(def.settings.randomize_pages?.page_ids ?? [])
  const ruleIds = new Set<string>()
  def.logic.forEach((r, i) => {
    const path = `logic[${i}]`
    if (ruleIds.has(r.id)) error('rule_id_duplicate', `Duplicate rule id ${r.id}.`, { path })
    ruleIds.add(r.id)
    checkCondition(r.when, `${path}.when`, r)
    switch (r.kind) {
      case 'show_question':
      case 'hide_question':
        if (!def.questions[r.target_id]) error('logic_ref', 'The rule targets a question that does not exist.', { path })
        break
      case 'show_page':
        if (!pageIdx.has(r.target_id)) error('logic_ref', 'The rule targets a page that does not exist.', { path })
        break
      case 'jump': {
        const from = pageIdx.get(r.from_page_id)
        if (from === undefined) error('logic_ref', 'The jump starts from a page that does not exist.', { path })
        if ('page_id' in r.to) {
          const to = pageIdx.get(r.to.page_id)
          if (to === undefined) error('logic_ref', 'The jump goes to a page that does not exist.', { path })
          else if (from !== undefined && to <= from) error('jump_backward', 'Jumps must go to a later page.', { path })
          if (randomized.has(r.from_page_id) || randomized.has(r.to.page_id)) warn('randomized_page_jump', 'This jump involves a randomized page, so "later" depends on the shuffled order.', { path })
        } else if (!endingIds.has(r.to.ending_id)) error('logic_ref', 'The jump ends on an ending that does not exist.', { path })
        break
      }
      case 'set_ending':
        if (!endingIds.has(r.ending_id)) error('logic_ref', 'The rule picks an ending that does not exist.', { path })
        break
    }
  })

  function checkCondition(c: Condition, path: string, rule: LogicRule | null) {
    if (conditionDepth(c) > MAX_CONDITION_DEPTH) error('logic_depth', `Conditions may nest at most ${MAX_CONDITION_DEPTH} groups deep.`, { path })
    const visit = (x: Condition, p: string) => {
      if ('all' in x) return x.all.forEach((y, i) => visit(y, `${p}.all[${i}]`))
      if ('any' in x) return x.any.forEach((y, i) => visit(y, `${p}.any[${i}]`))
      if ('not' in x) return visit(x.not, `${p}.not`)
      const f = x.field
      const type = fieldType(f)
      if (type === null) {
        error('logic_ref', 'The condition refers to a field that does not exist.', { path: p })
        return
      }
      if (f.kind === 'question' && f.row_id !== undefined) {
        const q = def.questions[f.id]
        if (q?.type !== 'matrix' || !q.settings.rows.some((row) => row.id === f.row_id)) error('logic_ref', 'The condition refers to a matrix row that does not exist.', { path: p })
      }
      const allowed = operatorsForField(type, f.kind === 'question' && f.row_id !== undefined)
      if (!allowed.includes(x.op)) error('logic_operator', `Operator "${x.op}" is not allowed for ${type} fields.`, { path: p })
      if (x.op === 'matches' && (typeof x.value !== 'string' || !isSafeRegex(x.value))) error('regex_invalid', 'The pattern is invalid or may be slow.', { path: p })
      const calcId = f.kind === 'calc' ? f.id : f.kind === 'question' && def.questions[f.id]?.type === 'calculated' ? f.id : null
      if (calcId && scored.has(calcId) && rule && rule.kind !== 'set_ending') {
        error('scored_calc_use', 'Scored calculations can only choose endings; the browser cannot evaluate them.', { path: p })
      }
    }
    visit(c, path)
  }

  function fieldType(f: LeafField): QuestionType | null {
    if (f.kind === 'hidden') return 'hidden'
    const q = def.questions[f.id]
    if (!q) return null
    if (f.kind === 'calc' && q.type !== 'calculated') return null
    return q.type
  }

  // Calcs
  for (const [id, q] of questions) {
    if (q.type !== 'calculated') continue
    const r = exprRefs(q.settings.formula)
    for (const ref of [...r.questions, ...r.scored]) if (!def.questions[ref]) error('calc_ref', `The formula refers to a missing question (${ref}).`, { question_id: id })
    for (const ref of r.calcs) if (def.questions[ref]?.type !== 'calculated') error('calc_ref', `The formula refers to a missing calculation (${ref}).`, { question_id: id })
    const conds: Condition[] = []
    const collect = (e: typeof q.settings.formula) => {
      if ('fn' in e && e.fn === 'if') {
        conds.push(e.cond)
        collect(e.then)
        collect(e.else)
      } else if ('fn' in e && e.fn === 'round') collect(e.arg)
      else if ('op' in e) e.args.forEach(collect)
    }
    collect(q.settings.formula)
    conds.forEach((c) => checkCondition(c, `questions.${id}.settings.formula`, null))
    if (scored.has(id) && q.settings.visible) error('scored_calc_visible', 'A scored calculation must be hidden from respondents.', { question_id: id })
  }
  for (const id of calcCycles(def)) error('calc_cycle', 'Calculations refer to each other in a loop.', { question_id: id })
  const quiz = def.settings.quiz
  if (quiz && def.questions[quiz.score_calc_id]?.type !== 'calculated') error('quiz_calc', 'The quiz score must be a calculated question.', { path: 'settings.quiz.score_calc_id' })

  // Piping
  const pagePos = (qid: string): number => {
    const pid = pageOfQ(qid)
    return pid === undefined ? -1 : (pageIdx.get(pid) ?? -1)
  }
  const checkPipes = (text: string | undefined, path: string, at: { page: number | null }) => {
    if (!text) return
    for (const t of parsePipeTokens(text)) {
      if (t.kind === 'hidden') continue
      const q = idx.byKey.get(t.ref)
      if (!q || (t.kind === 'calc' && q.type !== 'calculated')) {
        error('pipe_ref', `Piping token ${t.raw} refers to a missing question.`, { path })
        continue
      }
      if (!isPipeableType(q.type)) error('pipe_not_pipeable', `${q.type} answers cannot be piped.`, { path })
      if (scored.has(q.id) && at.page !== null) error('scored_calc_use', 'Scored calculations can only be piped into endings.', { path })
      const own = pagePos(q.id)
      if (at.page !== null && q.type !== 'hidden' && q.type !== 'calculated' && own >= at.page) {
        error('pipe_later', `Piping token ${t.raw} refers to a question on this or a later page.`, { path })
      }
    }
  }
  const rich = (r: RichText | undefined) => r?.text
  checkPipes(rich(def.settings.description), 'settings.description', { page: 0 })
  def.pages.forEach((p, i) => {
    checkPipes(p.title, `pages[${i}].title`, { page: i })
    checkPipes(rich(p.description), `pages[${i}].description`, { page: i })
  })
  for (const [id, q] of questions) {
    const at = { page: pagePos(id) < 0 ? 0 : pagePos(id) }
    const base = `questions.${id}`
    checkPipes(rich(q.label), `${base}.label`, at)
    checkPipes(rich(q.help), `${base}.help`, at)
    if (q.type === 'statement') checkPipes(rich(q.settings.body), `${base}.settings.body`, at)
    if (CHOICE_TYPES.has(q.type)) {
      ;(q.settings as { options: { label: string }[] }).options.forEach((o, i) => checkPipes(o.label, `${base}.settings.options[${i}].label`, at))
    }
  }
  def.endings.forEach((e, i) => {
    checkPipes(rich(e.title), `endings[${i}].title`, { page: null })
    checkPipes(rich(e.message), `endings[${i}].message`, { page: null })
    checkPipes(e.redirect_url, `endings[${i}].redirect_url`, { page: null })
  })
  checkPipes(rich(def.closed_message), 'closed_message', { page: 0 })

  // Server-only sanity: the split must leave nothing behind.
  if (containsServerOnlyKeys(splitDefinition(def).public_definition)) {
    error('server_only_leak', 'Scoring data would reach the browser. This is a bug in splitDefinition.')
  }

  // Tracking consent warning (00 R7)
  if (opts.pixelConsentMode === 'in_form' && opts.loadsPixels && !questions.some(([, q]) => q.type === 'consent' && q.settings.gates_tracking)) {
    warn('consent_tracking_missing', 'Pixels load only after consent, but no consent block gates tracking. Pixels will never load.')
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/** Calc ids that sit on a reference cycle. */
export function calcCycles(def: SurveyDefinition): string[] {
  const deps = new Map<string, string[]>()
  for (const q of Object.values(def.questions)) {
    if (q.type !== 'calculated') continue
    const r = exprRefs(q.settings.formula)
    deps.set(q.id, [...r.calcs, ...r.questions].filter((x) => def.questions[x]?.type === 'calculated'))
  }
  const onCycle = new Set<string>()
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (id: string) => {
    state.set(id, 1)
    stack.push(id)
    for (const d of deps.get(id) ?? []) {
      if (state.get(d) === 1) {
        for (let k = stack.lastIndexOf(d); k < stack.length; k++) onCycle.add(stack[k] as string)
      } else if (!state.has(d)) visit(d)
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const id of deps.keys()) if (!state.has(id)) visit(id)
  return [...onCycle].sort()
}

// ---------------------------------------------------------------- diff

export type ChangeClass = 'safe' | 'noted' | 'breaking'

export type ChangeKind =
  | 'question_added'
  | 'question_removed'
  | 'question_key_changed'
  | 'type_changed_same_storage'
  | 'type_changed_storage'
  | 'label_changed'
  | 'settings_changed'
  | 'required_changed'
  | 'validation_changed'
  | 'option_added'
  | 'option_removed'
  | 'option_relabeled'
  | 'matrix_row_removed'
  | 'matrix_column_removed'
  | 'rating_scale_changed'
  | 'reordered'
  | 'logic_changed'
  | 'theme_changed'
  | 'endings_changed'
  | 'settings_survey_changed'
  | 'closed_message_changed'

export interface Change {
  class: ChangeClass
  kind: ChangeKind
  message: string
  question_key?: string
  question_id?: string
}

export interface DiffResult {
  changes: Change[]
  safe: Change[]
  noted: Change[]
  breaking: Change[]
  has_breaking: boolean
}

const json = (v: unknown) => JSON.stringify(v ?? null)

function ids(list: { id: string }[]): Set<string> {
  return new Set(list.map((x) => x.id))
}

function questionOrder(def: SurveyDefinition): string[] {
  return def.pages.flatMap((p) => p.question_ids.map((id) => def.questions[id]?.question_key ?? id))
}

/**
 * Classify draft changes against the latest published version, per
 * question_key (doc 03 section 7). Logic changes are class `noted`
 * ("safe, noted" in the doc).
 */
export function diffDefinitions(prev: SurveyDefinition, next: SurveyDefinition): DiffResult {
  const changes: Change[] = []
  const push = (c: ChangeClass, kind: ChangeKind, message: string, q?: Question) =>
    changes.push({ class: c, kind, message, ...(q ? { question_key: q.question_key, question_id: q.id } : {}) })

  const prevByKey = new Map(Object.values(prev.questions).map((q) => [q.question_key, q]))
  const nextByKey = new Map(Object.values(next.questions).map((q) => [q.question_key, q]))

  for (const [key, a] of prevByKey) {
    const b = nextByKey.get(key)
    if (!b) {
      const renamed = next.questions[a.id]
      if (renamed && renamed.question_key !== key) push('breaking', 'question_key_changed', `Key changed from ${key} to ${renamed.question_key}; reports treat it as a new question.`, renamed)
      else push('breaking', 'question_removed', `Question ${key} was deleted. Past answers stay under its key.`, a)
      continue
    }
    compareQuestion(a, b, push)
  }
  for (const [key, b] of nextByKey) {
    if (prevByKey.has(key)) continue
    const prevSameId = prev.questions[b.id]
    if (prevSameId && prevSameId.question_key !== key) continue // reported as key change
    push('safe', 'question_added', `Question ${key} was added.`, b)
  }

  const po = questionOrder(prev).filter((k) => nextByKey.has(k))
  const no = questionOrder(next).filter((k) => prevByKey.has(k))
  if (json(po) !== json(no) || json(prev.pages.map((p) => p.id)) !== json(next.pages.map((p) => p.id))) push('safe', 'reordered', 'Questions or pages were reordered.')
  if (json(prev.logic) !== json(next.logic)) push('noted', 'logic_changed', 'Logic rules changed, which changes who sees what.')
  if (json(prev.theme) !== json(next.theme)) push('safe', 'theme_changed', 'Theme changed.')
  if (json(prev.endings) !== json(next.endings)) push('safe', 'endings_changed', 'Endings changed.')
  if (json(prev.closed_message) !== json(next.closed_message)) push('safe', 'closed_message_changed', 'Closed message changed.')
  if (json(prev.settings) !== json(next.settings) || json(prev.identity) !== json(next.identity) || json(prev.pixel_exclusions) !== json(next.pixel_exclusions)) {
    push('safe', 'settings_survey_changed', 'Survey settings changed.')
  }

  const safe = changes.filter((c) => c.class === 'safe')
  const noted = changes.filter((c) => c.class === 'noted')
  const breaking = changes.filter((c) => c.class === 'breaking')
  return { changes, safe, noted, breaking, has_breaking: breaking.length > 0 }
}

function compareQuestion(a: Question, b: Question, push: (c: ChangeClass, kind: ChangeKind, message: string, q?: Question) => void) {
  const key = b.question_key
  if (a.type !== b.type) {
    if (STORAGE_COLUMN[a.type] === STORAGE_COLUMN[b.type]) push('safe', 'type_changed_same_storage', `${key} changed type from ${a.type} to ${b.type} (same storage).`, b)
    else push('breaking', 'type_changed_storage', `${key} changed type from ${a.type} to ${b.type}; it needs a new key.`, b)
  }
  if (json(a.label) !== json(b.label) || json(a.help) !== json(b.help)) push('safe', 'label_changed', `${key} wording changed.`, b)
  if (a.required !== b.required) push('safe', 'required_changed', `${key} required toggled.`, b)
  if (json(a.validation) !== json(b.validation)) push('safe', 'validation_changed', `${key} validation changed.`, b)

  const optsOf = (q: Question) => (CHOICE_TYPES.has(q.type) ? (q.settings as { options: { id: string; label: string }[] }).options : null)
  const ao = optsOf(a)
  const bo = optsOf(b)
  if (ao && bo) {
    const bi = ids(bo)
    const ai = ids(ao)
    const removed = ao.filter((o) => !bi.has(o.id))
    if (removed.length) push('breaking', 'option_removed', `${key}: ${removed.length} option(s) removed. Old answers show "(removed option)".`, b)
    if (bo.some((o) => !ai.has(o.id))) push('safe', 'option_added', `${key}: option(s) added.`, b)
    if (ao.some((o) => bi.has(o.id) && bo.find((x) => x.id === o.id)?.label !== o.label)) push('safe', 'option_relabeled', `${key}: option label(s) changed.`, b)
  } else if (ao && !bo) {
    push('breaking', 'option_removed', `${key}: all options removed by the type change.`, b)
  }
  if (a.type === 'matrix' && b.type === 'matrix') {
    const br = ids(b.settings.rows)
    const bc = ids(b.settings.columns)
    if (a.settings.rows.some((r) => !br.has(r.id))) push('breaking', 'matrix_row_removed', `${key}: matrix row(s) removed.`, b)
    if (a.settings.columns.some((c) => !bc.has(c.id))) push('breaking', 'matrix_column_removed', `${key}: matrix column(s) removed.`, b)
  }
  if (a.type === 'rating' && b.type === 'rating' && a.settings.points !== b.settings.points) {
    push('breaking', 'rating_scale_changed', `${key}: rating scale changed from ${a.settings.points} to ${b.settings.points} points; reports split by version.`, b)
  }
  // Remaining settings (placeholder, layout, labels on scales): safe.
  const strip = (q: Question) => {
    const s = { ...(q.settings as Record<string, unknown>) }
    delete s.options
    delete s.rows
    delete s.columns
    delete s.points
    return json(s)
  }
  if (a.type === b.type && strip(a) !== strip(b)) push('safe', 'settings_changed', `${key} settings changed.`, b)
}
