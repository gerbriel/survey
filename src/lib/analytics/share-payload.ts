import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Pure helpers for the public shared report (doc 04 section 5.4): the payload
 * allow-list, and the password cookie sealing. No database, no Next imports.
 */

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{8,100}$/

/**
 * Every key the shared report may carry, at any depth. sanitizeSharedPayload
 * drops anything else, so a future SQL change cannot leak a column (rows,
 * emails, file paths, verbatims) through this page by accident.
 */
export const SHARED_PAYLOAD_KEYS = new Set([
  // envelope
  'report', 'survey', 'workspace', 'widgets', 'name', 'title',
  // widget ('rows' and 'columns' are matrix labels, {id, label}, widget level only)
  'id', 'position', 'chart_type', 'question_key', 'metric', 'label', 'options', 'rows', 'columns', 'result',
  // result
  'n', 'suppressed', 'type', 'data', 'funnel', 'views', 'starts', 'completes',
  // data items
  'option_id', 'row_id', 'column_id', 'count', 'avg_position', 'mean', 'median', 'min', 'max',
  'distribution', 'nps', 'value', 'word',
])

const MAX_DEPTH = 6

function clean(v: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => clean(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (SHARED_PAYLOAD_KEYS.has(k)) out[k] = clean(x, depth + 1)
    return out
  }
  if (typeof v === 'string') return v.slice(0, 500)
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v
  return null
}

export type SharedResultItem = {
  option_id?: string
  row_id?: string
  column_id?: string
  word?: string
  value?: number
  count?: number | null
  suppressed?: boolean
  avg_position?: number | null
}

export type SharedResult = {
  n?: number | null
  suppressed?: boolean
  type?: string | null
  metric?: string
  funnel?: { views?: number; starts?: number; completes?: number }
  data?:
    | SharedResultItem[]
    | { suppressed?: boolean; mean?: number; median?: number; min?: number; max?: number; nps?: number | null; distribution?: SharedResultItem[] | null }
    | null
}

export type SafeSharedWidget = {
  id: string
  position: number
  chart_type: string
  question_key: string | null
  metric: string | null
  label: string | null
  options: { id: string; label: string }[] | null
  /** Matrix row and column labels; null for other question types. */
  rows: { id: string; label: string }[] | null
  columns: { id: string; label: string }[] | null
  result: SharedResult
}

export type SafeSharedPayload = {
  report: { name: string }
  survey: { title: string }
  workspace: { name: string }
  widgets: SafeSharedWidget[]
}

/** Allow-list the shared_report_payload result. Workspace logo_path is dropped. */
export function sanitizeSharedPayload(raw: unknown): SafeSharedPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const c = clean(raw, 0) as Record<string, unknown>
  const str = (o: unknown, k: string) => (o && typeof o === 'object' && typeof (o as Record<string, unknown>)[k] === 'string' ? ((o as Record<string, unknown>)[k] as string) : '')
  const widgets = Array.isArray(c.widgets) ? (c.widgets as Record<string, unknown>[]) : []
  const labels = (v: unknown) =>
    Array.isArray(v)
      ? (v as Record<string, unknown>[])
          .filter((o) => o && typeof o.id === 'string')
          .map((o) => ({ id: o.id as string, label: typeof o.label === 'string' ? o.label : (o.id as string) }))
      : null
  /** rows and columns are allowed only as widget level labels, never inside a result. */
  const result = (v: unknown): SharedResult => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const rest: Record<string, unknown> = { ...(v as Record<string, unknown>) }
    delete rest.rows
    delete rest.columns
    return rest as SharedResult
  }
  return {
    report: { name: str(c.report, 'name') },
    survey: { title: str(c.survey, 'title') },
    workspace: { name: str(c.workspace, 'name') },
    widgets: widgets.map((w, i) => ({
      id: typeof w.id === 'string' ? w.id : String(i),
      position: typeof w.position === 'number' ? w.position : i,
      chart_type: typeof w.chart_type === 'string' ? w.chart_type : 'table',
      question_key: typeof w.question_key === 'string' ? w.question_key : null,
      metric: typeof w.metric === 'string' ? w.metric : null,
      label: typeof w.label === 'string' ? w.label : null,
      options: labels(w.options),
      rows: labels(w.rows),
      columns: labels(w.columns),
      result: result(w.result),
    })),
  }
}

/** Every key present anywhere in a value, for the allow-list test. */
export function allKeys(v: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) allKeys(x, acc)
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    acc.add(k)
    allKeys(x, acc)
  }
  return acc
}

// ------------------------------------------------------------ password cookie

/**
 * Decision: the cookie seals the password itself (AES-256-GCM, token as
 * associated data), not an HMAC of token + password_hash as doc 04 sketches,
 * because shared_report_payload needs the plaintext on every view and the
 * route must not read password_hash. A password change still invalidates the
 * cookie: the sealed old password stops matching and the prompt returns.
 */
export function shareCookieName(token: string): string {
  return `rs_${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
}

function key(secret: string): Buffer {
  return createHash('sha256').update(`report-share-cookie:${secret}`).digest()
}

export function sealPassword(password: string, token: string, secret: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(secret), iv)
  c.setAAD(Buffer.from(token))
  const body = Buffer.concat([c.update(password, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')
}

export function unsealPassword(sealed: string, token: string, secret: string): string | null {
  try {
    const buf = Buffer.from(sealed, 'base64url')
    if (buf.length < 29) return null
    const d = createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12))
    d.setAAD(Buffer.from(token))
    d.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
