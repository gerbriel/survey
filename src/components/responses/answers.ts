import { choiceIds, otherText, type AnswerValue, type ChoiceOption, type Question, type SurveyDefinition } from '@/lib/survey'

/**
 * Pure helpers that turn stored answers into display data, labeled from the
 * version's public definition (choice labels, matrix rows and columns,
 * ranking items). Shared by the response detail and the contact timeline.
 */

export type StoredAnswer = {
  question_key: string
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_json: unknown
}

export type StoredFile = { file_id: string; name: string; size?: number | null; mime?: string | null }

export function answerValue(a: StoredAnswer): AnswerValue | undefined {
  if (a.value_json !== null && a.value_json !== undefined) return a.value_json as AnswerValue
  if (a.value_number !== null && a.value_number !== undefined) return Number(a.value_number)
  if (a.value_date) return a.value_date
  if (a.value_text !== null && a.value_text !== undefined) return a.value_text
  return undefined
}

export function asDefinition(v: unknown): SurveyDefinition | null {
  if (!v || typeof v !== 'object') return null
  const d = v as Partial<SurveyDefinition>
  if (!Array.isArray(d.pages) || !d.questions || typeof d.questions !== 'object') return null
  return d as SurveyDefinition
}

/** Questions in page order, then any question not placed on a page. */
export function orderedQuestions(def: SurveyDefinition | null): Question[] {
  if (!def) return []
  const out: Question[] = []
  const seen = new Set<string>()
  for (const p of def.pages) {
    for (const qid of p.question_ids) {
      const q = def.questions[qid]
      if (q && !seen.has(qid)) {
        out.push(q)
        seen.add(qid)
      }
    }
  }
  for (const [qid, q] of Object.entries(def.questions)) if (!seen.has(qid)) out.push(q)
  return out
}

export function plainLabel(q: Question | undefined, fallback: string): string {
  const t = q?.label?.text?.trim()
  if (!t) return fallback
  return t.replace(/[*_`#>[\]]/g, '').replace(/\{\{[^}]*\}\}/g, '...').slice(0, 300)
}

function labelOf(options: ChoiceOption[], idValue: string): string {
  return options.find((o) => o.id === idValue)?.label ?? idValue
}

export function choiceLabels(options: ChoiceOption[], v: AnswerValue): string[] {
  const other = otherText(v)
  return choiceIds(v).map((cid) => {
    const o = options.find((x) => x.id === cid)
    if (!o) return cid
    return o.is_other && other ? `${o.label}: ${other}` : o.label
  })
}

export function filesOf(v: unknown): StoredFile[] {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []
  return list
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      file_id: String(f.file_id ?? f.id ?? ''),
      name: String(f.name ?? 'file'),
      size: typeof f.size === 'number' ? f.size : null,
      mime: typeof f.mime === 'string' ? f.mime : null,
    }))
    .filter((f) => f.file_id !== '')
}

export type MatrixCell = { row: string; column: string }

export function matrixCells(q: Question, v: AnswerValue): MatrixCell[] {
  if (q.type !== 'matrix' || !v || typeof v !== 'object' || Array.isArray(v)) return []
  const m = v as Record<string, string>
  return q.settings.rows
    .filter((r) => m[r.id] !== undefined)
    .map((r) => ({ row: r.label, column: q.settings.columns.find((c) => c.id === m[r.id])?.label ?? String(m[r.id]) }))
}

/** One-line text for previews and CSV cells. */
export function summarizeAnswer(q: Question | undefined, v: AnswerValue | undefined): string {
  if (v === undefined || v === null) return ''
  if (!q) return typeof v === 'object' ? JSON.stringify(v) : String(v)
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
      return choiceLabels(q.settings.options, v).join('; ')
    case 'ranking':
      return choiceIds(v)
        .map((cid) => labelOf(q.settings.options, cid))
        .join(' > ')
    case 'matrix':
      return matrixCells(q, v)
        .map((c) => `${c.row}: ${c.column}`)
        .join('; ')
    case 'yes_no':
      return v === 1 ? q.settings.yes_label : q.settings.no_label
    case 'consent':
      return v === 1 ? 'Agreed' : 'Not agreed'
    case 'rating':
      return `${String(v)} of ${q.settings.points}`
    case 'number':
      return `${q.settings.prefix ?? ''}${String(v)}${q.settings.suffix ?? ''}`
    case 'file_upload':
    case 'signature':
      return filesOf(v)
        .map((f) => f.name)
        .join(', ')
    case 'address': {
      const a = v as Record<string, string>
      return ['line1', 'line2', 'city', 'region', 'postal', 'country']
        .map((p) => a[p])
        .filter(Boolean)
        .join(', ')
    }
    case 'email':
      if (v && typeof v === 'object' && 'email' in v) return String((v as { email: unknown }).email)
      return String(v)
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

export type MetadataView = {
  hidden: [string, string][]
  utm: [string, string][]
  other: [string, string][]
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
const OTHER_KEYS: [string, string][] = [
  ['device', 'Device'],
  ['referrer_host', 'Referrer'],
  ['locale', 'Locale'],
  ['alt_email', 'Other email given'],
  ['pixel_consent', 'Pixel consent'],
]

export function metadataView(meta: unknown): MetadataView {
  const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {}
  const str = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : JSON.stringify(x))
  const hiddenObj = m.hidden && typeof m.hidden === 'object' ? (m.hidden as Record<string, unknown>) : {}
  return {
    hidden: Object.entries(hiddenObj).map(([k, v]) => [k, str(v)]),
    utm: UTM_KEYS.filter((k) => m[k] !== undefined && m[k] !== '').map((k) => [k, str(m[k])]),
    other: OTHER_KEYS.filter(([k]) => m[k] !== undefined && m[k] !== '').map(([k, label]) => [label, str(m[k])]),
  }
}

export const IDENTITY_LABELS: Record<string, string> = {
  token: 'Personal link',
  identity_answer: 'Identity answer',
  hidden_field: 'Hidden field, unverified',
}

export function contactName(c: { first_name?: string | null; last_name?: string | null; email?: string | null } | null): string {
  if (!c) return 'Anonymous'
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  return n || c.email || 'Unnamed contact'
}

/** First n answered questions, for timeline and inbox previews. */
export function previewAnswers(
  def: SurveyDefinition | null,
  answers: StoredAnswer[],
  n = 3,
): { label: string; text: string }[] {
  const byKey = new Map(answers.map((a) => [a.question_key, a]))
  const out: { label: string; text: string }[] = []
  for (const q of orderedQuestions(def)) {
    const a = byKey.get(q.question_key)
    if (!a || q.type === 'hidden') continue
    const text = summarizeAnswer(q, answerValue(a))
    if (!text) continue
    out.push({ label: plainLabel(q, q.question_key), text })
    if (out.length >= n) break
  }
  if (!def) {
    for (const a of answers.slice(0, n)) out.push({ label: a.question_key, text: summarizeAnswer(undefined, answerValue(a)) })
  }
  return out
}
