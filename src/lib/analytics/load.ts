import 'server-only'
import type { DbResult } from '@/lib/db/errors'
import { ok } from '@/lib/db/errors'
import type { UserClient } from '@/lib/supabase/types'
import { analyze, type AnalyticsResult } from './analyze'
import { listPublishedVersions, listSurveyQuestions, readAnswers, readEvents, readFilteredResponses, type SurveyLite, type VersionLite } from './data'
import { dateWindow, toResponseFilters, type AnalyticsFilters } from './filters'
import type { VersionSnapshot } from './versions'
import type { AnswerLite } from './types'

/**
 * Reads everything one analytics view needs as the signed-in member (RLS
 * applies) and hands it to the pure analyze(). Server only.
 *
 * Decision: analytics read at most 20,000 responses per view; above that the
 * page says the numbers cover the first 20,000 by id. SQL side aggregates are
 * a Phase 3 candidate.
 */
export const ANALYTICS_MAX_RESPONSES = 20_000

export type LoadedAnalytics = AnalyticsResult & {
  versions: VersionLite[]
  snapshots: VersionSnapshot[]
  scopeVersionIds: string[]
  truncated: boolean
  /** Raw answers in scope, for report widgets that cross-tab on their own key. Server only. */
  answers: AnswerLite[]
}

export async function loadSnapshots(supabase: UserClient, surveyId: string): Promise<DbResult<{ versions: VersionLite[]; snapshots: VersionSnapshot[] }>> {
  const [versions, questions] = await Promise.all([listPublishedVersions(supabase, { surveyId }), listSurveyQuestions(supabase, { surveyId })])
  if (!versions.ok) return versions
  if (!questions.ok) return questions
  const snapshots = versions.data.map((v) => ({
    versionId: v.id,
    versionNo: v.version_no,
    questions: questions.data.filter((q) => q.survey_version_id === v.id),
  }))
  return ok({ versions: versions.data, snapshots })
}

export function scopeFor(survey: Pick<SurveyLite, 'latest_published_version_id'>, versions: VersionLite[], filters: AnalyticsFilters): string[] {
  if (filters.version === 'all') return versions.map((v) => v.id)
  if (filters.version === 'latest') return survey.latest_published_version_id ? [survey.latest_published_version_id] : []
  return versions.some((v) => v.id === filters.version) ? [filters.version] : []
}

export async function loadAnalytics(supabase: UserClient, survey: SurveyLite, filters: AnalyticsFilters): Promise<DbResult<LoadedAnalytics>> {
  const snaps = await loadSnapshots(supabase, survey.id)
  if (!snaps.ok) return snaps
  const { versions, snapshots } = snaps.data
  const scope = scopeFor(survey, versions, filters)
  const window = dateWindow(filters)
  const responses = await readFilteredResponses(supabase, {
    surveyId: survey.id,
    filters: toResponseFilters(filters),
    max: ANALYTICS_MAX_RESPONSES + 1,
  })
  if (!responses.ok) return responses
  const truncated = responses.data.length > ANALYTICS_MAX_RESPONSES
  const rows = truncated ? responses.data.slice(0, ANALYTICS_MAX_RESPONSES) : responses.data
  const answers = await readAnswers(supabase, { responseIds: rows.map((r) => r.id) })
  if (!answers.ok) return answers
  const funnelVersionId = filters.version === 'all' || filters.version === 'latest' ? survey.latest_published_version_id : (scope[0] ?? null)
  const events = funnelVersionId
    ? await readEvents(supabase, { versionIds: [funnelVersionId], from: window.from, to: window.to })
    : ok([])
  if (!events.ok) return events
  const result = analyze({
    versions: snapshots,
    scopeVersionIds: scope,
    funnelVersionId,
    responses: rows,
    answers: answers.data,
    events: events.data,
    filters,
    window,
  })
  if (truncated) result.notes.unshift(`This view covers the first ${ANALYTICS_MAX_RESPONSES.toLocaleString('en-US')} matching responses.`)
  return ok({ ...result, versions, snapshots, scopeVersionIds: scope, truncated, answers: answers.data })
}
