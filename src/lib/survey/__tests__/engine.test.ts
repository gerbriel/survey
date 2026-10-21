import { describe, expect, it } from 'vitest'
import {
  calcOrder,
  compareLeaf,
  evaluate,
  evaluateCondition,
  isAnswered,
  isCorrect,
  maxScore,
  normalizeAnswers,
  numericValue,
  operatorsFor,
  operatorsForField,
  orderMatrixRows,
  orderOptions,
  orderPageQuestions,
  orderPages,
  questionMaxScore,
  questionScore,
  resolveHidden,
} from '../engine'
import { splitDefinition } from '../split'
import { QUESTION_TYPES, type Condition, type Question, type SurveyDefinition } from '../types'
import { ALL_TYPES, ALL_TYPES_ANSWERS, BRANCHING, defn, NOW, PIPING, q, QUIZ } from './fixtures'

const leaf = (id: string, op: Condition extends infer C ? (C extends { op: infer O } ? O : never) : never, value?: unknown): Condition =>
  ({ field: { kind: 'question', id }, op, value }) as Condition

describe('operatorsFor', () => {
  it('has an entry for every type', () => {
    for (const t of QUESTION_TYPES) expect(Array.isArray(operatorsFor(t))).toBe(true)
    expect(operatorsFor('statement')).toEqual([])
    expect(operatorsFor('short_text')).toContain('matches')
    expect(operatorsFor('number')).toContain('between')
    expect(operatorsFor('multiple_choice')).toContain('includes_all')
    expect(operatorsFor('date')).toContain('before')
    expect(operatorsFor('file_upload')).toEqual(['is_answered', 'is_not_answered'])
    expect(operatorsForField('matrix', true)).toContain('eq')
    expect(operatorsForField('matrix', false)).not.toContain('eq')
  })
})

