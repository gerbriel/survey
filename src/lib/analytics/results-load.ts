import 'server-only'
import { ok, type DbResult } from '@/lib/db/errors'
import { readAnswers, readResultRows, searchTextAnswers, type ResultRow } from '@/lib/db/responses'
import { listSurveysLite, type SurveyLite, type VersionLite } from '@/lib/db/surveys'
import type { UserClient } from '@/lib/supabase/types'
import { ANALYTICS_MAX_RESPONSES, loadSnapshots } from './load'
import { toResultsQuery, type ResultsFilters } from './results-filters'
import {
  byNewest,
  selectSurveys,
  OPEN_TEXT_TYPES,
  summarizeResults,
  surveyQuestionOrder,
  unionQuestionColumns,
  visibleColumns,
  type ResultColumn,
  type ResultsSummary,
} from './results'
import type { AnswerLite, QuestionSnapshot } from './types'
import type { VersionSnapshot } from './versions'

/**
 * Reads for the Results hub, as the member (RLS applies). Server only.
 *
 * Decision: the hub reads at most 20,000 responses per view across all
 * selected surveys (ANALYTICS_MAX_RESPONSES, the analytics page cap), in the
 * order surveys are listed; the page says so when it is hit.
 */

export { eligibleSurveys, selectSurveys } from './results'

export type SurveyScope = {
  survey: SurveyLite
  versions: VersionLite[]
  snapshots: VersionSnapshot[]
  questions: QuestionSnapshot[]
}

export async function loadSurveyScopes(supabase: UserClient, surveys: SurveyLite[]): Promise<DbResult<SurveyScope[]>> {
  const snaps = await Promise.all(surveys.map((s) => loadSnapshots(supabase, s.id)))
  const out: SurveyScope[] = []
  for (let i = 0; i < surveys.length; i++) {
    const r = snaps[i]!
    if (!r.ok) return r
    out.push({ survey: surveys[i]!, versions: r.data.versions, snapshots: r.data.snapshots, questions: surveyQuestionOrder(r.data.snapshots) })
  }
  return ok(out)
}

/** Response ids matching the free text filter, or null when there is none. */
export async function textMatches(
  supabase: UserClient,
  scopes: SurveyScope[],
  text: string | null,
): Promise<DbResult<{ ids: Set<string>; capped: boolean } | null>> {
  if (!text) return ok(null)
  const keys = [...new Set(scopes.flatMap((s) => s.questions.filter((q) => OPEN_TEXT_TYPES.has(q.type)).map((q) => q.question_key)))]
  if (!keys.length || !scopes.length) return ok({ ids: new Set(), capped: false })
  const r = await searchTextAnswers(supabase, { surveyIds: scopes.map((s) => s.survey.id), questionKeys: keys.slice(0, 500), text })
  if (!r.ok) return r
  return ok({ ids: new Set(r.data.responseIds), capped: r.data.capped })
}

export type ResultsView = {
  allSurveys: SurveyLite[]
  scopes: SurveyScope[]
  columns: ResultColumn[]
  shownColumns: ResultColumn[]
  summary: ResultsSummary
  total: number
  page: number
  pageSize: number
  rows: ResultRow[]
  /** Page answers by response id, only the shown columns. */
  answers: Map<string, AnswerLite[]>
  truncated: boolean
  textCapped: boolean
}

export const RESULTS_PAGE_SIZE = 25

export async function loadResults(
  supabase: UserClient,
  workspaceId: string,
  filters: ResultsFilters,
  opts: { page: number; columns: string[]; pageSize?: number },
): Promise<DbResult<ResultsView>> {
  const pageSize = opts.pageSize ?? RESULTS_PAGE_SIZE
  const list = await listSurveysLite(supabase, { workspaceId, order: 'created' })
  if (!list.ok) return list
  const selected = selectSurveys(list.data, filters.surveys)
  const scopes = await loadSurveyScopes(supabase, selected)
  if (!scopes.ok) return scopes

  // Read with status all so the completion rate counts partials; the status
  // filter is applied below for everything else.
  const wide = { ...filters, status: 'all' as const }
  let budget = ANALYTICS_MAX_RESPONSES
  let truncated = false
  const all: ResultRow[] = []
  for (const s of scopes.data) {
    if (budget <= 0) {
      truncated = true
      break
    }
    const query = toResultsQuery(wide, s.versions)
    if (!query) continue
    const r = await readResultRows(supabase, { surveyId: s.survey.id, filters: query.rpc, where: query.where, max: budget + 1 })
    if (!r.ok) return r
    if (r.data.length > budget) {
      truncated = true
      all.push(...r.data.slice(0, budget))
      budget = 0
    } else {
      all.push(...r.data)
      budget -= r.data.length
    }
  }

  const text = await textMatches(supabase, scopes.data, filters.text)
  if (!text.ok) return text
  const matchedAll = text.data ? all.filter((r) => text.data!.ids.has(r.id)) : all
  const shown = filters.status === 'all' ? matchedAll : matchedAll.filter((r) => r.status === filters.status)
  shown.sort(byNewest)

  const columns = unionQuestionColumns(scopes.data.map((s) => s.questions))
  const shownColumns = visibleColumns(columns, opts.columns)
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1)
  const page = Math.min(Math.max(0, opts.page), lastPage)
  const rows = shown.slice(page * pageSize, page * pageSize + pageSize)
  const answers = new Map<string, AnswerLite[]>()
  if (rows.length && shownColumns.length) {
    const a = await readAnswers(supabase, { responseIds: rows.map((r) => r.id), questionKeys: shownColumns.map((c) => c.key) })
    if (!a.ok) return a
    for (const x of a.data) {
      const l = answers.get(x.response_id)
      if (l) l.push(x)
      else answers.set(x.response_id, [x])
    }
  }
  return ok({
    allSurveys: list.data,
    scopes: scopes.data,
    columns,
    shownColumns,
    summary: summarizeResults(matchedAll, shown),
    total: shown.length,
    page,
    pageSize,
    rows,
    answers,
    truncated,
    textCapped: text.data?.capped ?? false,
  })
}
