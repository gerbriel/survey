/**
 * Shared analytics shapes (doc 04 section 4). Pure types: safe to import from
 * client components, which receive these as serialized props.
 */

/** One question as normalized in the `questions` snapshot table (migration 0006). */
export type QuestionSnapshot = {
  survey_version_id: string
  question_key: string
  type: string
  label: string
  position: number
  page_index: number
  is_pii: boolean
  /** Choice, multiple choice, dropdown and ranking options: id and label only. */
  options: { id: string; label: string }[] | null
  /** The full question settings object from the definition (config.settings). */
  settings: Record<string, unknown>
}

/** An answers row without the tenancy columns. */
export type AnswerLite = {
  response_id: string
  question_key: string
  survey_version_id: string
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_json: unknown
}

/** The response columns analytics needs. */
export type ResponseLite = {
  id: string
  survey_version_id: string
  status: 'partial' | 'complete'
  started_at: string
  submitted_at: string | null
  contact_id: string | null
  identity_source: string | null
  respondent_token_id: string | null
  metadata: Record<string, unknown>
}

/** An events row without the tenancy columns. */
export type EventLite = {
  respondent_hash: string | null
  type: string
  question_key: string | null
  occurred_at: string
  meta: Record<string, unknown>
}

export type OptionCount = { id: string; label: string; count: number; pct: number; base: number }

export type ChoiceSummary = {
  kind: 'choice'
  n: number
  /** true for multiple choice: percentages are of respondents and can sum past 100. */
  multi: boolean
  options: OptionCount[]
  /** "Other" free text, latest first, at most 50. Dashboard only, never shared. */
  other: string[]
}

export type HistogramBin = { from: number; to: number; count: number }

export type NumericSummary = {
  kind: 'numeric'
  n: number
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
  histogram: HistogramBin[]
}

export type DistributionPoint = { value: number; count: number; pct: number }

export type RatingSummary = {
  kind: 'rating'
  n: number
  mean: number | null
  median: number | null
  /** Every scale point from min to max, zero counts included. */
  distribution: DistributionPoint[]
}

export type NpsSummary = {
  kind: 'nps'
  n: number
  promoters: number
  passives: number
  detractors: number
  /** -100 to 100, null with no answers. */
  score: number | null
  distribution: DistributionPoint[]
}

export type WordCount = { word: string; count: number }

export type TextSummary = {
  kind: 'text'
  n: number
  words: WordCount[]
  /** Latest 20 answers. Dashboard only, never shared. */
  latest: string[]
}

export type MatrixSummary = {
  kind: 'matrix'
  n: number
  rows: { id: string; label: string }[]
  columns: { id: string; label: string }[]
  /** cells[row][column] counts. */
  cells: number[][]
  rowTotals: number[]
}

export type RankingItem = { id: string; label: string; avgPosition: number | null; firstPct: number; n: number }

export type RankingSummary = { kind: 'ranking'; n: number; items: RankingItem[] }

export type DateSummary = {
  kind: 'date'
  n: number
  earliest: string | null
  latest: string | null
  months: { month: string; count: number }[]
}

export type FileItem = { file_id: string; name: string; size: number | null; response_id: string }

export type FileSummary = { kind: 'files'; n: number; fileCount: number; files: FileItem[] }

/** Identity, contact and free-form types: only how many answered. */
export type CountSummary = { kind: 'count'; n: number }

export type QuestionSummary =
  | ChoiceSummary
  | NumericSummary
  | RatingSummary
  | NpsSummary
  | TextSummary
  | MatrixSummary
  | RankingSummary
  | DateSummary
  | FileSummary
  | CountSummary