describe('compareLeaf', () => {
  it('unanswered: only is_not_answered, neq, includes_none are true', () => {
    for (const op of ['eq', 'gt', 'contains', 'is_answered', 'includes_any', 'before', 'matches'] as const) {
      expect(compareLeaf('short_text', undefined, op, 'x')).toBe(false)
    }
    for (const op of ['is_not_answered', 'neq', 'includes_none'] as const) expect(compareLeaf('short_text', '', op, 'x')).toBe(true)
    expect(compareLeaf('multiple_choice', [], 'includes_none', ['a'])).toBe(true)
  })

  it('text is case-insensitive and trimmed', () => {
    expect(compareLeaf('short_text', '  Hello ', 'eq', 'hello')).toBe(true)
    expect(compareLeaf('short_text', 'Hello', 'neq', 'hello')).toBe(false)
    expect(compareLeaf('short_text', 'Hello World', 'contains', 'WORLD')).toBe(true)
    expect(compareLeaf('short_text', 'Hello', 'not_contains', 'x')).toBe(true)
    expect(compareLeaf('short_text', 'Hello', 'starts_with', 'he')).toBe(true)
    expect(compareLeaf('short_text', 'Hello', 'ends_with', 'LO')).toBe(true)
    expect(compareLeaf('short_text', 'abc123', 'matches', '^[a-z]+\\d+$')).toBe(true)
    expect(compareLeaf('short_text', 'ABC', 'matches', '^abc$')).toBe(true)
    expect(compareLeaf('short_text', 'aaa', 'matches', '(a+)+$')).toBe(false)
    expect(compareLeaf('short_text', 'aaa', 'matches', '[')).toBe(false)
    expect(compareLeaf('short_text', 'aaa', 'matches', 5)).toBe(false)
  })

  it('numbers compare numerically, booleans as 1/0', () => {
    expect(compareLeaf('number', 10, 'gt', 9)).toBe(true)
    expect(compareLeaf('number', 10, 'gte', '10')).toBe(true)
    expect(compareLeaf('number', 10, 'lt', 11)).toBe(true)
    expect(compareLeaf('number', 10, 'lte', 9)).toBe(false)
    expect(compareLeaf('number', 10, 'eq', 10)).toBe(true)
    expect(compareLeaf('number', 10, 'between', ['5', '10'])).toBe(true)
    expect(compareLeaf('number', 11, 'between', ['5', '10'])).toBe(false)
    expect(compareLeaf('number', 11, 'between', ['5'])).toBe(false)
    expect(compareLeaf('number', 11, 'between', ['a', 'b'])).toBe(false)
    expect(compareLeaf('number', 11, 'gt', 'abc')).toBe(false)
    expect(compareLeaf('number', 11, 'gt', null)).toBe(false)
    expect(compareLeaf('yes_no', 1, 'eq', true)).toBe(true)
    expect(compareLeaf('yes_no', 0, 'eq', false)).toBe(true)
    expect(compareLeaf('yes_no', 0, 'neq', true)).toBe(true)
  })

  it('choices compare option ids', () => {
    expect(compareLeaf('single_choice', 'o_a', 'eq', 'o_a')).toBe(true)
    expect(compareLeaf('single_choice', { id: 'o_a', other: 'x' }, 'eq', 'o_a')).toBe(true)
    expect(compareLeaf('single_choice', 'o_a', 'includes_any', ['o_a', 'o_b'])).toBe(true)
    expect(compareLeaf('single_choice', 'o_a', 'includes_none', 'o_b')).toBe(true)
    expect(compareLeaf('multiple_choice', ['o_a', 'o_b'], 'includes_all', ['o_a', 'o_b'])).toBe(true)
    expect(compareLeaf('multiple_choice', ['o_a'], 'includes_all', [])).toBe(false)
    expect(compareLeaf('multiple_choice', ['o_a', 'o_b'], 'eq', ['o_b', 'o_a'])).toBe(true)
    expect(compareLeaf('multiple_choice', ['o_a', 'o_b'], 'eq', ['o_b'])).toBe(false)
    expect(compareLeaf('multiple_choice', { ids: ['o_a'], other: 'x' }, 'includes_any', ['o_a'])).toBe(true)
    expect(compareLeaf('matrix_row', 'c_1', 'eq', 'c_1')).toBe(true)
  })

  it('dates and times compare ISO strings', () => {
    expect(compareLeaf('date', '2026-10-21', 'before', '2026-10-22')).toBe(true)
    expect(compareLeaf('date', '2026-10-21', 'after', '2026-10-22')).toBe(false)
    expect(compareLeaf('date', '2026-10-21', 'on', '2026-10-21T08:00:00Z')).toBe(true)
    expect(compareLeaf('date', '2026-10-21', 'between', ['2026-01-01', '2026-12-31'])).toBe(true)
    expect(compareLeaf('date', '2026-10-21', 'before', 5)).toBe(false)
    expect(compareLeaf('time', '09:30', 'gt', '09:00')).toBe(true)
    expect(compareLeaf('time', '09:30', 'eq', '09:30')).toBe(true)
    expect(compareLeaf('file_upload', [{}], 'is_answered', undefined)).toBe(true)
    expect(compareLeaf('file_upload', [{}], 'eq', 'x')).toBe(false)
  })

  it('isAnswered covers every shape', () => {
    expect(isAnswered(null)).toBe(false)
    expect(isAnswered(' ')).toBe(false)
    expect(isAnswered(NaN)).toBe(false)
    expect(isAnswered(0)).toBe(true)
    expect(isAnswered({})).toBe(false)
    expect(isAnswered({ a: 1 })).toBe(true)
    expect(isAnswered(true)).toBe(true)
  })
})

