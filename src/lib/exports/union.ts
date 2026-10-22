import type { ExportColumn } from './columns'

/**
 * Multi-survey export layout (bulk export). Pure.
 *
 * Combined layout: a `survey` column first, then the per-survey export
 * columns (doc 04 section 6.1) unioned by column id: meta columns, hidden
 * fields, UTM, then question columns keyed by question_key (matrix rows as
 * {question_key}.{row_id}). Order inside each group is the first survey's,
 * then ids only later surveys have. A survey without a column leaves it empty.
 */

export const SURVEY_COLUMN: ExportColumn = { id: 'survey', label: 'Survey', source: 'meta' }

const GROUPS: ExportColumn['source'][] = ['meta', 'hidden', 'utm', 'question']

export function unionExportColumns(perSurvey: ExportColumn[][]): ExportColumn[] {
  const seen = new Map<string, ExportColumn>()
  for (const cols of perSurvey) for (const c of cols) if (!seen.has(c.id)) seen.set(c.id, c)
  const all = [...seen.values()]
  return [SURVEY_COLUMN, ...GROUPS.flatMap((g) => all.filter((c) => c.source === g))]
}

/** One survey's formatted row placed into the union layout. */
export function toUnionRow(surveyTitle: string, surveyColumns: ExportColumn[], row: string[], union: ExportColumn[]): string[] {
  const byId = new Map<string, string>()
  surveyColumns.forEach((c, i) => byId.set(c.id, row[i] ?? ''))
  return union.map((c) => (c === SURVEY_COLUMN || c.id === SURVEY_COLUMN.id ? surveyTitle : (byId.get(c.id) ?? '')))
}

/**
 * Worksheet names: at most 31 characters, none of []:*?/\, unique case
 * insensitively, and never the reserved Summary or Combined.
 */
export function sheetNames(titles: string[], reserved: string[] = ['Summary', 'Combined']): string[] {
  const used = new Set(reserved.map((r) => r.toLowerCase()))
  return titles.map((t) => {
    const base = (t.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Survey').slice(0, 31)
    let name = base
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`
    }
    used.add(name.toLowerCase())
    return name
  })
}

export type SurveyCount = { survey: string; responses: number; complete: number; partial: number }

export const COUNTS_HEADER = ['survey', 'responses', 'complete', 'partial']

export function surveyCounts(title: string, rows: { status: 'partial' | 'complete' }[]): SurveyCount {
  const complete = rows.filter((r) => r.status === 'complete').length
  return { survey: title, responses: rows.length, complete, partial: rows.length - complete }
}
