/**
 * Respondent-side persistence (doc 02 section 5.3 and 11).
 *
 * S3 (R16, public H2): every workspace's surveys share the public origin, so
 * anything here is readable by any workspace's GTM or custom script. The
 * browser therefore keeps no answers and no seed: only the opaque resume
 * token under `survey:{surveyId}:resume` and the random respondent id used
 * to join first-party events. Partial answers live server side; autosave
 * sends them to the submit endpoint and boot rehydrates them through
 * /api/public/resume. Every access is guarded because storage can be
 * blocked (private mode, disabled cookies).
 */

export type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const keys = {
  resume: (surveyId: string) => `survey:${surveyId}:resume`,
  respondent: (surveyId: string) => `survey:${surveyId}:rid`,
}

/** S3 (R16): keys earlier builds wrote with answers or seeds; removed on every boot. */
const LEGACY_KEY_RE = /^survey:[^:]+:(answers|seed)$/

/** Same shape as the server check: gen_token(32) is 43 URL-safe base64 chars. */
export const RESUME_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

export function isResumeToken(v: unknown): v is string {
  return typeof v === 'string' && RESUME_TOKEN_RE.test(v)
}

export function browserStore(): Storage | null {
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

/**
 * S3 (R16): deletes answer mirrors and seeds that earlier builds left in
 * storage for any survey on this origin, so no answers stay at rest.
 */
export function purgeLegacyAnswers(store: (StoreLike & Pick<Storage, 'key' | 'length'>) | null): void {
  try {
    if (!store) return
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && LEGACY_KEY_RE.test(k)) doomed.push(k)
    }
    for (const k of doomed) store.removeItem(k)
  } catch {
    // Blocked storage holds nothing to purge.
  }
}

export function loadOrCreate(store: StoreLike | null, key: string, create: () => string, valid: (v: string) => boolean): string {
  const v = read(store, key)
  if (v && valid(v)) return v
  const fresh = create()
  write(store, key, fresh)
  return fresh
}

/** Consent choices only (survey:consent:{surveyId}); never answers. */
export function writeValue(store: StoreLike | null, key: string, value: string | null): void {
  write(store, key, value)
}

export function readValue(store: StoreLike | null, key: string): string | null {
  return read(store, key)
}

/** Clears the resume token after completion; the respondent id stays for event joins. */
export function clearAfterComplete(store: StoreLike | null, surveyId: string): void {
  write(store, keys.resume(surveyId), null)
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
