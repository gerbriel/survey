/**
 * Surveys list model: query string, filters and sort. Pure, unit tested.
 * The page reads the query on the server; the client list applies the same
 * functions to the loaded rows so typing and sorting feel instant, and the
 * URL is kept in step so every view is a shareable link.
 *
 * Workspaces hold tens of surveys, so sorting and filtering the loaded rows
 * in memory is the design, not a shortcut.
 */

import { ASSIGNMENT_FILTERS, type AssignmentFilter } from '@/lib/db/assignments'
import type { EffectiveState } from '@/lib/builder/state'

export const SORT_KEYS = ['title', 'state', 'responses', 'updated', 'owner'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

/** `archived` is not an effective state: it switches the page to the archived surveys. */
export const STATE_FILTERS = ['any', 'draft', 'scheduled', 'open', 'closed', 'archived'] as const
export type StateFilter = (typeof STATE_FILTERS)[number]

export const UPDATED_RANGES = ['any', '7', '30', '90'] as const
export type UpdatedRange = (typeof UPDATED_RANGES)[number]

export interface ListQuery {
  q: string
  state: StateFilter
  /** Owner user id, or '' for anyone. */
  owner: string
  assigned: AssignmentFilter
  updated: UpdatedRange
  sort: SortKey
  dir: SortDir
}

export const DEFAULT_QUERY: ListQuery = { q: '', state: 'any', owner: '', assigned: 'all', updated: 'any', sort: 'updated', dir: 'desc' }

/** Minimal row shape the model needs; SurveyListRow extends it. */
export interface ModelRow {
  id: string
  title: string
  slug: string
  state: EffectiveState
  responses: number
  updatedAt: string
  ownerId: string | null
  ownerName: string | null
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function first(p: Params, key: string): string | undefined {
  if (p instanceof URLSearchParams) return p.get(key) ?? undefined
  const v = p[key]
  return Array.isArray(v) ? v[0] : v
}

function pick<T extends string>(list: readonly T[], v: string | undefined, fallback: T): T {
  return v !== undefined && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Default direction when a column is first clicked. Decision: text columns start A to Z, numbers and dates start highest or newest. */
export function defaultDir(key: SortKey): SortDir {
  return key === 'title' || key === 'owner' || key === 'state' ? 'asc' : 'desc'
}

/**
 * Query string to a ListQuery. Unknown values fall back to the defaults.
 * The legacy `archived=1` link (before this list had a state filter) reads as state=archived.
 */
export function readListQuery(p: Params): ListQuery {
  const legacyArchived = first(p, 'archived') === '1'
  const state = pick(STATE_FILTERS, first(p, 'state'), legacyArchived ? 'archived' : 'any')
  const owner = first(p, 'owner') ?? ''
  const sort = pick(SORT_KEYS, first(p, 'sort'), DEFAULT_QUERY.sort)
  const dirRaw = first(p, 'dir')
  return {
    q: (first(p, 'q') ?? '').slice(0, 200),
    state,
    owner: UUID.test(owner) ? owner.toLowerCase() : '',
    assigned: pick(ASSIGNMENT_FILTERS, first(p, 'assigned'), 'all'),
    updated: pick(UPDATED_RANGES, first(p, 'updated'), 'any'),
    sort,
    dir: dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : sort === DEFAULT_QUERY.sort ? DEFAULT_QUERY.dir : defaultDir(sort),
  }
}

/** ListQuery to a query string without the leading `?`; default values are left out so the plain list URL stays plain. */
export function listQueryString(q: ListQuery): string {
  const s = new URLSearchParams()
  const term = q.q.trim()
  if (term) s.set('q', term)
  if (q.state !== 'any') s.set('state', q.state)
  if (q.owner) s.set('owner', q.owner)
  if (q.assigned !== 'all') s.set('assigned', q.assigned)
  if (q.updated !== 'any') s.set('updated', q.updated)
  if (q.sort !== DEFAULT_QUERY.sort || q.dir !== DEFAULT_QUERY.dir) {
    s.set('sort', q.sort)
    s.set('dir', q.dir)
  }
  return s.toString()
}

export function listQueryHref(base: string, q: ListQuery): string {
  const s = listQueryString(q)
  return s ? `${base}?${s}` : base
}

/** Header click: the same column reverses, a new column starts at its default direction. */
export function toggleSort(q: ListQuery, key: SortKey): ListQuery {
  return q.sort === key ? { ...q, dir: q.dir === 'asc' ? 'desc' : 'asc' } : { ...q, sort: key, dir: defaultDir(key) }
}

/**
 * Number of filters that narrow the list (search included, sort excluded).
 * Decision: the archived view is a place rather than a narrowing filter, so
 * state=archived does not count and clear all stays in it.
 */
export function activeFilterCount(q: ListQuery): number {
  return [q.q.trim() !== '', q.state !== 'any' && q.state !== 'archived', q.owner !== '', q.assigned !== 'all', q.updated !== 'any'].filter(Boolean).length
}

/** Decision: clear all resets every filter and the search but keeps the sort and the archived view. */
export function clearFilters(q: ListQuery): ListQuery {
  return { ...DEFAULT_QUERY, state: q.state === 'archived' ? 'archived' : 'any', sort: q.sort, dir: q.dir }
}

const DAY = 86_400_000

/**
 * Filters the client applies: search, effective state, owner, updated range.
 * The assignment filter needs collaborator ids and is applied on the server
 * with matchesAssignmentFilter; `archived` picks which rows are loaded.
 */
export function filterRows<T extends ModelRow>(rows: T[], q: ListQuery, now: number): T[] {
  const term = q.q.trim().toLowerCase()
  const since = q.updated === 'any' ? null : now - Number(q.updated) * DAY
  return rows.filter((r) => {
    if (term && !r.title.toLowerCase().includes(term) && !r.slug.toLowerCase().includes(term)) return false
    if (q.state !== 'any' && q.state !== 'archived' && r.state !== q.state) return false
    if (q.owner && r.ownerId !== q.owner) return false
    if (since !== null && Date.parse(r.updatedAt) < since) return false
    return true
  })
}

/** Decision: state sorts in lifecycle order, not alphabetically. */
const STATE_ORDER: Record<EffectiveState, number> = { draft: 0, scheduled: 1, open: 2, closed: 3 }

function compare(a: ModelRow, b: ModelRow, key: SortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
    case 'state':
      return STATE_ORDER[a.state] - STATE_ORDER[b.state]
    case 'responses':
      return a.responses - b.responses
    case 'updated':
      return Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
    case 'owner': {
      // Decision: surveys with no owner sort last in both directions.
      if (!a.ownerName || !b.ownerName) return 0
      return a.ownerName.localeCompare(b.ownerName, undefined, { sensitivity: 'base' })
    }
  }
}

/** Stable sort; ties fall back to newest update, then title, so the order never jumps. */
export function sortRows<T extends ModelRow>(rows: T[], sort: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort === 'owner' && !a.ownerName !== !b.ownerName) return a.ownerName ? -1 : 1
    const c = compare(a, b, sort) * sign
    if (c !== 0) return c
    const u = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    return u !== 0 ? u : a.title.localeCompare(b.title)
  })
}

export function applyListQuery<T extends ModelRow>(rows: T[], q: ListQuery, now: number): T[] {
  return sortRows(filterRows(rows, q, now), q.sort, q.dir)
}

/** "3 minutes ago" style text for the Updated column, against the request time so server and client agree. */
export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso))
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const y = Math.floor(d / 365)
  return `${y} year${y === 1 ? '' : 's'} ago`
}

/** Selection limited to the rows on screen, so a bulk action never touches a hidden survey. */
export function visibleSelection(selected: ReadonlySet<string>, shown: Array<{ id: string }>): string[] {
  return shown.filter((r) => selected.has(r.id)).map((r) => r.id)
}
