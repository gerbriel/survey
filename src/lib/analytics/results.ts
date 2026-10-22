import { isDisplayOnly, matrixAxes } from './aggregate'
import { medianTimeToComplete } from './funnel'
import { formatAnswerCell } from '@/lib/exports/columns'
import type { AnswerLite, QuestionSnapshot } from './types'
import type { VersionSnapshot } from './versions'
import { RESULTS_MAX_SURVEYS } from './results-filters'

type SurveyPick = { id: string; state: string; latest_published_version_id: string | null }

/**
 * Pure helpers for the Results hub: the column chooser union, the summary
 * strip and table cells. Safe to import from tests and server components.
 */

/** One chooser column: a question_key with the first label seen. */
export type ResultColumn = { key: string; label: string; type: string; surveys: number }

/** Types the hub can search with free text. */
export const OPEN_TEXT_TYPES: ReadonlySet<string> = new Set(['short_text', 'long_text'])

const NOT_A_COLUMN = new Set(['hidden', 'file_upload', 'signature'])

/** Latest-version-first question order of one survey, display-only types dropped. */
export function surveyQuestionOrder(snapshots: VersionSnapshot[]): QuestionSnapshot[] {
  const seen = new Set<string>()
  const out: QuestionSnapshot[] = []
  for (const v of [...snapshots].sort((a, b) => b.versionNo - a.versionNo)) {
    for (const q of [...v.questions].sort((a, b) => a.position - b.position)) {
      if (seen.has(q.question_key) || isDisplayOnly(q.type)) continue
      seen.add(q.question_key)
      out.push(q)
    }
  }
  return out
}

/**
 * Union of question columns across surveys, keyed by question_key, in the
 * order surveys are given (first survey's order, then keys only later surveys
 * have). Decision: hidden fields and file questions are not chooser columns;
 * the label is the first one seen.
 */
export function unionQuestionColumns(perSurvey: QuestionSnapshot[][]): ResultColumn[] {
  const byKey = new Map<string, ResultColumn>()
  for (const qs of perSurvey) {
    const here = new Set<string>()
    for (const q of qs) {
      if (NOT_A_COLUMN.has(q.type) || here.has(q.question_key)) continue
      here.add(q.question_key)
      const c = byKey.get(q.question_key)
      if (c) c.surveys++
      else byKey.set(q.question_key, { key: q.question_key, label: q.label || q.question_key, type: q.type, surveys: 1 })
    }
  }
  return [...byKey.values()]
}

/** Decision: the first three question columns are shown until the member picks. */
export const DEFAULT_VISIBLE_COLUMNS = 3

export function visibleColumns(all: ResultColumn[], picked: string[]): ResultColumn[] {
  if (!picked.length) return all.slice(0, DEFAULT_VISIBLE_COLUMNS)
  const set = new Set(picked)
  return all.filter((c) => set.has(c.key)).slice(0, 12)
}

export type ResultsSummary = { responses: number; complete: number; completionRate: number | null; medianSeconds: number | null; uniqueContacts: number }

type SummaryRow = { status: 'partial' | 'complete'; started_at: string; submitted_at: string | null; contact_id: string | null }

/**
 * Summary strip. Decision: completion rate is complete over all matching
 * responses with partials counted, whatever the status filter, because the
 * hub has no per-survey event funnel across surveys. The other numbers
 * follow the status filter (`shown`).
 */
export function summarizeResults(all: SummaryRow[], shown: SummaryRow[]): ResultsSummary {
  const complete = all.filter((r) => r.status === 'complete').length
  return {
    responses: shown.length,
    complete: shown.filter((r) => r.status === 'complete').length,
    completionRate: all.length ? Math.round((1000 * complete) / all.length) / 10 : null,
    medianSeconds: medianTimeToComplete(shown),
    uniqueContacts: new Set(shown.map((r) => r.contact_id).filter(Boolean)).size,
  }
}

