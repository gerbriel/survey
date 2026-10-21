/** Public share link on PUBLIC_HOST (R15): /r/{token}. */
export function publicReportUrl(token: string): string {
  const host = process.env.PUBLIC_HOST ?? 'localhost'
  return `${process.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}/r/${token}`
}

export function shareState(s: { revoked_at: string | null; expires_at: string | null }, now: number = Date.now()): 'active' | 'expired' | 'revoked' {
  if (s.revoked_at) return 'revoked'
  if (s.expires_at && Date.parse(s.expires_at) <= now) return 'expired'
  return 'active'
}
