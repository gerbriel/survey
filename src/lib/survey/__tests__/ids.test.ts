import { describe, expect, it } from 'vitest'
import { createIdGenerator, generateId, generateOptionId, generateQuestionKey, generateResponseSeed, isId, isOptionId, isQuestionKey, QUESTION_KEY_RE } from '../ids'

describe('ids', () => {
  it('generates question keys in the SQL format', () => {
    for (let i = 0; i < 200; i++) expect(generateQuestionKey()).toMatch(QUESTION_KEY_RE)
  })

  it('generates option ids and other kinds with their prefixes', () => {
    expect(isOptionId(generateOptionId())).toBe(true)
    for (const kind of ['page', 'question', 'option', 'row', 'column', 'ending', 'logic'] as const) {
      expect(isId(kind, generateId(kind))).toBe(true)
    }
  })

  it('is deterministic with a seed', () => {
    const a = createIdGenerator('seed-1')
    const b = createIdGenerator('seed-1')
    const c = createIdGenerator(42)
    const seqA = Array.from({ length: 20 }, () => a.questionKey())
    const seqB = Array.from({ length: 20 }, () => b.questionKey())
    expect(seqA).toEqual(seqB)
    expect(c.optionId()).toMatch(/^o_[a-z0-9]{8}$/)
    expect(createIdGenerator(42).optionId()).toBe(createIdGenerator(42).optionId())
    expect(createIdGenerator('x').questionKey()).not.toBe(createIdGenerator('y').questionKey())
  })

  it('unique() avoids taken ids', () => {
    const g = createIdGenerator('u')
    const first = createIdGenerator('u').next('question')
    const id = g.unique('question', [first])
    expect(id).not.toBe(first)
    expect(isQuestionKey(id)).toBe(true)
  })

  it('validators reject bad shapes', () => {
    expect(isQuestionKey('q_ABCDEFGH')).toBe(false)
    expect(isQuestionKey('q_abc')).toBe(false)
    expect(isQuestionKey('first_name')).toBe(false)
    expect(isQuestionKey(5)).toBe(false)
    expect(isOptionId('q_abcdefgh')).toBe(false)
    expect(isId('row', 'r_abcdefgh')).toBe(true)
  })

  it('response seeds are 16 chars and deterministic with a seed', () => {
    expect(generateResponseSeed()).toMatch(/^[a-z0-9]{16}$/)
    expect(generateResponseSeed('s')).toBe(generateResponseSeed('s'))
  })
})
