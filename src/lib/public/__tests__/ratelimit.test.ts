import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rateLimitHit = vi.fn()
vi.mock('@/lib/db/submission', () => ({ rateLimitHit: (...a: unknown[]) => rateLimitHit(...a) }))

const { checkRateLimits, hashIp, rateLimitSecret, RATE_LIMITS, utcDate } = await import('../ratelimit')
const admin = {} as never

describe('ip hashing', () => {
  const day = new Date('2026-10-21T10:00:00Z')

  it('is a 16 byte hex HMAC, stable within a UTC day', () => {
    const a = hashIp('203.0.113.7', 'secret-secret-123', day)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(hashIp('203.0.113.7', 'secret-secret-123', new Date('2026-10-21T23:59:59Z'))).toBe(a)
  })

  it('changes with the UTC date, the secret and the ip', () => {
    const a = hashIp('203.0.113.7', 'secret-secret-123', day)
    expect(hashIp('203.0.113.7', 'secret-secret-123', new Date('2026-10-22T00:00:01Z'))).not.toBe(a)
    expect(hashIp('203.0.113.7', 'other-secret-4567', day)).not.toBe(a)
    expect(hashIp('203.0.113.8', 'secret-secret-123', day)).not.toBe(a)
  })

  it('never contains the raw ip', () => {
    expect(hashIp('203.0.113.7', 'secret-secret-123', day)).not.toContain('203')
  })

  it('formats the UTC date', () => {
    expect(utcDate(new Date('2026-01-02T23:30:00-05:00'))).toBe('2026-01-03')
  })

  it('requires RATE_LIMIT_SECRET in production only', () => {
    expect(() => rateLimitSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/RATE_LIMIT_SECRET/)
    expect(rateLimitSecret({ NODE_ENV: 'production', RATE_LIMIT_SECRET: 'a-long-enough-secret' } as NodeJS.ProcessEnv)).toBe(
      'a-long-enough-secret',
    )
    expect(rateLimitSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeTruthy()
  })
})

describe('checkRateLimits', () => {
  beforeEach(() => rateLimitHit.mockReset())

  it('stops at the first bucket over its limit and reports its window', async () => {
    rateLimitHit.mockResolvedValueOnce({ ok: true, data: true }).mockResolvedValueOnce({ ok: true, data: false })
    const r = await checkRateLimits(admin, [
      { rule: RATE_LIMITS.submitSurvey, key: 's' },
      { rule: RATE_LIMITS.submitCreate, key: 'ip' },
      { rule: RATE_LIMITS.submitSave, key: 'ip' },
    ])
    expect(r).toEqual({ ok: false, retryAfter: 600 })
    expect(rateLimitHit).toHaveBeenCalledTimes(2)
    expect(rateLimitHit.mock.calls[1]![1]).toEqual({ bucket: 'submit:create', key: 'ip', window: '10 minutes', max: 10 })
  })

  it('uses an override max when given', async () => {
    rateLimitHit.mockResolvedValue({ ok: true, data: true })
    await checkRateLimits(admin, [{ rule: RATE_LIMITS.submitComplete, key: 'ip:s', max: 5 }])
    expect(rateLimitHit.mock.calls[0]![1]).toMatchObject({ bucket: 'submit:complete', window: '1 hour', max: 5 })
  })

  it('fails open on a database error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    rateLimitHit.mockResolvedValue({ ok: false, error: { code: 'network' } })
    expect(await checkRateLimits(admin, [{ rule: RATE_LIMITS.report, key: 'ip' }])).toEqual({ ok: true })
  })
})
