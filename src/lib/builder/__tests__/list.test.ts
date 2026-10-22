import { describe, expect, it, vi } from 'vitest'
import { BULK_MAX, aggregateBulk, bulkSummary, cleanBulkIds, runBulk } from '../list'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('cleanBulkIds', () => {
  it('drops junk and duplicates, keeps order, lowercases, caps', () => {
    expect(cleanBulkIds('x')).toEqual([])
    expect(cleanBulkIds([id(2), 'nope', 7, id(1), id(2).toUpperCase()])).toEqual([id(2), id(1)])
    expect(cleanBulkIds(Array.from({ length: BULK_MAX + 5 }, (_, i) => id(i)))).toHaveLength(BULK_MAX)
  })
})

describe('runBulk and aggregateBulk', () => {
  it('runs every id in order, survives failures and throws, and counts', async () => {
    const seen: string[] = []
    const fn = vi.fn(async (s: string) => {
      seen.push(s)
      if (s === 'b') return { ok: false, message: 'Locked.' }
      if (s === 'c') throw new Error('boom')
      return { ok: true, newId: `${s}2` }
    })
    const r = await runBulk(['a', 'b', 'c', 'd'], fn)
    expect(seen).toEqual(['a', 'b', 'c', 'd'])
    expect(r.succeeded).toBe(2)
    expect(r.failed).toBe(2)
    expect(r.items).toEqual([
      { surveyId: 'a', ok: true, newId: 'a2' },
      { surveyId: 'b', ok: false, message: 'Locked.' },
      { surveyId: 'c', ok: false, message: 'Something went wrong.' },
      { surveyId: 'd', ok: true, newId: 'd2' },
    ])
  })
  it('aggregates an empty list', () => {
    expect(aggregateBulk([])).toEqual({ succeeded: 0, failed: 0, items: [] })
  })
})

describe('bulkSummary', () => {
  it('words all, partial, none and empty outcomes', () => {
    expect(bulkSummary(aggregateBulk([{ surveyId: 'a', ok: true }]), 'archived')).toEqual({ text: '1 survey archived.', tone: 'success' })
    expect(bulkSummary(aggregateBulk([{ surveyId: 'a', ok: true }, { surveyId: 'b', ok: true }]), 'duplicated').text).toBe('2 surveys duplicated.')
    const partial = aggregateBulk([
      { surveyId: 'a', ok: true },
      { surveyId: 'b', ok: false, message: 'Not allowed.' },
      { surveyId: 'c', ok: false, message: 'Not allowed.' },
    ])
    expect(bulkSummary(partial, 'archived')).toEqual({ text: '1 survey archived, 2 failed. Not allowed.', tone: 'error' })
    expect(bulkSummary(aggregateBulk([{ surveyId: 'a', ok: false }]), 'restored').text).toBe('No surveys restored. Something went wrong.')
    expect(bulkSummary(aggregateBulk([]), 'archived').tone).toBe('error')
  })
})
