import { beforeEach, describe, expect, it, vi } from 'vitest'

/** S6 (R18): the audit row is written before the link exists, and a failed audit mints nothing. */

const calls: string[] = []
const ACTOR = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: async () => ({ user: { id: ACTOR }, supabase: {} }) }))
const insertPlatformAudit = vi.fn()
vi.mock('@/lib/db/admin', () => ({
  insertPlatformAudit: (_c: unknown, input: unknown) => {
    calls.push('audit')
    return insertPlatformAudit(input)
  },
  adminMembershipsByUser: vi.fn(),
  adminWorkspaceMembers: vi.fn(),
}))
const getProfile = vi.fn()
vi.mock('@/lib/db/profiles', () => ({ getProfile: (_c: unknown, input: unknown) => getProfile(input) }))
const generateLink = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: TARGET, email: 'jane@example.org' } }, error: null }),
        generateLink: (...a: unknown[]) => {
          calls.push('generateLink')
          return generateLink(...a)
        },
      },
    },
  }),
}))

const { mintPasswordResetLink } = await import('../service')

beforeEach(() => {
  calls.length = 0
  getProfile.mockReset().mockResolvedValue({ ok: true, data: { is_platform_admin: false } })
  insertPlatformAudit.mockReset().mockResolvedValue({ ok: true, data: undefined })
  generateLink.mockReset().mockResolvedValue({ data: { properties: { action_link: 'https://x/link' } }, error: null })
})

describe('mintPasswordResetLink', () => {
  it('audits first, then mints, and records the target id only', async () => {
    const r = await mintPasswordResetLink(TARGET)
    expect(r).toEqual({ ok: true, data: { link: 'https://x/link', email: 'jane@example.org' } })
    expect(calls).toEqual(['audit', 'generateLink'])
    expect(JSON.stringify(insertPlatformAudit.mock.calls[0]![0])).not.toContain('https://x/link')
  })
  it('aborts without a link when the audit insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    insertPlatformAudit.mockResolvedValue({ ok: false, error: { code: 'permission_denied' } })
    const r = await mintPasswordResetLink(TARGET)
    expect(r.ok).toBe(false)
    expect(calls).toEqual(['audit'])
  })
  it('refuses platform admins and self before auditing or minting', async () => {
    getProfile.mockResolvedValue({ ok: true, data: { is_platform_admin: true } })
    expect((await mintPasswordResetLink(TARGET)).ok).toBe(false)
    getProfile.mockResolvedValue({ ok: true, data: { is_platform_admin: false } })
    const self = await mintPasswordResetLink(ACTOR)
    expect(self.ok === false && self.error.code).toBe('not_authorized')
    expect(calls).toEqual([])
  })
})
