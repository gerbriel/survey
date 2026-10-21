import { describe, expect, it } from 'vitest'
import { authCookieOptions, hostOnlyCookieOptions } from '@/lib/supabase/cookies'
import { INVITE_COOKIE_MAX_AGE, inviteCookieOptions, isPlausibleInviteToken } from '../invite-cookies'

describe('Supabase auth cookie options (R15)', () => {
  it('production: host-only, Secure, SameSite Lax, Path /', () => {
    const o = authCookieOptions('production')
    expect(o).not.toHaveProperty('domain')
    expect(o.secure).toBe(true)
    expect(o.sameSite).toBe('lax')
    expect(o.path).toBe('/')
  })

  it('Secure everywhere except next dev', () => {
    expect(authCookieOptions('test').secure).toBe(true)
    expect(authCookieOptions(undefined).secure).toBe(true)
    expect(authCookieOptions('development').secure).toBe(false)
  })

  it('strips a Domain attribute and forces the safe attributes on every write', () => {
    const o = hostOnlyCookieOptions(
      { domain: '.example.org', path: '/w', sameSite: 'none', secure: false, maxAge: 3600, httpOnly: false },
      'production',
    )
    expect(o).not.toHaveProperty('domain')
    expect(o).toMatchObject({ path: '/', sameSite: 'lax', secure: true, maxAge: 3600, httpOnly: false })
  })

  it('keeps deletions working', () => {
    const o = hostOnlyCookieOptions({ maxAge: 0 }, 'production')
    expect(o.maxAge).toBe(0)
    expect(o).not.toHaveProperty('domain')
    expect(hostOnlyCookieOptions(undefined, 'production')).toEqual({ path: '/', sameSite: 'lax', secure: true })
  })
})

describe('invite cookie options', () => {
  it('HttpOnly, host-only, Secure outside dev, Lax, Path /, short lived', () => {
    const o = inviteCookieOptions('production')
    expect(o).not.toHaveProperty('domain')
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: INVITE_COOKIE_MAX_AGE })
    expect(inviteCookieOptions('development').secure).toBe(false)
  })

  it('accepts only plausible tokens', () => {
    expect(isPlausibleInviteToken('abcDEF123_-xyz')).toBe(true)
    expect(isPlausibleInviteToken('short')).toBe(false)
    expect(isPlausibleInviteToken('has space here')).toBe(false)
    expect(isPlausibleInviteToken('a'.repeat(201))).toBe(false)
    expect(isPlausibleInviteToken(null)).toBe(false)
  })
})
