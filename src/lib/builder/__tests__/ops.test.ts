import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator, lintDefinition, type Question, type SurveyDefinition } from '@/lib/survey'
import { defn, q, rt } from '@/lib/survey/__tests__/fixtures'
import { addPage, changeType, duplicateQuestion, moveQuestion, moveQuestionBy, removeEnding, removePage, removeQuestion, setIdGenerator } from '../ops'
import { parseFormula } from '../formula'
import { fillTheme, loadDefinition } from '../defaults'
import { aliasProblem, publicAssetUrl, publicSurveyUrl, RESERVED_ALIASES } from '../share'
import { effectiveState } from '../state'

const A = q({ id: 'q_aaaaaaaa', type: 'short_text', settings: {} })
const B = q({ id: 'q_bbbbbbbb', type: 'number', settings: {} })
const C = q({ id: 'q_cccccccc', type: 'single_choice', settings: { options: [{ id: 'o_1', label: 'One', score: 1 }], randomize: false } })

function twoPages(): SurveyDefinition {
  return defn({
    questions: [A, B, C],
    pages: [
      { id: 'p_one00001', question_ids: ['q_aaaaaaaa', 'q_bbbbbbbb'] },
      { id: 'p_two00001', question_ids: ['q_cccccccc'] },
    ],
  })
}

beforeEach(() => setIdGenerator(createIdGenerator('ops')))
afterEach(() => setIdGenerator(null))

describe('ops', () => {
  it('moves questions within and across pages', () => {
    const d = twoPages()
    expect(moveQuestion(d, 'q_aaaaaaaa', 'p_one00001', 1).pages[0]?.question_ids).toEqual(['q_bbbbbbbb', 'q_aaaaaaaa'])
    const x = moveQuestion(d, 'q_aaaaaaaa', 'p_two00001', 0)
    expect(x.pages.map((p) => p.question_ids)).toEqual([['q_bbbbbbbb'], ['q_aaaaaaaa', 'q_cccccccc']])
    expect(d.pages[0]?.question_ids).toEqual(['q_aaaaaaaa', 'q_bbbbbbbb'])
  })

  it('keyboard moves cross page edges', () => {
    const d = twoPages()
    const down = moveQuestionBy(d, 'q_bbbbbbbb', 1)
    expect(down.pages.map((p) => p.question_ids)).toEqual([['q_aaaaaaaa'], ['q_bbbbbbbb', 'q_cccccccc']])
    const up = moveQuestionBy(d, 'q_cccccccc', -1)
    expect(up.pages.map((p) => p.question_ids)).toEqual([['q_aaaaaaaa', 'q_bbbbbbbb', 'q_cccccccc'], []])
    expect(moveQuestionBy(d, 'q_aaaaaaaa', -1)).toBe(d)
  })

  it('removing a question drops rules that target it and identity pointers', () => {
    const d = { ...twoPages(), logic: [{ id: 'l_1', kind: 'show_question' as const, target_id: 'q_bbbbbbbb', when: { field: { kind: 'question' as const, id: 'q_aaaaaaaa' }, op: 'is_answered' as const } }], identity: { email_question_id: 'q_bbbbbbbb' } }
    const r = removeQuestion(d, 'q_bbbbbbbb')
    expect(r.questions.q_bbbbbbbb).toBeUndefined()
    expect(r.logic).toEqual([])
    expect(r.identity).toEqual({})
  })

  it('duplicates with a fresh key, same option ids, placed after the original', () => {
    const r = duplicateQuestion(twoPages(), 'q_cccccccc')
    const copy = r.definition.questions[r.id] as Question
    expect(copy.question_key).toBe(r.id)
    expect(r.id).not.toBe('q_cccccccc')
    expect((copy.settings as { options: { id: string }[] }).options[0]?.id).toBe('o_1')
    expect(r.definition.pages[1]?.question_ids).toEqual(['q_cccccccc', r.id])
  })

  it('removing a page keeps its questions; the last page and ending stay', () => {
    const d = twoPages()
    expect(removePage(d, 'p_two00001').pages).toEqual([{ id: 'p_one00001', question_ids: ['q_aaaaaaaa', 'q_bbbbbbbb', 'q_cccccccc'] }])
    expect(removePage(d, 'p_one00001').pages[0]?.question_ids).toEqual(['q_aaaaaaaa', 'q_bbbbbbbb', 'q_cccccccc'])
    const one = removePage(d, 'p_two00001')
    expect(removePage(one, 'p_one00001')).toBe(one)
    expect(removeEnding(d, d.endings[0]!.id)).toBe(d)
    expect(addPage(d, 0).definition.pages).toHaveLength(3)
  })

  it('changing type across storage columns forces a new key only once published', () => {
    const d = twoPages()
    const same = changeType(d, 'q_aaaaaaaa', 'long_text', {}, new Set(['q_aaaaaaaa']))
    expect(same.questions.q_aaaaaaaa?.question_key).toBe('q_aaaaaaaa')
    const unpublished = changeType(d, 'q_aaaaaaaa', 'number', {}, new Set())
    expect(unpublished.questions.q_aaaaaaaa?.question_key).toBe('q_aaaaaaaa')
    const forced = changeType(d, 'q_aaaaaaaa', 'number', {}, new Set(['q_aaaaaaaa']))
    expect(forced.questions.q_aaaaaaaa?.question_key).not.toBe('q_aaaaaaaa')
    expect(lintDefinition(forced).issues.filter((i) => i.code.startsWith('question_key'))).toEqual([])
  })
})

