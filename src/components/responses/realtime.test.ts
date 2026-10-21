import { describe, expect, it, vi } from 'vitest'
import type { InboxRow } from '@/lib/crm/data/responses'
import { createRealtimeHandler, rowMatches } from './realtime'

const ROW: InboxRow = {
  id: 'r1',
  survey_id: 's1',
  survey_version_id: 'v2',
  status: 'complete',
  contact_id: null,
  respondent_token_id: null,
  identity_source: null,
  started_at: '2026-10-21T10:00:00Z',
  submitted_at: '2026-10-21T10:05:00Z',
  last_question_key: null,
  score: null,
  score_max: null,
  metadata: {},
  contact: null,
}

describe('createRealtimeHandler', () => {
  it('refetches the row by id and never uses the payload contents', async () => {
    const fetched = { ...ROW, status: 'complete' as const }
    const fetchRow = vi.fn(async () => fetched)
    const upsert = vi.fn()
    const remove = vi.fn()
    const handler = createRealtimeHandler({ fetchRow, upsert, remove })
    await handler({
      eventType: 'INSERT',
      new: { id: 'r1', status: 'partial', raw: { secret: 'answers' }, metadata: { injected: true } },
    })
    expect(fetchRow).toHaveBeenCalledWith('r1')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]![0]).toBe(fetched)
    expect(upsert.mock.calls[0]![0]).not.toHaveProperty('raw')
    expect(upsert.mock.calls[0]![1]).toBe(true)
    expect(remove).not.toHaveBeenCalled()
  })

  it('drops the row when the refetch finds nothing (RLS or deleted)', async () => {
    const remove = vi.fn()
    const upsert = vi.fn()
    await createRealtimeHandler({ fetchRow: async () => null, upsert, remove })({ eventType: 'UPDATE', new: { id: 'r9' } })
    expect(upsert).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('r9')
  })

  it('removes on delete without fetching, and ignores payloads with no id', async () => {
    const fetchRow = vi.fn(async () => ROW)
    const remove = vi.fn()
    const h = createRealtimeHandler({ fetchRow, upsert: vi.fn(), remove })
    await h({ eventType: 'DELETE', old: { id: 'r2' } })
    await h({ eventType: 'INSERT', new: {} })
    expect(fetchRow).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('r2')
  })
})

describe('rowMatches', () => {
  const f = { status: 'complete' as const, identity: 'all' as const, version: 'all', latestVersionId: 'v2' }
  it('applies status, identity and version filters', () => {
    expect(rowMatches(ROW, f)).toBe(true)
    expect(rowMatches({ ...ROW, status: 'partial' }, f)).toBe(false)
    expect(rowMatches(ROW, { ...f, identity: 'identified' })).toBe(false)
    expect(rowMatches({ ...ROW, identity_source: 'token', contact_id: 'c' }, { ...f, identity: 'token' })).toBe(true)
    expect(rowMatches(ROW, { ...f, version: 'latest' })).toBe(true)
    expect(rowMatches(ROW, { ...f, version: 'v1' })).toBe(false)
  })
})
