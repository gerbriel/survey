import { describe, expect, it } from 'vitest'
import type { Question, SurveyDefinition } from '@/lib/survey'
import { answerValue, filesOf, metadataView, orderedQuestions, previewAnswers, summarizeAnswer } from './answers'

const base = { required: false, label: { format: 'md-lite' as const, text: 'Q' } }
const choice = {
  ...base,
  id: 'q_choice01',
  question_key: 'q_choice01',
  type: 'multiple_choice',
  label: { format: 'md-lite', text: 'Pick **some**' },
  settings: {
    randomize: false,
    options: [
      { id: 'o_a', label: 'Apple' },
      { id: 'o_b', label: 'Other', is_other: true },
    ],
  },
} as Question
const matrix = {
  ...base,
  id: 'q_matrix01',
  question_key: 'q_matrix01',
  type: 'matrix',
  settings: {
    rows: [
      { id: 'r1', label: 'Speed' },
      { id: 'r2', label: 'Price' },
    ],
    columns: [
      { id: 'c1', label: 'Good' },
      { id: 'c2', label: 'Bad' },
    ],
    randomize_rows: false,
    all_rows_required: false,
  },
} as Question
const ranking = {
  ...base,
  id: 'q_rank0001',
  question_key: 'q_rank0001',
  type: 'ranking',
  settings: { randomize: false, options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },
} as Question

const def = {
  pages: [{ id: 'p1', question_ids: ['q_rank0001', 'q_choice01'] }],
  questions: { q_choice01: choice, q_matrix01: matrix, q_rank0001: ranking },
} as unknown as SurveyDefinition

describe('answers', () => {
  it('reads the typed storage column', () => {
    expect(answerValue({ question_key: 'k', value_text: null, value_number: 4, value_date: null, value_json: null })).toBe(4)
    expect(answerValue({ question_key: 'k', value_text: 'hi', value_number: null, value_date: null, value_json: null })).toBe('hi')
    expect(answerValue({ question_key: 'k', value_text: null, value_number: null, value_date: '2026-01-02', value_json: null })).toBe('2026-01-02')
  })
  it('orders questions by page, then the rest', () => {
    expect(orderedQuestions(def).map((q) => q.question_key)).toEqual(['q_rank0001', 'q_choice01', 'q_matrix01'])
  })
  it('labels choices, matrix and ranking from the definition', () => {
    expect(summarizeAnswer(choice, { ids: ['o_a', 'o_b'], other: 'Kiwi' })).toBe('Apple; Other: Kiwi')
    expect(summarizeAnswer(matrix, { r1: 'c2', r2: 'c1' })).toBe('Speed: Bad; Price: Good')
    expect(summarizeAnswer(ranking, ['y', 'x'])).toBe('Y > X')
  })
  it('reads file answers from submit_response', () => {
    expect(filesOf([{ file_id: 'f1', name: 'a.pdf', size: 10, mime: 'application/pdf', path: 'x' }])).toEqual([
      { file_id: 'f1', name: 'a.pdf', size: 10, mime: 'application/pdf' },
    ])
    expect(filesOf({ file_id: 'sig', name: 'signature.png' })[0]!.file_id).toBe('sig')
  })
  it('splits metadata into hidden fields, UTM and details', () => {
    const m = metadataView({ hidden: { ref: 'abc' }, utm_source: 'news', device: 'mobile', alt_email: 'b@x.io', random_seed: 4 })
    expect(m.hidden).toEqual([['ref', 'abc']])
    expect(m.utm).toEqual([['utm_source', 'news']])
    expect(m.other).toEqual([
      ['Device', 'mobile'],
      ['Other email given', 'b@x.io'],
    ])
  })
  it('previews the first answered questions with plain labels', () => {
    const p = previewAnswers(def, [
      { question_key: 'q_choice01', value_text: null, value_number: null, value_date: null, value_json: ['o_a'] },
      { question_key: 'q_matrix01', value_text: null, value_number: null, value_date: null, value_json: { r1: 'c1' } },
    ])
    expect(p).toEqual([
      { label: 'Pick some', text: 'Apple' },
      { label: 'Q', text: 'Speed: Good' },
    ])
  })
})
