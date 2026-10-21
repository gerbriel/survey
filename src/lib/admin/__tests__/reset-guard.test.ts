import { describe, expect, it } from 'vitest'
import { resetLinkRefusal } from '../reset-guard'

describe('S6 (R18) reset link targets', () => {
  const ACTOR = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-8222-222222222222'

  it('refuses the caller themself', () => {
    expect(resetLinkRefusal(ACTOR, ACTOR, { is_platform_admin: false })).toBe('not_authorized')
  })
  it('refuses another platform admin', () => {
    expect(resetLinkRefusal(ACTOR, OTHER, { is_platform_admin: true })).toBe('not_authorized')
  })
  it('refuses an unreadable profile', () => {
    expect(resetLinkRefusal(ACTOR, OTHER, null)).toBe('not_found')
  })
  it('allows an ordinary user', () => {
    expect(resetLinkRefusal(ACTOR, OTHER, { is_platform_admin: false })).toBeNull()
  })
})
