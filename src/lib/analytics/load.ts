import 'server-only'
import type { DbResult } from '@/lib/db/errors'
import { ok } from '@/lib/db/errors'
import type { UserClient } from '@/lib/supabase/types'
import { analyze, type AnalyticsResult } from './analyze'
import { listPublishedVersions, type SurveyLite, type VersionLite } from '@/lib/db/surveys'
import { listSurveyQuestionRows, readAnswers, readFilteredResponses, type QuestionSnapshotRow } from '@/lib/db/responses'
import { readEvents } from '@/lib/db/events'
import { dateWindow, toResponseFilters, type AnalyticsFilters } from './filters'
import type { VersionSnapshot } from './versions'
import type { AnswerLite, QuestionSnapshot } from './types'

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
  const [versions, questions] = await Promise.all([listPublishedVersions(supabase, { surveyId }), listSurveyQuestionRows(supabase, { surveyId })])
  if (!versions.ok) return versions
  if (!questions.ok) return questions
  const all = questions.data.map(toSnapshot)
  const snapshots = versions.data.map((v) => ({
    versionId: v.id,
    versionNo: v.version_no,
    questions: all.filter((q) => q.survey_version_id === v.id),
  }))
  return ok({ versions: versions.data, snapshots })
}

/** A questions row as analytics reads it: choice options as {id, label}, settings from config. */
export function toSnapshot(row: QuestionSnapshotRow): QuestionSnapshot {
  const config = (row.config ?? {}) as { settings?: unknown }
  const settings = config.settings && typeof config.settings === 'object' ? (config.settings as Record<string, unknown>) : {}
  const options = Array.isArray(row.options)
    ? (row.options as { id?: unknown; label?: unknown }[])
        .filter((o) => o && typeof o.id === 'string')
        .map((o) => ({ id: o.id as string, label: typeof o.label === 'string' ? o.label : (o.id as string) }))
    : null
  return {
    survey_version_id: row.survey_version_id,
    question_key: row.question_key,
    type: row.type,
    label: row.label,
    position: row.position,
    page_index: row.page_index,
    is_pii: row.is_pii,
    options,
    settings,
  }
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
