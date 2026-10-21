import { describe, expect, it } from 'vitest'
import { authCookieOptions, hostOnlyCookieOptions } from '@/lib/supabase/cookies'
import {
  INVITE_COOKIE_MAX_AGE,
  inviteCookieOptions,
  isPlausibleInviteToken,
  PLATFORM_INVITE_COOKIE,
  signupInviteGuard,
  SIGNUP_NEEDS_INVITE_MESSAGE,
  WORKSPACE_INVITE_COOKIE,
} from '../invite-cookies'

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

  it('S12: production uses a __Host- prefixed name; dev keeps the library default', () => {
    expect(authCookieOptions('production').name).toBe('__Host-sb-auth')
    expect(authCookieOptions('production').name!.startsWith('__Host-')).toBe(true)
    expect(authCookieOptions('development')).not.toHaveProperty('name')
    // __Host- requires Secure, Path=/ and no Domain; all hold in production.
    expect(authCookieOptions('production')).toMatchObject({ secure: true, path: '/' })
  })

  it('S12: never passes a name to a per-cookie write', () => {
    const o = hostOnlyCookieOptions({ name: '__Host-sb-auth', maxAge: 10 } as never, 'production')
    expect(o).not.toHaveProperty('name')
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

describe('S1 (R18) password signup guard', () => {
  const jar = (c: Record<string, string>) => (name: string) => c[name]

  it('refuses without an invite cookie and points to the invite link or Google', () => {
    expect(signupInviteGuard(jar({}))).toEqual({ ok: false, message: SIGNUP_NEEDS_INVITE_MESSAGE })
    expect(SIGNUP_NEEDS_INVITE_MESSAGE).toMatch(/invite link/)
    expect(SIGNUP_NEEDS_INVITE_MESSAGE).toMatch(/Google/)
  })

  it('refuses implausible tokens', () => {
    expect(signupInviteGuard(jar({ [WORKSPACE_INVITE_COOKIE]: 'x', [PLATFORM_INVITE_COOKIE]: 'has space here' })).ok).toBe(false)
  })

  it('accepts a workspace or platform token', () => {
    expect(signupInviteGuard(jar({ [WORKSPACE_INVITE_COOKIE]: 'abcdefgh1234' }))).toEqual({
      ok: true,
      workspaceToken: 'abcdefgh1234',
      platformToken: null,
    })
    expect(signupInviteGuard(jar({ [PLATFORM_INVITE_COOKIE]: 'platformtok99' }))).toMatchObject({ ok: true, platformToken: 'platformtok99' })
  })
})
