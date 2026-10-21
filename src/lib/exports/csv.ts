/**
 * CSV writer for response exports (doc 04 section 6.1). Pure.
 *
 * - UTF-8 with a BOM so Excel opens it as UTF-8.
 * - RFC 4180 quoting: fields with a comma, semicolon, quote, CR or LF are
 *   quoted and inner quotes doubled. D-06: the semicolon is quoted too, since
 *   Excel splits on it in locales whose list separator is `;`.
 * - CSV injection guard: a cell starting with =, +, -, @, tab, CR or LF,
 *   after any leading whitespace (D-06), gets a leading apostrophe.
 *   Decision: plain numbers ("-5", "-0.25") are left alone so negative
 *   values stay numeric.
 */

export const BOM = '﻿'

const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i

export function guardInjection(value: string): string {
  if (value === '' || NUMERIC.test(value)) return value
  // D-06: leading whitespace before a formula character is guarded too.
  return FORMULA_START.test(value) ? `'${value}` : value
}

/** D-06: optional leading whitespace, then a character a spreadsheet treats as a formula start. */
export const FORMULA_START = /^\s*[=+\-@\t\r\n]/

export function escapeCsvCell(value: unknown): string {
  const s = guardInjection(value === null || value === undefined ? '' : String(value))
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
