import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES, errorMessage, matchesMask, resolveDateBound, toAnswerRow, validateSubmission, type ValidationContext } from '../validate'
import { normalizeAnswer, toE164 } from '../normalize'
import { splitDefinition } from '../split'
import type { Question, SurveyDefinition } from '../types'
import { ALL_TYPES, ALL_TYPES_ANSWERS, ALL_TYPES_FILES, BRANCHING, defn, NOW, PDF, PIPING, PNG, q, QUIZ } from './fixtures'

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({ now: NOW, hidden: {}, files: ALL_TYPES_FILES, mode: 'final', ...over })
const codes = (r: ReturnType<typeof validateSubmission>, key: string) => (r.errors[key] ?? []).map((e) => e.code)
const withAnswer = (key: string, v: unknown, c: Partial<ValidationContext> = {}, def: SurveyDefinition = ALL_TYPES) =>
  validateSubmission(def, { ...ALL_TYPES_ANSWERS, [key]: v }, ctx(c))

describe('validateSubmission: every type, valid', () => {
  it('accepts the complete answer set and normalizes values', () => {
    const r = validateSubmission(ALL_TYPES, ALL_TYPES_ANSWERS, ctx())
    expect(r.errors).toEqual({})
    expect(r.ok).toBe(true)
    expect(r.cleaned.q_shorttxt).toBe('Ada')
    expect(r.cleaned.q_emailadr).toBe('ada@example.com')
    expect(r.cleaned.q_phonenum).toBe('+15551234567')
    expect(r.cleaned.q_numberxx).toBe(42)
    expect(r.cleaned.q_yesnoxxx).toBe(1)
    expect(r.cleaned.q_consentx).toBe(1)
    expect(r.cleaned.q_hiddenxx).toBe('direct')
    expect(r.cleaned.q_calcxxxx).toBe(84)
    expect(r.computed.q_calcxxxx).toBe(84)
    expect(r.cleaned.q_statemnt).toBeUndefined()
    expect(r.path).toEqual(['p_text0001', 'p_choice01', 'p_misc0001'])
    expect(r.ending_id).toBe('e_default1')
    expect(r.visible_keys).toContain('q_filesxxx')
    expect(r.visible_keys).not.toContain('q_imagexxx')
  })
})