describe('evaluateCondition and groups', () => {
  const d = BRANCHING
  const ans = { q_rolexxxx: 'o_student1', q_agexxxxx: 20 }
  it('all, any, not and empty groups', () => {
    expect(evaluateCondition(d, { all: [] }, ans)).toBe(true)
    expect(evaluateCondition(d, { any: [] }, ans)).toBe(false)
    expect(evaluateCondition(d, { all: [leaf('q_rolexxxx', 'eq', 'o_student1'), leaf('q_agexxxxx', 'lt', 30)] }, ans)).toBe(true)
    expect(evaluateCondition(d, { any: [leaf('q_rolexxxx', 'eq', 'o_teacher1'), leaf('q_agexxxxx', 'gt', 30)] }, ans)).toBe(false)
    expect(evaluateCondition(d, { not: leaf('q_rolexxxx', 'eq', 'o_teacher1') }, ans)).toBe(true)
    expect(evaluateCondition(d, leaf('q_missing0', 'is_not_answered'), ans)).toBe(true)
  })

  it('depth cap 3: depth 3 evaluates, depth 4 is false', () => {
    const l = leaf('q_rolexxxx', 'eq', 'o_student1')
    const d3: Condition = { all: [{ any: [{ not: l }, l] }] }
    const d4: Condition = { all: [{ any: [{ not: { not: l } }] }] }
    expect(evaluateCondition(d, d3, ans)).toBe(true)
    expect(evaluateCondition(d, d4, ans)).toBe(false)
  })

  it('hidden, calc and matrix row fields', () => {
    expect(evaluateCondition(d, { field: { kind: 'hidden', param: 'src' }, op: 'eq', value: 'ad' }, {}, { hidden: { src: 'AD' } })).toBe(true)
    expect(evaluateCondition(d, { field: { kind: 'calc', id: 'q_c' }, op: 'gt', value: 1 }, {}, { calcs: { q_c: 2 } })).toBe(true)
    expect(evaluateCondition(ALL_TYPES, { field: { kind: 'question', id: 'q_matrixxx', row_id: 'r_speed001' }, op: 'eq', value: 'c_good0001' }, { q_matrixxx: { r_speed001: 'c_good0001' } })).toBe(true)
    expect(evaluateCondition(ALL_TYPES, { field: { kind: 'question', id: 'q_matrixxx', row_id: 'r_speed001' }, op: 'eq', value: 'c_good0001' }, { q_matrixxx: ['x'] })).toBe(false)
    expect(evaluateCondition(ALL_TYPES, { field: { kind: 'question', id: 'q_calcxxxx' }, op: 'eq', value: 4 }, {}, { calcs: { q_calcxxxx: 4 } })).toBe(true)
  })
})

describe('evaluate: branching survey', () => {
  it('student path: shows school, jumps from student page to final', () => {
    const s = evaluate(BRANCHING, { q_rolexxxx: 'o_student1', q_agexxxxx: 20 }, { now: NOW })
    expect(s.path).toEqual(['p_start001', 'p_student1', 'p_final001'])
    expect(s.visible.has('q_schoolxx')).toBe(true)
    expect(s.visible.has('q_gradexxx')).toBe(true)
    expect(s.ending_id).toBe('e_default1')
    expect(s.ended_early).toBe(false)
    expect(s.visible_keys).toEqual(['q_rolexxxx', 'q_agexxxxx', 'q_schoolxx', 'q_gradexxx', 'q_studentq', 'q_finalxxx'])
  })

  it('teacher path: skips student page, hide wins over default', () => {
    const s = evaluate(BRANCHING, { q_rolexxxx: 'o_teacher1', q_agexxxxx: 45, q_schoolxx: 'dropped' })
    expect(s.path).toEqual(['p_start001', 'p_teacher1', 'p_final001'])
    expect(s.visible.has('q_schoolxx')).toBe(false)
    expect(s.visible.has('q_gradexxx')).toBe(false)
    expect(s.answers.q_schoolxx).toBeUndefined()
  })

  it('visitor ends early with the specific ending', () => {
    const s = evaluate(BRANCHING, { q_rolexxxx: 'o_visitor1' })
    expect(s.path).toEqual(['p_start001'])
    expect(s.ending_id).toBe('e_visitor1')
    expect(s.ended_early).toBe(true)
  })

  it('no role: student page shows (no show_page rule), teacher page skipped by show_page', () => {
    const s = evaluate(BRANCHING, {})
    expect(s.path).toEqual(['p_start001', 'p_student1', 'p_final001'])
  })

  it('ignores backward jumps and jumps to unknown endings', () => {
    const d: SurveyDefinition = {
      ...BRANCHING,
      logic: [
        { id: 'l_back0001', kind: 'jump', from_page_id: 'p_student1', to: { page_id: 'p_start001' }, when: { all: [] }, order: 1 },
        { id: 'l_back0002', kind: 'jump', from_page_id: 'p_start001', to: { ending_id: 'e_nothere1' }, when: { all: [] }, order: 0 },
      ],
    }
    const s = evaluate(d, {})
    expect(s.path).toEqual(['p_start001', 'p_student1', 'p_teacher1', 'p_final001'])
  })

  it('drops unknown keys and accepts ids as fallback keys', () => {
    expect(normalizeAnswers(BRANCHING, { nope: 1, q_agexxxxx: 'abc', q_rolexxxx: 'o_student1' })).toEqual({ q_rolexxxx: 'o_student1' })
  })

  it('set_ending picks the first matching rule by order, else endings[0]', () => {
    const d: SurveyDefinition = {
      ...BRANCHING,
      endings: [...BRANCHING.endings, { id: 'e_third001', message: { format: 'md-lite', text: '' }, show_score: false, show_summary: false }],
      logic: [
        { id: 'l_e1', kind: 'set_ending', ending_id: 'e_third001', when: { all: [] }, order: 5 },
        { id: 'l_e2', kind: 'set_ending', ending_id: 'e_visitor1', when: { all: [] }, order: 1 },
      ],
    }
    expect(evaluate(d, {}).ending_id).toBe('e_visitor1')
    expect(evaluate({ ...d, endings: [] }, {}).ending_id).toBeNull()
  })
})

