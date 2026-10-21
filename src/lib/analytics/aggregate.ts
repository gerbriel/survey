import { histogram, mean, median, pct, round } from './stats'
import { wordFrequency } from './words'
import type {
  AnswerLite,
  ChoiceSummary,
  CountSummary,
  DateSummary,
  FileItem,
  FileSummary,
  MatrixSummary,
  NpsSummary,
  NumericSummary,
  QuestionSnapshot,
  QuestionSummary,
  RankingSummary,
  RatingSummary,
  TextSummary,
} from './types'

/**
 * Per question summaries (doc 04 section 4.1), computed from answers rows the
 * caller already read under RLS. Pure: unit tested without a database.
 */

type Option = { id: string; label: string }

/** Option ids an answer holds: single choice text, multi or ranking arrays, `{ids, other}`. */
export function choiceIdsOf(a: Pick<AnswerLite, 'value_text' | 'value_json'>): string[] {
  const j = a.value_json
  if (Array.isArray(j)) return j.filter((x): x is string => typeof x === 'string')
  if (j && typeof j === 'object' && Array.isArray((j as { ids?: unknown }).ids)) {
    return ((j as { ids: unknown[] }).ids).filter((x): x is string => typeof x === 'string')
  }
  return a.value_text ? [a.value_text] : []
}

export function otherTextOf(a: Pick<AnswerLite, 'value_json'>): string | null {
  const j = a.value_json
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = (j as { other?: unknown }).other
    if (typeof o === 'string' && o.trim()) return o.trim()
  }
  return null
}

export type ChoiceOptions = {
  multi?: boolean
  /**
   * Cross-version base (doc 04 section 4.4): option id to the version ids that
   * offered it. An option's percentage uses only answers from those versions.
   * Missing entries mean every version offered it.
   */
  offeredBy?: Record<string, string[]>
}

export function summarizeChoice(options: Option[], answers: AnswerLite[], opts: ChoiceOptions = {}): ChoiceSummary {
  const counts = new Map<string, number>()
  const byVersion = new Map<string, number>()
  const other: string[] = []
  let n = 0
  for (const a of answers) {
    const ids = choiceIdsOf(a)
    if (ids.length === 0) continue
    n++
    byVersion.set(a.survey_version_id, (byVersion.get(a.survey_version_id) ?? 0) + 1)
    for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1)
    const o = otherTextOf(a)
    if (o && other.length < 50) other.push(o)
  }
  const known = new Set(options.map((o) => o.id))
  const all: Option[] = [...options]
  // Ids no snapshot knows (a deleted option) still count, labelled by id.
  for (const id of counts.keys()) if (!known.has(id)) all.push({ id, label: id })
  return {
    kind: 'choice',
    n,
    multi: Boolean(opts.multi),
    options: all.map((o) => {
      const versions = opts.offeredBy?.[o.id]
      const base = versions ? versions.reduce((s, v) => s + (byVersion.get(v) ?? 0), 0) : n
      const count = counts.get(o.id) ?? 0
      return { id: o.id, label: o.label, count, base, pct: pct(count, base) }
    }),
    other,
  }
}

function numbers(answers: AnswerLite[]): number[] {
  const out: number[] = []
  for (const a of answers) if (typeof a.value_number === 'number' && Number.isFinite(a.value_number)) out.push(a.value_number)
  return out
}

export function summarizeNumeric(answers: AnswerLite[]): NumericSummary {
  const v = numbers(answers)
  return {
    kind: 'numeric',
    n: v.length,
    mean: mean(v),
    median: median(v),
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
    histogram: histogram(v),
  }
}

export function summarizeRating(answers: AnswerLite[], scale: { min: number; max: number }): RatingSummary {
  const v = numbers(answers)
  const counts = new Map<number, number>()
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1)
  const lo = Math.min(scale.min, ...(v.length ? [Math.min(...v)] : []))
  const hi = Math.max(scale.max, ...(v.length ? [Math.max(...v)] : []))
  const distribution = []
  for (let x = lo; x <= hi; x++) distribution.push({ value: x, count: counts.get(x) ?? 0, pct: pct(counts.get(x) ?? 0, v.length) })
  return { kind: 'rating', n: v.length, mean: mean(v), median: median(v), distribution }
}

