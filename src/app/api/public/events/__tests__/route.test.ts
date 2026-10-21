import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const recordEvents = vi.fn()
const rateLimitHit = vi.fn()
vi.mock('@/lib/db/events', async (orig) => ({ ...(await orig<typeof import('@/lib/db/events')>()), recordEvents: (...a: unknown[]) => recordEvents(...a) }))
vi.mock('@/lib/db/submission', () => ({ rateLimitHit: (...a: unknown[]) => rateLimitHit(...a) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ admin: true }) }))

const { POST } = await import('../route')

const S = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const body = (events: unknown[]) => JSON.stringify({ survey_id: S, survey_version_id: V, rid: 'rid_12345678', events })
const req = (b: string, type = 'application/json', extra: Record<string, string> = {}) =>
  new Request('https://s.example.org/api/public/events', { method: 'POST', body: b, headers: { 'content-type': type, 'x-real-ip': '203.0.113.7', ...extra } })

beforeEach(() => {
  recordEvents.mockReset().mockResolvedValue({ ok: true, data: 1 })
  rateLimitHit.mockReset().mockResolvedValue({ ok: true, data: true })
})

describe('POST /api/public/events', () => {
  it('records a valid batch and answers 204', async () => {
    const res = await POST(req(body([{ type: 'view', meta: { device: 'mobile' } }, { type: 'complete' }])))
    expect(res.status).toBe(204)
    expect(rateLimitHit).toHaveBeenCalledWith({ admin: true }, { bucket: 'events_rid', key: `${S}:rid_12345678`, window: '1 hour', max: 300 })
    // S11: per-IP and per-survey buckets run before the client chosen rid bucket.
    expect(rateLimitHit.mock.calls.map((c) => (c[1] as { bucket: string }).bucket)).toEqual(['events_ip', 'events_survey', 'events_rid'])
    const ipCall = rateLimitHit.mock.calls[0]![1] as { key: string; max: number }
    expect(ipCall.key).toMatch(/^[0-9a-f]{32}$/)
    expect(ipCall.key).not.toContain('203.0.113.7')
    expect(rateLimitHit.mock.calls[1]![1]).toMatchObject({ key: S, window: '1 minute', max: 10000 })
    expect(recordEvents).toHaveBeenCalledTimes(1)
    const [, events] = recordEvents.mock.calls[0]!
    expect(events).toEqual([{ survey_id: S, survey_version_id: V, respondent_hash: 'rid_12345678', type: 'view', meta: { device: 'mobile' } }])
  })
  it('accepts text/plain from sendBeacon', async () => {
    const res = await POST(req(body([{ type: 'abandon', meta: { last_question_key: 'q_abcdefgh', page: 1 } }]), 'text/plain;charset=UTF-8'))
    expect(res.status).toBe(204)
    expect(recordEvents).toHaveBeenCalledTimes(1)
  })
  it('204 and no write for invalid JSON, empty or complete-only batches', async () => {
    for (const b of ['not json', '', body([{ type: 'complete' }]), JSON.stringify({ events: [{ type: 'view' }] })]) {
      expect((await POST(req(b))).status).toBe(204)
    }
    expect(recordEvents).not.toHaveBeenCalled()
  })
  it('204 and no write when rate limited', async () => {
    rateLimitHit.mockResolvedValue({ ok: true, data: false })
    expect((await POST(req(body([{ type: 'view' }])))).status).toBe(204)
    expect(recordEvents).not.toHaveBeenCalled()
  })
  it('204 even when the database fails', async () => {
    recordEvents.mockResolvedValue({ ok: false, error: { code: 'unknown' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(req(body([{ type: 'view' }])))).status).toBe(204)
    spy.mockRestore()
  })
  it('S11: the per-IP bucket stops a flood of fresh rids before the rid bucket', async () => {
    rateLimitHit.mockImplementation(async (_c: unknown, input: { bucket: string }) => ({ ok: true, data: input.bucket !== 'events_ip' }))
    expect((await POST(req(body([{ type: 'view' }])))).status).toBe(204)
    expect(rateLimitHit).toHaveBeenCalledTimes(1)
    expect(recordEvents).not.toHaveBeenCalled()
  })
  it('I7: a declared Content-Length over 64 KB is refused without reading the body', async () => {
    const r = req(body([{ type: 'view' }]), 'application/json', { 'content-length': '70000' })
    const spy = vi.spyOn(r, 'text')
    expect((await POST(r)).status).toBe(204)
    expect(spy).not.toHaveBeenCalled()
    expect(r.bodyUsed).toBe(false)
    expect(rateLimitHit).not.toHaveBeenCalled()
  })
  it('refuses bodies over 64 KB', async () => {
    expect((await POST(req(body([{ type: 'view', meta: { referrer_host: 'x'.repeat(70_000) } }])))).status).toBe(204)
    expect(recordEvents).not.toHaveBeenCalled()
  })
})