describe('validateSubmission: per-type rules', () => {
  it('text length, pattern, mask', () => {
    expect(codes(withAnswer('q_shorttxt', 'A'), 'q_shorttxt')).toEqual(['min_length'])
    expect(codes(withAnswer('q_longtext', 'x'.repeat(51)), 'q_longtext')).toEqual(['max_length'])
    const pat = defn({ questions: [q({ id: 'q_pattern1', type: 'short_text', settings: { mask: '99-aa' }, validation: { pattern: { regex: '^1', flags: 'i', message: 'Must start with 1' } } })] })
    const r = validateSubmission(pat, { q_pattern1: '22-ab' }, ctx())
    expect(r.errors.q_pattern1?.map((e) => e.message)).toEqual(['Must start with 1'])
    const r2 = validateSubmission(pat, { q_pattern1: '12-a1' }, ctx())
    expect(codes(r2, 'q_pattern1')).toEqual(['pattern'])
    expect(validateSubmission(pat, { q_pattern1: '12-ab' }, ctx()).ok).toBe(true)
    const noMsg = defn({ questions: [q({ id: 'q_pattern1', type: 'short_text', settings: {}, validation: { pattern: { regex: '^1', message: '' } } })] })
    expect(validateSubmission(noMsg, { q_pattern1: '2' }, ctx()).errors.q_pattern1?.[0]?.message).toBe(ERROR_MESSAGES.pattern)
  })

  it('email format, confirm, domains', () => {
    expect(codes(withAnswer('q_emailadr', 'nope'), 'q_emailadr')).toEqual(['email'])
    expect(codes(withAnswer('q_emailadr', { email: 'a@b.co', confirm: 'x@b.co' }), 'q_emailadr')).toEqual(['confirm_mismatch'])
    expect(codes(withAnswer('q_emailadr', 'a@sub.spam.test'), 'q_emailadr')).toEqual(['email'])
    expect(codes(withAnswer('q_emailadr', 5), 'q_emailadr')).toEqual(['type'])
    const allow = defn({ questions: [q({ id: 'q_email001', type: 'email', settings: {}, validation: { allowed_email_domains: ['corp.org'] } })] })
    expect(validateSubmission(allow, { q_email001: 'a@corp.org' }, ctx()).ok).toBe(true)
    expect(validateSubmission(allow, { q_email001: 'a@gmail.com' }, ctx()).ok).toBe(false)
  })

  it('phone E.164', () => {
    expect(codes(withAnswer('q_phonenum', '12'), 'q_phonenum')).toEqual(['phone'])
    expect(withAnswer('q_phonenum', '+44 20 7946 0958').cleaned.q_phonenum).toBe('+442079460958')
    expect(toE164('0044 1234 5678', 'GB')).toBe('+4412345678')
    expect(toE164('1 555 123 4567', 'CA')).toBe('+15551234567')
    expect(toE164('5551234', 'FR')).toBe('5551234')
  })

  it('number bounds and integer', () => {
    expect(codes(withAnswer('q_numberxx', 101), 'q_numberxx')).toEqual(['max'])
    expect(codes(withAnswer('q_numberxx', -1), 'q_numberxx')).toEqual(['min'])
    expect(codes(withAnswer('q_numberxx', 1.5), 'q_numberxx')).toEqual(['integer'])
    expect(codes(withAnswer('q_numberxx', 'abc'), 'q_numberxx')).toEqual(['type'])
    expect(withAnswer('q_numberxx', '').errors.q_numberxx).toBeUndefined()
  })

  it('choices: unknown option, other, exclusive, selections', () => {
    expect(codes(withAnswer('q_singlech', 'o_nothere1'), 'q_singlech')).toEqual(['unknown_option'])
    expect(codes(withAnswer('q_singlech', { id: 'o_red00001', other: 'x' }), 'q_singlech')).toEqual(['type'])
    expect(codes(withAnswer('q_singlech', 5), 'q_singlech')).toEqual(['type'])
    expect(withAnswer('q_singlech', { id: 'o_red00001' }).cleaned.q_singlech).toBe('o_red00001')
    expect(codes(withAnswer('q_multich1', ['o_aaaaaaaa', 'o_none0001']), 'q_multich1')).toEqual(['exclusive'])
    expect(codes(withAnswer('q_multich1', ['o_aaaaaaaa', 'o_bbbbbbbb', 'o_cccccccc']), 'q_multich1')).toEqual(['max_selections'])
    expect(codes(withAnswer('q_multich1', ['o_aaaaaaaa', 'o_aaaaaaaa']), 'q_multich1')).toEqual(['unknown_option'])
    expect(codes(withAnswer('q_multich1', { ids: ['o_aaaaaaaa'], other: 'x' }), 'q_multich1')).toEqual(['type'])
    expect(codes(withAnswer('q_multich1', { ids: 'x' }), 'q_multich1')).toEqual(['type'])
    expect(codes(withAnswer('q_multich1', 7), 'q_multich1')).toEqual(['type'])
    expect(withAnswer('q_multich1', { ids: [] }).errors.q_multich1).toBeUndefined()
    const minSel = defn({ questions: [q({ id: 'q_multi001', type: 'multiple_choice', settings: { options: [{ id: 'o_1', label: '1', is_other: true }, { id: 'o_2', label: '2' }], randomize: false }, validation: { min_selections: 2 } })] })
    expect(codes(validateSubmission(minSel, { q_multi001: ['o_1'] }, ctx()), 'q_multi001')).toEqual(['min_selections'])
    expect(validateSubmission(minSel, { q_multi001: ['o_1'] }, ctx({ mode: 'partial' })).ok).toBe(true)
    expect(validateSubmission(minSel, { q_multi001: { ids: ['o_1', 'o_2'], other: 'More' } }, ctx()).cleaned.q_multi001).toEqual({ ids: ['o_1', 'o_2'], other: 'More' })
  })

  it('ranking: known, unique, top N, complete', () => {
    expect(codes(withAnswer('q_rankingx', ['o_rank0001']), 'q_rankingx')).toEqual(['min_selections'])
    expect(withAnswer('q_rankingx', ['o_rank0001'], { mode: 'partial' }).errors.q_rankingx).toBeUndefined()
    expect(codes(withAnswer('q_rankingx', ['o_rank0001', 'o_rank0002', 'o_rank0003']), 'q_rankingx')).toEqual(['max_selections'])
    expect(codes(withAnswer('q_rankingx', ['o_rank0001', 'o_nothere1']), 'q_rankingx')).toEqual(['unknown_option'])
    expect(codes(withAnswer('q_rankingx', 'x'), 'q_rankingx')).toEqual(['type'])
  })

  it('yes_no, rating, nps', () => {
    expect(codes(withAnswer('q_yesnoxxx', 'maybe'), 'q_yesnoxxx')).toEqual(['type'])
    expect(withAnswer('q_yesnoxxx', 'false').cleaned.q_yesnoxxx).toBe(0)
    expect(codes(withAnswer('q_ratingxx', 6), 'q_ratingxx')).toEqual(['max'])
    expect(codes(withAnswer('q_ratingxx', 0), 'q_ratingxx')).toEqual(['min'])
    expect(codes(withAnswer('q_ratingxx', 2.5), 'q_ratingxx')).toEqual(['integer'])
    expect(codes(withAnswer('q_npsxxxxx', 11), 'q_npsxxxxx')).toEqual(['max'])
    expect(codes(withAnswer('q_npsxxxxx', -1), 'q_npsxxxxx')).toEqual(['min'])
    expect(codes(withAnswer('q_npsxxxxx', 1.5), 'q_npsxxxxx')).toEqual(['integer'])
  })

  it('matrix: unknown ids and per-row required', () => {
    const r = withAnswer('q_matrixxx', { r_speed001: 'c_nothere1', r_bogus001: 'c_good0001' })
    expect(r.errors.q_matrixxx?.filter((e) => e.code === 'unknown_option').map((e) => e.row_id)).toEqual(['r_speed001', 'r_bogus001'])
    expect(r.errors.q_matrixxx?.find((e) => e.code === 'required')?.row_id).toBe('r_price001')
    expect(codes(withAnswer('q_matrixxx', { r_speed001: 5 }), 'q_matrixxx')).toEqual(['type'])
    expect(codes(withAnswer('q_matrixxx', []), 'q_matrixxx')).toEqual(['type'])
    expect(withAnswer('q_matrixxx', { r_speed001: '' }).errors.q_matrixxx?.length).toBe(2)
    const loose = defn({ questions: [q({ id: 'q_matrix01', type: 'matrix', required: true, settings: { rows: [{ id: 'r_1', label: 'r' }], columns: [{ id: 'c_1', label: 'c' }], randomize_rows: false, all_rows_required: false } })] })
    expect(codes(validateSubmission(loose, {}, ctx()), 'q_matrix01')).toEqual(['required'])
  })

  it('date: format, bounds (absolute and relative), weekdays', () => {
    expect(codes(withAnswer('q_datexxxx', '2026-02-30'), 'q_datexxxx')).toEqual(['type'])
    expect(codes(withAnswer('q_datexxxx', 20261022), 'q_datexxxx')).toEqual(['type'])
    expect(codes(withAnswer('q_datexxxx', '2026-10-20'), 'q_datexxxx')).toEqual(['min_date'])
    expect(codes(withAnswer('q_datexxxx', '2028-01-04'), 'q_datexxxx')).toEqual(['max_date'])
    expect(withAnswer('q_datexxxx', '2026-10-25').errors.q_datexxxx?.[0]?.message).toBe('This day is not available.')
    expect(withAnswer('q_datexxxx', '2026-10-20').errors.q_datexxxx?.[0]?.message).toBe('Choose a date on or after 2026-10-21.')
    expect(resolveDateBound(undefined, NOW)).toBeUndefined()
    expect(resolveDateBound({ relative_days: -1 }, NOW)).toBe('2026-10-20')
    expect(resolveDateBound('2026-01-01T00:00:00Z', NOW)).toBe('2026-01-01')
  })

  it('time: format, step, bounds', () => {
    expect(codes(withAnswer('q_timexxxx', '25:00'), 'q_timexxxx')).toEqual(['type'])
    expect(codes(withAnswer('q_timexxxx', '09:10'), 'q_timexxxx')).toEqual(['type'])
    expect(codes(withAnswer('q_timexxxx', '08:00'), 'q_timexxxx')).toEqual(['min'])
    expect(withAnswer('q_timexxxx', '18:00').errors.q_timexxxx?.[0]?.message).toBe('Enter a value of at most 17:00.')
  })

  it('files: manifest, type, size, count; signature png', () => {
    const big = { ...PDF, path: 'resp/1/big.pdf', size: 2 * 1024 * 1024 }
    const txt = { ...PDF, path: 'resp/1/x.txt', name: 'x.txt' }
    const manifest = { q_filesxxx: [PDF, big, txt], q_signatur: [PNG, { ...PNG, path: 'resp/1/s.jpg', mime: 'image/jpeg' }] }
    expect(codes(withAnswer('q_filesxxx', [{ ...PDF, path: 'resp/2/forged.pdf' }]), 'q_filesxxx')).toEqual(['file_unknown'])
    expect(codes(withAnswer('q_filesxxx', [big], { files: manifest }), 'q_filesxxx')).toEqual(['file_size'])
    expect(codes(withAnswer('q_filesxxx', [txt], { files: manifest }), 'q_filesxxx')).toEqual(['file_type'])
    expect(codes(withAnswer('q_filesxxx', [PDF, PDF, PDF], { files: manifest }), 'q_filesxxx')).toEqual(['file_count'])
    // Manifest size is authoritative over the client-claimed size.
    expect(codes(withAnswer('q_filesxxx', [{ ...big, size: 10 }], { files: manifest }), 'q_filesxxx')).toEqual(['file_size'])
    expect(codes(withAnswer('q_signatur', { ...PNG, path: 'resp/1/s.jpg' }, { files: manifest }), 'q_signatur')).toEqual(['file_type'])
    expect(codes(withAnswer('q_signatur', PNG, { files: {} }), 'q_signatur')).toEqual(['file_unknown'])
    expect(codes(withAnswer('q_filesxxx', [{ path: 1 }]), 'q_filesxxx')).toEqual(['type'])
    expect(codes(withAnswer('q_signatur', 'x'), 'q_signatur')).toEqual(['type'])
    expect(withAnswer('q_filesxxx', []).errors.q_filesxxx).toBeUndefined()
  })

  it('address: parts required, locked country', () => {
    const r = withAnswer('q_address1', { line1: '1 Main', country: 'CA' })
    expect(r.errors.q_address1?.map((e) => [e.code, e.part])).toEqual([
      ['type', 'country'],
      ['required', 'city'],
    ])
    expect(codes(withAnswer('q_address1', { line1: 5 }), 'q_address1')).toEqual(['type'])
    expect(codes(withAnswer('q_address1', 'x'), 'q_address1')).toEqual(['type'])
    expect(withAnswer('q_address1', { line1: ' ', line2: null }).errors.q_address1?.length).toBe(2)
    const plain = defn({ questions: [q({ id: 'q_addr0001', type: 'address', required: true, settings: { parts_required: {} } })] })
    expect(codes(validateSubmission(plain, {}, ctx()), 'q_addr0001')).toEqual(['required'])
  })

  it('consent must be checked when required, once', () => {
    expect(codes(withAnswer('q_consentx', false), 'q_consentx')).toEqual(['consent'])
    expect(codes(withAnswer('q_consentx', undefined), 'q_consentx')).toEqual(['consent'])
    expect(withAnswer('q_consentx', false, { mode: 'partial' }).errors.q_consentx).toBeUndefined()
  })
})

