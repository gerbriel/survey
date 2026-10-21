import type { CookieOptions } from '@supabase/ssr'
import { isDevRuntime } from '@/lib/supabase/cookies'

/**
 * Invite tokens ride an HttpOnly cookie through Google OAuth, because OAuth
 * cannot carry them in signup metadata (doc 01 section 12, doc 05 section 3).
 * The /invite/{token} and /join/{token} pages (Phase 2A) set the cookie from
 * a server action or route handler; the auth callback reads it, calls the SQL
 * claim function, and deletes it.
 *
 * Host-only like the auth cookies: no Domain attribute.
 */
export const PLATFORM_INVITE_COOKIE = 'survey_platform_invite'
export const WORKSPACE_INVITE_COOKIE = 'survey_workspace_invite'

export type InviteKind = 'platform' | 'workspace'

export function inviteCookieName(kind: InviteKind): string {
  return kind === 'platform' ? PLATFORM_INVITE_COOKIE : WORKSPACE_INVITE_COOKIE
}

/** One hour is enough to finish a Google sign-in; the invite itself expires in SQL. */
export const INVITE_COOKIE_MAX_AGE = 60 * 60

export function inviteCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptions {
  return {
    httpOnly: true,
    secure: !isDevRuntime(nodeEnv),
    sameSite: 'lax',
    path: '/',
    maxAge: INVITE_COOKIE_MAX_AGE,
  }
}

/** Tokens are gen_token(24) style; anything else is not worth a round trip. */
export function isPlausibleInviteToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.length >= 8 && token.length <= 200 && /^[A-Za-z0-9_-]+$/.test(token)
}

export const SIGNUP_NEEDS_INVITE_MESSAGE =
  'Password sign-up needs an invite link. Open the invite link you were sent, then create your account, or sign in with Google.'

export type SignupInviteGuard =
  | { ok: true; workspaceToken: string | null; platformToken: string | null }
  | { ok: false; message: string }

/**
 * S1 (R18): a password signup's email is unverified (confirmations are off),
 * so it is accepted only with an invite token from the invite cookie. Without
 * a plausible token the signup action refuses before calling Supabase Auth.
 * Google sign-in does not pass through here.
 */
export function signupInviteGuard(read: (name: string) => string | undefined): SignupInviteGuard {
  const w = read(WORKSPACE_INVITE_COOKIE)
  const p = read(PLATFORM_INVITE_COOKIE)
  const workspaceToken = isPlausibleInviteToken(w) ? w : null
  const platformToken = isPlausibleInviteToken(p) ? p : null
  if (!workspaceToken && !platformToken) return { ok: false, message: SIGNUP_NEEDS_INVITE_MESSAGE }
  return { ok: true, workspaceToken, platformToken }
}