describe('evaluate: quiz scoring', () => {
  const answers = { q_quiz0001: 'o_q1right1', q_quiz0002: ['o_q2a00001', 'o_q2b00001'], q_quizyn01: true, q_quizmtx1: { r_mrow0001: 'c_mcol0002' } }
  it('server computes score, max, and scored ending', () => {
    const s = evaluate(QUIZ, answers)
    // score: 2 + 2 + 1 + 3 = 8, correct: 2 -> 10
    expect(s.calcs.q_scorexxx).toBe(10)
    expect(s.calcs.q_pctxxxxx).toBe(100)
    expect(s.score).toEqual({ value: 10, max: 10 })
    expect(s.ending_id).toBe('e_pass0001')
    expect(s.visible_keys).not.toContain('q_scorexxx')
    expect(s.visible_keys).toContain('q_plaincal')
  })

  it('wrong answers fail', () => {
    const s = evaluate(QUIZ, { q_quiz0001: 'o_q1wrong1', q_quiz0002: ['o_q2c00001'] })
    expect(s.calcs.q_scorexxx).toBe(-1)
    expect(s.ending_id).toBe('e_fail0001')
  })

  it('client with the public definition has no score', () => {
    const pub = splitDefinition(QUIZ).public_definition
    const s = evaluate(pub, answers)
    expect(s.score).toBeNull()
    expect(s.calcs.q_scorexxx).toBeUndefined()
    expect(s.ending_id).toBe('e_fail0001')
  })

  it('score helpers per type', () => {
    const qs = QUIZ.questions
    expect(questionScore(qs.q_quiz0001 as Question, undefined)).toBe(0)
    expect(questionScore(qs.q_quizyn01 as Question, 0)).toBe(0)
    expect(questionScore(qs.q_quizyn01 as Question, 7)).toBe(0)
    expect(questionScore(qs.q_quizmtx1 as Question, ['x'])).toBe(0)
    const rating = q({ id: 'q_rate0001', type: 'rating', settings: { points: 5, display: 'stars' } })
    expect(questionScore(rating, 4)).toBe(4)
    expect(questionScore(rating, 'x')).toBe(0)
    expect(questionMaxScore(rating)).toBe(5)
    const rank = q({ id: 'q_rank0001', type: 'ranking', settings: { options: [{ id: 'o_1', label: '1', score: 5 }, { id: 'o_2', label: '2' }], randomize: false } })
    expect(questionScore(rank, ['o_1', 'o_2'])).toBe(5)
    expect(questionScore(rank, [])).toBe(0)
    expect(questionMaxScore(rank)).toBe(5)
    expect(questionScore(q({ id: 'q_text0001', type: 'short_text', settings: {} }), 'x')).toBe(0)
    expect(questionMaxScore(q({ id: 'q_text0001', type: 'short_text', settings: {} }))).toBe(0)
    expect(isCorrect(qs.q_quiz0001 as Question, undefined)).toBe(false)
    expect(isCorrect(rating, 3)).toBe(false)
  })

  it('maxScore handles operator shapes and missing quiz', () => {
    expect(maxScore(BRANCHING)).toBeNull()
    const mk = (formula: unknown) =>
      maxScore({ ...QUIZ, questions: { ...QUIZ.questions, q_scorexxx: { ...(QUIZ.questions.q_scorexxx as Question), settings: { formula, formula_source: '', visible: false } } as Question } })
    const s = { fn: 'score', ids: ['q_quiz0001'] }
    expect(mk({ op: 'min', args: [s, { num: 1 }] })).toBe(1)
    expect(mk({ op: 'max', args: [s, { num: 1 }] })).toBe(2)
    expect(mk({ op: '*', args: [s, { num: 3 }] })).toBe(6)
    expect(mk({ op: '-', args: [s, { num: 3 }] })).toBe(2)
    expect(mk({ op: '+', args: [] })).toBe(0)
    expect(mk({ fn: 'if', cond: { all: [] }, then: s, else: { num: 9 } })).toBe(9)
    expect(mk({ ref: { kind: 'question', id: 'q_quiz0001' } })).toBe(0)
    expect(mk({ ref: { kind: 'calc', id: 'q_plaincal' } })).toBe(7)
    expect(mk({ ref: { kind: 'calc', id: 'q_scorexxx' } })).toBe(0)
    expect(mk({ fn: 'score', ids: ['q_nothere1'] })).toBe(0)
  })
})

