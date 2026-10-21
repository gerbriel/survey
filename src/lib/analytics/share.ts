import 'server-only'
import { createHash } from 'node:crypto'
import { reportShareGate, sharedReportPayload, type ReportShareGateStatus } from '@/lib/db/reports'
import { rateLimitHit } from '@/lib/db/submission'
import { createAdminClient } from '@/lib/supabase/admin'
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

/** Secret for the password cookie. Decision: REPORT_SHARE_SECRET, else derived from the service role key. */
export function shareCookieSecret(): string {
  const s = process.env.REPORT_SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('REPORT_SHARE_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set')
  return s
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

/** 5 password attempts per 15 minutes per token and IP. The IP is hashed for the key, never stored. */
export async function allowPasswordAttempt(token: string, ip: string): Promise<boolean> {
  const key = createHash('sha256').update(`${token}:${ip}`).digest('hex').slice(0, 64)
  const r = await rateLimitHit(createAdminClient(), { bucket: 'share_password', key, window: '15 minutes', max: 5 })
  return r.ok && r.data
}
