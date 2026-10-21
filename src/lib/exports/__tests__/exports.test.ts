import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { QuestionBlock } from '@/lib/analytics/analyze'
import { summarizeQuestion } from '@/lib/analytics/aggregate'
import type { AnswerLite, QuestionSnapshot, ResponseLite } from '@/lib/analytics/types'
import { buildColumns, formatAnswerCell, responseFilePath, responseRow, type RowContext } from '../columns'
import { BOM, csvLine, escapeCsvCell, guardInjection, toCsv } from '../csv'
import { summaryRows } from '../summary'
import { buildXlsx } from '../xlsx'

const V = '11111111-1111-4111-8111-111111111111'
const q = (p: Partial<QuestionSnapshot> & { type: string; question_key: string }): QuestionSnapshot => ({
  survey_version_id: V,
  label: p.question_key,
  position: 0,
  page_index: 0,
  is_pii: false,
  options: null,
  settings: {},
  ...p,
})
const a = (question_key: string, p: Partial<AnswerLite>): AnswerLite => ({
  response_id: 'r1',
  question_key,
  survey_version_id: V,
  value_text: null,
  value_number: null,
  value_date: null,
  value_json: null,
  ...p,
})

const OPTS = [
  { id: 'o1', label: 'Red' },
  { id: 'o2', label: 'Blue' },
]
const QS = [
  q({ type: 'hidden', question_key: 'q_hidden00', settings: { param: 'src' } }),
  q({ type: 'single_choice', question_key: 'q_single00', label: 'Colour', options: OPTS }),
  q({ type: 'multiple_choice', question_key: 'q_multi000', options: OPTS }),
  q({ type: 'matrix', question_key: 'q_matrix00', label: 'Rate', settings: { rows: [{ id: 'm1', label: 'Speed' }, { id: 'm2', label: 'Price' }], columns: [{ id: 'c1', label: 'Bad' }, { id: 'c2', label: 'Good' }] } }),
  q({ type: 'ranking', question_key: 'q_rank0000', options: OPTS }),
  q({ type: 'file_upload', question_key: 'q_file0000' }),
  q({ type: 'number', question_key: 'q_number00' }),
  q({ type: 'statement', question_key: 'q_stmt0000' }),
  q({ type: 'short_text', question_key: 'q_text0000' }),
]

describe('csv writer', () => {
  it('quotes and doubles quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(escapeCsvCell(null)).toBe('')
  })
  it('guards formula injection but leaves numbers alone', () => {
    for (const s of ['=SUM(A1)', '+1+1', '-cmd', '@x', '\tx', '\rx']) expect(guardInjection(s).startsWith("'")).toBe(true)
    expect(guardInjection('-5')).toBe('-5')
    expect(guardInjection('-0.25')).toBe('-0.25')
    expect(escapeCsvCell('=1,2')).toBe(`"'=1,2"`)
    // D-06: leading whitespace, LF and the semicolon delimiter
    for (const s of ['  =1+1', ' \t@x', '\n=1', '\u00a0=1']) expect(guardInjection(s).startsWith("'")).toBe(true)
    expect(escapeCsvCell('Paris;=HYPERLINK("http://x","c")')).toBe('"Paris;=HYPERLINK(""http://x"",""c"")"')
    expect(escapeCsvCell('a;b')).toBe('"a;b"')
    expect(guardInjection(' -5')).toBe("' -5")
  })
  it('BOM, CRLF and optional label row', () => {
    const s = toCsv(['a', 'b'], [[1, 'x']], ['A', 'B'])
    expect(s.startsWith(BOM)).toBe(true)
    expect(s).toBe(`${BOM}a,b\r\nA,B\r\n1,x\r\n`)
    expect(csvLine(['x'])).toBe('x\r\n')
  })
})

