import { describe, expect, it } from 'vitest'
import { diffLines, pageCount, pageHref, readFilters, readPage } from '../activity-view'
import { limitRows } from '../limits-view'
import { assignableRoles, canRemove, directAddRoles, invitableRoles } from '../member-rules'

describe('member rules (mirror guard_workspace_member)', () => {
  it('direct add (R20): at or below the actor, never owner', () => {
    expect(directAddRoles('owner')).toEqual(['admin', 'editor', 'viewer'])
    expect(directAddRoles('admin')).toEqual(['admin', 'editor', 'viewer'])
    expect(directAddRoles('editor')).toEqual([])
    expect(directAddRoles('viewer')).toEqual([])
  })

  it('owner manages everyone but the owner row; admin manages editors and viewers', () => {
    expect(assignableRoles('owner', 'admin')).toEqual(['admin', 'editor', 'viewer'])
    expect(assignableRoles('owner', 'owner')).toEqual([])
    expect(assignableRoles('admin', 'editor')).toEqual(['editor', 'viewer'])
    expect(assignableRoles('admin', 'admin')).toEqual([])
    expect(assignableRoles('editor', 'viewer')).toEqual([])
  })

  it('anyone but the owner may leave; removal follows the same rule', () => {
    expect(canRemove('viewer', 'viewer', true)).toBe(true)
    expect(canRemove('owner', 'owner', true)).toBe(false)
    expect(canRemove('admin', 'admin', false)).toBe(false)
    expect(canRemove('admin', 'editor', false)).toBe(true)
    expect(canRemove('owner', 'admin', false)).toBe(true)
    expect(canRemove('editor', 'viewer', false)).toBe(false)
  })

  it('invite roles: owner may offer admin, admin may not', () => {
    expect(invitableRoles('owner')).toEqual(['admin', 'editor', 'viewer'])
    expect(invitableRoles('admin')).toEqual(['editor', 'viewer'])
    expect(invitableRoles('editor')).toEqual([])
  })
})

describe('limit rows', () => {
  it('shows defaults without an override row and badges overrides', () => {
    const rows = limitRows(null, null)
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.source === 'default')).toBe(true)
    expect(rows.find((r) => r.key === 'max_file_bytes')?.value).toBe('25 MB')
    const o = limitRows(
      { max_file_bytes: 52_428_800, max_files_per_response: 20, max_questions: 300, max_definition_bytes: 1_048_576, rate_limit_per_hour: 20, raw_script_pixels_allowed: false },
      { max_file_bytes: 52_428_800, raw_script_pixels_allowed: false, max_questions: null },
    )
    expect(o.find((r) => r.key === 'max_file_bytes')).toMatchObject({ value: '50 MB', source: 'override' })
    expect(o.find((r) => r.key === 'raw_script_pixels_allowed')).toMatchObject({ value: 'Turned off', source: 'override' })
    expect(o.find((r) => r.key === 'max_questions')?.source).toBe('default')
  })
})

describe('log filters and paging', () => {
  it('reads only known non-empty filters and a sane page', () => {
    expect(readFilters({ entity: 'survey', actor: '', junk: 'x', action: ['a', 'b'] }, ['entity', 'actor', 'action'])).toEqual({ entity: 'survey' })
    expect(readPage({ page: '3' })).toBe(3)
    expect(readPage({ page: '-1' })).toBe(1)
    expect(readPage({})).toBe(1)
  })

  it('builds page links that keep filters', () => {
    expect(pageHref('/x', { entity: 'pixel' }, 2)).toBe('/x?entity=pixel&page=2')
    expect(pageHref('/x', {}, 1)).toBe('/x')
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(101, 50)).toBe(3)
  })

  it('renders diffs as from and to text', () => {
    expect(diffLines({ name: ['Old', 'New'], show_powered_by: [true, false], logo_path: [null, 'a.png'] })).toEqual([
      { field: 'name', from: 'Old', to: 'New' },
      { field: 'show_powered_by', from: 'true', to: 'false' },
      { field: 'logo_path', from: 'empty', to: 'a.png' },
    ])
    expect(diffLines({ request_id: 'abc' })).toEqual([{ field: 'request_id', from: '', to: 'abc' }])
    expect(diffLines(null)).toEqual([])
  })
})
