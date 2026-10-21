import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { insertAbuseReport, type ABUSE_REASONS } from '@/lib/db/admin'
import { clientIp, json, readJsonBody } from './http'
import { resolveSurvey } from './load'
import { checkRateLimits, hashIp, RATE_LIMITS, rateLimitSecret } from './ratelimit'
import { verifyTurnstile } from './turnstile'

/**
 * POST /api/public/report (doc 02 section 9.1). Honeypot, rate limit,
 * Turnstile, then one insert into abuse_reports with the service role. An
 * unknown or draft slug is stored with a null survey id, never rejected, and
 * every outcome after validation answers the same way, so the form never
 * confirms which slugs exist.
 */

export const FORM_REASONS = ['spam', 'phishing', 'sensitive_data', 'harassment', 'illegal', 'other'] as const

/**
 * Decision: the form offers doc 02's reasons; the abuse_reports check
 * constraint (migration 0010) allows four values, so spam and illegal content
 * are stored as `other` with the chosen label prefixed to the details.
 */
export function storedReason(reason: (typeof FORM_REASONS)[number]): { reason: (typeof ABUSE_REASONS)[number]; prefix: string | null } {
  switch (reason) {
    case 'spam':
      return { reason: 'other', prefix: 'Spam' }
    case 'illegal':
      return { reason: 'other', prefix: 'Illegal content' }
    default:
      return { reason, prefix: null }
  }
}

const reportBody = z.object({
  slug: z.string().trim().max(100).default(''),
  reason: z.enum(FORM_REASONS),
  details: z.string().trim().max(2000).optional(),
  contact: z.string().trim().max(200).optional(),
  turnstileToken: z.string().max(2048).optional(),
  website: z.string().max(1000),
})

const RECEIVED = { ok: true }

export async function handleReport(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req, reportBody, 16 * 1024)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (body.website !== '') return json(RECEIVED)

  const admin = createAdminClient()
  const ip = clientIp(req.headers)
  const ipHash = hashIp(ip, rateLimitSecret())
  const rl = await checkRateLimits(admin, [{ rule: RATE_LIMITS.report, key: ipHash }])
  if (!rl.ok) return json({ ok: false, code: 'rate_limited', retryAfter: rl.retryAfter }, 429, { 'retry-after': String(rl.retryAfter) })

  const t = await verifyTurnstile({ token: body.turnstileToken, ip, action: 'report' })
  if (!t.ok) return json({ ok: false, code: 'captcha_failed' }, 403)

  const slug = body.slug.toLowerCase()
  const survey = slug ? await resolveSurvey(slug) : null
  const { reason, prefix } = storedReason(body.reason)
  const details = [prefix, body.details || null].filter(Boolean).join(': ') || null
  const r = await insertAbuseReport(admin, {
    survey_id: survey?.survey_id ?? null,
    workspace_id: survey?.workspace_id ?? null,
    slug_text: slug,
    reason,
    details: details ? details.slice(0, 2000) : null,
    reporter_contact: body.contact || null,
    ip_hash: ipHash,
  })
  if (!r.ok) {
    console.error('[public] abuse report insert failed', r.error.code)
    return json({ ok: false, code: 'server_error' }, 500)
  }
  return json(RECEIVED)
}
