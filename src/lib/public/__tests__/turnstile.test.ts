import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { SITEVERIFY_URL, isTestSecret, verifyTurnstile } = await import('../turnstile')

const env = (extra: Record<string, string> = {}) =>
  ({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'real-secret', PUBLIC_HOST: 's.example.org', ...extra }) as unknown as NodeJS.ProcessEnv

function fakeFetch(body: unknown) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body)))
}

describe('verifyTurnstile', () => {
  it('posts secret, token, ip and idempotency key to siteverify', async () => {
    const f = fakeFetch({ success: true, action: 'submit', hostname: 's.example.org' })
    const r = await verifyTurnstile({ token: 'tok', ip: '1.2.3.4', action: 'submit', idempotencyKey: 'k1', env: env(), fetchImpl: f as never })
    expect(r).toEqual({ ok: true })
    expect(f.mock.calls[0]![0]).toBe(SITEVERIFY_URL)
    const sent = f.mock.calls[0]![1]!.body as URLSearchParams
    expect(Object.fromEntries(sent)).toEqual({ secret: 'real-secret', response: 'tok', remoteip: '1.2.3.4', idempotency_key: 'k1' })
  })

  it('rejects a failed verification', async () => {
    const r = await verifyTurnstile({
      token: 'tok',
      ip: '1.2.3.4',
      action: 'submit',
      env: env(),
      fetchImpl: fakeFetch({ success: false, 'error-codes': ['invalid-input-response'] }) as never,
    })
    expect(r).toEqual({ ok: false, reason: 'invalid-input-response' })
  })

  it('rejects the wrong action or hostname', async () => {
    const wrongAction = await verifyTurnstile({
      token: 't',
      ip: 'x',
      action: 'submit',
      env: env(),
      fetchImpl: fakeFetch({ success: true, action: 'report', hostname: 's.example.org' }) as never,
    })
    expect(wrongAction).toEqual({ ok: false, reason: 'action_mismatch' })
    const wrongHost = await verifyTurnstile({
      token: 't',
      ip: 'x',
      action: 'submit',
      env: env(),
      fetchImpl: fakeFetch({ success: true, action: 'submit', hostname: 'survey.example.org' }) as never,
    })
    expect(wrongHost).toEqual({ ok: false, reason: 'hostname_mismatch' })
  })

  it('compares the hostname without the port', async () => {
    const r = await verifyTurnstile({
      token: 't',
      ip: 'x',
      action: 'upload',
      env: env({ PUBLIC_HOST: 'S.localhost:3000' }),
      fetchImpl: fakeFetch({ success: true, action: 'upload', hostname: 's.localhost' }) as never,
    })
    expect(r.ok).toBe(true)
  })

  it('skips action and hostname checks for Cloudflare test secrets', async () => {
    expect(isTestSecret('1x0000000000000000000000000000000AA')).toBe(true)
    expect(isTestSecret('real-secret')).toBe(false)
    const r = await verifyTurnstile({
      token: 't',
      ip: 'x',
      action: 'submit',
      env: env({ TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }),
      fetchImpl: fakeFetch({ success: true, action: 'test', hostname: 'example.com' }) as never,
    })
    expect(r.ok).toBe(true)
  })

  it('requires a token', async () => {
    const f = fakeFetch({ success: true })
    expect(await verifyTurnstile({ token: undefined, ip: 'x', action: 'submit', env: env(), fetchImpl: f as never })).toEqual({
      ok: false,
      reason: 'missing_token',
    })
    expect(f).not.toHaveBeenCalled()
  })

  it('treats a network failure as a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await verifyTurnstile({ token: 't', ip: 'x', action: 'submit', env: env(), fetchImpl: f as never })).toEqual({
      ok: false,
      reason: 'network',
    })
  })

  it('skips only outside production when the secret is unset', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const f = fakeFetch({ success: true })
    const dev = await verifyTurnstile({ token: undefined, ip: 'x', action: 'submit', env: { NODE_ENV: 'development' } as never, fetchImpl: f as never })
    expect(dev).toEqual({ ok: true, skipped: true })
    const prod = await verifyTurnstile({ token: 't', ip: 'x', action: 'submit', env: { NODE_ENV: 'production' } as never, fetchImpl: f as never })
    expect(prod).toEqual({ ok: false, reason: 'not_configured' })
    expect(f).not.toHaveBeenCalled()
  })
})
