import { describe, expect, it } from 'vitest'
import { evaluate, maxScore } from '../engine'
import { validateSubmission } from '../validate'
import type { Question, SurveyDefinition } from '../types'
import { BRANCHING, defn, NOW, PIPING, q, QUIZ } from './fixtures'

describe('engine edge cases', () => {
  it('skips unknown page entries and questions listed on two pages', () => {
    const d: SurveyDefinition = {
      ...BRANCHING,
      logic: [],
      pages: [
        { id: 'p_start001', question_ids: ['q_nothere1', 'q_rolexxxx', 'q_agexxxxx', 'q_schoolxx', 'q_gradexxx', 'q_studentq', 'q_teachrq1', 'q_finalxxx'] },
        { id: 'p_dup00001', question_ids: ['q_rolexxxx'] },
      ],
    }
    const s = evaluate(d, { q_rolexxxx: 'o_student1' })
    expect(s.visible.has('q_nothere1')).toBe(false)
    expect(s.visible_keys.filter((k) => k === 'q_rolexxxx')).toHaveLength(1)
  })

  it('maxScore through round and divide', () => {
    const mk = (formula: unknown) =>
      maxScore({ ...QUIZ, questions: { ...QUIZ.questions, q_scorexxx: { ...(QUIZ.questions.q_scorexxx as Question), settings: { formula, formula_source: '', visible: false } } as Question } })
    expect(mk({ fn: 'round', arg: { op: '/', args: [{ fn: 'correct', ids: ['q_quiz0001', 'q_nothere1'] }, { num: 3 }] }, places: 1 })).toBe(1)
    expect(mk({ ref: { kind: 'hidden', id: 'x' } })).toBe(0)
  })

  it('works with no context at all', () => {
    const s = evaluate(PIPING, { q_qtyxxxxx: 2 })
    expect(s.calcs.q_totalxxx).toBe(20)
  })
})

describe('validator edge cases', () => {
  it('questions without validation settings', () => {
    const d = defn({
      questions: [
        q({ id: 'q_multi001', type: 'multiple_choice', settings: { options: [{ id: 'o_1', label: '1' }], randomize: false } }),
        q({ id: 'q_time0001', type: 'time', settings: { minute_step: 1 } }),
        q({ id: 'q_date0001', type: 'date', settings: { display_format: 'MDY' } }),
        q({ id: 'q_rank0001', type: 'ranking', settings: { options: [{ id: 'o_1', label: '1' }, { id: 'o_2', label: '2' }], randomize: false } }),
        q({ id: 'q_file0001', type: 'file_upload', settings: {} }),
        q({ id: 'q_addr0001', type: 'address', settings: { parts_required: {} } }),
        q({ id: 'q_hidd0001', type: 'hidden', settings: { param: 'h' } }),
      ],
    })
    const file = { path: 'p/x.bin', name: 'x', size: 1, mime: 'application/octet-stream' }
    const r = validateSubmission(
      d,
      { q_multi001: ['o_1'], q_time0001: '07:01', q_date0001: '2020-01-01', q_rank0001: ['o_2', 'o_1'], q_file0001: [file], q_addr0001: { country: 'MX' }, q_hidd0001: 'spoof' },
      { now: NOW, hidden: { h: 'real' }, files: { q_file0001: [file] }, mode: 'final' },
    )
    expect(r.errors).toEqual({})
    expect(r.cleaned.q_hidd0001).toBe('real')
    expect(r.cleaned.q_addr0001).toEqual({ country: 'MX' })
  })
})