describe('validateSubmission: modes and logic', () => {
  it('final requires visible required questions; partial does not', () => {
    const r = validateSubmission(BRANCHING, { q_rolexxxx: 'o_student1' }, ctx({ files: {} }))
    expect(Object.keys(r.errors).sort()).toEqual(['q_finalxxx', 'q_schoolxx', 'q_studentq'])
    expect(validateSubmission(BRANCHING, { q_rolexxxx: 'o_student1' }, ctx({ mode: 'partial' })).ok).toBe(true)
  })

  it('drops answers to hidden questions and off-path pages without errors', () => {
    const r = validateSubmission(BRANCHING, { q_rolexxxx: 'o_teacher1', q_schoolxx: 'x', q_studentq: 'x', q_teachrq1: 'T', q_finalxxx: 'F' }, ctx())
    expect(r.ok).toBe(true)
    expect(r.cleaned).toEqual({ q_rolexxxx: 'o_teacher1', q_teachrq1: 'T', q_finalxxx: 'F' })
    expect(r.visible_keys).toEqual(['q_rolexxxx', 'q_agexxxxx', 'q_gradexxx', 'q_teachrq1', 'q_finalxxx'])
  })

  it('early ending: only the first page counts', () => {
    const r = validateSubmission(BRANCHING, { q_rolexxxx: 'o_visitor1', q_finalxxx: 'x' }, ctx())
    expect(r.ok).toBe(true)
    expect(r.ending_id).toBe('e_visitor1')
    expect(r.ended_early).toBe(true)
    expect(r.cleaned).toEqual({ q_rolexxxx: 'o_visitor1' })
  })

  it('page mode checks only that page; other invalid answers stay out of cleaned', () => {
    const r = validateSubmission(BRANCHING, { q_rolexxxx: 'o_student1', q_schoolxx: '', q_studentq: 'S', q_agexxxxx: 'x' }, ctx({ mode: 'page', page_id: 'p_student1' }))
    expect(r.ok).toBe(true)
    const r2 = validateSubmission(BRANCHING, { q_rolexxxx: 'o_student1' }, ctx({ mode: 'page', page_id: 'p_start001' }))
    expect(Object.keys(r2.errors)).toEqual(['q_schoolxx'])
    expect(validateSubmission(BRANCHING, {}, ctx({ mode: 'page', page_id: 'p_nothere1' })).ok).toBe(true)
    const r3 = validateSubmission(ALL_TYPES, { ...ALL_TYPES_ANSWERS, q_ratingxx: 99 }, ctx({ mode: 'page', page_id: 'p_text0001' }))
    expect(r3.ok).toBe(true)
    expect(r3.cleaned.q_ratingxx).toBeUndefined()
    expect(r3.cleaned.q_npsxxxxx).toBe(9)
  })

  it('ignores client calc values and unknown keys; accepts id keys', () => {
    const r = validateSubmission(PIPING, { q_namexxxx: 'A', q_qtyxxxxx: 2, q_totalxxx: 1e9, junk: 1 }, ctx())
    expect(r.cleaned.q_totalxxx).toBe(20)
    expect(r.cleaned.junk).toBeUndefined()
    const renamed: SurveyDefinition = { ...PIPING, questions: { ...PIPING.questions, q_namexxxx: { ...(PIPING.questions.q_namexxxx as Question), question_key: 'q_newkey01' } } }
    expect(validateSubmission(renamed, { q_namexxxx: 'A' }, ctx()).cleaned.q_newkey01).toBe('A')
    expect(validateSubmission(PIPING, null as unknown as Record<string, unknown>, ctx({ mode: 'partial' })).ok).toBe(true)
  })

  it('quiz: server computes only the quiz score calc into computed; client gets none', () => {
    const answers = { q_quiz0001: 'o_q1right1' }
    const server = validateSubmission(QUIZ, answers, ctx())
    expect(server.computed).toEqual({ q_scorexxx: 3, q_plaincal: 7 })
    expect(server.cleaned.q_scorexxx).toBeUndefined()
    expect(server.cleaned.q_pctxxxxx).toBeUndefined()
    expect(server.score).toEqual({ value: 3, max: 10 })
    const client = validateSubmission(splitDefinition(QUIZ).public_definition, answers, ctx())
    expect(client.computed).toEqual({ q_plaincal: 7 })
    expect(client.visible_keys).toEqual(server.visible_keys)
  })
})

