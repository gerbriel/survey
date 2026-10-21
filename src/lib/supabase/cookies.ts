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

/**
 * S12 (public M4): the auth cookie name in production. Browsers accept a
 * `__Host-` cookie only when it is Secure, has Path=/ and no Domain, so a
 * script on PUBLIC_HOST cannot toss a parent-domain cookie with this name
 * into DASHBOARD_HOST. @supabase/ssr 0.12 takes the name through
 * `cookieOptions.name` (it becomes the storage key, so chunks are
 * `__Host-sb-auth.0`, `.1` and the PKCE verifier `__Host-sb-auth-code-verifier`).
 * Dev on plain http keeps the default name, since `__Host-` needs Secure.
 * Changing the name signs everyone out once at deploy.
 */
export const HOST_AUTH_COOKIE_NAME = '__Host-sb-auth'

export function authCookieName(nodeEnv: string | undefined = process.env.NODE_ENV): string | undefined {
  return nodeEnv === 'production' ? HOST_AUTH_COOKIE_NAME : undefined
}

/** Attributes for every auth cookie write (no name). */
function authCookieAttributes(nodeEnv: string | undefined): CookieOptions {
  return { path: '/', sameSite: 'lax', secure: !isDevRuntime(nodeEnv) }
}

/** Options handed to @supabase/ssr as `cookieOptions`. */
export function authCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptionsWithName {
  const name = authCookieName(nodeEnv)
  return name ? { name, ...authCookieAttributes(nodeEnv) } : authCookieAttributes(nodeEnv)
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
  // Next's cookies.set spreads options after the name, so a `name` here would
  // rename every chunk; it is dropped along with Domain.
  const { domain: _dropped, name: _name, ...rest } = (options ?? {}) as CookieOptionsWithName
  void _dropped
  void _name
  return { ...rest, ...authCookieAttributes(nodeEnv) }
}
