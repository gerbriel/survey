import Papa from 'papaparse'

/**
 * CSV reading and writing shared by the import wizard (browser preview) and
 * the export routes (server). Pure, no Node or DOM APIs.
 *
 * Decision: parsing is shared code, not server only. Doc 04 section 1.5 asks
 * for the preview in the browser with Papa Parse; the server re-validates each
 * chunk before import_contacts_chunk sees it.
 */

export type ParsedCsv = { headers: string[]; rows: string[][]; errors: string[] }

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  const all = result.data.filter((r) => Array.isArray(r))
  const headerRow = all[0] ?? []
  const headers = headerRow.map((h, i) => (String(h ?? '').trim() || `Column ${i + 1}`))
  const rows = all.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? '').trim()))
  const errors = result.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 1}: ${e.message}`)
  return { headers, rows, errors }
}

/** Cells that a spreadsheet would run as a formula get a leading quote (doc 04 section 6.1). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = typeof value === 'string' ? value : Array.isArray(value) ? value.join('; ') : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n'
}

export const BOM = '﻿'

/** Whole CSV document with a BOM so Excel reads UTF-8. */
export function toCsv(header: string[], rows: unknown[][], opts: { bom?: boolean } = {}): string {
  return (opts.bom === false ? '' : BOM) + csvLine(header) + rows.map(csvLine).join('')
}
