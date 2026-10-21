import { isDisplayOnly } from './aggregate'
import type { QuestionSnapshot } from './types'

/**
 * Report widget vocabulary (doc 04 sections 5.1 and 5.2). Pure.
 */

export const CHART_TYPES = ['bar', 'stacked_bar', 'pie', 'table', 'histogram', 'nps_gauge', 'heat_table', 'word_list', 'line', 'stat'] as const
export type ChartType = (typeof CHART_TYPES)[number]

/** Funnel metrics a widget can bind instead of a question_key. */
export const METRICS = ['completion', 'responses_over_time', 'funnel', 'drop_off', 'median_time', 'device_split'] as const
export type Metric = (typeof METRICS)[number]

export const METRIC_LABELS: Record<Metric, string> = {
  completion: 'Completion rate',
  responses_over_time: 'Responses over time',
  funnel: 'Views, starts and completes',
  drop_off: 'Drop-off by question',
  median_time: 'Median time to complete',
  device_split: 'Device split',
}

export const METRIC_CHARTS: Record<Metric, ChartType[]> = {
  completion: ['stat'],
  responses_over_time: ['line', 'table'],
  funnel: ['bar', 'table'],
  drop_off: ['bar', 'table'],
  median_time: ['stat'],
  device_split: ['bar', 'pie', 'table'],
}

export const CHART_LABELS: Record<ChartType, string> = {
  bar: 'Bar',
  stacked_bar: 'Stacked bar',
  pie: 'Pie',
  table: 'Table',
  histogram: 'Histogram',
  nps_gauge: 'NPS gauge',
  heat_table: 'Heat table',
  word_list: 'Word list',
  line: 'Line',
  stat: 'Number',
}

/** Chart types that make sense for a question type; the first is the default. */
export function chartsForType(type: string): ChartType[] {
  switch (type) {
    case 'single_choice':
    case 'dropdown':
    case 'yes_no':
    case 'consent':
      return ['bar', 'pie', 'stacked_bar', 'table']
    case 'multiple_choice':
      return ['bar', 'stacked_bar', 'table']
    case 'number':
    case 'calculated':
      return ['histogram', 'stat', 'table']
    case 'rating':
      return ['bar', 'stat', 'table']
    case 'nps':
      return ['nps_gauge', 'bar', 'stat', 'table']
    case 'short_text':
    case 'long_text':
      return ['word_list', 'stat']
    case 'matrix':
      return ['heat_table', 'table']
    case 'ranking':
      return ['table', 'bar']
    case 'date':
      return ['histogram', 'table', 'stat']
    default:
      return ['stat']
  }
}

/** Question types a choice cross-tab can use on either axis. */
export function isCrossTabbable(type: string): boolean {
  return ['single_choice', 'dropdown', 'multiple_choice', 'yes_no', 'consent'].includes(type)
}

export type WidgetSpec = {
  id?: string
  position: number
  question_key: string | null
  metric: Metric | null
  chart_type: ChartType
  cross_tab_key: string | null
  options: { title?: string }
}

/**
 * The default report, generated on the fly (doc 04 section 5.2): completion
 * card, responses over time, then one widget per question of the latest
 * version with its type's default chart.
 */
export function defaultWidgets(questions: Pick<QuestionSnapshot, 'question_key' | 'type' | 'position'>[]): WidgetSpec[] {
  const out: WidgetSpec[] = [
    { position: 0, question_key: null, metric: 'completion', chart_type: 'stat', cross_tab_key: null, options: {} },
    { position: 1, question_key: null, metric: 'responses_over_time', chart_type: 'line', cross_tab_key: null, options: {} },
  ]
  for (const q of [...questions].sort((a, b) => a.position - b.position)) {
    if (isDisplayOnly(q.type) || q.type === 'hidden') continue
    out.push({
      position: out.length,
      question_key: q.question_key,
      metric: null,
      chart_type: chartsForType(q.type)[0]!,
      cross_tab_key: null,
      options: {},
    })
  }
  return out
}

export function isChartType(v: unknown): v is ChartType {
  return typeof v === 'string' && (CHART_TYPES as readonly string[]).includes(v)
}

export function isMetric(v: unknown): v is Metric {
  return typeof v === 'string' && (METRICS as readonly string[]).includes(v)
}
