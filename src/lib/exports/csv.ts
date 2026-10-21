/**
 * CSV writer for response exports (doc 04 section 6.1). Pure.
 *
 * - UTF-8 with a BOM so Excel opens it as UTF-8.
 * - RFC 4180 quoting: fields with a comma, quote, CR or LF are quoted and
 *   inner quotes doubled.
 * - CSV injection guard: a cell starting with =, +, -, @, tab or CR gets a
 *   leading apostrophe. Decision: plain numbers ("-5", "-0.25") are left
 *   alone so negative values stay numeric.
 */

export const BOM = '﻿'

const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i

export function guardInjection(value: string): string {
  if (value === '' || NUMERIC.test(value)) return value
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function escapeCsvCell(value: unknown): string {
  const s = guardInjection(value === null || value === undefined ? '' : String(value))
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvLine(cells: unknown[]): string {
  return `${cells.map(escapeCsvCell).join(',')}\r\n`
}

/** Whole document in memory; the route streams csvLine per row instead. */
export function toCsv(header: string[], rows: unknown[][], labels?: string[]): string {
  let out = BOM + csvLine(header)
  if (labels) out += csvLine(labels)
  for (const r of rows) out += csvLine(r)
  return out
}
