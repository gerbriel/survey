import { choiceIdsOf, matrixAxes, otherTextOf, questionOptions } from '@/lib/analytics/aggregate'
import type { AnswerLite, QuestionSnapshot, ResponseLite } from '@/lib/analytics/types'

/**
 * Column layout and cell formatting for response exports (doc 04 section
 * 6.1). Pure, shared by the CSV and XLSX writers.
 *
 * Columns: response_id, status, started_at, submitted_at, version,
 * contact_id, contact_email, identity_source, token, then hidden fields
 * (hidden.{param}, from hidden questions), then UTM, then one column per
 * question_key in latest-version order with older-only keys appended. Matrix
 * questions get one column per row: {question_key}.{row_id}.
 */

/** App path of a response file, built by Phase 2D as an authenticated signed-URL redirect. */
export function responseFilePath(slug: string, surveyId: string, fileId: string): string {
  return `/w/${slug}/surveys/${surveyId}/responses/files/${fileId}`
}

export type ExportColumn = {
  id: string
  /** Second header row. */
  label: string
  source: 'meta' | 'hidden' | 'utm' | 'question'
  question_key?: string
  row_id?: string
}

export const META_COLUMNS = [
  'response_id',
  'status',
  'started_at',
  'submitted_at',
  'version',
  'contact_id',
  'contact_email',
  'identity_source',
  'token',
] as const

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

const META_LABELS: Record<(typeof META_COLUMNS)[number], string> = {
  response_id: 'Response id',
  status: 'Status',
  started_at: 'Started at',
  submitted_at: 'Submitted at',
  version: 'Version',
  contact_id: 'Contact id',
  contact_email: 'Contact email',
  identity_source: 'Identity source',
  token: 'Token',
}

const SKIP = new Set(['statement', 'image'])

/** `questions` in latest-version order with older-only keys appended (see orderedQuestions). */
export function buildColumns(questions: QuestionSnapshot[]): ExportColumn[] {
  const cols: ExportColumn[] = META_COLUMNS.map((id) => ({ id, label: META_LABELS[id], source: 'meta' as const }))
  const hidden = questions.filter((q) => q.type === 'hidden')
  for (const q of hidden) {
    const param = typeof q.settings.param === 'string' && q.settings.param ? q.settings.param : q.question_key
    cols.push({ id: `hidden.${param}`, label: `Hidden: ${param}`, source: 'hidden', question_key: q.question_key })
  }
  for (const k of UTM_KEYS) cols.push({ id: k, label: k, source: 'utm' })
  for (const q of questions) {
    if (SKIP.has(q.type) || q.type === 'hidden') continue
    if (q.type === 'matrix') {
      for (const r of matrixAxes(q).rows) {
        cols.push({ id: `${q.question_key}.${r.id}`, label: `${q.label}: ${r.label}`, source: 'question', question_key: q.question_key, row_id: r.id })
      }
      continue
    }
    cols.push({ id: q.question_key, label: q.label, source: 'question', question_key: q.question_key })
  }
  return cols
}

export type RowContext = {
  versionNo: Map<string, number>
  /** Snapshot of a key in the response's own version, else the latest. */
  question: (versionId: string, key: string) => QuestionSnapshot | undefined
  contactEmail: Map<string, string | null>
  tokens: Map<string, string>
  /** Absolute app URL for a response file (Phase 2D's authenticated signed-URL redirect). */
  fileUrl: (fileId: string) => string
}

function labelFor(q: QuestionSnapshot | undefined, id: string): string {
  if (!q) return id
  return questionOptions(q).find((o) => o.id === id)?.label ?? id
}

/** One answer as cell text (not matrix). */
export function formatAnswerCell(q: QuestionSnapshot | undefined, a: AnswerLite, fileUrl: (fileId: string) => string): string {
  const type = q?.type
  switch (type) {
    case 'single_choice':
    case 'dropdown': {
      const id = choiceIdsOf(a)[0]
      if (!id) return ''
      const other = otherTextOf(a)
      return other ? `${labelFor(q, id)}: ${other}` : labelFor(q, id)
    }
    case 'multiple_choice': {
      const labels = choiceIdsOf(a).map((id) => labelFor(q, id))
      const other = otherTextOf(a)
      if (other) labels.push(`Other: ${other}`)
      return labels.join('; ')
    }
    case 'ranking':
      return choiceIdsOf(a).map((id) => labelFor(q, id)).join(' > ')
    case 'yes_no':
    case 'consent':
      return a.value_number === null ? '' : labelFor(q, String(a.value_number))
    case 'file_upload':
    case 'signature': {
      const j = a.value_json
      const list = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : []
      return list
        .map((f) => (f && typeof f === 'object' && typeof (f as { file_id?: unknown }).file_id === 'string' ? fileUrl((f as { file_id: string }).file_id) : ''))
        .filter(Boolean)
        .join('; ')
    }
    case 'address': {
      const j = a.value_json
      if (!j || typeof j !== 'object') return ''
      const o = j as Record<string, unknown>
      return ['line1', 'line2', 'city', 'region', 'postal', 'country']
        .map((k) => (typeof o[k] === 'string' ? (o[k] as string) : ''))
        .filter(Boolean)
        .join(', ')
    }
    default:
      if (a.value_text !== null) return a.value_text
      if (a.value_number !== null) return String(a.value_number)
      if (a.value_date !== null) return a.value_date
      return a.value_json === null || a.value_json === undefined ? '' : JSON.stringify(a.value_json)
  }
}

export function responseRow(columns: ExportColumn[], r: ResponseLite, answers: AnswerLite[], ctx: RowContext): string[] {
  const byKey = new Map(answers.map((a) => [a.question_key, a]))
  const meta = r.metadata ?? {}
  return columns.map((c) => {
    if (c.source === 'meta') {
      switch (c.id) {
        case 'response_id':
          return r.id
        case 'status':
          return r.status
        case 'started_at':
          return r.started_at
        case 'submitted_at':
          return r.submitted_at ?? ''
        case 'version':
          return String(ctx.versionNo.get(r.survey_version_id) ?? '')
        case 'contact_id':
          return r.contact_id ?? ''
        case 'contact_email':
          return (r.contact_id && ctx.contactEmail.get(r.contact_id)) || ''
        case 'identity_source':
          return r.identity_source ?? ''
        case 'token':
          return (r.respondent_token_id && ctx.tokens.get(r.respondent_token_id)) || ''
        default:
          return ''
      }
    }
    if (c.source === 'utm') {
      const v = meta[c.id]
      return typeof v === 'string' ? v : ''
    }
    const a = c.question_key ? byKey.get(c.question_key) : undefined
    if (!a) return ''
    if (c.source === 'hidden') return a.value_text ?? ''
    const q = ctx.question(r.survey_version_id, c.question_key!)
    if (c.row_id) {
      const j = a.value_json
      const col = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>)[c.row_id] : undefined
      if (typeof col !== 'string') return ''
      return q ? (matrixAxes(q).columns.find((x) => x.id === col)?.label ?? col) : col
    }
    return formatAnswerCell(q, a, ctx.fileUrl)
  })
}