describe('helpers', () => {
  it('errorMessage interpolates and keeps unknown placeholders', () => {
    expect(errorMessage('min', { min: 3 })).toBe('Enter a value of at least 3.')
    expect(errorMessage('min')).toBe('Enter a value of at least {min}.')
  })

  it('matchesMask', () => {
    expect(matchesMask('ab-12', 'aa-99')).toBe(true)
    expect(matchesMask('a1', '**')).toBe(true)
    expect(matchesMask('a-', '**')).toBe(false)
    expect(matchesMask('abc', 'aa')).toBe(false)
  })

  it('toAnswerRow maps every type to one storage column', () => {
    const qs = ALL_TYPES.questions
    const r = validateSubmission(ALL_TYPES, ALL_TYPES_ANSWERS, ctx())
    const rows = Object.fromEntries(Object.entries(r.cleaned).map(([k, v]) => [k, toAnswerRow(qs[k] as Question, v)]))
    expect(rows.q_shorttxt).toEqual({ value_text: 'Ada' })
    expect(rows.q_singlech).toEqual({ value_text: 'o_other001', value_json: { other: 'Green' } })
    expect(rows.q_numberxx).toEqual({ value_number: 42 })
    expect(rows.q_datexxxx).toEqual({ value_date: '2026-10-22' })
    expect(rows.q_multich1).toEqual({ value_json: ['o_aaaaaaaa', 'o_bbbbbbbb'] })
    expect(rows.q_calcxxxx).toEqual({ value_number: 84 })
    expect(toAnswerRow(qs.q_dropdown as Question, 'o_ca000001')).toEqual({ value_text: 'o_ca000001' })
    expect(toAnswerRow(qs.q_statemnt as Question, 'x')).toBeNull()
  })

  it('normalizeAnswer edge cases', () => {
    const qs = ALL_TYPES.questions
    expect(normalizeAnswer(qs.q_shorttxt as Question, 5)).toEqual({ kind: 'value', value: '5' })
    expect(normalizeAnswer(qs.q_shorttxt as Question, {})).toEqual({ kind: 'invalid' })
    expect(normalizeAnswer(qs.q_shorttxt as Question, '  ')).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_emailadr as Question, ' ')).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_phonenum as Question, [])).toEqual({ kind: 'invalid' })
    expect(normalizeAnswer(qs.q_phonenum as Question, '')).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_datexxxx as Question, ' ')).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_numberxx as Question, Infinity)).toEqual({ kind: 'invalid' })
    expect(normalizeAnswer(qs.q_singlech as Question, '')).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_multich1 as Question, [])).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_rankingx as Question, [])).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_matrixxx as Question, {})).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_address1 as Question, {})).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_imagexxx as Question, 'x')).toEqual({ kind: 'empty' })
    expect(normalizeAnswer(qs.q_shorttxt as Question, null)).toEqual({ kind: 'empty' })
  })
})
