/**
 * Public link helpers for the share page (doc 02 sections 2 and 8). Pure.
 */

/** http only for *.localhost dev hosts (doc 02 section 1); https everywhere else. */
export function publicOrigin(publicHost: string): string {
  const host = publicHost.trim().replace(/\/+$/, '')
  const bare = host.replace(/:\d+$/, '')
  const proto = bare === 'localhost' || bare.endsWith('.localhost') ? 'http' : 'https'
  return `${proto}://${host}`
}

export function publicSurveyUrl(publicHost: string, key: string, opts: { tagQr?: boolean } = {}): string {
  const url = `${publicOrigin(publicHost)}/${encodeURIComponent(key)}`
  return opts.tagQr ? `${url}?utm_medium=qr` : url
}

/** Client-side mirror of the SQL alias rules (migration 0005 set_survey_alias). SQL stays the authority. */
export function aliasProblem(alias: string, reserved: readonly string[]): string | null {
  const a = alias.trim().toLowerCase()
  if (a === '') return null
  if (a.length < 3 || a.length > 60) return 'Use 3 to 60 characters.'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a)) return 'Use lowercase letters, digits and single hyphens between them.'
  if (/^[a-z0-9]{10}$/.test(a)) return 'Ten letters and digits look like a survey link code. Add a hyphen or change the length.'
  if (reserved.includes(a)) return 'This word is reserved for the app.'
  return null
}

/**
 * Mirrors reserved_public_segments() as last defined (migration 0018, which
 * added 'welcome'). Pinned by src/lib/builder/__tests__/reserved.test.ts.
 */
export const RESERVED_ALIASES = [
  // DASHBOARD_SEGMENTS (src/lib/hosts.ts)
  'w', 'admin', 'login', 'pending', 'invite', 'auth', 'dev', 'welcome', 'join',
  // docs/01 section 3
  'api', 's', 'r', 'f', 'e', 'logout', 'app', 'www', 'static', 'well-known', 'privacy',
  // docs/02 section 2 (public host routes and files)
  'report', 'robots', 'favicon',
] as const

/** Public URL for an object in the public-assets bucket. Accepts paths with or without the bucket prefix. */
export function publicAssetUrl(supabaseUrl: string | undefined, path: string | null | undefined): string | null {
  if (!supabaseUrl || !path) return null
  if (/^https?:\/\//.test(path)) return path
  const clean = path.replace(/^\/+/, '').replace(/^public-assets\//, '')
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/public-assets/${clean.split('/').map(encodeURIComponent).join('/')}`
}