describe('evaluate: calcs and piping inputs', () => {
  it('computes calc from question and hidden default, rounded to decimals', () => {
    const s = evaluate(PIPING, { q_qtyxxxxx: 3 })
    expect(s.calcs.q_totalxxx).toBe(30)
    expect(s.hidden.price).toBe('10')
    const s2 = evaluate(PIPING, { q_qtyxxxxx: 3 }, { hidden: { price: '1.255' } })
    expect(s2.calcs.q_totalxxx).toBe(3.77)
    expect(s2.answers.q_pricehid).toBe('1.255')
  })

  it('client-submitted calc and hidden values are ignored', () => {
    const s = evaluate(PIPING, { q_totalxxx: 999, q_pricehid: '50', q_qtyxxxxx: 1 })
    expect(s.calcs.q_totalxxx).toBe(10)
  })

  it('formula operators and edge cases', () => {
    const calc = (formula: unknown, extra: Question[] = []) =>
      evaluate(defn({ questions: [q({ id: 'q_nnnnnnnn', type: 'number', settings: {} }), q({ id: 'q_mmmmmmmm', type: 'multiple_choice', settings: { options: [{ id: 'o_1', label: '1' }, { id: 'o_2', label: '2' }], randomize: false } }), q({ id: 'q_tttttttt', type: 'short_text', settings: {} }), q({ id: 'q_cccccccc', type: 'calculated', settings: { formula, formula_source: '', visible: true } } as never), ...extra] }), { q_nnnnnnnn: 8, q_mmmmmmmm: ['o_1', 'o_2'], q_tttttttt: '2.5' }, { hidden: { h: 'abc' } }).calcs.q_cccccccc
    const n = { ref: { kind: 'question', id: 'q_nnnnnnnn' } }
    expect(calc({ op: '/', args: [n, { num: 0 }] })).toBe(0)
    expect(calc({ op: '/', args: [n, { num: 2 }] })).toBe(4)
    expect(calc({ op: '-', args: [n] })).toBe(-8)
    expect(calc({ op: '-', args: [n, { num: 3 }] })).toBe(5)
    expect(calc({ op: 'min', args: [n, { num: 3 }] })).toBe(3)
    expect(calc({ op: 'max', args: [n, { num: 3 }] })).toBe(8)
    expect(calc({ op: '+', args: [] })).toBe(0)
    expect(calc({ ref: { kind: 'question', id: 'q_mmmmmmmm' } })).toBe(2)
    expect(calc({ ref: { kind: 'question', id: 'q_tttttttt' } })).toBe(2.5)
    expect(calc({ ref: { kind: 'question', id: 'q_nothere1' } })).toBe(0)
    expect(calc({ ref: { kind: 'hidden', id: 'h' } })).toBe(0)
    expect(calc({ ref: { kind: 'calc', id: 'q_nothere1' } })).toBe(0)
    expect(calc({ fn: 'round', arg: { num: 2.345 }, places: 2 })).toBe(2.35)
    expect(calc({ fn: 'if', cond: { field: { kind: 'question', id: 'q_nnnnnnnn' }, op: 'gt', value: 5 }, then: { num: 1 }, else: { num: 2 } })).toBe(1)
    expect(calc({ fn: 'score', ids: ['q_nothere1'] })).toBe(0)
    expect(calc({ fn: 'correct', ids: ['q_nothere1'] })).toBe(0)
    expect(calc({ num: Infinity })).toBe(0)
    expect(calc({ op: '*', args: [{ num: 1e308 }, { num: 10 }] })).toBe(0)
  })

  it('numericValue', () => {
    const t = q({ id: 'q_tttttttt', type: 'short_text', settings: {} })
    expect(numericValue(t, 'x')).toBe(0)
    expect(numericValue(t, undefined)).toBe(0)
    expect(numericValue(t, { a: 'b' })).toBe(0)
  })

  it('calcOrder sorts dependencies and tolerates cycles', () => {
    const cq = (id: string, formula: unknown) => q({ id, type: 'calculated', settings: { formula, formula_source: '', visible: true } } as never)
    const d = defn({
      questions: [
        cq('q_cccc0003', { ref: { kind: 'calc', id: 'q_cccc0002' } }),
        cq('q_cccc0002', { op: '+', args: [{ ref: { kind: 'question', id: 'q_cccc0001' } }, { num: 1 }] }),
        cq('q_cccc0001', { num: 1 }),
        cq('q_cyc00001', { ref: { kind: 'calc', id: 'q_cyc00002' } }),
        cq('q_cyc00002', { ref: { kind: 'calc', id: 'q_cyc00001' } }),
      ],
    })
    const order = calcOrder(d)
    expect(order.indexOf('q_cccc0001')).toBeLessThan(order.indexOf('q_cccc0002'))
    expect(order.indexOf('q_cccc0002')).toBeLessThan(order.indexOf('q_cccc0003'))
    expect(order.slice(-2).sort()).toEqual(['q_cyc00001', 'q_cyc00002'])
    const s = evaluate(d, {})
    expect(s.calcs.q_cccc0003).toBe(2)
    expect(s.calcs.q_cyc00001).toBe(0)
  })

  it('calcs depending on a hidden question re-run until stable', () => {
    // q_bbbbbbbb is hidden when q_aaaaaaaa > 5; the calc reads q_bbbbbbbb and gates q_dddddddd.
    const d = defn({
      questions: [
        q({ id: 'q_aaaaaaaa', type: 'number', settings: {} }),
        q({ id: 'q_bbbbbbbb', type: 'number', settings: {} }),
        q({ id: 'q_cccccccc', type: 'calculated', settings: { formula: { ref: { kind: 'question', id: 'q_bbbbbbbb' } }, formula_source: '', visible: false } }),
        q({ id: 'q_dddddddd', type: 'short_text', settings: {} }),
      ],
      logic: [
        { id: 'l_1', kind: 'hide_question', target_id: 'q_bbbbbbbb', when: { field: { kind: 'question', id: 'q_aaaaaaaa' }, op: 'gt', value: 5 } },
        { id: 'l_2', kind: 'show_question', target_id: 'q_dddddddd', when: { field: { kind: 'calc', id: 'q_cccccccc' }, op: 'gt', value: 0 } },
      ],
    })
    const s = evaluate(d, { q_aaaaaaaa: 9, q_bbbbbbbb: 4, q_dddddddd: 'x' })
    expect(s.calcs.q_cccccccc).toBe(0)
    expect(s.visible.has('q_dddddddd')).toBe(false)
    const s2 = evaluate(d, { q_aaaaaaaa: 1, q_bbbbbbbb: 4, q_dddddddd: 'x' })
    expect(s2.visible.has('q_dddddddd')).toBe(true)
  })

  it('pageless hidden and calc questions are always on the path', () => {
    const d = defn({
      questions: [q({ id: 'q_hhhhhhhh', type: 'hidden', settings: { param: 'ref' } }), q({ id: 'q_cccccccc', type: 'calculated', settings: { formula: { num: 1 }, formula_source: '1', visible: false } })],
      pages: [{ id: 'p_1', question_ids: [] }],
    })
    const s = evaluate(d, {}, { hidden: { ref: 'abc' } })
    expect(s.visible_keys).toEqual(['q_hhhhhhhh', 'q_cccccccc'])
    expect(s.answers.q_hhhhhhhh).toBe('abc')
    expect(resolveHidden(d, undefined)).toEqual({})
  })
})

