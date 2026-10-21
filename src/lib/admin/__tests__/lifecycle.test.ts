import { describe, expect, it } from 'vitest'
import {
  canRequestDeletion,
  canRestore,
  deletionAvailableAt,
  formatBytes,
  formatDate,
  inviteStatus,
  lifecycleState,
  purgeDueAt,
  slugRedirectActive,
} from '../lifecycle'

const now = new Date('2026-10-21T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()

describe('workspace lifecycle timing', () => {
  it('names the state', () => {
    expect(lifecycleState({ archived_at: null, deleted_at: null })).toBe('active')
    expect(lifecycleState({ archived_at: daysAgo(1), deleted_at: null })).toBe('archived')
    expect(lifecycleState({ archived_at: daysAgo(10), deleted_at: daysAgo(1) })).toBe('deletion_requested')
  })

  it('offers deletion 7 days after archiving', () => {
    expect(deletionAvailableAt({ archived_at: null, deleted_at: null })).toBeNull()
    expect(canRequestDeletion({ archived_at: daysAgo(6), deleted_at: null }, now)).toBe(false)
    expect(canRequestDeletion({ archived_at: daysAgo(7), deleted_at: null }, now)).toBe(true)
    expect(deletionAvailableAt({ archived_at: '2026-10-01T00:00:00Z', deleted_at: null })?.toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })

  it('allows restore for 30 days after the deletion request', () => {
    expect(canRestore({ archived_at: daysAgo(40), deleted_at: daysAgo(29) }, now)).toBe(true)
    expect(canRestore({ archived_at: daysAgo(40), deleted_at: daysAgo(31) }, now)).toBe(false)
    expect(purgeDueAt({ archived_at: null, deleted_at: null })).toBeNull()
  })

  it('keeps old slugs redirecting for 30 days', () => {
    expect(slugRedirectActive(daysAgo(29), now)).toBe(true)
    expect(slugRedirectActive(daysAgo(31), now)).toBe(false)
  })
})

describe('formatting', () => {
  it('formats dates in UTC and bytes in binary units', () => {
    expect(formatDate('2026-10-21T23:30:00Z')).toBe('Oct 21, 2026')
    expect(formatDate(null)).toBe('')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(26_214_400)).toBe('25 MB')
  })
})

describe('inviteStatus', () => {
  const future = '2027-01-01T00:00:00Z'
  it('orders revoked, used, expired, open', () => {
    expect(inviteStatus({ revoked_at: daysAgo(1), expires_at: future }, now)).toBe('revoked')
    expect(inviteStatus({ revoked_at: null, expires_at: future, used_count: 1, max_uses: 1 }, now)).toBe('used')
    expect(inviteStatus({ revoked_at: null, expires_at: future, used_at: daysAgo(1) }, now)).toBe('used')
    expect(inviteStatus({ revoked_at: null, expires_at: daysAgo(1), used_count: 0, max_uses: 5 }, now)).toBe('expired')
    expect(inviteStatus({ revoked_at: null, expires_at: future, used_count: 2, max_uses: 5 }, now)).toBe('open')
  })
})
