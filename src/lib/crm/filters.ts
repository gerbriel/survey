import type { ContactFilters } from '@/lib/db/contacts'
import { LEAD_STATUSES, type LeadStatus } from './import'

/**
 * Contact list URL state (doc 04 section 1.1). The URL is the single source
 * of truth for filters and columns; picking a saved view writes its filters
 * into the URL.
 *
 * Decision: `?view=board` switches to the kanban (doc 04 section 1.2), so a
 * saved view is selected with `?sv={id}` instead.
 *
 * Note: `follow_up: "due"` (the built-in "Follow-up due" view, build plan
 * running notes) is already part of the frozen ContactFilters type, so no
 * local extension is needed.
 */

export type SearchParams = Record<string, string | string[] | undefined>

export const FOLLOW_UP_OPTIONS = ['overdue', 'due', 'this_week', 'unset'] as const
export type FollowUp = (typeof FOLLOW_UP_OPTIONS)[number]

export const CORE_COLUMNS = [
  'name',
  'email',
  'phone',
  'company',
  'lead_status',
  'owner',
  'tags',
  'response_count',
  'last_response_at',
  'follow_up_at',
  'source',
  'created_at',
] as const
export const DEFAULT_COLUMNS = [
  'name',
  'email',
  'phone',
  'company',
  'lead_status',
  'owner',
  'tags',
  'response_count',
  'last_response_at',
]
export const COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  company: 'Company',
  lead_status: 'Lead status',
  owner: 'Owner',
  tags: 'Tags',
  response_count: 'Responses',
  last_response_at: 'Last response',
  follow_up_at: 'Follow-up',
  source: 'Source',
  created_at: 'Created',
}

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v
  return s && s.trim() ? s.trim() : undefined
}
function many(v: string | string[] | undefined): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : []
  return list.flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Next day as YYYY-MM-DD, so a "to" date is inclusive against the SQL `<`. */
function dayAfter(d: string): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}
function dayBefore(d: string): string {
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

export function paramsToFilters(sp: SearchParams): ContactFilters {
  const f: ContactFilters = {}
  const q = one(sp.q)
  if (q) f.q = q.slice(0, 200)
  const status = many(sp.status).filter((s): s is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(s))
  if (status.length) f.lead_status = status
  const tags = many(sp.tags).map((t) => t.toLowerCase())
  if (tags.length) {
    const mode = one(sp.tagmode)
    f.tags = { mode: mode === 'all' || mode === 'none' ? mode : 'any', values: tags }
  }
  const owners = many(sp.owner)
  if (owners.length) {
    const ids = owners.filter((o) => UUID_RE.test(o))
    f.owner = {
      ...(owners.includes('me') ? { me: true } : {}),
      ...(owners.includes('unassigned') ? { unassigned: true } : {}),
      ...(ids.length ? { ids } : {}),
    }
  }
  const fu = one(sp.follow)
  if (fu && (FOLLOW_UP_OPTIONS as readonly string[]).includes(fu)) f.follow_up = fu as FollowUp
  const source = one(sp.source)
  if (source) f.source = source
  const lrFrom = one(sp.lr_from)
  if (lrFrom && DATE_RE.test(lrFrom)) f.last_response_from = lrFrom
  const lrTo = one(sp.lr_to)
  if (lrTo && DATE_RE.test(lrTo)) f.last_response_to = dayAfter(lrTo)
  const cFrom = one(sp.c_from)
  if (cFrom && DATE_RE.test(cFrom)) f.created_from = cFrom
  const cTo = one(sp.c_to)
  if (cTo && DATE_RE.test(cTo)) f.created_to = dayAfter(cTo)
  const cf = one(sp.cf)
  if (cf) {
    try {
      const parsed: unknown = JSON.parse(cf)
      if (Array.isArray(parsed)) {
        const custom = parsed
          .filter((x): x is { key: string; op: string; value?: unknown } =>
            !!x && typeof x === 'object' && typeof (x as { key?: unknown }).key === 'string')
          .slice(0, 10)
        if (custom.length) f.custom = custom as ContactFilters['custom']
      }
    } catch {
      // Ignore a malformed custom filter param.
    }
  }
  const responded = one(sp.responded)
  if (responded) {
    const [surveyId, has] = responded.split(':')
    if (surveyId && UUID_RE.test(surveyId)) f.responded = [{ survey_id: surveyId, has: has !== 'no', complete_only: true }]
  }
  return f
}

/** Inverse of paramsToFilters, used to turn a saved view into a URL. */
export function filtersToParams(f: ContactFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.lead_status?.length) p.set('status', f.lead_status.join(','))
  if (f.tags?.values.length) {
    p.set('tags', f.tags.values.join(','))
    if (f.tags.mode && f.tags.mode !== 'any') p.set('tagmode', f.tags.mode)
  }
  if (f.owner) {
    const o = [...(f.owner.me ? ['me'] : []), ...(f.owner.unassigned ? ['unassigned'] : []), ...(f.owner.ids ?? [])]
    if (o.length) p.set('owner', o.join(','))
  }
  if (f.follow_up) p.set('follow', f.follow_up)
  if (f.source) p.set('source', f.source)
  if (f.last_response_from) p.set('lr_from', f.last_response_from.slice(0, 10))
  if (f.last_response_to) p.set('lr_to', dayBefore(f.last_response_to))
  if (f.created_from) p.set('c_from', f.created_from.slice(0, 10))
  if (f.created_to) p.set('c_to', dayBefore(f.created_to))
  if (f.custom?.length) p.set('cf', JSON.stringify(f.custom))
  const r = f.responded?.[0]
  if (r) p.set('responded', `${r.survey_id}:${r.has === false ? 'no' : 'yes'}`)
  return p
}

export function paramsToColumns(sp: SearchParams, fallback: string[] = DEFAULT_COLUMNS): string[] {
  const cols = many(sp.cols).filter((c) => (CORE_COLUMNS as readonly string[]).includes(c) || /^custom\.[a-z][a-z0-9_]{0,39}$/.test(c))
  return cols.length ? cols : fallback
}

export type Cursor = { updated_at: string; id: string }

export function encodeCursor(c: Cursor): string {
  return `${c.updated_at}|${c.id}`
}
export function decodeCursor(v: string | string[] | undefined): Cursor | null {
  const s = one(v)
  if (!s) return null
  const [updated_at, id] = s.split('|')
  if (!updated_at || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(updated_at))) return null
  return { updated_at, id }
}

export function hasAnyFilter(f: ContactFilters): boolean {
  return Object.keys(f).length > 0
}
