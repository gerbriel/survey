import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUERY,
  activeFilterCount,
  applyListQuery,
  clearFilters,
  filterRows,
  listQueryHref,
  listQueryString,
  readListQuery,
  relativeTime,
  sortRows,
  toggleSort,
  visibleSelection,
  type ListQuery,
  type ModelRow,
} from '../listModel'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const DAY = 86_400_000
const OWNER_A = '11111111-1111-4111-8111-111111111111'
const OWNER_B = '22222222-2222-4222-8222-222222222222'

function row(p: Partial<ModelRow> & { id: string }): ModelRow {
  return { title: p.id, slug: p.id, state: 'draft', responses: 0, updatedAt: new Date(NOW - DAY).toISOString(), ownerId: null, ownerName: null, ...p }
}

const ROWS: ModelRow[] = [
  row({ id: 'a', title: 'Alpha feedback', slug: 'alpha-x1', state: 'open', responses: 40, updatedAt: new Date(NOW - 2 * DAY).toISOString(), ownerId: OWNER_B, ownerName: 'Bea' }),
  row({ id: 'b', title: 'beta pulse', slug: 'beta-x2', state: 'closed', responses: 5, updatedAt: new Date(NOW - 40 * DAY).toISOString(), ownerId: OWNER_A, ownerName: 'Ann' }),
  row({ id: 'c', title: 'Gamma signup', slug: 'gamma-x3', state: 'draft', responses: 0, updatedAt: new Date(NOW - 100 * DAY).toISOString() }),
  row({ id: 'd', title: 'Delta event', slug: 'delta-x4', state: 'scheduled', responses: 12, updatedAt: new Date(NOW - 1000).toISOString(), ownerId: OWNER_A, ownerName: 'Ann' }),
]

const ids = (r: ModelRow[]) => r.map((x) => x.id)
const q = (p: Partial<ListQuery>): ListQuery => ({ ...DEFAULT_QUERY, ...p })

describe('readListQuery and listQueryString', () => {
  it('reads defaults from an empty query and writes nothing back', () => {
    expect(readListQuery({})).toEqual(DEFAULT_QUERY)
    expect(listQueryString(DEFAULT_QUERY)).toBe('')
    expect(listQueryHref('/w/a/surveys', DEFAULT_QUERY)).toBe('/w/a/surveys')
  })

  it('round trips every field', () => {
    const full = q({ q: 'pulse', state: 'closed', owner: OWNER_A, assigned: 'mine', updated: '30', sort: 'responses', dir: 'asc' })
    const s = listQueryString(full)
    expect(readListQuery(new URLSearchParams(s))).toEqual(full)
    expect(readListQuery(Object.fromEntries(new URLSearchParams(s)))).toEqual(full)
  })

  it('falls back on unknown values and keeps the legacy archived link', () => {
    expect(readListQuery({ state: 'nope', sort: 'x', dir: 'up', updated: '12', assigned: 'z', owner: 'not-a-uuid' })).toEqual(DEFAULT_QUERY)
    expect(readListQuery({ archived: '1' }).state).toBe('archived')
    expect(readListQuery({ archived: '1', assigned: 'owned' })).toMatchObject({ state: 'archived', assigned: 'owned' })
    expect(readListQuery({ q: ['one', 'two'] }).q).toBe('one')
  })

  it('a non default sort gets its column default direction when dir is missing', () => {
    expect(readListQuery({ sort: 'title' })).toMatchObject({ sort: 'title', dir: 'asc' })
    expect(readListQuery({ sort: 'responses' })).toMatchObject({ sort: 'responses', dir: 'desc' })
  })

  it('writes sort and dir only when they differ from updated desc', () => {
    expect(listQueryString(q({ sort: 'updated', dir: 'asc' }))).toBe('sort=updated&dir=asc')
    expect(listQueryString(q({ q: '  hi  ' }))).toBe('q=hi')
  })
})

describe('toggleSort', () => {
  it('reverses the same column and starts a new one at its default', () => {
    const t = toggleSort(DEFAULT_QUERY, 'title')
    expect(t).toMatchObject({ sort: 'title', dir: 'asc' })
    expect(toggleSort(t, 'title')).toMatchObject({ sort: 'title', dir: 'desc' })
    expect(toggleSort(DEFAULT_QUERY, 'updated')).toMatchObject({ sort: 'updated', dir: 'asc' })
    expect(toggleSort(t, 'responses')).toMatchObject({ sort: 'responses', dir: 'desc' })
  })
})

