import { z } from 'zod'
import { EVENT_TYPES } from '@/lib/db/events'

/**
 * Beacon payload accepted by POST /api/public/events (doc 04 section 3).
 * Pure zod, no server imports, so Phase 2C's client queue can import the type.
 *
 * ACCEPTED SCHEMA (lenient; reconcile with Phase 2C):
 *
 *   {
 *     survey_id: uuid,
 *     survey_version_id: uuid,
 *     rid: string, 8 to 64 chars of [A-Za-z0-9_-]   (respondent_hash also accepted)
 *     events: [                                       1 to 50 entries
 *       {
 *         type: 'view' | 'start' | 'question_view' | 'question_answer'
 *             | 'page_next' | 'page_back' | 'abandon' | 'file_upload',
 *         question_key?: 'q_' + 8 of [a-z0-9]  (anything else is dropped to null),
 *         occurred_at?: ISO 8601 string (SQL clamps to 10 minutes of server time),
 *         meta?: object (allow-listed keys below, everything else stripped)
 *       }
 *     ]
 *   }
 *
 * Body may arrive as application/json or text/plain (navigator.sendBeacon
 * with a Blob). At most 64 KB. Events that fail validation are dropped one by
 * one; `complete` is always refused (submit_response emits it server side).
 * The batch is refused as a whole only when the envelope is invalid. The
 * route answers 204 either way.
 *
 * meta allow-list (doc 04 section 3.2): device (mobile | tablet | desktop),
 * referrer_host, utm (object of utm_* strings), page, position, from_page,
 * to_page, size_bucket, mime, last_question_key. Strings are cut to 200
 * characters. Never answer values, emails or free text.
 */

export const BEACON_MAX_EVENTS = 50
export const BEACON_MAX_BYTES = 64 * 1024

const QKEY = /^q_[a-z0-9]{8}$/

export const beaconEventType = z.enum(EVENT_TYPES)

const shortStr = z.string().transform((s) => s.slice(0, 200))
const smallInt = z.coerce.number().int().min(0).max(10_000)

export const beaconMeta = z
  .object({
    device: z.enum(['mobile', 'tablet', 'desktop']).optional().catch(undefined),
    referrer_host: shortStr.optional().catch(undefined),
    utm: z
      .record(z.string(), z.unknown())
      .transform((o) =>
        Object.fromEntries(
          Object.entries(o)
            .filter(([k, v]) => /^utm_(source|medium|campaign|term|content)$/.test(k) && typeof v === 'string')
            .map(([k, v]) => [k, (v as string).slice(0, 200)]),
        ),
      )
      .optional()
      .catch(undefined),
    page: smallInt.optional().catch(undefined),
    position: smallInt.optional().catch(undefined),
    from_page: smallInt.optional().catch(undefined),
    to_page: smallInt.optional().catch(undefined),
    size_bucket: shortStr.optional().catch(undefined),
    mime: shortStr.optional().catch(undefined),
    last_question_key: z.string().regex(QKEY).optional().catch(undefined),
  })
  .strip()
  .transform((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)))

export const beaconEvent = z.object({
  type: beaconEventType,
  question_key: z
    .string()
    .nullish()
    .transform((k) => (k && QKEY.test(k) ? k : null)),
  occurred_at: z
    .string()
    .max(40)
    .nullish()
    .transform((t) => (t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : undefined)),
  meta: beaconMeta.optional().catch(undefined),
})

export const beaconEnvelope = z
  .object({
    survey_id: z.guid(),
    survey_version_id: z.guid(),
    rid: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    respondent_hash: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    events: z.array(z.unknown()).min(1).max(BEACON_MAX_EVENTS),
  })
  .refine((b) => Boolean(b.rid ?? b.respondent_hash), { message: 'rid is required', path: ['rid'] })

export type BeaconEnvelope = z.input<typeof beaconEnvelope>
export type BeaconEvent = z.input<typeof beaconEvent>

export type ParsedBeacon = {
  survey_id: string
  survey_version_id: string
  rid: string
  events: z.output<typeof beaconEvent>[]
  dropped: number
}

/** Envelope must parse; each event is parsed alone and dropped on failure. */
export function parseBeacon(body: unknown): ParsedBeacon | null {
  const env = beaconEnvelope.safeParse(body)
  if (!env.success) return null
  const events: z.output<typeof beaconEvent>[] = []
  let dropped = 0
  for (const e of env.data.events) {
    const p = beaconEvent.safeParse(e)
    if (p.success) events.push(p.data)
    else dropped++
  }
  return {
    survey_id: env.data.survey_id,
    survey_version_id: env.data.survey_version_id,
    rid: (env.data.rid ?? env.data.respondent_hash)!,
    events,
    dropped,
  }
}
