import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ERROR_MESSAGES,
  errorMessage,
  migrateDefinition,
  toAnswerRow,
  validateSubmission,
  type ErrorCode as ValidatorCode,
  type FileRef,
  type SurveyDefinition,
} from '@/lib/survey'
import { submitResponse, type SubmitPayload, type SubmitResult } from '@/lib/db/submission'
import type { PublicSurvey } from '@/lib/db/publicRead'
import { createAdminClient } from '@/lib/supabase/admin'
import { fileIdsFromAnswers, type SubmitResponse } from '@/components/public/protocol'
import { publishedVersion } from './db'
import { clientIp, json, readJsonBody } from './http'
import { resolveSurvey, surveyContext } from './load'
import { checkRateLimits, hashIp, RATE_LIMITS, rateLimitSecret, type RateCheck } from './ratelimit'
import { resumeHashOrNull, resumeTokenSchema } from './resume'
import { verifyTurnstile } from './turnstile'

/**
 * POST /api/public/submit (doc 02 section 5). Order of checks:
 *
 *   1. method, content type, size (256 KB)      400 / 405 / 413 / 415
 *   2. body shape (zod)                         400 invalid_request
 *   3. survey open check (resolve_public_survey, anon)  404 / 409
 *   4. honeypot                                  fake 200, writes nothing
 *   5. rate limits (rate_limit_hit)              429 rate_limited
 *   6. Turnstile, on create and on complete      403 captcha_failed
 *   7. full version (service role), migrateDefinition once
 *   8. validateSubmission: partial for save, final for complete  422
 *   9. submit_response (service role): idempotency, cap, token, files, state
 *
 * Decision: rate limits run before Turnstile, as doc 02 section 5.1 says,
 * so a flood costs one Postgres call per request and never a siteverify call.
 * Decision: the survey check runs before the honeypot (it is one indexed
 * anon read) so the per-survey rate limits know the workspace.
 */

export const MAX_SUBMIT_BYTES = 256 * 1024

const clientMeta = z
  .object({
    utm_source: z.string().max(255),
    utm_medium: z.string().max(255),
    utm_campaign: z.string().max(255),
    utm_term: z.string().max(255),
    utm_content: z.string().max(255),
    referrer_host: z.string().max(255),
    locale: z.string().max(35),
    device: z.enum(['mobile', 'tablet', 'desktop']),
    pixel_consent: z.object({ mode: z.string().max(20), granted: z.boolean() }),
  })
  .partial()

export const submitBody = z.object({
  action: z.enum(['save', 'complete']),
  key: z.string().min(1).max(100),
  surveyId: z.guid(),
  versionId: z.guid(),
  idempotencyKey: z.uuid(),
  resumeToken: resumeTokenSchema.optional(),
  respondentToken: z.string().min(1).max(200).optional(),
  respondentHash: z.string().regex(/^[a-f0-9]{16,64}$/).optional(),
  answers: z.record(z.string().max(80), z.unknown()),
  hidden: z.record(z.string().max(64), z.string().max(500)).default({}),
  uploadIds: z.array(z.guid()).max(200).default([]),
  startedAt: z.string().max(40),
  seed: z.string().max(64).optional(),
  pageId: z.string().max(80).optional(),
  meta: clientMeta.optional(),
  turnstileToken: z.string().max(2048).optional(),
  /** Honeypot. Any value is accepted here so the fake success can answer it. */
  website: z.string().max(1000),
})

export type SubmitBody = z.output<typeof submitBody>

const HTTP: Record<string, number> = {
  invalid_request: 400,
  captcha_failed: 403,
  token_invalid: 403,
  not_found: 404,
  survey_closed: 409,
  not_open_yet: 409,
  cap_reached: 409,
  token_used: 409,
  validation_failed: 422,
  rate_limited: 429,
  server_error: 500,
}

function fail(code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ ok: false, code, ...extra }, HTTP[code] ?? 400, headers)
}

