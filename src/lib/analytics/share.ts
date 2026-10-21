import 'server-only'
import { createHash } from 'node:crypto'
import { reportShareGate, sharedReportPayload, type ReportShareGateStatus } from '@/lib/db/reports'
import { rateLimitHit } from '@/lib/db/submission'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateKeyIp } from '@/lib/public/http'
import { sanitizeSharedPayload, SHARE_TOKEN_RE, type SafeSharedPayload } from './share-payload'

/**
 * Server side of the public /r/[token] page (doc 04 section 5.4). The page
 * lives on PUBLIC_HOST and may not import the admin client, so it calls these.
 *
 * All validation (exists, not revoked, not expired, password) happens in SQL:
 * report_share_gate decides between 404, password prompt and open, and
 * counts the view; shared_report_payload derives report, survey and
 * workspace from the share row and returns aggregates only.
 */
export { shareCookieName, sealPassword, unsealPassword } from './share-payload'

export function isShareToken(token: string): boolean {
  return SHARE_TOKEN_RE.test(token)
}

/**
 * Secret for the password cookie. I4: REPORT_SHARE_SECRET is required in
 * production (at least 32 characters) with no fallback to the service role
 * key, so rotating that key never logs out share viewers and the two secrets
 * never share material. Outside production a fixed dev secret is used.
 */
export function shareCookieSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.REPORT_SHARE_SECRET
  if (s && s.length >= 32) return s
  if (env.NODE_ENV === 'production') throw new Error('REPORT_SHARE_SECRET is not set (at least 32 characters)')
  return 'dev-only-report-share-secret-do-not-use'
}

export type ShareGate = ReportShareGateStatus

/**
 * report_share_gate (migration 0018), called on every page load: not_found
 * for an unknown, revoked or expired token, needs_password when the share has
 * a password and none or a wrong one was given, open otherwise. Every open
 * counts one view.
 */
export async function shareGate(token: string, password: string | null): Promise<ShareGate> {
  if (!isShareToken(token)) return 'not_found'
  try {
    const r = await reportShareGate(createAdminClient(), { token, password })
    return r.ok ? r.data.status : 'not_found'
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

/**
 * 5 password attempts per 15 minutes per token and IP, plus 50 per hour per
 * token from anywhere. The IP is hashed for the key, never stored.
 * S9 (R17, public M1): IPv6 keys on the /64 prefix, and the per-token
 * ceiling bounds guessing even across address rotation.
 */
export async function allowPasswordAttempt(token: string, ip: string): Promise<boolean> {
  const admin = createAdminClient()
  const key = createHash('sha256').update(`${token}:${rateKeyIp(ip)}`).digest('hex').slice(0, 64)
  const r = await rateLimitHit(admin, { bucket: 'share_password', key, window: '15 minutes', max: 5 })
  if (!r.ok || !r.data) return false
  const tokenKey = createHash('sha256').update(token).digest('hex').slice(0, 64)
  const t = await rateLimitHit(admin, { bucket: 'share_password_token', key: tokenKey, window: '1 hour', max: 50 })
  return t.ok && t.data
}
