/**
 * Wire contract between the public survey page and /api/public/* (doc 02
 * sections 5 and 6). Client safe: no server imports, no zod (keeps the
 * public bundle small; the route handlers validate with zod).
 */

import type { FileRef } from '@/lib/survey'

export type ErrorCode =
  | 'invalid_request'
  | 'captcha_failed'
  | 'token_invalid'
  | 'not_found'
  | 'survey_closed'
  | 'not_open_yet'
  | 'cap_reached'
  | 'token_used'
  | 'validation_failed'
  | 'rate_limited'
  | 'server_error'
  | 'file_size'
  | 'file_type'
  | 'file_count'

/** Client-collected metadata (doc 01 section 6 keys); SQL drops anything else. */
export type ClientMeta = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  referrer_host?: string
  locale?: string
  device?: 'mobile' | 'tablet' | 'desktop'
  pixel_consent?: { mode: string; granted: boolean }
}

export type SubmitRequest = {
  action: 'save' | 'complete'
  key: string
  surveyId: string
  versionId: string
  idempotencyKey: string
  resumeToken?: string
  respondentToken?: string
  respondentHash?: string
  answers: Record<string, unknown>
  hidden: Record<string, string>
  uploadIds: string[]
  startedAt: string
  seed?: string
  pageId?: string
  meta?: ClientMeta
  turnstileToken?: string
  website: string
}

export type SubmitResponse =
  | {
      ok: true
      responseId: string
      resumeToken?: string
      score?: { value: number; max: number }
      endingId?: string | null
    }
  | { ok: false; code: ErrorCode; fieldErrors?: Record<string, string>; retryAfter?: number }

export type UploadRequest = {
  key: string
  surveyId: string
  versionId: string
  questionKey: string
  name: string
  size: number
  mime: string
  resumeToken?: string
  turnstileToken?: string
}

export type UploadResponse =
  | { ok: true; fileId: string; path: string; signedUrl: string }
  | { ok: false; code: ErrorCode; retryAfter?: number }

export type ResumeRequest = { key: string; surveyId: string; resumeToken: string }

export type ResumeResponse =
  | {
      ok: true
      versionId: string
      /** Present only when the partial started on an older published version. */
      definition?: unknown
      answers: Record<string, unknown>
      files: Record<string, FileRef[]>
      seed?: string
      lastQuestionKey?: string | null
      startedAt: string
    }
  | { ok: false; code: ErrorCode; retryAfter?: number }

export type ReportRequest = {
  slug: string
  reason: 'spam' | 'phishing' | 'sensitive_data' | 'harassment' | 'illegal' | 'other'
  details?: string
  contact?: string
  turnstileToken?: string
  website: string
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PENDING_ID_RE = new RegExp(`/pending/(${UUID})/`)

/**
 * Upload id from a stored object path `{ws}/{survey}/pending/{upload_id}/{name}`.
 * Decision: FileRef has no id field, so the id travels inside the path that
 * create_upload minted; the server re-derives file_ids from answers.
 */
export function fileIdFromPath(path: string): string | null {
  return PENDING_ID_RE.exec(path)?.[1] ?? null
}

/** Every upload id referenced by file answers (FileRef or FileRef[] values). */
export function fileIdsFromAnswers(answers: Record<string, unknown>): string[] {
  const out = new Set<string>()
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x)
      return
    }
    if (v && typeof v === 'object' && typeof (v as FileRef).path === 'string') {
      const id = fileIdFromPath((v as FileRef).path)
      if (id) out.add(id)
    }
  }
  for (const v of Object.values(answers)) visit(v)
  return [...out]
}

/** URL params that never become hidden fields or metadata. */
export const RESERVED_PARAMS = new Set(['r', 't'])
const PARAM_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
export const MAX_HIDDEN_PARAMS = 50
export const MAX_HIDDEN_VALUE = 500

/** Hidden fields from a query string: safe names, trimmed values, bounded count (doc 02 section 5). */
export function hiddenFromSearch(search: string | URLSearchParams): Record<string, string> {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of params) {
    if (n >= MAX_HIDDEN_PARAMS) break
    if (RESERVED_PARAMS.has(k) || !PARAM_RE.test(k) || k in out) continue
    out[k] = v.slice(0, MAX_HIDDEN_VALUE)
    n++
  }
  return out
}
