import { describe, expect, it } from 'vitest'
import {
  choiceIdsOf,
  summarizeChoice,
  summarizeDate,
  summarizeFiles,
  summarizeMatrix,
  summarizeNps,
  summarizeNumeric,
  summarizeQuestion,
  summarizeRanking,
  summarizeRating,
  summarizeText,
} from '../aggregate'
import { histogram, mean, median, pct } from '../stats'
import { ans, OPTS, q, V1, V2 } from './fixtures'

describe('stats', () => {
  it('mean, median, pct', () => {
    expect(mean([])).toBeNull()
    expect(mean([1, 2, 4])).toBe(2.33)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(pct(1, 3)).toBe(33.3)
    expect(pct(1, 0)).toBe(0)
  })
  it('histogram covers every value with integer bins for integers', () => {
    const h = histogram([1, 2, 2, 3, 10, 11, 50])
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(7)
    expect(h.length).toBeGreaterThanOrEqual(5)
    expect(h.every((b) => Number.isInteger(b.from) && Number.isInteger(b.to))).toBe(true)
    expect(histogram([4, 4, 4])).toEqual([{ from: 4, to: 4, count: 3 }])
    expect(histogram([])).toEqual([])
  })
})

describe('choice', () => {
  it('single choice counts, percents and other text', () => {
    const s = summarizeChoice(OPTS, [
      ans({ value_text: 'opt_a' }),
      ans({ value_text: 'opt_a' }),
      ans({ value_text: 'opt_b', value_json: { other: ' Something else ' } }),
      ans({ value_text: null }),
    ])
    expect(s.n).toBe(3)
    expect(s.options.map((o) => [o.id, o.count, o.pct])).toEqual([
      ['opt_a', 2, 66.7],
      ['opt_b', 1, 33.3],
      ['opt_c', 0, 0],
    ])
    expect(s.other).toEqual(['Something else'])
  })
  it('multi choice percent is of respondents and can pass 100', () => {
    const s = summarizeChoice(OPTS, [ans({ value_json: ['opt_a', 'opt_b'] }), ans({ value_json: { ids: ['opt_a'], other: 'x' } })], { multi: true })
    expect(s.multi).toBe(true)
    expect(s.options.find((o) => o.id === 'opt_a')!.pct).toBe(100)
    expect(s.options.find((o) => o.id === 'opt_b')!.pct).toBe(50)
    expect(s.options.reduce((x, o) => x + o.pct, 0)).toBeGreaterThan(100)
  })
  it('cross-version base: an option counts only versions that offered it', () => {
    const s = summarizeChoice(OPTS, [ans({ value_text: 'opt_a', survey_version_id: V1 }), ans({ value_text: 'opt_c', survey_version_id: V2 }), ans({ value_text: 'opt_a', survey_version_id: V2 })], {
      offeredBy: { opt_c: [V2] },
    })
    const c = s.options.find((o) => o.id === 'opt_c')!
    expect(c.base).toBe(2)
    expect(c.pct).toBe(50)
    expect(s.options.find((o) => o.id === 'opt_a')!.base).toBe(3)
  })
  it('unknown option ids still count', () => {
    const s = summarizeChoice(OPTS, [ans({ value_text: 'opt_gone' })])
    expect(s.options.at(-1)).toMatchObject({ id: 'opt_gone', count: 1 })
  })
  it('choiceIdsOf reads every storage shape', () => {
    expect(choiceIdsOf({ value_text: 'a', value_json: null })).toEqual(['a'])
    expect(choiceIdsOf({ value_text: null, value_json: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(choiceIdsOf({ value_text: null, value_json: { ids: ['c'], other: 'x' } })).toEqual(['c'])
  })
})

describe('numeric and rating', () => {
  it('numeric n, mean, median, min, max', () => {
    const s = summarizeNumeric([1, 2, 3, 10].map((v) => ans({ value_number: v })).concat(ans({})))
    expect(s).toMatchObject({ n: 4, mean: 4, median: 2.5, min: 1, max: 10 })
    expect(s.histogram.reduce((x, b) => x + b.count, 0)).toBe(4)
  })
  it('rating distribution fills every scale point', () => {
    const s = summarizeRating([5, 5, 3].map((v) => ans({ value_number: v })), { min: 1, max: 5 })
    expect(s.distribution.map((d) => d.count)).toEqual([0, 0, 1, 0, 2])
    expect(s.mean).toBe(4.33)
    expect(s.median).toBe(5)
  })
})

describe('nps', () => {
  it('promoters, passives, detractors and score', () => {
    const s = summarizeNps([10, 9, 9, 8, 7, 6, 0, 3, 10, 5].map((v) => ans({ value_number: v })))
    expect(s).toMatchObject({ n: 10, promoters: 4, passives: 2, detractors: 4, score: 0 })
    expect(s.distribution).toHaveLength(11)
    expect(s.distribution[10]!.count).toBe(2)
  })
  it('all promoters is 100, empty is null', () => {
    expect(summarizeNps([ans({ value_number: 9 })]).score).toBe(100)
    expect(summarizeNps([]).score).toBeNull()
  })
  it('rounds like the SQL', () => {
    // 2 promoters, 1 detractor of 3: 33.3 rounds to 33
    expect(summarizeNps([9, 10, 2].map((v) => ans({ value_number: v }))).score).toBe(33)
  })
})

describe('matrix', () => {
  it('heat table counts and row totals', () => {
    const rows = [{ id: 'r1', label: 'Speed' }, { id: 'r2', label: 'Price' }]
    const cols = [{ id: 'c1', label: 'Bad' }, { id: 'c2', label: 'Good' }]
    const s = summarizeMatrix(rows, cols, [ans({ value_json: { r1: 'c2', r2: 'c1' } }), ans({ value_json: { r1: 'c2', rX: 'c1' } }), ans({ value_json: 'junk' })])
    expect(s.n).toBe(2)
    expect(s.cells).toEqual([[0, 2], [1, 0]])
    expect(s.rowTotals).toEqual([2, 1])
  })
})

describe('ranking', () => {
  it('average position and percent ranked first, best first', () => {
    const s = summarizeRanking(OPTS, [ans({ value_json: ['opt_b', 'opt_a', 'opt_c'] }), ans({ value_json: ['opt_b', 'opt_c', 'opt_a'] }), ans({ value_json: ['opt_a', 'opt_b'] })])
    expect(s.n).toBe(3)
    expect(s.items[0]).toMatchObject({ id: 'opt_b', avgPosition: 1.33, firstPct: 66.7 })
    expect(s.items.find((i) => i.id === 'opt_c')).toMatchObject({ avgPosition: 2.5, n: 2 })
  })
})

describe('text, date, files', () => {
  it('text word list and latest answers', () => {
    const s = summarizeText([ans({ value_text: 'The delivery was fast' }), ans({ value_text: 'Fast delivery and friendly staff' }), ans({ value_text: '  ' })])
    expect(s.n).toBe(2)
    expect(s.words.slice(0, 2)).toEqual([
      { word: 'delivery', count: 2 },
      { word: 'fast', count: 2 },
    ])
    expect(s.latest).toHaveLength(2)
  })
  it('date range and months', () => {
    const s = summarizeDate(['2026-03-02', '2026-01-15', '2026-03-30'].map((d) => ans({ value_date: d })))
    expect(s).toMatchObject({ n: 3, earliest: '2026-01-15', latest: '2026-03-30' })
    expect(s.months).toEqual([
      { month: '2026-01', count: 1 },
      { month: '2026-03', count: 2 },
    ])
  })
  it('file counts', () => {
    const s = summarizeFiles([
      ans({ value_json: [{ file_id: 'f1', name: 'a.pdf', size: 10 }, { file_id: 'f2', name: 'b.pdf' }] }),
      ans({ value_json: { file_id: 'f3', name: 'sig.png' } }),
      ans({ value_json: [] }),
    ])
    expect(s).toMatchObject({ n: 2, fileCount: 3 })
    expect(s.files.map((f) => f.file_id)).toEqual(['f1', 'f2', 'f3'])
  })
})

describe('summarizeQuestion dispatch', () => {
  it('yes/no becomes a two option choice with custom labels', () => {
    const s = summarizeQuestion(q({ type: 'yes_no', settings: { yes_label: 'Sure', no_label: 'Nope' } }), [ans({ value_number: 1 }), ans({ value_number: 0 }), ans({ value_number: 1 })])
    expect(s.kind).toBe('choice')
    if (s.kind === 'choice') expect(s.options.map((o) => [o.label, o.count])).toEqual([['Sure', 2], ['Nope', 1]])
  })
  it('kinds by type', () => {
    expect(summarizeQuestion(q({ type: 'nps' }), []).kind).toBe('nps')
    expect(summarizeQuestion(q({ type: 'rating', settings: { points: 10 } }), []).kind).toBe('rating')
    expect(summarizeQuestion(q({ type: 'long_text' }), []).kind).toBe('text')
    expect(summarizeQuestion(q({ type: 'email' }), [ans({ value_text: 'a@b.co' })])).toEqual({ kind: 'count', n: 1 })
    expect(summarizeQuestion(q({ type: 'signature' }), []).kind).toBe('files')
    expect(summarizeQuestion(q({ type: 'multiple_choice', options: OPTS }), []).kind).toBe('choice')
  })
})
