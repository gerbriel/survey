import { z } from 'zod'
import type { AdminClient } from '@/lib/supabase/types'
import { asJson, call, id, jsonObject } from './rpc'

/**
 * Analytics beacon (migration 0009, doc 04 section 3). Service role only.
 * SQL silently drops unknown types, 'complete' (only submit_response emits
 * it), unpublished versions and surveys that do not resolve publicly.
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