describe('export columns and cells', () => {
  const cols = buildColumns(QS)
  it('meta, hidden, utm, then one column per key; matrix per row; display types skipped', () => {
    const ids = cols.map((c) => c.id)
    expect(ids.slice(0, 9)).toEqual(['response_id', 'status', 'started_at', 'submitted_at', 'version', 'contact_id', 'contact_email', 'identity_source', 'token'])
    expect(ids).toContain('hidden.src')
    expect(ids).toContain('utm_campaign')
    expect(ids).toContain('q_matrix00.m1')
    expect(ids).toContain('q_matrix00.m2')
    expect(ids).not.toContain('q_matrix00')
    expect(ids).not.toContain('q_stmt0000')
    expect(ids).not.toContain('q_hidden00')
    expect(cols.find((c) => c.id === 'q_matrix00.m1')!.label).toBe('Rate: Speed')
  })
  it('formats one response row', () => {
    const r: ResponseLite = {
      id: 'r1',
      survey_version_id: V,
      status: 'complete',
      started_at: '2026-10-01T10:00:00Z',
      submitted_at: '2026-10-01T10:05:00Z',
      contact_id: 'c1',
      identity_source: 'token',
      respondent_token_id: 't1',
      metadata: { utm_source: 'mail' },
    }
    const ctx: RowContext = {
      versionNo: new Map([[V, 3]]),
      question: (_v, k) => QS.find((x) => x.question_key === k),
      contactEmail: new Map([['c1', 'pat@example.org']]),
      tokens: new Map([['t1', 'tok123']]),
      fileUrl: (id) => `https://survey.example.org${responseFilePath('acme', 's1', id)}`,
    }
    const row = responseRow(
      cols,
      r,
      [
        a('q_hidden00', { value_text: 'newsletter' }),
        a('q_single00', { value_text: 'o1', value_json: { other: 'ish' } }),
        a('q_multi000', { value_json: ['o1', 'o2'] }),
        a('q_matrix00', { value_json: { m1: 'c2' } }),
        a('q_rank0000', { value_json: ['o2', 'o1'] }),
        a('q_file0000', { value_json: [{ file_id: 'f1' }, { file_id: 'f2' }] }),
        a('q_number00', { value_number: -3 }),
        a('q_text0000', { value_text: '=HYPERLINK()' }),
      ],
      ctx,
    )
    const get = (id: string) => row[cols.findIndex((c) => c.id === id)]
    expect(get('version')).toBe('3')
    expect(get('contact_email')).toBe('pat@example.org')
    expect(get('token')).toBe('tok123')
    expect(get('utm_source')).toBe('mail')
    expect(get('hidden.src')).toBe('newsletter')
    expect(get('q_single00')).toBe('Red: ish')
    expect(get('q_multi000')).toBe('Red; Blue')
    expect(get('q_matrix00.m1')).toBe('Good')
    expect(get('q_matrix00.m2')).toBe('')
    expect(get('q_rank0000')).toBe('Blue > Red')
    expect(get('q_file0000')).toBe('https://survey.example.org/w/acme/surveys/s1/responses/files/f1; https://survey.example.org/w/acme/surveys/s1/responses/files/f2')
    expect(get('q_number00')).toBe('-3')
    expect(escapeCsvCell(get('q_text0000'))).toBe("'=HYPERLINK()")
  })
  it('yes/no and address cells', () => {
    expect(formatAnswerCell(q({ type: 'yes_no', question_key: 'q_yn000000' }), a('q_yn000000', { value_number: 1 }), () => '')).toBe('Yes')
    expect(formatAnswerCell(q({ type: 'address', question_key: 'q_addr0000' }), a('q_addr0000', { value_json: { line1: '1 Main', city: 'Fresno' } }), () => '')).toBe('1 Main, Fresno')
  })
})

describe('xlsx writer', () => {
  it('writes Responses, Summary and Questions sheets that read back', async () => {
    const nps = q({ type: 'nps', question_key: 'q_nps00000', label: 'Recommend?' })
    const block: QuestionBlock = { question: nps, summary: summarizeQuestion(nps, [9, 10, 3].map((v) => a('q_nps00000', { value_number: v }))), diff: null, refused: false, crossTab: null }
    const buf = await buildXlsx({
      header: ['response_id', 'q_nps00000'],
      labels: ['Response id', 'Recommend?'],
      rows: [['r1', '9'], ['r2', '=evil()']],
      summary: summaryRows([block]),
      questions: [{ question_key: 'q_nps00000', label: 'Recommend?', type: 'nps', versions: 'v1' }],
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Responses', 'Summary', 'Questions'])
    const resp = wb.getWorksheet('Responses')!
    expect(resp.getRow(1).getCell(2).value).toBe('q_nps00000')
    expect(resp.getRow(3).getCell(1).value).toBe('r1')
    expect(resp.getRow(4).getCell(2).value).toBe("'=evil()")
    const sum = wb.getWorksheet('Summary')!
    const values = sum.getSheetValues().flat().filter((v) => v !== undefined && v !== null)
    expect(values).toContain('nps')
    expect(values).toContain(33)
    expect(wb.getWorksheet('Questions')!.getRow(2).getCell(4).value).toBe('v1')
  })
})
