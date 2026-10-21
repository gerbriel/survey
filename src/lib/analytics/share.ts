import 'server-only'
import { createHash } from 'node:crypto'
import { sharedReportPayload } from '@/lib/db/reports'
import { rateLimitHit } from '@/lib/db/submission'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeSharedPayload, SHARE_TOKEN_RE, type SafeSharedPayload } from './share-payload'

/**
 * Server side of the public /r/[token] page (doc 04 section 5.4). The page
 * lives on PUBLIC_HOST and may not import the admin client, so it calls these.
 *
 * All validation (exists, not revoked, not expired, password) happens inside
 * shared_report_payload, which derives report, survey and workspace from the
 * share row. The single extra read here, shareNeedsPassword, only tells the
 * page whether to draw a password prompt instead of a 404.
 */
export { shareCookieName, sealPassword, unsealPassword } from './share-payload'

export function isShareToken(token: string): boolean {
  return SHARE_TOKEN_RE.test(token)
}

/** Secret for the password cookie. Decision: REPORT_SHARE_SECRET, else derived from the service role key. */
export function shareCookieSecret(): string {
  const s = process.env.REPORT_SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('REPORT_SHARE_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set')
  return s
}

export type ShareGate = 'not_found' | 'needs_password' | 'open'

/**
 * Whether a live share exists and has a password. Unknown, revoked and
 * expired all return not_found. Reads one row with the service role; the
 * hash itself never leaves this function.
 * TODO(foundation): a SECURITY DEFINER `report_share_gate(p_token)` would keep
 * this read in SQL; until then it is a single filtered select.
 */
export async function shareGate(token: string): Promise<ShareGate> {
  if (!isShareToken(token)) return 'not_found'
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('report_shares')
      .select('password_hash, revoked_at, expires_at')
      .eq('token', token)
      .maybeSingle()
    if (error || !data || data.revoked_at) return 'not_found'
    if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) return 'not_found'
    return data.password_hash ? 'needs_password' : 'open'
  } catch {
    return 'not_found'
  }
}

/** The aggregate payload, sanitized against the allow-list, or null (same 404 for every failure). */
export async function loadSharedReport(token: string, password: string | null): Promise<SafeSharedPayload | null> {
  if (!isShareToken(token)) return null
  const r = await sharedReportPayload(createAdminClient(), { token, password })
  if (!r.ok || !r.data) return null
  return sanitizeSharedPayload(r.data)
}

/** 5 password attempts per 15 minutes per token and IP. The IP is hashed for the key, never stored. */
export async function allowPasswordAttempt(token: string, ip: string): Promise<boolean> {
  const key = createHash('sha256').update(`${token}:${ip}`).digest('hex').slice(0, 64)
  const r = await rateLimitHit(createAdminClient(), { bucket: 'share_password', key, window: '15 minutes', max: 5 })
  return r.ok && r.data
}
