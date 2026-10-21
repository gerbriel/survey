import { describe, expect, it } from 'vitest'
import { postSignInPath, type ClaimOutcome } from '../post-sign-in'

const WS = '11111111-1111-4111-8111-111111111111'
const out = (status: ClaimOutcome['claim']['status'], extra: Partial<ClaimOutcome> = {}): ClaimOutcome => ({
  claim: { status, workspace_id: null },
  workspaceSlug: null,
  hadToken: false,
  ...extra,
})

describe('postSignInPath', () => {
  it('sends a joined member into the workspace', () => {
    expect(postSignInPath(out('joined', { workspaceSlug: 'hr', hadToken: true, claim: { status: 'joined', workspace_id: WS } }), 'active', null)).toBe('/w/hr')
    expect(
      postSignInPath(out('already_member', { workspaceSlug: 'hr', hadToken: true }), 'active', '/w/other'),
    ).toBe('/w/hr?invite=already_member')
  })

  it('sends pending users to /pending', () => {
    expect(postSignInPath(out('pending'), 'pending', '/w/hr')).toBe('/pending')
    expect(postSignInPath(out('invalid', { hadToken: true }), 'pending', null)).toBe('/pending?invite=invalid')
    expect(postSignInPath(out('pending'), null, null)).toBe('/pending')
  })

  it('honors a safe next for active users', () => {
    expect(postSignInPath(out('active'), 'active', '/w/hr/surveys')).toBe('/w/hr/surveys')
    expect(postSignInPath(out('activated'), 'active', 'https://evil.example')).toBe('/')
    expect(postSignInPath(out('invalid', { hadToken: true }), 'active', '/w/hr')).toBe('/w/hr?invite=invalid')
  })

  it('blocks disabled accounts', () => {
    expect(postSignInPath(out('disabled'), 'disabled', '/w/hr')).toBe('/login?error=account_disabled')
    expect(postSignInPath(out('active'), 'deleted', null)).toBe('/login?error=account_disabled')
  })
})
