/**
 * Thank-you redirect (doc 02 section 10): https only, checked with new URL
 * at render time again even though publish validated it. Optional "pass
 * hidden fields" appends the captured hidden fields as query params without
 * overwriting params the URL already has.
 */

export const MAX_REDIRECT_DELAY_SECONDS = 10

export function safeRedirectUrl(
  url: string | null | undefined,
  opts: { hidden?: Record<string, string>; passParams?: boolean } = {},
): string | null {
  if (!url || typeof url !== 'string') return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (opts.passParams && opts.hidden) {
    for (const [k, v] of Object.entries(opts.hidden)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v)
    }
  }
  return u.toString()
}

/** 0 to 10 seconds; anything else clamps. */
export function redirectDelaySeconds(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0
  return Math.min(Math.max(n, 0), MAX_REDIRECT_DELAY_SECONDS)
}
