import ExcelJS from 'exceljs'
import { guardInjection } from './csv'
import { SUMMARY_HEADER, type SummaryRow } from './summary'

/**
 * XLSX writer (doc 04 section 6.2): Responses, Summary and Questions sheets.
 * Decision: built in memory with exceljs writeBuffer; the direct path is
 * capped at 2,000 rows and larger exports go through export_jobs, so the
 * streaming writer is not needed.
 */

export type QuestionInfo = { question_key: string; label: string; type: string; versions: string }

export type XlsxInput = {
  header: string[]
  labels: string[]
  rows: string[][]
  summary: SummaryRow[]
  questions: QuestionInfo[]
}

/** Same injection guard as CSV: a formula-looking string is kept as text. */
function cell(v: string | number): string | number {
  return typeof v === 'number' ? v : guardInjection(v)
}

export async function buildXlsx(input: XlsxInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Survey'
  wb.created = new Date()

  const responses = wb.addWorksheet('Responses')
  responses.addRow(input.header)
  responses.addRow(input.labels)
  responses.getRow(1).font = { bold: true }
  for (const r of input.rows) responses.addRow(r.map(cell))
  responses.views = [{ state: 'frozen', ySplit: 2 }]

  const summary = wb.addWorksheet('Summary')
  summary.addRow(SUMMARY_HEADER)
  summary.getRow(1).font = { bold: true }
  for (const r of input.summary) summary.addRow(r.map(cell))

  const questions = wb.addWorksheet('Questions')
  questions.addRow(['question_key', 'label', 'type', 'versions'])
  questions.getRow(1).font = { bold: true }
  for (const q of input.questions) questions.addRow([q.question_key, cell(q.label), q.type, q.versions])

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** One worksheet for buildWorkbook: header rows are bold and frozen. */
export type SheetSpec = { name: string; headerRows: (string | number)[][]; rows: (string | number)[][] }

/**
 * Any number of sheets, same injection guard (bulk export, Compare). Pure
 * apart from exceljs; built in memory like buildXlsx.
 */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Survey'
  wb.created = new Date()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const h of s.headerRows) ws.addRow(h.map(cell))
    if (s.headerRows.length) {
      ws.getRow(1).font = { bold: true }
      ws.views = [{ state: 'frozen', ySplit: s.headerRows.length }]
    }
    for (const r of s.rows) ws.addRow(r.map(cell))
  }
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}
