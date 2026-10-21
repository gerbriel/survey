import { describe, expect, it } from 'vitest'
import { evaluate } from '../engine'
import { formatAnswer, formatCalc, isPipeableType, parsePipeTokens, pipeText, resolvePipes } from '../pipe'
import type { Question, QuestionOf } from '../types'
import { ALL_TYPES, PIPING, QUIZ } from './fixtures'

describe('piping', () => {
  it('parses tokens with fallbacks', () => {
    const t = parsePipeTokens('Hi {{q:q_namexxxx|there}} and {{ hidden : utm }} {{calc:q_totalxxx}} {{bogus:x}}')
    expect(t.map((x) => [x.kind, x.ref, x.fallback])).toEqual([
      ['q', 'q_namexxxx', 'there'],
      ['hidden', 'utm', undefined],
      ['calc', 'q_totalxxx', undefined],
    ])
  })

  it('resolves answers, choice labels, calcs and hidden values as text segments', () => {
    const s = evaluate(PIPING, { q_namexxxx: '**Ada**', q_qtyxxxxx: 2, q_colorxxx: ['o_red00001', 'o_blue0001'] }, { hidden: { utm_source: 'mail' } })
    const body = (PIPING.questions.q_summary1 as QuestionOf<'statement'>).settings.body.text
    expect(pipeText(body, PIPING, s)).toBe('Hi **Ada**, you like Red, Blue. Total 20.00 via mail')
    const segs = resolvePipes(body, PIPING, s)
    expect(segs[0]).toEqual({ kind: 'text', text: 'Hi ' })
    expect(segs[1]).toMatchObject({ kind: 'value', text: '**Ada**' })
    expect(segs.at(-1)).toMatchObject({ kind: 'value', text: 'mail' })
  })

  it('uses fallbacks for unanswered, hidden, or unknown references', () => {
    const s = evaluate(PIPING, {})
    expect(pipeText('{{q:q_namexxxx|there}} {{q:q_nothere1|x}} {{hidden:nope|none}} {{calc:q_nothere1|0}} {{calc:q_namexxxx|c}}', PIPING, s)).toBe('there x none 0 c')
    expect(pipeText('{{q:q_namexxxx}}!', PIPING, s)).toBe('!')
  })

  it('URL-encodes values in redirect URLs', () => {
    const s = evaluate(PIPING, { q_namexxxx: 'A & B', q_qtyxxxxx: 1 })
    expect(pipeText(PIPING.endings[0]!.redirect_url!, PIPING, s, { encode: 'url' })).toBe('https://example.org/thanks?name=A%20%26%20B&total=10.00')
  })

  it('pipes scored calcs only through calcOverrides (submit result)', () => {
    const msg = QUIZ.endings[1]!.message.text
    const s = evaluate(QUIZ, {})
    expect(pipeText(msg, QUIZ, s, { calcOverrides: { q_scorexxx: 7 } })).toBe('You scored 7')
    expect(pipeText('{{q:q_plaincal}} {{q:q_scorexxx|n}}', QUIZ, s)).toBe('7 0')
  })

  it('formats every pipeable type and refuses the rest', () => {
    const qs = ALL_TYPES.questions
    expect(formatAnswer(qs.q_singlech as Question, { id: 'o_other001', other: 'Green' })).toBe('Green')
    expect(formatAnswer(qs.q_singlech as Question, 'o_red00001')).toBe('Red')
    expect(formatAnswer(qs.q_singlech as Question, 'o_unknown1')).toBe('o_unknown1')
    expect(formatAnswer(qs.q_rankingx as Question, ['o_rank0002', 'o_rank0001'])).toBe('Two, One')
    expect(formatAnswer(qs.q_yesnoxxx as Question, 1)).toBe('Yes')
    expect(formatAnswer(qs.q_yesnoxxx as Question, 0)).toBe('No')
    expect(formatAnswer(qs.q_numberxx as Question, 5)).toBe('5')
    expect(formatAnswer(qs.q_calcxxxx as Question, 5)).toBe('5')
    expect(formatAnswer(qs.q_calcxxxx as Question, 'x')).toBeNull()
    expect(formatAnswer(qs.q_shorttxt as Question, ['x'])).toBeNull()
    expect(formatAnswer(qs.q_matrixxx as Question, {})).toBeNull()
    for (const t of ['matrix', 'file_upload', 'signature', 'address', 'consent'] as const) expect(isPipeableType(t)).toBe(false)
    expect(isPipeableType('short_text')).toBe(true)
    expect(formatCalc(undefined, 1.5)).toBe('1.5')
  })

  it('a hidden question pipes as fallback', () => {
    const s = evaluate(PIPING, { q_namexxxx: 'Ada' })
    s.visible.delete('q_namexxxx')
    expect(pipeText('{{q:q_namexxxx|gone}}', PIPING, s)).toBe('gone')
  })
})
