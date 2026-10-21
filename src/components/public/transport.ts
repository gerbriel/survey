/**
 * Browser transport for the public page: JSON posts to /api/public/*,
 * direct uploads to a signed Storage URL with progress, and the batched
 * first-party event beacon for Phase 2E's /api/public/events.
 */

export type PostResult<T> = { status: number; data: T | null; networkError: boolean }

export async function postJson<T>(url: string, body: unknown, opts: { keepalive?: boolean } = {}): Promise<PostResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: opts.keepalive,
      cache: 'no-store',
      credentials: 'omit',
    })
    let data: T | null = null
    try {
      data = (await res.json()) as T
    } catch {
      data = null
    }
    return { status: res.status, data, networkError: false }
  } catch {
    return { status: 0, data: null, networkError: true }
  }
}

/** sendBeacon with a JSON Blob (application/json), falling back to a keepalive fetch. */
export function beaconJson(url: string, body: unknown): boolean {
  const payload = JSON.stringify(body)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))) return true
    }
  } catch {
    // fall through
  }
  try {
    void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true, credentials: 'omit' })
    return true
  } catch {
    return false
  }
}

/** PUT the file to a Storage signed upload URL (what storage-js uploadToSignedUrl does), with progress. */
export function uploadToSignedUrl(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => resolve(false)
    xhr.onabort = () => resolve(false)
    xhr.send(file)
  })
}

/**
 * First-party analytics events for Phase 2E's /api/public/events, matching
 * src/lib/analytics/beacon-schema.ts: one envelope per batch with the survey,
 * version and random respondent id, then up to 50 events. meta carries page
 * numbers (1-based), never page ids, answer values or free text.
 */
export type BeaconEvent = {
  type: 'view' | 'start' | 'question_view' | 'question_answer' | 'page_next' | 'page_back' | 'abandon' | 'file_upload'
  question_key?: string
  occurred_at: string
  meta?: Record<string, string | number | Record<string, string>>
}

export type BeaconEnvelope = { survey_id: string; survey_version_id: string; rid: string; events: BeaconEvent[] }

export const EVENTS_URL = '/api/public/events'
export const MAX_EVENTS_PER_BATCH = 50

/** Batches events; flushes on size, on a short timer, and on page hide. */
export class EventQueue {
  private queue: BeaconEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly header: Omit<BeaconEnvelope, 'events'>,
    private readonly send: (body: BeaconEnvelope) => void = (body) => {
      beaconJson(EVENTS_URL, body)
    },
    private readonly delayMs = 3000,
  ) {}

  push(e: BeaconEvent): void {
    this.queue.push(e)
    if (this.queue.length >= MAX_EVENTS_PER_BATCH) this.flush()
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, MAX_EVENTS_PER_BATCH)
      this.send({ ...this.header, events: batch })
    }
  }
}

export function deviceKind(): 'mobile' | 'tablet' | 'desktop' {
  try {
    const ua = navigator.userAgent
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet'
    if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile'
  } catch {
    // ignore
  }
  return 'desktop'
}

/** RFC 4122 v4 id; crypto.randomUUID needs a secure context, this does not. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      // fall through
    }
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
