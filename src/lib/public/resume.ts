import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { FileRef } from '@/lib/survey'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ResumeResponse } from '@/components/public/protocol'
import { resumeState, type ResumeRows } from './db'
import { clientIp, json, readJsonBody } from './http'
import { definitionFor, resolveSurvey } from './load'
import { checkRateLimits, hashIp, RATE_LIMITS, rateLimitSecret } from './ratelimit'

/**
 * Resume (doc 02 section 5.3). The first save returns a 32-byte secret
 * (gen_token(32): 43 URL-safe base64 chars); only sha256 hex of it is stored
 * on the response. The client keeps it in localStorage and may copy a
 * `?r=` link; the token travels in a POST body, never a GET query.
 */

export const resumeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)

/** sha256 hex of the UTF-8 token, identical to SQL sha256_hex(text). */
export function hashResumeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Valid token to its hash, or null for anything malformed. */
export function resumeHashOrNull(token: string | undefined | null): string | null {
  if (!token) return null
  return resumeTokenSchema.safeParse(token).success ? hashResumeToken(token) : null
}

type StoredFile = { file_id?: unknown; path?: unknown; name?: unknown; size?: unknown; mime?: unknown }

function toFileRef(v: StoredFile): FileRef | null {
  if (typeof v.path !== 'string' || typeof v.name !== 'string') return null
  return { path: v.path, name: v.name, size: typeof v.size === 'number' ? v.size : 0, mime: typeof v.mime === 'string' ? v.mime : '' }
}

/**
 * One stored answers row back to the wire value the renderer accepts
 * (inverse of toAnswerRow plus the SQL file answer shape).
 */
export function answerRowToWire(row: ResumeRows['answers'][number]): unknown {
  const j = row.value_json as unknown
  if (row.value_text !== null && j && typeof j === 'object' && !Array.isArray(j) && 'other' in j) {
    return { id: row.value_text, other: String((j as { other: unknown }).other ?? '') }
  }
  if (row.value_number !== null) return row.value_number
  if (row.value_date !== null) return row.value_date
  if (row.value_text !== null) return row.value_text
  if (Array.isArray(j) && j.length > 0 && j.every((x) => x && typeof x === 'object' && 'file_id' in x)) {
    return j.map((x) => toFileRef(x as StoredFile)).filter((x): x is FileRef => x !== null)
  }
  if (j && typeof j === 'object' && !Array.isArray(j) && 'file_id' in j) return toFileRef(j as StoredFile)
  return j ?? undefined
}

export function rowsToWire(rows: ResumeRows): { answers: Record<string, unknown>; files: Record<string, FileRef[]> } {
  const answers: Record<string, unknown> = {}
  for (const a of rows.answers) {
    const v = answerRowToWire(a)
    if (v !== undefined && v !== null) answers[a.question_key] = v
  }
  const files: Record<string, FileRef[]> = {}
  for (const f of rows.files) {
    ;(files[f.question_key] ??= []).push({ path: f.object_path, name: f.original_name, size: f.declared_size, mime: f.declared_mime })
  }
  return { answers, files }
}

const resumeBody = z.object({
  key: z.string().min(1).max(100),
  surveyId: z.guid(),
  resumeToken: resumeTokenSchema,
})

/** POST /api/public/resume */
export async function handleResume(req: Request): Promise<Response> {
  const body = await readJsonBody(req, resumeBody, 8 * 1024)
  if (!body.ok) return body.response
  const { key, surveyId, resumeToken } = body.data

  const admin = createAdminClient()
  const ip = clientIp(req.headers)
  const rl = await checkRateLimits(admin, [{ rule: RATE_LIMITS.resume, key: hashIp(ip, rateLimitSecret()) }])
  if (!rl.ok) return json({ ok: false, code: 'rate_limited', retryAfter: rl.retryAfter }, 429, { 'retry-after': String(rl.retryAfter) })

  const survey = await resolveSurvey(key.toLowerCase())
  if (!survey || survey.survey_id !== surveyId) return json({ ok: false, code: 'not_found' }, 404)
  if (survey.effective_state !== 'open' || !survey.version_id) {
    const code = survey.effective_state === 'scheduled' ? 'not_open_yet' : survey.state_reason === 'cap' ? 'cap_reached' : 'survey_closed'
    return json({ ok: false, code }, 409)
  }

  const r = await resumeState(admin, { surveyId, resumeTokenHash: hashResumeToken(resumeToken) })
  if (!r.ok) {
    console.error('[public] resume lookup failed', r.error.code)
    return json({ ok: false, code: 'server_error' }, 500)
  }
  if (!r.data) return json({ ok: false, code: 'not_found' }, 404)

  const { answers, files } = rowsToWire(r.data)
  const meta = (r.data.response.metadata ?? {}) as Record<string, unknown>
  const out: ResumeResponse = {
    ok: true,
    versionId: r.data.response.survey_version_id,
    answers,
    files,
    seed: typeof meta.random_seed === 'string' ? meta.random_seed : undefined,
    lastQuestionKey: r.data.response.last_question_key,
    startedAt: r.data.response.started_at,
  }
  if (r.data.response.survey_version_id !== survey.version_id) {
    const def = await definitionFor(r.data.response.survey_version_id, key.toLowerCase())
    if (!def) return json({ ok: false, code: 'not_found' }, 404)
    out.definition = def.definition
  }
  return json(out)
}