describe('formula', () => {
  it('parses arithmetic, references and functions into the engine AST', () => {
    const d = twoPages()
    expect(parseFormula('{{q:q_bbbbbbbb}} * 2 + 1', d)).toEqual({
      ok: true,
      expr: { op: '+', args: [{ op: '*', args: [{ ref: { kind: 'question', id: 'q_bbbbbbbb' } }, { num: 2 }] }, { num: 1 }] },
    })
    expect(parseFormula('round(max(1, {{hidden:src}}), 2)', d)).toEqual({ ok: true, expr: { fn: 'round', arg: { op: 'max', args: [{ num: 1 }, { ref: { kind: 'hidden', id: 'src' } }] }, places: 2 } })
    expect(parseFormula('score({{q:q_cccccccc}})', d)).toEqual({ ok: true, expr: { fn: 'score', ids: ['q_cccccccc'] } })
    expect(parseFormula('-(3)', d)).toEqual({ ok: true, expr: { op: '-', args: [{ num: 0 }, { num: 3 }] } })
  })

  it('reports errors', () => {
    const d = twoPages()
    expect(parseFormula('', d).ok).toBe(false)
    expect(parseFormula('1 +', d).ok).toBe(false)
    expect(parseFormula('{{q:q_missing1}}', d)).toEqual({ ok: false, error: 'Unknown question q_missing1.' })
    expect(parseFormula('foo(1)', d).ok).toBe(false)
    expect(parseFormula('1 $ 2', d).ok).toBe(false)
  })
})

describe('defaults, share and state helpers', () => {
  it('fills an empty template theme and loads it', () => {
    const t = fillTheme({ colors: { primary: '#ff0000' }, font: { body: 'Comic Sans' } })
    expect(t.colors.primary).toBe('#ff0000')
    expect(t.font.body).toBe('Inter')
    const raw = { ...twoPages(), theme: {} }
    const r = loadDefinition(raw)
    expect(r.ok && r.definition.theme.layout).toBe('card')
  })

  it('builds public links and asset URLs', () => {
    expect(publicSurveyUrl('s.example.org', 'abc-def', { tagQr: true })).toBe('https://s.example.org/abc-def?utm_medium=qr')
    expect(publicSurveyUrl('s.localhost:3000', 'abcdefghij')).toBe('http://s.localhost:3000/abcdefghij')
    expect(publicAssetUrl('https://x.supabase.co', 'ws/logo-1.png')).toBe('https://x.supabase.co/storage/v1/object/public/public-assets/ws/logo-1.png')
    expect(publicAssetUrl('https://x.supabase.co', 'public-assets/ws/a b.png')).toBe('https://x.supabase.co/storage/v1/object/public/public-assets/ws/a%20b.png')
    expect(publicAssetUrl(undefined, 'x')).toBeNull()
  })

  it('checks aliases like SQL does', () => {
    expect(aliasProblem('spring-feedback', RESERVED_ALIASES)).toBeNull()
    expect(aliasProblem('admin', RESERVED_ALIASES)).toMatch(/reserved/)
    expect(aliasProblem('abcdefghij', RESERVED_ALIASES)).toMatch(/link code/)
    expect(aliasProblem('a--b', RESERVED_ALIASES)).toMatch(/hyphens/)
    expect(aliasProblem('ab', RESERVED_ALIASES)).toMatch(/3 to 60/)
  })

  it('computes the effective state like survey_effective_state', () => {
    const base = { state: 'open' as const, opens_at: null, closes_at: null, response_cap: null, complete_count: 0, archived_at: null, latest_published_version_id: 'v' }
    const now = Date.parse('2026-10-21T12:00:00Z')
    expect(effectiveState(base, now).state).toBe('open')
    expect(effectiveState({ ...base, latest_published_version_id: null }, now).state).toBe('draft')
    expect(effectiveState({ ...base, opens_at: '2026-10-22T00:00:00Z' }, now).state).toBe('scheduled')
    expect(effectiveState({ ...base, closes_at: '2026-10-20T00:00:00Z' }, now)).toEqual({ state: 'closed', reason: 'schedule' })
    expect(effectiveState({ ...base, response_cap: 5, complete_count: 5 }, now)).toEqual({ state: 'closed', reason: 'cap' })
    expect(effectiveState({ ...base, state: 'closed' }, now)).toEqual({ state: 'closed', reason: 'manual' })
  })
})

void rt
