import 'server-only'
import { z } from 'zod'
import { countResponseFiles, createUpload } from '@/lib/db/submission'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UploadResponse } from '@/components/public/protocol'
import { clientIp, json, readJsonBody } from './http'
import { resolveSurvey, surveyContext } from './load'
import { checkRateLimits, hashIp, RATE_LIMITS, rateLimitSecret } from './ratelimit'
import { resumeHashOrNull, resumeTokenSchema } from './resume'
import { stateCode } from './submit'
import { verifyTurnstile } from './turnstile'

/**
 * POST /api/public/upload (doc 02 section 6). Mints a signed upload URL
 * into the private response-files bucket under the pending path that
 * create_upload chose ({workspace_id}/{survey_id}/pending/{upload_id}/{name}).
 * create_upload checks the question, effective_limits size and the MIME
 * allowlist, and with a resume token the per-response file count. The file
 * attaches to a response later in submit_response through file_ids.
 */

export const RESPONSE_FILES_BUCKET = 'response-files'
/** Hard cap from the global limits table; the client enforces it before a token exists. */
export const MAX_FILES_PER_RESPONSE = 20

const uploadBody = z.object({
  key: z.string().min(1).max(100),
  surveyId: z.guid(),
  versionId: z.guid(),
  questionKey: z.string().regex(/^q_[a-z0-9]{8}$/),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().min(1).max(200),
  /** S10: files the client already holds for this response. */
  fileCount: z.number().int().min(0).max(1000).optional(),
  resumeToken: resumeTokenSchema.optional(),
  turnstileToken: z.string().max(2048).optional(),
  website: z.string().max(1000).default(''),
})

const HTTP: Record<string, number> = {
  invalid_request: 400,
  captcha_failed: 403,
  not_found: 404,
  not_open_yet: 409,
  survey_closed: 409,
  cap_reached: 409,
  file_size: 422,
  file_type: 422,
  file_count: 422,
  rate_limited: 429,
  server_error: 500,
}

function fail(code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ ok: false, code, ...extra }, HTTP[code] ?? 400, headers)
}

export async function handleUpload(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req, uploadBody, 16 * 1024)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const key = body.key.toLowerCase()

  const survey = await resolveSurvey(key)
  if (!survey || survey.survey_id !== body.surveyId) return fail('not_found')
  const closed = stateCode(survey)
  if (closed) return fail(closed)
  if (body.website !== '') return fail('invalid_request')

  const admin = createAdminClient()
  const ip = clientIp(req.headers)
  const rl = await checkRateLimits(admin, [{ rule: RATE_LIMITS.uploadMint, key: hashIp(ip, rateLimitSecret()) }])
  if (!rl.ok) return fail('rate_limited', { retryAfter: rl.retryAfter }, { 'retry-after': String(rl.retryAfter) })

  // A valid resume token or a fresh Turnstile token (doc 02 section 6 step 1).
  const hash = resumeHashOrNull(body.resumeToken)
  if (!hash) {
    const t = await verifyTurnstile({ token: body.turnstileToken, ip, action: 'upload' })
    if (!t.ok) return fail('captcha_failed')
  }

  // S10: the per response file cap, client declared and, once a partial
  // exists, server counted (attached plus pending). create_upload enforces
  // the same cap in SQL (0019); this check refuses before a row is written.
  const ctx = await surveyContext(survey)
  const cap = ctx?.limits.max_files_per_response ?? MAX_FILES_PER_RESPONSE
  if ((body.fileCount ?? 0) >= cap) return fail('file_count')
  if (hash) {
    const counted = await countResponseFiles(admin, { surveyId: body.surveyId, resumeTokenHash: hash })
    if (!counted.ok) {
      // Fail open to SQL: create_upload counts again under a row lock.
      console.error('[public] response file count failed', counted.error.code)
    } else if (counted.data === null) {
      return fail('invalid_request')
    } else if (counted.data >= cap) {
      return fail('file_count')
    }
  }

  const r = await createUpload(admin, {
    survey_id: body.surveyId,
    survey_version_id: body.versionId,
    question_key: body.questionKey,
    name: body.name,
    size: body.size,
    mime: body.mime.toLowerCase(),
    ...(hash ? { resume_token_hash: hash } : {}),
  })
  if (!r.ok) {
    console.error('[public] create_upload failed', r.error.code)
    return fail('server_error')
  }
  if (!r.data.ok) return fail(r.data.code)

  const signed = await admin.storage.from(RESPONSE_FILES_BUCKET).createSignedUploadUrl(r.data.object_path)
  if (signed.error || !signed.data) {
    console.error('[public] createSignedUploadUrl failed', signed.error?.message)
    return fail('server_error')
  }
  const out: UploadResponse = { ok: true, fileId: r.data.file_id, path: r.data.object_path, signedUrl: signed.data.signedUrl }
  return json(out)
}
