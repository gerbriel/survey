import { beforeEach, describe, expect, it, vi } from 'vitest'

/** L7: state checked by key, rate limited, misses never cached. */

vi.mock('server-only', () => ({}))
const cacheCalls: unknown[] = []
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, _k: unknown, opts: unknown) => {
    cacheCalls.push(opts)
    return fn
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
const ogCard = vi.fn()
vi.mock('@/lib/db/publicRead', () => ({ ogCard: (_c: unknown, i: unknown) => ogCard(i) }))
const rateLimitHit = vi.fn()
vi.mock('@/lib/db/submission', () => ({ rateLimitHit: (_c: unknown, i: unknown) => rateLimitHit(i) }))
const resolveSurvey = vi.fn()
vi.mock('../load', () => ({
  KEY_RE: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
  publicAssetUrl: () => null,
  resolveSurvey: (k: string) => resolveSurvey(k),
}))

const { ogCardForRequest } = await import('../og')

const V = '22222222-2222-4222-8222-222222222222'
const S = '11111111-1111-4111-8111-111111111111'
const req = (k = 'abcdefghij') => new Request(`https://s.example.org/api/public/og/${V}?k=${k}`, { headers: { 'x-real-ip': '203.0.113.1' } })

beforeEach(() => {
  rateLimitHit.mockReset().mockResolvedValue({ ok: true, data: true })
  resolveSurvey.mockReset().mockResolvedValue({ survey_id: S })
  ogCard.mockReset().mockResolvedValue({ ok: true, data: { surveyId: S, title: 'T', workspaceName: 'W', logoPath: null } })
})

describe('ogCardForRequest', () => {
  it('serves the card for a version of the survey the key resolves to', async () => {
    expect(await ogCardForRequest(req(), V)).toMatchObject({ kind: 'card', card: { title: 'T' } })
    expect(rateLimitHit).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'og' }))
  })
  it('404s when the key resolves to nothing (draft, archived, deleted) before reading the card', async () => {
    resolveSurvey.mockResolvedValue(null)
    expect(await ogCardForRequest(req(), V)).toEqual({ kind: 'not_found' })
    expect(ogCard).not.toHaveBeenCalled()
  })
  it('404s for a version of another survey and for a missing key', async () => {
    ogCard.mockResolvedValue({ ok: true, data: { surveyId: 'other', title: 'T', workspaceName: 'W', logoPath: null } })
    expect(await ogCardForRequest(req(), V)).toEqual({ kind: 'not_found' })
    expect(await ogCardForRequest(new Request(`https://s.example.org/api/public/og/${V}`), V)).toEqual({ kind: 'not_found' })
  })
  it('is rate limited per IP', async () => {
    rateLimitHit.mockResolvedValue({ ok: true, data: false })
    expect(await ogCardForRequest(req(), V)).toEqual({ kind: 'rate_limited', retryAfter: 60 })
    expect(resolveSurvey).not.toHaveBeenCalled()
  })
  it('carries the theme header image: a starter as a data URI', async () => {
    ogCard.mockResolvedValue({
      ok: true,
      data: { surveyId: S, title: 'T', workspaceName: 'W', logoPath: null, cover: { source: { kind: 'starter', id: 'ocean' }, height: 'short', focal_y: 0.5 } },
    })
    const r = await ogCardForRequest(req(), V)
    expect(r.kind === 'card' && r.card.coverUrl).toMatch(/^data:image\/svg\+xml;base64,/)
  })
  it('never caches a miss: the lookup runs again on the next request', async () => {
    ogCard.mockResolvedValue({ ok: true, data: null })
    await ogCardForRequest(req(), V)
    await ogCardForRequest(req(), V)
    expect(ogCard).toHaveBeenCalledTimes(2)
  })
})
