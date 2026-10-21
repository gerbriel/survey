/**
 * Pure URL helpers for sign-in redirects. No Next imports, so they are unit
 * tested directly.
 */

export const LOGIN_PATH = '/login'
export const PENDING_PATH = '/pending'
export const AUTH_CALLBACK_PATH = '/api/auth/callback'

/**
 * A `next` value is honored only when it is a same-origin path: starts with a
 * single slash, no scheme, no backslash, no protocol-relative `//host`.
 * Anything else falls back. Prevents open redirects through ?next=.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback
  if (next.length > 2000) return fallback
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback
  for (let i = 0; i < next.length; i++) if (next.charCodeAt(i) < 0x20) return fallback
  try {
    const u = new URL(next, 'http://dashboard.invalid')
    if (u.origin !== 'http://dashboard.invalid') return fallback
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}

export function loginPath(next?: string | null, error?: string): string {
  const params = new URLSearchParams()
  const safe = next ? safeNextPath(next, '') : ''
  if (safe && safe !== '/') params.set('next', safe)
  if (error) params.set('error', error)
  const q = params.toString()
  return q ? `${LOGIN_PATH}?${q}` : LOGIN_PATH
}

/**
 * Origin of the dashboard host, for OAuth redirect URLs. http under
 * `next dev`, https everywhere else (same rule as the /s/{key} redirect).
 */
export function dashboardOrigin(
  env: { DASHBOARD_HOST?: string; NODE_ENV?: string } = {
    DASHBOARD_HOST: process.env.DASHBOARD_HOST,
    NODE_ENV: process.env.NODE_ENV,
  },
): string {
  const host = env.DASHBOARD_HOST?.trim()
  if (!host) throw new Error('DASHBOARD_HOST is not set (see .env.example)')
  const protocol = env.NODE_ENV === 'development' ? 'http' : 'https'
  return `${protocol}://${host}`
}

export function authCallbackUrl(next?: string | null, origin: string = dashboardOrigin()): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin)
  const safe = safeNextPath(next, '')
  if (safe && safe !== '/') url.searchParams.set('next', safe)
  return url.toString()
}
