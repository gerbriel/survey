import { z } from 'zod'
import type { AdminClient, UserClient } from '@/lib/supabase/types'
import type { DbResult } from './errors'
import { asJson, call, id, jsonObject, readAll, type PageResult } from './rpc'

/**
 * Analytics events (migration 0009, doc 04 section 3). recordEvents is the
 * beacon, service role only: SQL silently drops unknown types, 'complete'
 * (only submit_response emits it), unpublished versions and surveys that do
 * not resolve publicly. readEvents is the member read for funnels (RLS).
 */
export const EVENT_TYPES = [
  'view',
  'start',
  'question_view',
  'question_answer',
  'page_next',
  'page_back',
  'abandon',
  'file_upload',
] as const

export const eventInput = z.object({
  survey_id: id,
  survey_version_id: id,
  respondent_hash: z.string().max(64).optional(),
  type: z.enum(EVENT_TYPES),
  question_key: z.string().optional(),
  occurred_at: z.string().optional(),
  meta: jsonObject.optional(),
})

export const recordEventsInput = z.array(eventInput).max(50)

/** Returns the number of events inserted. */
export function recordEvents(client: AdminClient, events: z.input<typeof recordEventsInput>) {
  return call(
    recordEventsInput,
    events,
    (v) => client.rpc('record_events', { p_events: asJson(v) }),
    (d): number => (typeof d === 'number' ? d : 0),
  )
}

/** An events row without the tenancy columns. */
export type EventLite = {
  respondent_hash: string | null
  type: string
  question_key: string | null
  occurred_at: string
  meta: Record<string, unknown>
}

export const readEventsInput = z.object({
  versionIds: z.array(id).min(1).max(50),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
  max: z.number().int().min(1).max(500_000).default(200_000),
})

/** Raw events of some versions in a window, paged (RLS: viewer and above). */
export async function readEvents(client: UserClient, input: z.input<typeof readEventsInput>): Promise<DbResult<EventLite[]>> {
  const parsed = readEventsInput.safeParse(input)
  if (!parsed.success) return call(readEventsInput, input, async () => ({ data: null, error: null }))
  const v = parsed.data
  return readAll((from, to) => {
    let q = client.from('events').select('respondent_hash, type, question_key, occurred_at, meta').in('survey_version_id', v.versionIds)
    if (v.from) q = q.gte('occurred_at', v.from)
    if (v.to) q = q.lt('occurred_at', v.to)
    return q.order('id').range(from, to) as unknown as PageResult<EventLite>
  }, v.max)
}
