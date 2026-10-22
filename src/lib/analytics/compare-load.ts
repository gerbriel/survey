import 'server-only'
import { ok, type DbResult } from '@/lib/db/errors'
import { getSurvey, listSurveysLite, type SurveyLite, type SurveyRow } from '@/lib/db/surveys'
import type { UserClient } from '@/lib/supabase/types'
import type { QuestionBlock } from './analyze'
import {
  compareFiltersFor,
  compareStrip,
  compareSummaries,
  matchQuestions,
  type Match,
  type MatchResult,
  type QuestionComparison,
  type StripComparison,
} from './compare'
import type { AnalyticsFilters } from './filters'
import { loadAnalytics, type LoadedAnalytics } from './load'

/**
 * Reads for Compare, as the member (RLS applies). Each survey loads exactly
 * like its analytics page (same 20,000 response cap, same summaries), so the
 * numbers agree. Server only.
 */

/** A question block as Compare matches it. */
export type CompareItem = QuestionBlock & { question_key: string; type: string; label: string }

export type ComparedSurvey = { survey: SurveyRow; filters: AnalyticsFilters; analytics: LoadedAnalytics }

export type ComparedQuestion = Match<CompareItem> & { comparison: QuestionComparison }

export type Comparison = {
  surveys: ComparedSurvey[]
  /** Ids from the URL that are not comparable (other workspace, unpublished). */
  skipped: string[]
  match: MatchResult<CompareItem>
  questions: ComparedQuestion[]
  strip: StripComparison
}

export function itemsOf(blocks: QuestionBlock[]): CompareItem[] {
  return blocks.map((b) => ({ ...b, question_key: b.question.question_key, type: b.question.type, label: b.question.label }))
}

/** Pure assembly from loaded analytics, unit tested through compare.ts. */
export function assembleComparison(surveys: ComparedSurvey[], skipped: string[] = []): Comparison {
  const match = matchQuestions(surveys.map((s) => itemsOf(s.analytics.blocks)))
  const questions = match.matched.map((m) => ({ ...m, comparison: compareSummaries(m.entries.map((e) => (e && !e.refused ? e.summary : null))) }))
  const strip = compareStrip(
    surveys.map((s) => ({
      responses: s.analytics.responseCount,
      completionRate: s.analytics.funnel.starts ? s.analytics.funnel.completionRate : null,
      medianSeconds: s.analytics.medianSeconds,
    })),
  )
  return { surveys, skipped, match, questions, strip }
}

export async function loadComparison(supabase: UserClient, workspaceId: string, ids: string[], sp: URLSearchParams): Promise<DbResult<Comparison>> {
  const surveys: ComparedSurvey[] = []
  const skipped: string[] = []
  for (const [i, surveyId] of ids.entries()) {
    // D-15: a survey of another workspace reads as null.
    const s = await getSurvey(supabase, { workspaceId, surveyId })
    if (!s.ok) return s
    if (!s.data || !s.data.latest_published_version_id) {
      skipped.push(surveyId)
      continue
    }
    const filters = compareFiltersFor(sp, i)
    const a = await loadAnalytics(supabase, s.data, filters)
    if (!a.ok) return a
    surveys.push({ survey: s.data, filters, analytics: a.data })
  }
  return ok(assembleComparison(surveys, skipped))
}

/** Picker choices: published, not archived surveys. */
export async function comparableSurveys(supabase: UserClient, workspaceId: string): Promise<DbResult<SurveyLite[]>> {
  const r = await listSurveysLite(supabase, { workspaceId, order: 'title' })
  if (!r.ok) return r
  return ok(r.data.filter((s) => s.latest_published_version_id))
}