/** Newest first: submitted_at, else started_at, then id for a stable order. */
export function byNewest<T extends { id: string; started_at: string; submitted_at: string | null }>(a: T, b: T): number {
  const ta = Date.parse(a.submitted_at ?? a.started_at)
  const tb = Date.parse(b.submitted_at ?? b.started_at)
  return tb - ta || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
}

export function respondentLabel(r: {
  contact: { email: string | null; first_name: string | null; last_name: string | null } | null
  identity_source: string | null
  respondent_token_id: string | null
}): string {
  const c = r.contact
  if (c) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
    return name || c.email || 'Contact'
  }
  if (r.respondent_token_id || r.identity_source === 'token') return 'Token respondent'
  return 'Anonymous'
}

export function deviceOf(metadata: unknown): string {
  const d = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).device : undefined
  return typeof d === 'string' && d ? d : 'unknown'
}

/** Table cell text for one answer, shortened for the hub table. */
export function answerText(q: QuestionSnapshot | undefined, a: AnswerLite | undefined, max = 80): string {
  if (!a) return ''
  let s: string
  if (q?.type === 'matrix') {
    const j = a.value_json
    const o = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {}
    const { rows, columns } = matrixAxes(q)
    s = rows
      .filter((r) => typeof o[r.id] === 'string')
      .map((r) => `${r.label}: ${columns.find((c) => c.id === o[r.id])?.label ?? String(o[r.id])}`)
      .join('; ')
  } else {
    s = formatAnswerCell(q, a, () => 'file')
  }
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

export type TableRow = {
  id: string
  href: string
  survey: string
  status: 'partial' | 'complete'
  submittedAt: string | null
  startedAt: string
  respondent: string
  version: string
  device: string
  cells: string[]
}

type RowIn = {
  id: string
  survey_id: string
  survey_version_id: string
  status: 'partial' | 'complete'
  started_at: string
  submitted_at: string | null
  identity_source: string | null
  respondent_token_id: string | null
  metadata: unknown
  contact: { email: string | null; first_name: string | null; last_name: string | null } | null
}

type ScopeIn = { survey: { id: string; title: string }; snapshots: VersionSnapshot[] }

/** Table rows for one page: labels, version numbers and answer cells per shown column. */
export function buildTableRows(slug: string, rows: RowIn[], scopes: ScopeIn[], columns: ResultColumn[], answers: Map<string, AnswerLite[]>): TableRow[] {
  const bySurvey = new Map(scopes.map((s) => [s.survey.id, s]))
  return rows.map((r) => {
    const scope = bySurvey.get(r.survey_id)
    const snap = scope?.snapshots.find((v) => v.versionId === r.survey_version_id)
    const mine = answers.get(r.id) ?? []
    const q = (key: string) =>
      snap?.questions.find((x) => x.question_key === key) ??
      scope?.snapshots.flatMap((v) => v.questions).find((x) => x.question_key === key)
    return {
      id: r.id,
      href: `/w/${encodeURIComponent(slug)}/surveys/${r.survey_id}/responses/${r.id}`,
      survey: scope?.survey.title ?? 'Survey',
      status: r.status,
      submittedAt: r.submitted_at,
      startedAt: r.started_at,
      respondent: respondentLabel(r),
      version: snap ? `v${snap.versionNo}` : '',
      device: deviceOf(r.metadata),
      cells: columns.map((c) => answerText(q(c.key), mine.find((a) => a.question_key === c.key))),
    }
  })
}

/** Default set: open, closed or scheduled with a published version. Drafts are never in it. */
export function eligibleSurveys<T extends SurveyPick>(all: T[]): T[] {
  return all.filter((s) => s.latest_published_version_id && s.state !== 'draft')
}

/** Selected ids that belong to this workspace (D-15), else the default set, capped. */
export function selectSurveys<T extends SurveyPick>(all: T[], requested: string[]): T[] {
  if (requested.length) {
    const want = new Set(requested)
    return all.filter((s) => want.has(s.id) && s.latest_published_version_id).slice(0, RESULTS_MAX_SURVEYS)
  }
  return eligibleSurveys(all).slice(0, RESULTS_MAX_SURVEYS)
}

