import { describe, expect, it } from 'vitest'
import { conflictRows, defaultChoices, defaultSurvivor, mergedStatus } from './merge'
import type { Contact, FieldDef } from './types'

const c = (id: string, extra: Partial<Contact>): Contact =>
  ({
    id,
    email: null,
    phone: null,
    first_name: null,
    last_name: null,
    company: null,
    owner_id: null,
    follow_up_at: null,
    follow_up_note: null,
    source: null,
    custom: {},
    tags: [],
    lead_status: 'new',
    response_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }) as Contact

describe('merge helpers', () => {
  const a = c('a', { email: 'ana@x.io', company: 'Acme', response_count: 2, created_at: '2026-02-01T00:00:00Z', custom: { plan: 'Pro' } })
  const b = c('b', { email: 'ana@y.io', company: 'Acme', response_count: 2, created_at: '2026-01-01T00:00:00Z', lead_status: 'customer' })
  const d = c('d', { first_name: 'Ana', lead_status: 'lost', custom: { plan: 'Basic' } })

  it('picks the most responses, then the oldest', () => {
    expect(defaultSurvivor([a, b, d])).toBe('b')
  })
  it('lists only fields with differing non-empty values', () => {
    const rows = conflictRows([a, b, d], [{ key: 'plan', label: 'Plan' } as FieldDef], { email: 'Email' })
    expect(rows.map((r) => r.field)).toEqual(['email', 'custom.plan'])
    expect(defaultChoices(rows, 'b')).toEqual({ email: 'b', 'custom.plan': 'a' })
  })
  it('keeps the most advanced status, lost only when all are lost', () => {
    expect(mergedStatus([a, b, d])).toBe('customer')
    expect(mergedStatus([d, c('e', { lead_status: 'lost' })])).toBe('lost')
  })
})
