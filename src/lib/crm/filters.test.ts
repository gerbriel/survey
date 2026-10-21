import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, filtersToParams, paramsToColumns, paramsToFilters } from './filters'

const U = '11111111-2222-3333-4444-555555555555'

describe('contact filter URL state', () => {
  it('parses every supported filter', () => {
    const f = paramsToFilters({
      q: ' ana ',
      status: ['new,qualified', 'bogus'],
      tags: 'VIP,event',
      tagmode: 'all',
      owner: `me,unassigned,${U},junk`,
      follow: 'due',
      lr_from: '2026-01-01',
      lr_to: '2026-01-31',
      responded: `${U}:no`,
      cf: JSON.stringify([{ key: 'plan', op: 'eq', value: 'Pro' }]),
    })
    expect(f).toEqual({
      q: 'ana',
      lead_status: ['new', 'qualified'],
      tags: { mode: 'all', values: ['vip', 'event'] },
      owner: { me: true, unassigned: true, ids: [U] },
      follow_up: 'due',
      last_response_from: '2026-01-01',
      last_response_to: '2026-02-01',
      responded: [{ survey_id: U, has: false, complete_only: true }],
      custom: [{ key: 'plan', op: 'eq', value: 'Pro' }],
    })
  })
  it('round trips the built-in views', () => {
    for (const f of [{}, { owner: { me: true }, lead_status: ['new', 'contacted', 'qualified'] as ('new' | 'contacted' | 'qualified')[] }, { follow_up: 'due' as const }]) {
      expect(paramsToFilters(Object.fromEntries(filtersToParams(f)))).toEqual(f)
    }
  })
  it('round trips date ranges inclusively', () => {
    const f = paramsToFilters({ lr_to: '2026-03-01' })
    expect(f.last_response_to).toBe('2026-03-02')
    expect(filtersToParams(f).get('lr_to')).toBe('2026-03-01')
  })
  it('ignores malformed input', () => {
    expect(paramsToFilters({ follow: 'never', lr_from: 'yesterday', cf: '{oops' })).toEqual({})
  })
  it('validates columns and cursors', () => {
    expect(paramsToColumns({ cols: 'name,email,custom.plan,evil;drop' })).toEqual(['name', 'email', 'custom.plan'])
    expect(paramsToColumns({}, ['email'])).toEqual(['email'])
    const c = { updated_at: '2026-10-21T10:00:00.123456+00:00', id: U }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor('x|y')).toBeNull()
  })
})
