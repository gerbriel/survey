import { describe, expect, it } from 'vitest'
import {
  computeFunnel,
  deviceSplitResponses,
  deviceSplitViews,
  dropOffByPage,
  dropOffByQuestion,
  medianTimeToComplete,
  responsesOverTime,
  weekKey,
} from '../funnel'
import type { EventLite } from '../types'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const T = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString()
const ev = (rid: string, type: string, extra: Partial<EventLite> = {}): EventLite => ({ respondent_hash: rid, type, question_key: null, occurred_at: T(10), meta: {}, ...extra })

describe('computeFunnel', () => {
  it('views, starts, completes, abandoned and rates by distinct rid', () => {
    const events = [
      ev('a', 'view'), ev('a', 'view'), ev('a', 'start'), ev('a', 'complete'),
      ev('b', 'view'), ev('b', 'start'), ev('b', 'abandon'),
      ev('c', 'view', { occurred_at: T(60 * 30) }), ev('c', 'start', { occurred_at: T(60 * 30) }),
      ev('d', 'view'), ev('d', 'start'),
      ev('e', 'view'),
      ev('', 'view'),
    ]
    const f = computeFunnel(events, NOW)
    expect(f).toMatchObject({ views: 5, starts: 4, completes: 1, abandoned: 2, completionRate: 25, startRate: 80 })
  })
  it('a later complete wins over abandon', () => {
    expect(computeFunnel([ev('a', 'start'), ev('a', 'abandon'), ev('a', 'complete')], NOW)).toMatchObject({ completes: 1, abandoned: 0 })
  })
})

describe('drop-off', () => {
  const qs = [
    { question_key: 'q_00000001', label: 'One', position: 0 },
    { question_key: 'q_00000002', label: 'Two', position: 1 },
    { question_key: 'q_00000003', label: 'Three', position: 2 },
  ]
  const view = (rid: string, k: string, page = 0) => ev(rid, 'question_view', { question_key: k, meta: { page } })
  const events = [
    ev('a', 'start'), view('a', 'q_00000001'), view('a', 'q_00000002', 1), view('a', 'q_00000003', 1), ev('a', 'complete'),
    ev('b', 'start'), view('b', 'q_00000001'), view('b', 'q_00000002', 1),
    ev('c', 'start'), view('c', 'q_00000001'),
    // never started: ignored
    view('d', 'q_00000001'), view('d', 'q_00000002', 1),
  ]
  it('per question reached and dropped here', () => {
    expect(dropOffByQuestion(events, qs).map((r) => [r.question_key, r.reached, r.droppedHere])).toEqual([
      ['q_00000001', 3, 1],
      ['q_00000002', 2, 1],
      ['q_00000003', 1, 0],
    ])
  })
  it('per page', () => {
    expect(dropOffByPage(events)).toEqual([
      { page: 0, reached: 3, droppedHere: 1 },
      { page: 1, reached: 2, droppedHere: 1 },
    ])
  })
})

describe('median time to complete', () => {
  it('uses complete responses only', () => {
    const r = (start: string, end: string | null, status: 'complete' | 'partial' = 'complete') => ({ status, started_at: start, submitted_at: end })
    expect(
      medianTimeToComplete([
        r('2026-10-01T10:00:00Z', '2026-10-01T10:01:00Z'),
        r('2026-10-01T10:00:00Z', '2026-10-01T10:03:00Z'),
        r('2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z'),
        r('2026-10-01T10:00:00Z', null, 'partial'),
      ]),
    ).toBe(180)
    expect(medianTimeToComplete([])).toBeNull()
  })
})

describe('responses over time', () => {
  it('daily buckets with gaps filled', () => {
    const r = responsesOverTime(
      [
        { status: 'complete', started_at: '2026-10-01T09:00:00Z', submitted_at: '2026-10-01T09:05:00Z' },
        { status: 'partial', started_at: '2026-10-03T09:00:00Z', submitted_at: null },
      ],
      { from: '2026-10-01T00:00:00Z', to: '2026-10-03T23:00:00Z' },
    )
    expect(r.unit).toBe('day')
    expect(r.points).toEqual([
      { bucket: '2026-10-01', complete: 1, partial: 0 },
      { bucket: '2026-10-02', complete: 0, partial: 0 },
      { bucket: '2026-10-03', complete: 0, partial: 1 },
    ])
  })
  it('weekly past 90 days, Monday start', () => {
    const r = responsesOverTime([{ status: 'complete', started_at: '2026-01-01T00:00:00Z', submitted_at: '2026-01-07T00:00:00Z' }], { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' })
    expect(r.unit).toBe('week')
    expect(weekKey(Date.parse('2026-01-07T00:00:00Z'))).toBe('2026-01-05')
    expect(r.points.find((p) => p.bucket === '2026-01-05')?.complete).toBe(1)
  })
})

describe('device split', () => {
  it('responses and views', () => {
    const d = deviceSplitResponses([
      { status: 'complete', metadata: { device: 'mobile' } },
      { status: 'complete', metadata: { device: 'desktop' } },
      { status: 'complete', metadata: {} },
      { status: 'partial', metadata: { device: 'mobile' } },
    ])
    expect(d.map((x) => [x.device, x.count])).toEqual([['desktop', 1], ['mobile', 1], ['unknown', 1]])
    const v = deviceSplitViews([ev('a', 'view', { meta: { device: 'tablet' } }), ev('a', 'view', { meta: { device: 'mobile' } })])
    expect(v).toEqual([{ device: 'tablet', count: 1, pct: 100 }])
  })
})