describe('randomization', () => {
  const single = ALL_TYPES.questions.q_singlech as Question
  it('without a seed or without randomize the order is the definition order', () => {
    expect(orderOptions(single, undefined).map((o) => o.id)).toEqual(['o_red00001', 'o_blue0001', 'o_other001'])
    expect(orderOptions(ALL_TYPES.questions.q_dropdown as Question, 'seed').map((o) => o.id)).toEqual(['o_ca000001', 'o_ny000001'])
    expect(orderOptions(ALL_TYPES.questions.q_shorttxt as Question, 'seed')).toEqual([])
    expect(orderMatrixRows(ALL_TYPES.questions.q_shorttxt as Question, 'seed')).toEqual([])
    expect(orderMatrixRows(ALL_TYPES.questions.q_matrixxx as Question, undefined).map((r) => r.id)).toEqual(['r_speed001', 'r_price001'])
    expect(orderPageQuestions(ALL_TYPES.pages[0]!, 'seed')).toEqual(ALL_TYPES.pages[0]!.question_ids)
    expect(orderPages(ALL_TYPES, 'seed')).toEqual(ALL_TYPES.pages.map((p) => p.id))
  })

  it('property: seeded orders are deterministic, permutations, and keep pins', () => {
    const multi = ALL_TYPES.questions.q_multich1 as Question
    const page = ALL_TYPES.pages[1]!
    const pagesDef: SurveyDefinition = {
      ...ALL_TYPES,
      pages: [...ALL_TYPES.pages, { id: 'p_extra001', question_ids: [] }, { id: 'p_extra002', question_ids: [] }],
      settings: { ...ALL_TYPES.settings, randomize_pages: { page_ids: ['p_choice01', 'p_misc0001', 'p_extra001'] } },
    }
    const seen = { opt: new Set<string>(), q: new Set<string>(), p: new Set<string>(), r: new Set<string>() }
    for (let i = 0; i < 200; i++) {
      const seed = `resp${i}`
      const a = orderOptions(single, seed).map((o) => o.id)
      expect(a).toEqual(orderOptions(single, seed).map((o) => o.id))
      expect(a[2]).toBe('o_other001')
      const m = orderOptions(multi, seed).map((o) => o.id)
      expect(m[3]).toBe('o_none0001')
      expect([...m].sort()).toEqual(['o_aaaaaaaa', 'o_bbbbbbbb', 'o_cccccccc', 'o_none0001'])
      seen.opt.add(m.join())
      const qs = orderPageQuestions(page, seed)
      expect(qs).toEqual(orderPageQuestions(page, seed))
      expect(qs[7]).toBe('q_rankingx')
      expect([...qs].sort()).toEqual([...page.question_ids].sort())
      seen.q.add(qs.join())
      const ps = orderPages(pagesDef, seed)
      expect(ps[0]).toBe('p_text0001')
      expect(ps[4]).toBe('p_extra002')
      seen.p.add(ps.join())
      seen.r.add(orderMatrixRows(ALL_TYPES.questions.q_matrixxx as Question, seed).map((r) => r.id).join())
    }
    expect(seen.opt.size).toBe(6)
    expect(seen.q.size).toBeGreaterThan(100)
    expect(seen.p.size).toBe(6)
    expect(seen.r.size).toBe(2)
  })

  it('page randomization drives the path walk', () => {
    const d: SurveyDefinition = { ...BRANCHING, logic: [], settings: { ...BRANCHING.settings, randomize_pages: { page_ids: ['p_student1', 'p_teacher1'] } } }
    const paths = new Set<string>()
    for (let i = 0; i < 50; i++) paths.add(evaluate(d, {}, { seed: `s${i}` }).path.join())
    expect(paths.size).toBe(2)
  })

  it('randomization never changes visibility or validation inputs', () => {
    const a = evaluate(ALL_TYPES, ALL_TYPES_ANSWERS, { now: NOW, seed: 'one' })
    const b = evaluate(ALL_TYPES, ALL_TYPES_ANSWERS, { now: NOW, seed: 'two' })
    expect([...a.visible].sort()).toEqual([...b.visible].sort())
  })
})

describe('client and server agree', () => {
  it('two independent evaluate calls with the same inputs produce identical visible keys', () => {
    for (const [d, a] of [
      [ALL_TYPES, ALL_TYPES_ANSWERS],
      [BRANCHING, { q_rolexxxx: 'o_teacher1', q_agexxxxx: 31 }],
      [QUIZ, { q_quiz0001: 'o_q1right1' }],
      [PIPING, { q_namexxxx: 'Ada', q_qtyxxxxx: 2 }],
    ] as const) {
      const ctx = { now: NOW, hidden: { source: 'ad' }, seed: 'abc' }
      // "Client": public definition as JSON round trip, as the browser receives it.
      const client = evaluate(JSON.parse(JSON.stringify(splitDefinition(d).public_definition)), JSON.parse(JSON.stringify(a)), ctx)
      // "Server": full definition, fresh object.
      const server = evaluate(JSON.parse(JSON.stringify(d)), a, ctx)
      expect(client.visible_keys).toEqual(server.visible_keys)
      expect(client.path).toEqual(server.path)
    }
  })
})
