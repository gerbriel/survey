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