/** Closed-state code for a resolved survey that is not open, or null when it may still accept. */
export function stateCode(s: PublicSurvey, now: Date = new Date()): 'not_open_yet' | 'cap_reached' | 'survey_closed' | null {
  if (s.effective_state === 'open') return null
  if (s.effective_state === 'scheduled') return 'not_open_yet'
  // 15 minute grace after a scheduled close; submit_response checks started_at.
  if (s.state_reason === 'schedule' && s.closes_at && now.getTime() < new Date(s.closes_at).getTime() + 15 * 60_000) return null
  return s.state_reason === 'cap' ? 'cap_reached' : 'survey_closed'
}

/** SQL and validator error codes to the message shown under the question. */
export function fieldMessage(code: string): string {
  if (code in ERROR_MESSAGES) return errorMessage(code as ValidatorCode)
  if (code === 'unknown_question') return 'This question is no longer part of the survey. Please reload.'
  return ERROR_MESSAGES.type
}

/** The question_key of the last question on a page, for drop-off reporting. */
export function lastKeyOnPage(def: SurveyDefinition, pageId: string | undefined): string | undefined {
  if (!pageId) return undefined
  const page = def.pages.find((p) => p.id === pageId)
  const last = page?.question_ids[page.question_ids.length - 1]
  return last ? def.questions[last]?.question_key : undefined
}

/** cleaned answers (keyed by question_key) to submit_response rows, plus the quiz score calc. */
export function answerRows(def: SurveyDefinition, cleaned: Record<string, unknown>, computed: Record<string, number>): Record<string, unknown> {
  const byKey = new Map(Object.values(def.questions).map((q) => [q.question_key, q]))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cleaned)) {
    const q = byKey.get(k)
    if (!q || q.type === 'file_upload' || q.type === 'signature') continue // files attach through file_ids
    const row = toAnswerRow(q, v as never)
    if (row) out[k] = row
  }
  const quizId = def.settings.quiz?.score_calc_id
  const quizKey = quizId ? def.questions[quizId]?.question_key : undefined
  if (quizKey && computed[quizKey] !== undefined) out[quizKey] = { value_number: computed[quizKey] }
  return out
}

function filesManifest(answers: Record<string, unknown>): Record<string, FileRef[]> {
  const out: Record<string, FileRef[]> = {}
  for (const [k, v] of Object.entries(answers)) {
    const list = Array.isArray(v) ? v : [v]
    const refs = list.filter((x): x is FileRef => !!x && typeof x === 'object' && typeof (x as FileRef).path === 'string')
    if (refs.length > 0) out[k] = refs
  }
  return out
}

export function toClientResult(r: SubmitResult, endingId: string | null): { status: number; body: SubmitResponse } {
  if (r.ok) {
    const body: SubmitResponse = { ok: true, responseId: r.response_id }
    if (r.resume_token) body.resumeToken = r.resume_token
    if (typeof r.score === 'number') body.score = { value: r.score, max: typeof r.score_max === 'number' ? r.score_max : r.score }
    if (endingId !== undefined) body.endingId = endingId
    return { status: 200, body }
  }
  const body: SubmitResponse = { ok: false, code: r.code }
  if (r.code === 'validation_failed' && r.field_errors) {
    body.fieldErrors = Object.fromEntries(Object.entries(r.field_errors).map(([k, c]) => [k, fieldMessage(c)]))
  }
  return { status: HTTP[r.code] ?? 400, body }
}

