import { describe, expect, it } from 'vitest'
import { containsServerOnlyKeys, findServerOnlyKeys, SERVER_ONLY_KEYS, splitDefinition } from '../split'
import { evaluate } from '../engine'
import type { SurveyDefinition } from '../types'
import { ALL_TYPES, BRANCHING, PIPING, QUIZ } from './fixtures'

/** QUIZ plus every server-only field on every type that can hold one. */
const EVERYTHING: SurveyDefinition = (() => {
  const d = JSON.parse(JSON.stringify(QUIZ)) as SurveyDefinition
  const add = JSON.parse(JSON.stringify(ALL_TYPES.questions)) as SurveyDefinition['questions']
  for (const q of Object.values(add)) {
    if (q.type === 'single_choice' || q.type === 'dropdown' || q.type === 'multiple_choice' || q.type === 'ranking') q.settings.options.forEach((o, i) => (o.score = i))
    if (q.type === 'single_choice' || q.type === 'dropdown') q.settings.correct_option_id = q.settings.options[0]!.id
    if (q.type === 'multiple_choice') q.settings.correct_option_ids = [q.settings.options[0]!.id]
    if (q.type === 'yes_no') q.settings.yes_score = 1
    if (q.type === 'matrix') q.settings.columns.forEach((c, i) => (c.score = i))
  }
  d.questions = { ...d.questions, ...add }
  d.pages = [...d.pages, ...ALL_TYPES.pages]
  d.pages[1]!.randomize_questions = { pinned_ids: ['q_scorexxx'] }
  d.logic.push({ id: 'l_badshow1', kind: 'show_question', target_id: 'q_plaincal', when: { field: { kind: 'question', id: 'q_pctxxxxx' }, op: 'gt', value: 1 } })
  return d
})()

describe('splitDefinition', () => {
  it('public_definition never contains any SERVER_ONLY_KEYS', () => {
    for (const d of [EVERYTHING, QUIZ, ALL_TYPES, BRANCHING, PIPING]) {
      const { public_definition } = splitDefinition(d)
      expect(containsServerOnlyKeys(public_definition)).toBe(false)
      expect(findServerOnlyKeys(public_definition)).toEqual([])
      const text = JSON.stringify(public_definition)
      for (const k of SERVER_ONLY_KEYS) expect(text).not.toContain(`"${k}":`)
    }
    expect(containsServerOnlyKeys(EVERYTHING)).toBe(true)
    expect(findServerOnlyKeys({ a: [{ score: 1 }] })).toEqual(['a[0].score'])
  })

  it('moves every server-only field into server_only', () => {
    const { public_definition: pub, server_only: s } = splitDefinition(EVERYTHING)
    expect(s.option_scores.q_quiz0001).toEqual({ o_q1right1: 2, o_q1wrong1: 0 })
    expect(s.option_scores.q_rankingx).toEqual({ o_rank0001: 0, o_rank0002: 1, o_rank0003: 2 })
    expect(s.correct).toMatchObject({ q_quiz0001: 'o_q1right1', q_quiz0002: ['o_q2a00001', 'o_q2b00001'], q_dropdown: 'o_ca000001', q_multich1: ['o_aaaaaaaa'] })
    expect(s.yes_no_scores).toEqual({ q_quizyn01: { yes: 1, no: 0 }, q_yesnoxxx: { yes: 1 } })
    expect(s.matrix_column_scores.q_quizmtx1).toEqual({ c_mcol0001: 0, c_mcol0002: 3 })
    expect(Object.keys(s.scored_calcs).sort()).toEqual(['q_pctxxxxx', 'q_scorexxx'])
    expect(s.scored_rules.map((r) => r.id).sort()).toEqual(['l_badshow1', 'l_passxxxx'])
    expect(pub.questions.q_scorexxx).toBeUndefined()
    expect(pub.questions.q_plaincal).toBeDefined()
    expect(pub.pages[1]!.question_ids).toEqual(['q_quizyn01', 'q_quizmtx1', 'q_plaincal'])
    expect(pub.pages[1]!.randomize_questions).toEqual({ pinned_ids: [] })
    expect(pub.logic.map((r) => r.id)).toEqual(['l_plainxxx'])
    expect(Object.keys(pub.questions)).toEqual(Object.keys(EVERYTHING.questions).filter((k) => !s.scored_calcs[k]))
  })

  it('is pure and deterministic', () => {
    const before = JSON.stringify(EVERYTHING)
    const a = splitDefinition(EVERYTHING)
    const b = splitDefinition(JSON.parse(before))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(EVERYTHING)).toBe(before)
  })

  it('a definition without scoring splits to itself', () => {
    const { public_definition, server_only } = splitDefinition(PIPING)
    expect(public_definition).toEqual(PIPING)
    expect(server_only.scored_rules).toEqual([])
  })

  it('public evaluation agrees with full evaluation except for scored parts', () => {
    const a = { q_quiz0001: 'o_q1right1', q_quizyn01: 1 }
    const pub = evaluate(splitDefinition(QUIZ).public_definition, a)
    const full = evaluate(QUIZ, a)
    expect(pub.visible_keys).toEqual(full.visible_keys)
    expect(pub.calcs.q_plaincal).toBe(full.calcs.q_plaincal)
  })
})
