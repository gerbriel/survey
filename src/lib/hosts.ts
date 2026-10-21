/**
 * Hostname routing rules shared by `src/proxy.ts` and the two root layouts.
 *
 * Pure functions, no Next imports, so they are unit tested directly
 * (tests/unit/hosts.test.ts). See docs/02-public-delivery.md section 1 and
 * ruling R15 in docs/00-decisions.md for why there are two hostnames.
 */

export type HostKind = 'public' | 'dashboard' | 'unknown'

/** Lowercase and drop the port, so `S.localhost:3000` and `s.localhost` compare equal. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return ''
  return host.trim().toLowerCase().replace(/:\d+$/, '')
}

export function classifyHost(
  host: string | null | undefined,
  env: { DASHBOARD_HOST?: string; PUBLIC_HOST?: string },
): HostKind {
  const h = normalizeHost(host)
  if (!h) return 'unknown'
  if (env.PUBLIC_HOST && h === normalizeHost(env.PUBLIC_HOST)) return 'public'
  if (env.DASHBOARD_HOST && h === normalizeHost(env.DASHBOARD_HOST)) return 'dashboard'
  return 'unknown'
}

/**
 * First path segments that belong to the (dashboard) group. A slug or alias
 * pattern would otherwise match `/login` or `/admin` on the public host and
 * render a dashboard page there, because static routes beat `[key]`.
 * Aliases must never take one of these names (doc 02 section 2 reserved list).
 */
export const DASHBOARD_SEGMENTS = ['w', 'admin', 'login', 'pending', 'invite', 'auth', 'dev', 'welcome', 'join'] as const

/**
 * Internal path the public host's `/` is rewritten to. The dashboard owns the
 * real `/` route; two route groups cannot both define it. The folder is
 * `src/app/(public)/%5Fhome`, which serves `/_home`. A leading underscore can
 * never be a slug or alias, so this cannot shadow a survey.
 */
export const PUBLIC_HOME_PATH = '/_home'

/** `/{slug}` or `/{alias}`: lowercase, 3 to 64 chars, inner hyphens only. */
const KEY_RE = /^\/[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const PUBLIC_ALLOW: RegExp[] = [
  /^\/$/,
  KEY_RE,
  /^\/r\/[A-Za-z0-9_-]+$/, // shared report link (doc 04, R15)
  /^\/api\/public\//,
  /^\/(robots\.txt|favicon\.ico)$/,
]

function firstSegment(path: string): string {
  return path.split('/')[1] ?? ''
}

export function isPublicPathAllowed(path: string): boolean {
  if ((DASHBOARD_SEGMENTS as readonly string[]).includes(firstSegment(path))) return false
  return PUBLIC_ALLOW.some((r) => r.test(path))
}

export function isDashboardPathAllowed(path: string, opts: { dev: boolean }): boolean {
  if (path === '/') return true
  if (path === '/favicon.ico' || path === '/robots.txt') return true
  if (path.startsWith('/api/public/')) return false
  if (path.startsWith('/api/')) return true
  const seg = firstSegment(path)
  if (seg === 'dev') return opts.dev // /dev/renderer and friends never ship
  return (DASHBOARD_SEGMENTS as readonly string[]).includes(seg)
}

/** `/s/{key}` on the dashboard host: returns the public URL to 302 to, or null. */
export function publicRedirectTarget(
  path: string,
  search: string,
  publicHost: string,
  protocol: 'http' | 'https',
): string | null {
  if (!path.startsWith('/s/')) return null
  const key = path.slice(3)
  if (!KEY_RE.test(`/${key}`)) return null
  return `${protocol}://${publicHost}/${key}${search}`
}