/** NPS: promoters 9-10, passives 7-8, detractors 0-6, score = %promoters - %detractors, rounded. */
export function summarizeNps(answers: AnswerLite[]): NpsSummary {
  const v = numbers(answers).filter((x) => x >= 0 && x <= 10)
  let promoters = 0
  let passives = 0
  let detractors = 0
  const counts = new Array<number>(11).fill(0)
  for (const x of v) {
    const r = Math.round(x)
    counts[r] = (counts[r] ?? 0) + 1
    if (x >= 9) promoters++
    else if (x >= 7) passives++
    else detractors++
  }
  return {
    kind: 'nps',
    n: v.length,
    promoters,
    passives,
    detractors,
    score: v.length ? round((100 * (promoters - detractors)) / v.length) : null,
    distribution: counts.map((count, value) => ({ value, count, pct: pct(count, v.length) })),
  }
}

export function summarizeText(answers: AnswerLite[], latestFirst = true): TextSummary {
  const texts = answers.map((a) => a.value_text?.trim() ?? '').filter(Boolean)
  return {
    kind: 'text',
    n: texts.length,
    words: wordFrequency(texts, 50),
    latest: (latestFirst ? texts : [...texts].reverse()).slice(0, 20),
  }
}

export function summarizeMatrix(rows: Option[], columns: Option[], answers: AnswerLite[]): MatrixSummary {
  const ri = new Map(rows.map((r, i) => [r.id, i]))
  const ci = new Map(columns.map((c, i) => [c.id, i]))
  const cells = rows.map(() => columns.map(() => 0))
  let n = 0
  for (const a of answers) {
    const j = a.value_json
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue
    let any = false
    for (const [rid, cid] of Object.entries(j as Record<string, unknown>)) {
      const r = ri.get(rid)
      const c = typeof cid === 'string' ? ci.get(cid) : undefined
      if (r === undefined || c === undefined) continue
      cells[r]![c]!++
      any = true
    }
    if (any) n++
  }
  return { kind: 'matrix', n, rows, columns, cells, rowTotals: cells.map((r) => r.reduce((s, x) => s + x, 0)) }
}

/** Average position per item (1 is first, lower is better) and share ranked first. */
export function summarizeRanking(options: Option[], answers: AnswerLite[]): RankingSummary {
  const sum = new Map<string, number>()
  const seen = new Map<string, number>()
  const first = new Map<string, number>()
  let n = 0
  for (const a of answers) {
    const ids = choiceIdsOf(a)
    if (ids.length === 0) continue
    n++
    ids.forEach((id, i) => {
      sum.set(id, (sum.get(id) ?? 0) + i + 1)
      seen.set(id, (seen.get(id) ?? 0) + 1)
      if (i === 0) first.set(id, (first.get(id) ?? 0) + 1)
    })
  }
  const items = options.map((o) => {
    const k = seen.get(o.id) ?? 0
    return {
      id: o.id,
      label: o.label,
      n: k,
      avgPosition: k ? round((sum.get(o.id) ?? 0) / k, 2) : null,
      firstPct: pct(first.get(o.id) ?? 0, n),
    }
  })
  items.sort((a, b) => (a.avgPosition ?? Infinity) - (b.avgPosition ?? Infinity))
  return { kind: 'ranking', n, items }
}

export function summarizeDate(answers: AnswerLite[]): DateSummary {
  const v = answers.map((a) => a.value_date).filter((d): d is string => typeof d === 'string' && d.length >= 7).sort()
  const months = new Map<string, number>()
  for (const d of v) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + 1)
  return {
    kind: 'date',
    n: v.length,
    earliest: v[0] ?? null,
    latest: v[v.length - 1] ?? null,
    months: [...months.entries()].sort().map(([month, count]) => ({ month, count })),
  }
}

