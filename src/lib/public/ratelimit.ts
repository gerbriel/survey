import 'server-only'
import { createHmac } from 'node:crypto'
import { rateLimitHit } from '@/lib/db/submission'
import type { AdminClient } from '@/lib/supabase/types'
import { rateKeyIp } from './http'

/**
 * Postgres sliding-window rate limits (doc 02 section 5.2). The raw IP is
 * never stored: buckets are keyed by HMAC-SHA256(ip, RATE_LIMIT_SECRET +
 * utcDate) truncated to 16 bytes, so the same IP hashes differently every
 * UTC day and the table cannot be joined across days.
 */

export type RateLimitRule = { bucket: string; window: string; windowSeconds: number; max: number }

/** Doc 02 section 5.2 table, plus the report and resume buckets. */
export const RATE_LIMITS = {
  // S9 (R17): sized for an office NAT, keyed by IP plus survey id; Turnstile is the real gate.
  submitCreate: { bucket: 'submit:create', window: '10 minutes', windowSeconds: 600, max: 60 },
  submitSave: { bucket: 'submit:save', window: '1 minute', windowSeconds: 60, max: 60 },
  /** max is replaced by effective_limits(workspace_id).rate_limit_per_hour when known. */
  submitComplete: { bucket: 'submit:complete', window: '1 hour', windowSeconds: 3600, max: 20 },
  submitSurvey: { bucket: 'submit:survey', window: '1 minute', windowSeconds: 60, max: 600 },
  uploadMint: { bucket: 'upload:mint', window: '10 minutes', windowSeconds: 600, max: 30 },
  report: { bucket: 'report', window: '1 hour', windowSeconds: 3600, max: 5 },
  // Decision: resume lookups share the upload budget size; a resume token is a
  // 256-bit secret, so this only bounds load, not guessing.
  resume: { bucket: 'resume', window: '10 minutes', windowSeconds: 600, max: 30 },
  // S11 (R17, public M3): the events beacon, per IP and per survey, ahead of the rid bucket.
  eventsIp: { bucket: 'events_ip', window: '1 minute', windowSeconds: 60, max: 120 },
  eventsSurvey: { bucket: 'events_survey', window: '1 minute', windowSeconds: 60, max: 10000 },
  // L7: generated link previews, per IP.
  og: { bucket: 'og', window: '1 minute', windowSeconds: 60, max: 60 },
} as const satisfies Record<string, RateLimitRule>

const DEV_SECRET = 'dev-only-rate-limit-secret'
let warned = false

/** RATE_LIMIT_SECRET, or a fixed dev secret outside production (with a warning). */
export function rateLimitSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.RATE_LIMIT_SECRET
  if (s && s.length >= 16) return s
  if (env.NODE_ENV === 'production') throw new Error('RATE_LIMIT_SECRET is not set (at least 16 characters)')
  if (!warned) {
    warned = true
    console.warn('[public] RATE_LIMIT_SECRET is not set; using a fixed development secret.')
  }
  return DEV_SECRET
}

/** YYYY-MM-DD in UTC. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * HMAC-SHA256(ip, secret + utcDate), first 16 bytes as 32 hex chars.
 * S9 (R17): IPv6 is reduced to its /64 prefix before hashing (rateKeyIp).
 */
export function hashIp(ip: string, secret: string, now: Date = new Date()): string {
  return createHmac('sha256', secret + utcDate(now)).update(rateKeyIp(ip)).digest('hex').slice(0, 32)
}

export type RateCheck = { rule: RateLimitRule; key: string; max?: number }

export type RateOutcome = { ok: true } | { ok: false; retryAfter: number }

/**
 * Runs the checks in order and stops at the first one over its limit.
 * Decision: a database failure here fails open (logged). Rate limiting is a
 * cost control; Turnstile and submit_response still run.
 */
export async function checkRateLimits(admin: AdminClient, checks: RateCheck[]): Promise<RateOutcome> {
  for (const c of checks) {
    const r = await rateLimitHit(admin, { bucket: c.rule.bucket, key: c.key, window: c.rule.window, max: c.max ?? c.rule.max })
    if (!r.ok) {
      console.error('[public] rate_limit_hit failed', c.rule.bucket, r.error.code)
      continue
    }
    if (r.data === false) return { ok: false, retryAfter: c.rule.windowSeconds }
  }
  return { ok: true }
}
