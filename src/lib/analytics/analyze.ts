import { isDisplayOnly, questionOptions, summarizeQuestion } from './aggregate'
import { binaryAsChoice, crossTab, type CrossTab } from './crosstab'
import { hasNonEventFilter, type AnalyticsFilters } from './filters'
import {
  computeFunnel,
  deviceSplitResponses,
  deviceSplitViews,
  dropOffByPage,
  dropOffByQuestion,
  medianTimeToComplete,
  responsesOverTime,
  type DeviceSplit,
  type DropOffRow,
  type Funnel,
  type PageDropOffRow,
  type TimePoint,
} from './funnel'
import { compareVersions, type VersionDiff, type VersionSnapshot } from './versions'
import { isCrossTabbable } from './widgets'
import type { AnswerLite, EventLite, QuestionSnapshot, QuestionSummary, ResponseLite } from './types'

/**
 * Pure assembly of the analytics page from rows already read under RLS.
 * load.ts does the reads; this does the math, so it is unit testable.
 */

export type QuestionBlock = {
  question: QuestionSnapshot
  summary: QuestionSummary | null
  diff: VersionDiff | null
  /** Type changed across versions in scope: refuse to combine (doc 04 section 4.4). */
  refused: boolean
  crossTab: CrossTab | null
}

export type AnalyticsResult = {
  responseCount: number
  completeCount: number
  blocks: QuestionBlock[]
  funnel: Funnel
  funnelVersionNo: number | null
  dropOff: DropOffRow[]
  dropOffPages: PageDropOffRow[]
  medianSeconds: number | null
  overTime: { unit: 'day' | 'week'; points: TimePoint[] }
  devices: DeviceSplit
  viewDevices: DeviceSplit
  notes: string[]
}

export type AnalyzeInput = {
  versions: VersionSnapshot[]
  /** Version ids in scope for answers (filters.version resolved). */
  scopeVersionIds: string[]
  /** Version whose events drive the funnel. */
  funnelVersionId: string | null
  responses: ResponseLite[]
  answers: AnswerLite[]
  events: EventLite[]
  filters: AnalyticsFilters
  window: { from: string | null; to: string | null }
  now?: number
}

/** Question order: latest version in scope first, then keys only older versions had. */
export function orderedQuestions(versions: VersionSnapshot[], scope: string[]): QuestionSnapshot[] {
  const inScope = versions.filter((v) => scope.includes(v.versionId)).sort((a, b) => b.versionNo - a.versionNo)
  const seen = new Set<string>()
  const out: QuestionSnapshot[] = []
  for (const v of inScope) {
    for (const q of [...v.questions].sort((a, b) => a.position - b.position)) {
      if (seen.has(q.question_key) || isDisplayOnly(q.type)) continue
      seen.add(q.question_key)
      out.push(q)
    }
  }
  return out
}

export function analyze(input: AnalyzeInput): AnalyticsResult {
  const notes: string[] = []
  const inScope = input.versions.filter((v) => input.scopeVersionIds.includes(v.versionId))
  const diffs = inScope.length > 1 ? compareVersions(inScope) : new Map<string, VersionDiff>()
  const byKey = new Map<string, AnswerLite[]>()
  for (const a of input.answers) {
    const list = byKey.get(a.question_key)
    if (list) list.push(a)
    else byKey.set(a.question_key, [a])
  }
  const questions = orderedQuestions(input.versions, input.scopeVersionIds)
  const xtQ = input.filters.crossTab ? questions.find((q) => q.question_key === input.filters.crossTab) : undefined
  const xtAnswers = xtQ ? prep(xtQ, byKey.get(xtQ.question_key) ?? []) : []

  const blocks: QuestionBlock[] = questions.map((q) => {
    const diff = diffs.get(q.question_key) ?? null
    const answers = byKey.get(q.question_key) ?? []
    if (diff?.typeChanged) return { question: q, summary: null, diff, refused: true, crossTab: null }
    const summary = summarizeQuestion(q, answers, diff ? { options: diff.options, offeredBy: diff.offeredBy } : {})
    let xt: CrossTab | null = null
    if (xtQ && xtQ.question_key !== q.question_key && isCrossTabbable(q.type)) {
      xt = crossTab(diff?.options ?? questionOptions(q), prep(q, answers), questionOptions(xtQ), xtAnswers)
    }
    return { question: q, summary, diff, refused: false, crossTab: xt }
  })

  const funnelVersion = input.versions.find((v) => v.versionId === input.funnelVersionId) ?? null
  if (input.filters.version === 'all' && funnelVersion) {
    notes.push(`Funnel and drop-off show the latest version (v${funnelVersion.versionNo}); funnels are per version.`)
  }
  if (hasNonEventFilter(input.filters)) {
    notes.push('Funnel, drop-off and views follow the date and version filters only; people who did not submit have no answers or contact.')
  }

  return {
    responseCount: input.responses.length,
    completeCount: input.responses.filter((r) => r.status === 'complete').length,
    blocks,
    funnel: computeFunnel(input.events, input.now),
    funnelVersionNo: funnelVersion?.versionNo ?? null,
    dropOff: funnelVersion ? dropOffByQuestion(input.events, funnelVersion.questions.filter((q) => !isDisplayOnly(q.type))) : [],
    dropOffPages: dropOffByPage(input.events),
    medianSeconds: medianTimeToComplete(input.responses),
    overTime: responsesOverTime(input.responses, input.window),
    devices: deviceSplitResponses(input.responses),
    viewDevices: deviceSplitViews(input.events),
    notes,
  }
}

function prep(q: QuestionSnapshot, answers: AnswerLite[]): AnswerLite[] {
  return q.type === 'yes_no' || q.type === 'consent' ? binaryAsChoice(answers) : answers
}

/** Cross-tab for one report widget: rows from rowKey's options, columns from colKey's. */
export function widgetCrossTab(
  versions: VersionSnapshot[],
  scope: string[],
  answers: AnswerLite[],
  rowKey: string,
  colKey: string,
): CrossTab | null {
  const qs = orderedQuestions(versions, scope)
  const rq = qs.find((q) => q.question_key === rowKey)
  const cq = qs.find((q) => q.question_key === colKey)
  if (!rq || !cq || rowKey === colKey || !isCrossTabbable(rq.type) || !isCrossTabbable(cq.type)) return null
  const pick = (k: string) => answers.filter((a) => a.question_key === k)
  return crossTab(questionOptions(rq), prep(rq, pick(rowKey)), questionOptions(cq), prep(cq, pick(colKey)))
}
