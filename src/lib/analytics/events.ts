import 'server-only'
import { recordEvents } from '@/lib/db/events'
import { rateLimitHit } from '@/lib/db/submission'
import { createAdminClient } from '@/lib/supabase/admin'
import { BEACON_MAX_BYTES, parseBeacon } from './beacon-schema'

/**
 * Beacon ingest for POST /api/public/events (doc 04 section 3.3). Service
 * role, called only from that route. The accepted payload is documented in
 * beacon-schema.ts; re-exported here for Fable to reconcile with Phase 2C.
 *
 * Never trusts respondent identity: the rid is an opaque per-tab random id,
 * stored as respondent_hash and nothing else. No IP or user agent is kept.
 * record_events (migration 0009) re-checks that the survey resolves publicly
 * and the version is published, drops unknown types and `complete`, and
 * clamps occurred_at.
 *
 * Decision: one rate limit check per batch, 300 batches per rid per hour
 * (bucket "events_rid"). With at most 50 events per batch this is lenient;
 * the survey wide 10,000 per minute limit of doc 04 is not enforced in v1 to
 * keep each beacon to two database calls.
 */
export { BEACON_MAX_BYTES, BEACON_MAX_EVENTS, beaconEnvelope, beaconEvent, parseBeacon } from './beacon-schema'

export const RID_LIMIT = { window: '1 hour', max: 300 } as const

export type IngestOutcome = 'recorded' | 'invalid' | 'rate_limited' | 'empty' | 'error'

export async function ingestBeacon(raw: string): Promise<{ outcome: IngestOutcome; inserted: number }> {
  if (raw.length === 0 || raw.length > BEACON_MAX_BYTES) return { outcome: 'invalid', inserted: 0 }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return { outcome: 'invalid', inserted: 0 }
  }
  const batch = parseBeacon(body)
  if (!batch) return { outcome: 'invalid', inserted: 0 }
  if (batch.events.length === 0) return { outcome: 'empty', inserted: 0 }

  const admin = createAdminClient()
  const allowed = await rateLimitHit(admin, {
    bucket: 'events_rid',
    key: `${batch.survey_id}:${batch.rid}`,
    window: RID_LIMIT.window,
    max: RID_LIMIT.max,
  })
  if (!allowed.ok) return { outcome: 'error', inserted: 0 }
  if (!allowed.data) return { outcome: 'rate_limited', inserted: 0 }

  const r = await recordEvents(
    admin,
    batch.events.map((e) => ({
      survey_id: batch.survey_id,
      survey_version_id: batch.survey_version_id,
      respondent_hash: batch.rid,
      type: e.type,
      ...(e.question_key ? { question_key: e.question_key } : {}),
      ...(e.occurred_at ? { occurred_at: e.occurred_at } : {}),
      ...(e.meta ? { meta: e.meta } : {}),
    })),
  )
  if (!r.ok) return { outcome: 'error', inserted: 0 }
  return { outcome: 'recorded', inserted: r.data }
}
