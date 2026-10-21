/**
 * Shared validator (doc 03 section 4, 00 R4). Same code in the browser (with
 * public_definition) and in the submit route (with the full definition).
 *
 * Decision: answers in, and errors, cleaned and computed out, are keyed by
 * question_key, the wire format of doc 02 section 5 and submit_response, so
 * the route can pass `cleaned` and `visible_keys` straight to SQL. Doc 03
 * section 4 says "keyed by question id"; new questions have id === key.
 *
 * Decision: validateSubmission does not call migrateDefinition itself. Callers
 * migrate once when they load a definition; re-checking the shape on every
 * keystroke would be wasted work.
 */

import type { AnswerValue, FileRef, Question, SurveyDefinition, Validation } from './types'
import { ADDRESS_PARTS } from './types'
import { evaluateNormalized, type EvalState } from './engine'
import { indexDefinition, scoredCalcIds } from './definition'
import { choiceIds, emailParts, normalizeAnswer, otherText } from './normalize'
import { isSafeRegex } from './regex'

export interface ValidationContext {
  now: string
  hidden: Record<string, string>
  /** Upload manifest keyed by question_key. Server: files uploaded under this response. */
  files: Record<string, FileRef[]>
  mode: 'page' | 'partial' | 'final'
  page_id?: string
  /** responses.metadata.random_seed; only affects page randomization of the path. */
  seed?: string
}

export type ErrorCode =
  | 'required'
  | 'type'
  | 'min_length'
  | 'max_length'
  | 'pattern'
  | 'min'
  | 'max'
  | 'integer'
  | 'min_date'
  | 'max_date'
  | 'email'
  | 'phone'
  | 'min_selections'
  | 'max_selections'
  | 'unknown_option'
  | 'exclusive'
  | 'file_type'
  | 'file_size'
  | 'file_count'
  | 'file_unknown'
  | 'consent'
  | 'confirm_mismatch'

export interface ValidationError {
  code: ErrorCode
  message: string
  row_id?: string
  part?: string
}

export interface ValidateResult {
  ok: boolean
  /** Keyed by question_key. */
  errors: Record<string, ValidationError[]>
  /** Valid answers on the path and visible, normalized, keyed by question_key. Calcs included. */
  cleaned: Record<string, AnswerValue>
  /** Calculated values keyed by question_key. Scored calcs appear only for the quiz score calc. */
  computed: Record<string, number>
  path: string[]
  ending_id: string | null
  /** For submit_response `visible_keys`. */
  visible_keys: string[]
  ended_early: boolean
  score: { value: number; max: number } | null
}

/** English defaults, `{name}` placeholders interpolated from params. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  required: 'This field is required.',
  type: 'This answer is not valid.',
  min_length: 'Enter at least {min} characters.',
  max_length: 'Enter at most {max} characters.',
  pattern: 'This answer is not in the expected format.',
  min: 'Enter a value of at least {min}.',
  max: 'Enter a value of at most {max}.',
  integer: 'Enter a whole number.',
  min_date: 'Choose a date on or after {min}.',
  max_date: 'Choose a date on or before {max}.',
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number, including the country code.',
  min_selections: 'Select at least {min}.',
  max_selections: 'Select at most {max}.',
  unknown_option: 'Choose one of the listed options.',
  exclusive: 'This option cannot be combined with others.',
  file_type: 'This file type is not allowed. Allowed: {allowed}.',
  file_size: 'Each file must be {max} MB or smaller.',
  file_count: 'Upload at most {max} files.',
  file_unknown: 'This file was not uploaded. Please upload it again.',
  consent: 'Please check this box to continue.',
  confirm_mismatch: 'The two entries do not match.',
}

export function errorMessage(code: ErrorCode, params: Record<string, string | number> = {}): string {
  return ERROR_MESSAGES[code].replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const E164_RE = /^\+[1-9]\d{6,14}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function err(code: ErrorCode, params: Record<string, string | number> = {}, extra: Partial<ValidationError> = {}): ValidationError {
  return { code, message: errorMessage(code, params), ...extra }
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Resolve a min_date or max_date bound. Relative bounds count days from context.now (UTC date). */
export function resolveDateBound(bound: string | { relative_days: number } | undefined, now: string): string | undefined {
  if (bound === undefined) return undefined
  if (typeof bound === 'string') return bound.slice(0, 10)
  return addDays(now, bound.relative_days)
}

/**
 * Input mask check. Decision: `9` is a digit, `a` a letter, `*` a letter or
 * digit, every other character is literal.
 */
export function matchesMask(value: string, mask: string): boolean {
  if (value.length !== mask.length) return false
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i] as string
    const c = value[i] as string
    if (m === '9' ? !/\d/.test(c) : m === 'a' ? !/[A-Za-z]/.test(c) : m === '*' ? !/[A-Za-z0-9]/.test(c) : m !== c) return false
  }
  return true
}