describe('sortRows', () => {
  it('defaults to newest update first', () => {
    expect(ids(applyListQuery(ROWS, DEFAULT_QUERY, NOW))).toEqual(['d', 'a', 'b', 'c'])
  })
  it('sorts title case insensitively both ways', () => {
    expect(ids(sortRows(ROWS, 'title', 'asc'))).toEqual(['a', 'b', 'd', 'c'])
    expect(ids(sortRows(ROWS, 'title', 'desc'))).toEqual(['c', 'd', 'b', 'a'])
  })
  it('sorts state in lifecycle order', () => {
    expect(ids(sortRows(ROWS, 'state', 'asc'))).toEqual(['c', 'd', 'a', 'b'])
  })
  it('sorts responses numerically', () => {
    expect(ids(sortRows(ROWS, 'responses', 'desc'))).toEqual(['a', 'd', 'b', 'c'])
  })
  it('sorts owner by name with unowned last in both directions, ties by newest', () => {
    expect(ids(sortRows(ROWS, 'owner', 'asc'))).toEqual(['d', 'b', 'a', 'c'])
    expect(ids(sortRows(ROWS, 'owner', 'desc'))).toEqual(['a', 'd', 'b', 'c'])
  })
  it('does not mutate its input', () => {
    const copy = [...ROWS]
    sortRows(ROWS, 'title', 'asc')
    expect(ROWS).toEqual(copy)
  })
})

describe('filterRows', () => {
  it('searches title and slug', () => {
    expect(ids(filterRows(ROWS, q({ q: 'PULSE' }), NOW))).toEqual(['b'])
    expect(ids(filterRows(ROWS, q({ q: 'x3' }), NOW))).toEqual(['c'])
  })
  it('filters by effective state; archived does not narrow the loaded rows', () => {
    expect(ids(filterRows(ROWS, q({ state: 'open' }), NOW))).toEqual(['a'])
    expect(ids(filterRows(ROWS, q({ state: 'archived' }), NOW))).toHaveLength(4)
  })
  it('filters by owner and updated range', () => {
    expect(ids(filterRows(ROWS, q({ owner: OWNER_A }), NOW))).toEqual(['b', 'd'])
    expect(ids(filterRows(ROWS, q({ updated: '7' }), NOW))).toEqual(['a', 'd'])
    expect(ids(filterRows(ROWS, q({ updated: '90' }), NOW))).toEqual(['a', 'b', 'd'])
  })
  it('combines filters, and can match nothing', () => {
    expect(ids(filterRows(ROWS, q({ owner: OWNER_A, updated: '30' }), NOW))).toEqual(['d'])
    expect(filterRows(ROWS, q({ owner: OWNER_B, state: 'closed' }), NOW)).toEqual([])
  })
})

describe('activeFilterCount and clearFilters', () => {
  it('counts narrowing filters only and keeps sort and the archived view on clear', () => {
    const busy = q({ q: 'x', state: 'open', owner: OWNER_A, assigned: 'mine', updated: '7', sort: 'title', dir: 'asc' })
    expect(activeFilterCount(busy)).toBe(5)
    expect(activeFilterCount(q({ state: 'archived' }))).toBe(0)
    expect(clearFilters(busy)).toEqual(q({ sort: 'title', dir: 'asc' }))
    expect(clearFilters(q({ state: 'archived', q: 'x' }))).toEqual(q({ state: 'archived' }))
  })
})

describe('relativeTime and visibleSelection', () => {
  it('formats elapsed time', () => {
    expect(relativeTime(new Date(NOW - 10_000).toISOString(), NOW)).toBe('just now')
    expect(relativeTime(new Date(NOW - 60_000).toISOString(), NOW)).toBe('1 minute ago')
    expect(relativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 hours ago')
    expect(relativeTime(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe('2 days ago')
    expect(relativeTime(new Date(NOW - 65 * DAY).toISOString(), NOW)).toBe('2 months ago')
    expect(relativeTime(new Date(NOW - 800 * DAY).toISOString(), NOW)).toBe('2 years ago')
  })
  it('keeps only selected ids that are on screen, in screen order', () => {
    expect(visibleSelection(new Set(['d', 'zz', 'a']), ROWS)).toEqual(['a', 'd'])
  })
})
