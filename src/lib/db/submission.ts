import { z } from 'zod'
import type { AdminClient } from '@/lib/supabase/types'
import { asJson, call, id, jsonObject } from './rpc'

/**
 * Public submission (migration 0012, doc 02 sections 5 and 6). Service role
 * only: the /api/public route handlers call these after Turnstile, honeypot
 * and rate limiting. SQL returns `{ok:false, code}` for expected outcomes
 * instead of raising, so those arrive as data, not as a DbError.
 */

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

export const submitPayload = z.object({
  /** The route maps validator mode partial to save and final to complete (R4). */
  action: z.enum(['save', 'complete']),
  survey_id: id,
  survey_version_id: id,
  idempotency_key: id,
  /** sha256 hex of the resume secret, never the secret itself. */
  resume_token_hash: sha256Hex.optional(),
  respondent_token: z.string().min(1).max(200).optional(),
  respondent_hash: z.string().max(64).optional(),
  /** {question_key: value} */
  answers: jsonObject,
  /** Computed by the route with the doc 03 engine. */
  visible_keys: z.array(z.string()),
  metadata: jsonObject.default({}),
  ip: z.string().max(64).optional(),
  file_ids: z.array(id).default([]),
  started_at: z.string().optional(),
  last_question_key: z.string().optional(),
})

export type SubmitPayload = z.input<typeof submitPayload>

export type SubmitFailureCode =
  | 'invalid_request'
  | 'not_found'
  | 'survey_closed'
  | 'not_open_yet'
  | 'cap_reached'
  | 'token_invalid'
  | 'token_used'
  | 'validation_failed'

export type SubmitResult =
  | {
      ok: true
      response_id: string
      /** Plain resume secret, returned once on the first save only. */
      resume_token?: string
      score?: number
      score_max?: number
    }
  | { ok: false; code: SubmitFailureCode; field_errors?: Record<string, string>; response_id?: string }

/** One entry point for save and complete. Idempotent by idempotency_key. */
export function submitResponse(client: AdminClient, payload: SubmitPayload) {
  return call(
    submitPayload,
    payload,
    (v) => client.rpc('submit_response', { p_payload: asJson(v) }),
    (d): SubmitResult => d as unknown as SubmitResult,
  )
}

export const createUploadPayload = z.object({
  survey_id: id,
  survey_version_id: id,
  question_key: z.string().regex(/^q_[a-z0-9]{8}$/),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().min(1).max(200),
  resume_token_hash: sha256Hex.optional(),
})

export type CreateUploadResult =
  | { ok: true; file_id: string; object_path: string }
  | {
      ok: false
      code: 'invalid_request' | 'not_found' | 'not_open_yet' | 'survey_closed' | 'file_size' | 'file_type' | 'file_count'
    }

/** Inserts a pending response_files row; the route then mints the signed upload URL for object_path. */
export function createUpload(client: AdminClient, payload: z.input<typeof createUploadPayload>) {
  return call(
    createUploadPayload,
    payload,
    (v) => client.rpc('create_upload', { p_payload: asJson(v) }),
    (d): CreateUploadResult => d as unknown as CreateUploadResult,
  )
}

export const rateLimitInput = z.object({
  bucket: z.string().min(1).max(64),
  key: z.string().min(1).max(200),
  /** A Postgres interval, for example '1 hour' or '10 minutes'. At most 1 day. */
  window: z.string().min(1).max(40),
  max: z.number().int().min(1),
})

/** Sliding window. true means allowed (and recorded); false means over the limit. */
export function rateLimitHit(client: AdminClient, input: z.input<typeof rateLimitInput>) {
  return call(
    rateLimitInput,
    input,
    (v) => client.rpc('rate_limit_hit', { p_bucket: v.bucket, p_key: v.key, p_window: v.window, p_max: v.max }),
    (d): boolean => d === true,
  )
}
