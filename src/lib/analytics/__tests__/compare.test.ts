import { describe, expect, it } from 'vitest'
import {
  compareDetailTable,
  compareFiltersFor,
  compareStrip,
  compareSummaries,
  compareSummaryTable,
  deltasFor,
  formatDelta,
  matchQuestions,
  normalizeLabel,
  parseCompareSurveys,
} from '../compare'
import type { ChoiceSummary, NpsSummary, NumericSummary, QuestionSummary, RatingSummary } from '../types'

const mq = (question_key: string, type: string, label: string) => ({ question_key, type, label })

const choice = (n: number, opts: [string, string, number][]): ChoiceSummary => ({
  kind: 'choice',
  n,
  multi: false,
  other: [],
  options: opts.map(([id, label, count]) => ({ id, label, count, pct: n ? Math.round((1000 * count) / n) / 10 : 0, base: n })),
})
const numeric = (n: number, mean: number | null): NumericSummary => ({ kind: 'numeric', n, mean, median: mean, min: null, max: null, histogram: [] })
const nps = (n: number, promoters: number, passives: number, detractors: number, score: number | null): NpsSummary => ({
  kind: 'nps',
  n,
  promoters,
  passives,
  detractors,
  score,
  distribution: [],
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('matchQuestions', () => {
  it('matches by question_key first, in the first survey order', () => {
    const r = matchQuestions([
      [mq('q_aaaaaaaa', 'nps', 'Recommend us?'), mq('q_bbbbbbbb', 'single_choice', 'Plan')],
      [mq('q_bbbbbbbb', 'single_choice', 'Which plan'), mq('q_aaaaaaaa', 'nps', 'Would you recommend us')],
    ])
    expect(r.matched.map((m) => [m.key, m.by])).toEqual([
      ['q_aaaaaaaa', 'key'],
      ['q_bbbbbbbb', 'key'],
    ])
    expect(r.matched[1]!.entries[1]!.label).toBe('Which plan')
    expect(r.unmatched).toEqual([[], []])
  })

  it('falls back to normalized label plus type when keys differ', () => {
    const r = matchQuestions([
      [mq('q_aaaaaaaa', 'rating', 'How satisfied are you?')],
      [mq('q_zzzzzzzz', 'rating', '  how SATISFIED are you ')],
      [mq('q_yyyyyyyy', 'long_text', 'Anything else?')],
    ])
    expect(r.matched).toHaveLength(1)
    expect(r.matched[0]!.by).toBe('label')
    expect(r.matched[0]!.entries.map((e) => e?.question_key ?? null)).toEqual(['q_aaaaaaaa', 'q_zzzzzzzz', null])
    expect(r.unmatched[2]!.map((q) => q.question_key)).toEqual(['q_yyyyyyyy'])
  })

  it('refuses a key whose type differs and never label matches it', () => {
    const r = matchQuestions([
      [mq('q_aaaaaaaa', 'single_choice', 'Score')],
      [mq('q_aaaaaaaa', 'number', 'Score')],
    ])
    expect(r.matched).toEqual([])
    expect(r.refused).toEqual([{ by: 'key', key: 'q_aaaaaaaa', label: 'Score', types: ['single_choice', 'number'] }])
    expect(r.unmatched.map((l) => l.length)).toEqual([1, 1])
  })

  it('refuses a label match across types', () => {
    const r = matchQuestions([[mq('q_aaaaaaaa', 'rating', 'Speed')], [mq('q_bbbbbbbb', 'number', 'Speed')]])
    expect(r.matched).toEqual([])
    expect(r.refused[0]).toMatchObject({ by: 'label', types: ['rating', 'number'] })
    expect(r.unmatched.map((l) => l.length)).toEqual([1, 1])
  })

  it('normalizes accents, punctuation and spacing', () => {
    expect(normalizeLabel(' Café: quality?! ')).toBe('cafe quality')
  })
})

describe('compareSummaries', () => {
  it('choice: percentage point deltas, options matched by id then label', () => {
    const c = compareSummaries([
      choice(10, [['a', 'Yes', 6], ['b', 'No', 4]]),
      choice(20, [['x', 'yes', 5], ['b', 'No', 15]]),
    ])
    const yes = c.measures.find((m) => m.measure === 'Yes')!
    expect(yes.values).toEqual([60, 25])
    expect(yes.deltas).toEqual([null, -35])
    expect(c.headline.measure).toBe('Yes')
    expect(c.measures[0]).toMatchObject({ measure: 'answered', values: [10, 20], deltas: [null, null] })
  })

  it('numeric and rating: mean delta', () => {
    expect(compareSummaries([numeric(5, 3.25), numeric(8, 4)]).headline.deltas).toEqual([null, 0.8])
    const r: RatingSummary = { kind: 'rating', n: 4, mean: 4, median: 4, distribution: [{ value: 5, count: 2, pct: 50 }] }
    const r2: RatingSummary = { ...r, mean: 3.5, distribution: [{ value: 5, count: 1, pct: 25 }] }
    const c = compareSummaries([r, r2])
    expect(c.headline.deltas[1]).toBe(-0.5)
    expect(c.measures.find((m) => m.measure === 'rated 5')!.deltas[1]).toBe(-25)
  })

  it('nps: score delta in NPS points and shares', () => {
    const c = compareSummaries([nps(10, 5, 3, 2, 30), nps(10, 2, 3, 5, -30)])
    expect(c.headline).toMatchObject({ measure: 'nps', values: [30, -30], deltas: [null, -60], delta: 'nps' })
    expect(c.measures.find((m) => m.measure === 'promoters')!.values).toEqual([50, 20])
  })

  it('small cells: no delta when either side has under 3 answers', () => {
    expect(deltasFor([50, 70, 80], [10, 2, 5], 'pp')).toEqual([null, null, 30])
    expect(deltasFor([50, 70], [2, 10], 'pp')).toEqual([null, null])
    const c = compareSummaries([numeric(2, 1), numeric(9, 5)])
    expect(c.headline.values).toEqual([1, 5])
    expect(c.headline.deltas).toEqual([null, null])
  })

  it('missing survey or missing option reads as empty, not 0', () => {
    const c = compareSummaries([choice(10, [['a', 'Red', 5]]), null, choice(10, [['b', 'Blue', 5]])])
    expect(c.measures.find((m) => m.measure === 'Red')!.values).toEqual([50, null, null])
    expect(c.measures.find((m) => m.measure === 'Blue')!.deltas).toEqual([null, null, null])
  })

  it('text and count types have no difference', () => {
    const t: QuestionSummary = { kind: 'text', n: 4, words: [], latest: [] }
    const c = compareSummaries([t, { ...t, n: 9 }])
    expect(c.measures).toHaveLength(1)
    expect(c.headline.deltas).toEqual([null, null])
  })
})

describe('strip, params and tables', () => {
  it('completion rate pp and median seconds against the first survey', () => {
    const s = compareStrip([
      { responses: 10, completionRate: 50, medianSeconds: 120 },
      { responses: 10, completionRate: 62.5, medianSeconds: 90 },
    ])
    expect(s.completionDelta).toEqual([null, 12.5])
    expect(s.medianDelta).toEqual([null, -30])
  })

  it('parses survey ids and per survey overrides', () => {
    expect(parseCompareSurveys([`${A},${B}`, A, 'nope'])).toEqual([A, B])
    const sp = new URLSearchParams('range=30d&version=all&range_1=custom&from_1=2026-01-01&to_1=2026-02-01')
    expect(compareFiltersFor(sp, 0)).toMatchObject({ range: '30d', version: 'all', status: 'complete' })
    expect(compareFiltersFor(sp, 1)).toMatchObject({ range: 'custom', from: '2026-01-01', to: '2026-02-01', version: 'all' })
  })

  it('summary table: one row per question, one column per survey, then differences', () => {
    const comparison = compareSummaries([nps(10, 5, 3, 2, 30), nps(10, 2, 3, 5, -30)])
    const t = compareSummaryTable(['S1', 'S2'], [{ key: 'q_aaaaaaaa', label: 'Recommend', type: 'nps', by: 'key', comparison }])
    expect(t.header).toEqual(['question_key', 'question', 'type', 'matched_by', 'measure', 'S1', 'S2', 'difference S2'])
    expect(t.rows).toEqual([['q_aaaaaaaa', 'Recommend', 'nps', 'key', 'nps', 30, -30, -60]])
    expect(compareDetailTable(['S1', 'S2'], [{ key: 'q_aaaaaaaa', label: 'Recommend', comparison }]).rows).toHaveLength(5)
  })

  it('formats deltas with a sign and a unit word', () => {
    expect(formatDelta(12.5, 'pp')).toBe('+12.5 pts')
    expect(formatDelta(-60, 'nps')).toBe('-60 NPS')
    expect(formatDelta(null, 'pp')).toBe('')
  })
})
