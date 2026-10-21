import { z } from 'zod'
import type { Json } from '@/types/db-helpers'
import type { AdminClient } from '@/lib/supabase/types'
import type { DbResult } from './errors'
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
      /** S4 (0019): set when an idempotency key was replayed; never carries a secret. */
      replayed?: boolean
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

export const responseFileCountInput = z.object({ surveyId: id, resumeTokenHash: sha256Hex })

/**
 * S10: files already held by the open partial a resume hash names, attached
 * plus pending (minted for it, migration 0019 pending_response_id). Null when
 * the hash names no open partial. create_upload enforces the same cap in SQL.
 */
export async function countResponseFiles(
  admin: AdminClient,
  input: z.input<typeof responseFileCountInput>,
): Promise<DbResult<number | null>> {
  const head = await call(responseFileCountInput, input, (v) =>
    admin
      .from('responses')
      .select('id')
      .eq('survey_id', v.surveyId)
      .eq('resume_token_hash', v.resumeTokenHash)
      .eq('status', 'partial')
      .maybeSingle(),
  )
  if (!head.ok) return head
  if (!head.data) return { ok: true, data: null }
  const responseId = (head.data as { id: string }).id
  const byResponse = z.object({ responseId: id })
  const attached = await call(byResponse, { responseId }, (v) =>
    admin
      .from('response_files')
      .select('id', { count: 'exact', head: true })
      .eq('response_id', v.responseId)
      .then((r) => ({ data: r.count ?? 0, error: r.error })),
  )
  if (!attached.ok) return attached
  const pending = await call(byResponse, { responseId }, (v) =>
    admin
      .from('response_files')
      .select('id', { count: 'exact', head: true })
      .eq('pending_response_id', v.responseId)
      .eq('status', 'pending')
      .then((r) => ({ data: r.count ?? 0, error: r.error })),
  )
  if (!pending.ok) return pending
  return { ok: true, data: Number(attached.data) + Number(pending.data) }
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

// ---------------------------------------------------------------------------
// Service role reads for the submit and resume handlers.
// ---------------------------------------------------------------------------

export type PublishedVersion = {
  id: string
  survey_id: string
  workspace_id: string
  version_no: number
  definition: Json
}

export const publishedVersionInput = z.object({ versionId: id, surveyId: id })

/** The full (server-only) definition of a published version of the survey. */
export function publishedVersion(admin: AdminClient, input: z.input<typeof publishedVersionInput>) {
  return call(
    publishedVersionInput,
    input,
    (v) =>
      admin
        .from('survey_versions')
        .select('id, survey_id, workspace_id, version_no, definition')
        .eq('id', v.versionId)
        .eq('survey_id', v.surveyId)
        .eq('status', 'published')
        .maybeSingle(),
    (row): PublishedVersion | null => (row ? (row as PublishedVersion) : null),
  )
}

export type ResumeRows = {
  response: {
    id: string
    survey_version_id: string
    metadata: Json
    last_question_key: string | null
    started_at: string
  }
  answers: {
    question_key: string
    value_text: string | null
    value_number: number | null
    value_date: string | null
    value_json: Json | null
  }[]
  files: { id: string; question_key: string; object_path: string; original_name: string; declared_size: number; declared_mime: string }[]
}

export const resumeStateInput = z.object({ surveyId: id, resumeTokenHash: sha256Hex })

/** An open partial by resume hash, with its answers and files. Null when unknown or complete. */
export async function resumeState(admin: AdminClient, input: z.input<typeof resumeStateInput>): Promise<DbResult<ResumeRows | null>> {
  const head = await call(resumeStateInput, input, (v) =>
    admin
      .from('responses')
      .select('id, survey_version_id, metadata, last_question_key, started_at')
      .eq('survey_id', v.surveyId)
      .eq('resume_token_hash', v.resumeTokenHash)
      .eq('status', 'partial')
      .maybeSingle(),
  )
  if (!head.ok) return head
  if (!head.data) return { ok: true, data: null }
  const response = head.data as ResumeRows['response']
  const byResponse = z.object({ responseId: id })
  const answers = await call(byResponse, { responseId: response.id }, (v) =>
    admin.from('answers').select('question_key, value_text, value_number, value_date, value_json').eq('response_id', v.responseId),
  )
  if (!answers.ok) return answers
  const files = await call(byResponse, { responseId: response.id }, (v) =>
    admin
      .from('response_files')
      .select('id, question_key, object_path, original_name, declared_size, declared_mime')
      .eq('response_id', v.responseId)
      .order('created_at'),
  )
  if (!files.ok) return files
  return {
    ok: true,
    data: {
      response,
      answers: (answers.data ?? []) as ResumeRows['answers'],
      files: (files.data ?? []) as ResumeRows['files'],
    },
  }
}