export async function handleSubmit(req: Request): Promise<Response> {
  // 1, 2. Method, content type, size, shape.
  const parsed = await readJsonBody(req, submitBody, MAX_SUBMIT_BYTES)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const key = body.key.toLowerCase()

  // 3. Survey open check.
  const survey = await resolveSurvey(key)
  if (!survey || survey.survey_id !== body.surveyId) return fail('not_found')
  const closed = stateCode(survey)
  if (closed) return fail(closed)

  // 4. Honeypot: bots learn nothing.
  if (body.website !== '') return json({ ok: true, responseId: randomUUID() })

  // 5. Rate limits.
  const admin = createAdminClient()
  const ip = clientIp(req.headers)
  const ipKey = hashIp(ip, rateLimitSecret())
  const ctx = await surveyContext(body.surveyId)
  const checks: RateCheck[] = [{ rule: RATE_LIMITS.submitSurvey, key: body.surveyId }]
  if (!body.resumeToken) checks.push({ rule: RATE_LIMITS.submitCreate, key: ipKey })
  if (body.action === 'save') checks.push({ rule: RATE_LIMITS.submitSave, key: ipKey })
  else checks.push({ rule: RATE_LIMITS.submitComplete, key: `${ipKey}:${body.surveyId}`, max: ctx?.limits.rate_limit_per_hour })
  const rl = await checkRateLimits(admin, checks)
  if (!rl.ok) return fail('rate_limited', { retryAfter: rl.retryAfter }, { 'retry-after': String(rl.retryAfter) })

  // 6. Turnstile when this request creates a response, and on complete.
  if (!body.resumeToken || body.action === 'complete') {
    const t = await verifyTurnstile({ token: body.turnstileToken, ip, action: 'submit', idempotencyKey: body.idempotencyKey })
    if (!t.ok) return fail('captcha_failed')
  }

  // 7. Full definition of the version the respondent loaded, migrated once.
  const v = await publishedVersion(admin, { versionId: body.versionId, surveyId: body.surveyId })
  if (!v.ok) {
    console.error('[public] version load failed', v.error.code)
    return fail('server_error')
  }
  if (!v.data) return fail('invalid_request')
  let def: SurveyDefinition
  try {
    def = migrateDefinition(v.data.definition)
  } catch (e) {
    console.error('[public] stored definition failed to migrate', (e as Error).message)
    return fail('server_error')
  }

  // 8. Validate. save: types and limits only, invalid answers dropped.
  // complete: required fields and logic-visible paths too.
  const result = validateSubmission(def, body.answers, {
    now: new Date().toISOString(),
    hidden: body.hidden,
    files: filesManifest(body.answers),
    mode: body.action === 'save' ? 'partial' : 'final',
    seed: body.seed,
  })
  if (body.action === 'complete' && !result.ok) {
    const fieldErrors: Record<string, string> = {}
    for (const [k, errs] of Object.entries(result.errors)) if (errs[0]) fieldErrors[k] = errs[0].message
    return fail('validation_failed', { fieldErrors })
  }

  // 9. The single writer.
  const metadata: Record<string, unknown> = { ...(body.meta ?? {}), hidden: body.hidden }
  if (body.seed) metadata.random_seed = body.seed
  const ua = req.headers.get('user-agent')
  if (ua) metadata.user_agent = ua.slice(0, 512)
  const payload: SubmitPayload = {
    action: body.action,
    survey_id: body.surveyId,
    survey_version_id: body.versionId,
    idempotency_key: body.idempotencyKey,
    answers: answerRows(def, result.cleaned, result.computed),
    visible_keys: result.visible_keys,
    metadata,
    ip,
    file_ids: fileIdsFromAnswers(result.cleaned),
    started_at: body.startedAt,
  }
  const hash = resumeHashOrNull(body.resumeToken)
  if (hash) payload.resume_token_hash = hash
  if (body.respondentToken) payload.respondent_token = body.respondentToken
  if (body.respondentHash) payload.respondent_hash = body.respondentHash
  const last = lastKeyOnPage(def, body.pageId)
  if (last) payload.last_question_key = last

  const r = await submitResponse(admin, payload)
  if (!r.ok) {
    console.error('[public] submit_response failed', r.error.code, r.error.detail)
    return fail('server_error')
  }
  const out = toClientResult(r.data, body.action === 'complete' ? result.ending_id : null)
  return json(out.body, out.status)
}
