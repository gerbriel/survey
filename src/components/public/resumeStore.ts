/**
 * Respondent-side persistence (doc 02 section 5.3 and 11). localStorage
 * first: the resume token under `survey:{surveyId}:resume`, a mirror of the
 * answers so a failed save loses nothing, the response seed, and a random
 * respondent id for first-party events. Every access is guarded because
 * storage can be blocked (private mode, disabled cookies).
 */

export type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const keys = {
  resume: (surveyId: string) => `survey:${surveyId}:resume`,
  answers: (surveyId: string) => `survey:${surveyId}:answers`,
  seed: (surveyId: string) => `survey:${surveyId}:seed`,
  respondent: (surveyId: string) => `survey:${surveyId}:rid`,
}

/** Same shape as the server check: gen_token(32) is 43 URL-safe base64 chars. */
export const RESUME_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

export function isResumeToken(v: unknown): v is string {
  return typeof v === 'string' && RESUME_TOKEN_RE.test(v)
}

export function browserStore(): StoreLike | null {
  try {
    const s = window.localStorage
    const probe = '__survey_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

function read(store: StoreLike | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(store: StoreLike | null, key: string, value: string | null): void {
  try {
    if (!store) return
    if (value === null) store.removeItem(key)
    else store.setItem(key, value)
  } catch {
    // Quota or blocked storage: the server copy still exists.
  }
}

export function loadResumeToken(store: StoreLike | null, surveyId: string): string | null {
  const v = read(store, keys.resume(surveyId))
  return isResumeToken(v) ? v : null
}

export function saveResumeToken(store: StoreLike | null, surveyId: string, token: string | null): void {
  write(store, keys.resume(surveyId), token && isResumeToken(token) ? token : null)
}

export type AnswerMirror = { versionId: string; answers: Record<string, unknown>; pageId?: string; savedAt: string }

export function loadMirror(store: StoreLike | null, surveyId: string, versionId: string): AnswerMirror | null {
  const raw = read(store, keys.answers(surveyId))
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as AnswerMirror
    if (!m || m.versionId !== versionId || typeof m.answers !== 'object' || m.answers === null) return null
    return m
  } catch {
    return null
  }
}

export function saveMirror(store: StoreLike | null, surveyId: string, mirror: AnswerMirror | null): void {
  write(store, keys.answers(surveyId), mirror ? JSON.stringify(mirror) : null)
}

export function loadOrCreate(store: StoreLike | null, key: string, create: () => string, valid: (v: string) => boolean): string {
  const v = read(store, key)
  if (v && valid(v)) return v
  const fresh = create()
  write(store, key, fresh)
  return fresh
}

export function writeValue(store: StoreLike | null, key: string, value: string | null): void {
  write(store, key, value)
}

export function readValue(store: StoreLike | null, key: string): string | null {
  return read(store, key)
}

/** Clears everything kept for a survey after completion; the respondent id stays for event joins. */
export function clearAfterComplete(store: StoreLike | null, surveyId: string): void {
  write(store, keys.resume(surveyId), null)
  write(store, keys.answers(surveyId), null)
  write(store, keys.seed(surveyId), null)
}

/**
 * Reads `?r=` and `?t=` from a URL and returns the URL with both removed,
 * for history.replaceState before any pixel loads (doc 02 section 5.3).
 */
export function takeUrlTokens(href: string): { resumeToken: string | null; respondentToken: string | null; cleanUrl: string | null } {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return { resumeToken: null, respondentToken: null, cleanUrl: null }
  }
  const r = u.searchParams.get('r')
  const t = u.searchParams.get('t')
  if (r === null && t === null) return { resumeToken: null, respondentToken: null, cleanUrl: null }
  u.searchParams.delete('r')
  u.searchParams.delete('t')
  return {
    resumeToken: isResumeToken(r) ? r : null,
    respondentToken: t && t.length <= 200 ? t : null,
    cleanUrl: u.pathname + (u.search ? u.search : '') + u.hash,
  }
}

export function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}
