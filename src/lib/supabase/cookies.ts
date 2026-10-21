import type { CookieOptions, CookieOptionsWithName } from '@supabase/ssr'

/**
 * Cookie attributes for every Supabase auth cookie (R15, doc 02 section 1).
 *
 * Host-only: no Domain attribute, ever. A cookie without Domain is sent only
 * to the exact host that set it, which is DASHBOARD_HOST. Setting Domain to
 * the organization domain would also send the session to PUBLIC_HOST, where
 * workspace pixels and custom scripts run.
 *
 * Secure everywhere except `next dev` (plain http on survey.localhost).
 * SameSite Lax so the OAuth redirect back from Google still carries the PKCE
 * verifier cookie. Path / so every dashboard route sees the session.
 */
export function isDevRuntime(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'development'
}

/** Options handed to @supabase/ssr as `cookieOptions`. */
export function authCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptionsWithName {
  return { path: '/', sameSite: 'lax', secure: !isDevRuntime(nodeEnv) }
}

/**
 * Normalizes options for one cookie write. Whatever the library or a caller
 * passes, the Domain attribute is dropped and path, SameSite and Secure are
 * forced to the values above. maxAge, expires and httpOnly pass through, so
 * deletions (maxAge 0) still work.
 */
export function hostOnlyCookieOptions(
  options: CookieOptions | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CookieOptions {
  const { domain: _dropped, ...rest } = options ?? {}
  void _dropped
  return { ...rest, ...authCookieOptions(nodeEnv) }
}