function textChecks(v: string, val: Validation | undefined, out: ValidationError[]): void {
  if (!val) return
  if (val.min_length !== undefined && v.length < val.min_length) out.push(err('min_length', { min: val.min_length }))
  if (val.max_length !== undefined && v.length > val.max_length) out.push(err('max_length', { max: val.max_length }))
  if (val.pattern && isSafeRegex(val.pattern.regex)) {
    const re = new RegExp(val.pattern.regex, val.pattern.flags === 'i' ? 'i' : '')
    if (!re.test(v)) out.push({ code: 'pattern', message: val.pattern.message || errorMessage('pattern') })
  }
}

function numberChecks(n: number, val: Validation | undefined, out: ValidationError[]): void {
  if (!val) return
  if (val.integer && !Number.isInteger(n)) out.push(err('integer'))
  if (val.min !== undefined && n < val.min) out.push(err('min', { min: val.min }))
  if (val.max !== undefined && n > val.max) out.push(err('max', { max: val.max }))
}

function selectionChecks(count: number, val: Validation | undefined, out: ValidationError[], skipMin: boolean): void {
  if (!val) return
  if (!skipMin && val.min_selections !== undefined && count < val.min_selections) out.push(err('min_selections', { min: val.min_selections }))
  if (val.max_selections !== undefined && count > val.max_selections) out.push(err('max_selections', { max: val.max_selections }))
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** Checks a submitted ref against the manifest; returns the manifest entry (authoritative size and mime). */
function fileChecks(refs: FileRef[], q: Question, manifest: FileRef[], out: ValidationError[]): void {
  const val = q.validation
  if (val?.max_files !== undefined && refs.length > val.max_files) out.push(err('file_count', { max: val.max_files }))
  for (const ref of refs) {
    const known = manifest.find((m) => m.path === ref.path)
    if (!known) {
      out.push(err('file_unknown'))
      continue
    }
    if (q.type === 'signature' && known.mime !== 'image/png') out.push(err('file_type', { allowed: 'png' }))
    if (val?.allowed_extensions && val.allowed_extensions.length > 0 && !val.allowed_extensions.includes(extOf(known.name))) {
      out.push(err('file_type', { allowed: val.allowed_extensions.join(', ') }))
    }
    if (val?.max_file_mb !== undefined && known.size > val.max_file_mb * 1024 * 1024) out.push(err('file_size', { max: val.max_file_mb }))
  }
}

/**
 * Validates one normalized value. `final` adds completeness checks that only
 * make sense on a finished answer (minimum selections, full ranking).
 */
function checkValue(q: Question, v: AnswerValue, raw: unknown, ctx: ValidationContext, out: ValidationError[]): void {
  const complete = ctx.mode !== 'partial'
  switch (q.type) {
    case 'short_text':
      textChecks(v as string, q.validation, out)
      if (q.settings.mask && !matchesMask(v as string, q.settings.mask)) out.push(err('pattern'))
      return
    case 'long_text':
      textChecks(v as string, q.validation, out)
      return
    case 'email': {
      const s = v as string
      if (!EMAIL_RE.test(s)) {
        out.push(err('email'))
        return
      }
      const parts = emailParts(raw)
      // Decision: confirm is checked only when the `{ email, confirm }` shape is sent.
      if (q.settings.confirm && parts?.confirm !== undefined && parts.confirm !== s) out.push(err('confirm_mismatch'))
      const domain = s.slice(s.lastIndexOf('@') + 1)
      const hit = (list: string[]) => list.some((d) => domain === d.toLowerCase() || domain.endsWith('.' + d.toLowerCase()))
      const allowed = q.validation?.allowed_email_domains
      if (allowed && allowed.length > 0 && !hit(allowed)) out.push(err('email'))
      const blocked = q.validation?.blocked_email_domains
      if (blocked && hit(blocked)) out.push(err('email'))
      textChecks(s, { ...q.validation, pattern: undefined }, out)
      return
    }
    case 'phone':
      if (!E164_RE.test(v as string)) out.push(err('phone'))
      return
    case 'number':
      numberChecks(v as number, q.validation, out)
      return
    case 'rating': {
      const n = v as number
      // Decision: rating values run 1..points.
      if (!Number.isInteger(n)) out.push(err('integer'))
      else if (n < 1) out.push(err('min', { min: 1 }))
      else if (n > q.settings.points) out.push(err('max', { max: q.settings.points }))
      return
    }
    case 'nps': {
      const n = v as number
      if (!Number.isInteger(n)) out.push(err('integer'))
      else if (n < 0) out.push(err('min', { min: 0 }))
      else if (n > 10) out.push(err('max', { max: 10 }))
      return
    }
    case 'single_choice':
    case 'dropdown': {
      const id = choiceIds(v)[0] as string
      const opt = q.settings.options.find((o) => o.id === id)
      if (!opt) out.push(err('unknown_option'))
      else if (otherText(v) !== undefined && !opt.is_other) out.push(err('type'))
      return
    }
    case 'multiple_choice': {
      const ids = choiceIds(v)
      const opts = q.settings.options
      if (new Set(ids).size !== ids.length || ids.some((id) => !opts.some((o) => o.id === id))) {
        out.push(err('unknown_option'))
        return
      }
      if (ids.length > 1 && ids.some((id) => opts.find((o) => o.id === id)?.is_exclusive)) out.push(err('exclusive'))
      if (otherText(v) !== undefined && !ids.some((id) => opts.find((o) => o.id === id)?.is_other)) out.push(err('type'))
      selectionChecks(ids.length, q.validation, out, !complete)
      return
    }
    case 'ranking': {
      const ids = choiceIds(v)
      const opts = q.settings.options
      if (new Set(ids).size !== ids.length || ids.some((id) => !opts.some((o) => o.id === id))) {
        out.push(err('unknown_option'))
        return
      }
      // Decision: with rank_top_n exactly N must be ranked; without it, every option.
      const need = q.settings.rank_top_n !== undefined ? Math.min(q.settings.rank_top_n, opts.length) : opts.length
      if (ids.length > need) out.push(err('max_selections', { max: need }))
      else if (complete && ids.length < need) out.push(err('min_selections', { min: need }))
      return
    }
    case 'yes_no':
      return
    case 'consent':
      if (q.required && v !== 1 && ctx.mode !== 'partial') out.push(err('consent'))
      return
    case 'matrix': {
      const m = v as Record<string, string>
      for (const [row, col] of Object.entries(m)) {
        if (!q.settings.rows.some((r) => r.id === row) || !q.settings.columns.some((c) => c.id === col)) {
          out.push(err('unknown_option', {}, { row_id: row }))
        }
      }
      return
    }
    case 'date': {
      const s = v as string
      if (!isValidDate(s)) {
        out.push(err('type'))
        return
      }
      const min = resolveDateBound(q.validation?.min_date, ctx.now)
      const max = resolveDateBound(q.validation?.max_date, ctx.now)
      if (min && s < min) out.push(err('min_date', { min }))
      if (max && s > max) out.push(err('max_date', { max }))
      const wd = new Date(s + 'T00:00:00Z').getUTCDay()
      // Decision: a disabled weekday reports code `type` with a specific message (doc 03 has no code for it).
      if (q.settings.disabled_weekdays?.includes(wd)) out.push({ code: 'type', message: 'This day is not available.' })
      return
    }
    case 'time': {
      const s = v as string
      if (!TIME_RE.test(s)) {
        out.push(err('type'))
        return
      }
      const mins = Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
      const step = q.settings.minute_step
      if (step > 1 && mins % step !== 0) out.push(err('type'))
      // Decision: time bounds use validation.min / max as minutes after midnight.
      const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
      if (q.validation?.min !== undefined && mins < q.validation.min) out.push(err('min', { min: fmt(q.validation.min) }))
      if (q.validation?.max !== undefined && mins > q.validation.max) out.push(err('max', { max: fmt(q.validation.max) }))
      return
    }
    case 'file_upload':
      fileChecks(v as FileRef[], q, ctx.files[q.question_key] ?? [], out)
      return
    case 'signature':
      fileChecks([v as FileRef], q, ctx.files[q.question_key] ?? [], out)
      return
    case 'address': {
      const a = v as Record<string, string>
      if (q.settings.lock_country && q.settings.default_country && a.country !== undefined && a.country !== q.settings.default_country) {
        out.push(err('type', {}, { part: 'country' }))
      }
      return
    }
    case 'hidden':
    case 'calculated':
    case 'statement':
    case 'image':
      return
  }
}

function requiredErrors(q: Question, v: AnswerValue | undefined): ValidationError[] {
  if (q.type === 'matrix') {
    const m = (v ?? {}) as Record<string, string>
    if (q.settings.all_rows_required) {
      return q.settings.rows.filter((r) => !m[r.id]).map((r) => err('required', {}, { row_id: r.id }))
    }
    return q.required && Object.keys(m).length === 0 ? [err('required')] : []
  }
  if (q.type === 'address') {
    const a = (v ?? {}) as Record<string, string>
    const parts = ADDRESS_PARTS.filter((p) => q.settings.parts_required[p] && !a[p])
    if (parts.length > 0) return parts.map((p) => err('required', {}, { part: p }))
    return q.required && v === undefined ? [err('required')] : []
  }
  if (q.type === 'consent') return q.required && v !== 1 ? [err('consent')] : []
  return q.required && v === undefined ? [err('required')] : []
}

export function validateSubmission(definition: SurveyDefinition, answers: Record<string, unknown>, context: ValidationContext): ValidateResult {
  const idx = indexDefinition(definition)

  // Normalize, remembering raw values and shape failures. Calc inputs are ignored.
  const raws = new Map<string, unknown>()
  const invalid = new Set<string>()
  const normalized: Record<string, AnswerValue> = {}
  for (const [k, raw] of Object.entries(answers ?? {})) {
    const q = idx.byKey.get(k) ?? idx.byId.get(k)
    if (!q || q.type === 'calculated' || q.type === 'hidden' || q.type === 'statement' || q.type === 'image') continue
    raws.set(q.id, raw)
    const n = normalizeAnswer(q, raw)
    if (n.kind === 'value') normalized[q.id] = n.value
    else if (n.kind === 'invalid') invalid.add(q.id)
  }

  const state: EvalState = evaluateNormalized(definition, normalized, { now: context.now, hidden: context.hidden, seed: context.seed })
  const scored = scoredCalcIds(definition)

  let checkIds: string[]
  if (context.mode === 'page') {
    const page = context.page_id ? idx.pagesById.get(context.page_id) : undefined
    checkIds = page ? page.question_ids.filter((id) => state.visible.has(id) && idx.pageOf.get(id) === page.id) : []
  } else {
    checkIds = [...state.visible]
  }

  const errors: Record<string, ValidationError[]> = {}
  const bad = new Set<string>()
  for (const id of checkIds) {
    const q = idx.byId.get(id) as Question
    if (q.type === 'calculated' || q.type === 'hidden' || q.type === 'statement' || q.type === 'image') continue
    const out: ValidationError[] = []
    const v = normalized[id]
    if (invalid.has(id)) out.push(err('type'))
    else if (v !== undefined) checkValue(q, v, raws.get(id), context, out)
    if (context.mode !== 'partial' && !invalid.has(id)) {
      const already = new Set(out.map((e) => e.code))
      for (const e of requiredErrors(q, v)) if (!(e.code === 'consent' && already.has('consent'))) out.push(e)
    }
    if (out.length > 0) {
      errors[q.question_key] = out
      bad.add(id)
    }
  }

  // Answers outside the checked set but visible on the path still get type and bound checks
  // in page mode, so `cleaned` never carries a value that would fail `final`.
  const cleaned: Record<string, AnswerValue> = {}
  for (const [id, v] of Object.entries(state.answers)) {
    const q = idx.byId.get(id) as Question
    if (bad.has(id) || scored.has(id)) continue
    if (q.type !== 'calculated' && q.type !== 'hidden' && !checkIds.includes(id)) {
      const out: ValidationError[] = []
      checkValue(q, v, raws.get(id), { ...context, mode: 'partial' }, out)
      if (out.length > 0) continue
    }
    cleaned[q.question_key] = v
  }

  const computed: Record<string, number> = {}
  const quizId = definition.settings.quiz?.score_calc_id
  for (const [id, n] of Object.entries(state.calcs)) {
    const q = idx.byId.get(id)
    if (!q) continue
    if (scored.has(id) && id !== quizId) continue
    computed[q.question_key] = n
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    cleaned,
    computed,
    path: state.path,
    ending_id: state.ending_id,
    visible_keys: state.visible_keys,
    ended_early: state.ended_early,
    score: state.score,
  }
}

export type AnswerRow =
  | { value_text: string }
  | { value_number: number }
  | { value_date: string }
  | { value_json: unknown }
  | { value_text: string; value_json: { other: string } }

/**
 * Storage row for one answer (doc 03 section 4) so the SQL writer never guesses.
 * Decision: multiple_choice with Other text stores `{ ids, other }` in
 * value_json; without Other text it stays a plain `string[]`.
 */
export function toAnswerRow(q: Question, value: AnswerValue): AnswerRow | null {
  switch (q.type) {
    case 'statement':
    case 'image':
      return null
    case 'single_choice':
    case 'dropdown': {
      const other = otherText(value)
      const id = choiceIds(value)[0] ?? ''
      return other !== undefined ? { value_text: id, value_json: { other } } : { value_text: id }
    }
    case 'number':
    case 'rating':
    case 'nps':
    case 'yes_no':
    case 'consent':
    case 'calculated':
      return { value_number: value as number }
    case 'date':
      return { value_date: value as string }
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'time':
    case 'hidden':
      return { value_text: value as string }
    default:
      return { value_json: value }
  }
}