export function summarizeFiles(answers: AnswerLite[]): FileSummary {
  const files: FileItem[] = []
  let n = 0
  let fileCount = 0
  for (const a of answers) {
    const j = a.value_json
    const list = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : []
    let any = false
    for (const f of list) {
      if (!f || typeof f !== 'object') continue
      const o = f as { file_id?: unknown; name?: unknown; size?: unknown }
      if (typeof o.file_id !== 'string') continue
      any = true
      fileCount++
      if (files.length < 100) {
        files.push({
          file_id: o.file_id,
          name: typeof o.name === 'string' ? o.name : 'file',
          size: typeof o.size === 'number' ? o.size : null,
          response_id: a.response_id,
        })
      }
    }
    if (any) n++
  }
  return { kind: 'files', n, fileCount, files }
}

export function summarizeCount(answers: AnswerLite[]): CountSummary {
  return { kind: 'count', n: answers.length }
}

function settingOptions(s: Record<string, unknown>, key: string): Option[] {
  const v = s[key]
  if (!Array.isArray(v)) return []
  return v
    .filter((o): o is { id: string; label?: unknown } => !!o && typeof o === 'object' && typeof (o as { id?: unknown }).id === 'string')
    .map((o) => ({ id: o.id, label: typeof o.label === 'string' ? o.label : o.id }))
}

/** Rating scale bounds from settings: 1 to points (default 5). */
export function ratingScale(q: Pick<QuestionSnapshot, 'settings'>): { min: number; max: number } {
  const p = Number(q.settings.points)
  return { min: 1, max: Number.isFinite(p) && p >= 2 && p <= 11 ? p : 5 }
}

/** Options a choice-like question shows, including yes/no and consent as two options. */
export function questionOptions(q: QuestionSnapshot): Option[] {
  switch (q.type) {
    case 'yes_no':
      return [
        { id: '1', label: typeof q.settings.yes_label === 'string' && q.settings.yes_label ? q.settings.yes_label : 'Yes' },
        { id: '0', label: typeof q.settings.no_label === 'string' && q.settings.no_label ? q.settings.no_label : 'No' },
      ]
    case 'consent':
      return [
        { id: '1', label: 'Agreed' },
        { id: '0', label: 'Did not agree' },
      ]
    default:
      return q.options ?? settingOptions(q.settings, 'options')
  }
}

export function matrixAxes(q: QuestionSnapshot): { rows: Option[]; columns: Option[] } {
  return { rows: settingOptions(q.settings, 'rows'), columns: settingOptions(q.settings, 'columns') }
}

/** yes/no and consent store 1 or 0 in value_number; give them choice ids. */
function asBinaryChoice(answers: AnswerLite[]): AnswerLite[] {
  return answers
    .filter((a) => a.value_number === 0 || a.value_number === 1)
    .map((a) => ({ ...a, value_text: String(a.value_number), value_json: null }))
}

export const CHOICE_TYPES = ['single_choice', 'dropdown', 'multiple_choice', 'yes_no', 'consent'] as const

/** Dispatch by question type (doc 04 section 4.1). */
export function summarizeQuestion(
  q: QuestionSnapshot,
  answers: AnswerLite[],
  opts: { options?: Option[]; offeredBy?: Record<string, string[]> } = {},
): QuestionSummary {
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
      return summarizeChoice(opts.options ?? questionOptions(q), answers, { offeredBy: opts.offeredBy })
    case 'multiple_choice':
      return summarizeChoice(opts.options ?? questionOptions(q), answers, { multi: true, offeredBy: opts.offeredBy })
    case 'yes_no':
    case 'consent':
      return summarizeChoice(questionOptions(q), asBinaryChoice(answers))
    case 'number':
    case 'calculated':
      return summarizeNumeric(answers)
    case 'rating':
      return summarizeRating(answers, ratingScale(q))
    case 'nps':
      return summarizeNps(answers)
    case 'short_text':
    case 'long_text':
      return summarizeText(answers)
    case 'matrix': {
      const { rows, columns } = matrixAxes(q)
      return summarizeMatrix(rows, columns, answers)
    }
    case 'ranking':
      return summarizeRanking(opts.options ?? questionOptions(q), answers)
    case 'date':
      return summarizeDate(answers)
    case 'file_upload':
    case 'signature':
      return summarizeFiles(answers)
    default:
      // email, phone, address, time, hidden: identity or free-form, count only.
      return summarizeCount(answers)
  }
}

/** Types that have no answer to summarize. */
export function isDisplayOnly(type: string): boolean {
  return type === 'statement' || type === 'image'
}
