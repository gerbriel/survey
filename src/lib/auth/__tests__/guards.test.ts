import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`)
  }
}
class NotFound extends Error {}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to)
  },
  notFound: () => {
    throw new NotFound('not found')
  },
}))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T>(fn: T) => fn }))

const supabase = { auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => supabase }))
vi.mock('@/lib/db/profiles', () => ({
  getProfile: async () => ({ ok: true, data: { id: USER, status: 'active', is_platform_admin: false } }),
}))

const db = {
  getWorkspaceBySlug: vi.fn(),
  getSlugHistory: vi.fn(),
  getWorkspaceById: vi.fn(),
  getMembership: vi.fn(),
  listMemberships: vi.fn(),
}
vi.mock('@/lib/db/workspaces', () => db)

const USER = '11111111-1111-4111-8111-111111111111'
const WS = '22222222-2222-4222-8222-222222222222'
const { requireMember, renamedWorkspaceSlug } = await import('../guards')

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const live = { id: WS, slug: 'new-name', archived_at: null, deleted_at: null }

describe('requireMember after a slug rename', () => {
  beforeEach(() => {
    for (const f of Object.values(db)) f.mockReset()
    db.getMembership.mockResolvedValue({ ok: true, data: 'editor' })
  })

  it('redirects an old slug to the current one within 30 days', async () => {
    db.getWorkspaceBySlug.mockResolvedValue({ ok: true, data: null })
    db.getSlugHistory.mockResolvedValue({ ok: true, data: { workspace_id: WS, released_at: daysAgo(3) } })
    db.getWorkspaceById.mockResolvedValue({ ok: true, data: live })
    await expect(requireMember('old-name', 'viewer')).rejects.toMatchObject({ to: '/w/new-name' })
    expect(db.getSlugHistory).toHaveBeenCalledWith(supabase, { slug: 'old-name' })
  })

  it('404s an old slug after 30 days, an unknown slug, and a deleted workspace', async () => {
    db.getWorkspaceBySlug.mockResolvedValue({ ok: true, data: null })
    db.getSlugHistory.mockResolvedValueOnce({ ok: true, data: { workspace_id: WS, released_at: daysAgo(31) } })
    await expect(requireMember('old-name')).rejects.toBeInstanceOf(NotFound)
    db.getSlugHistory.mockResolvedValueOnce({ ok: true, data: null })
    await expect(requireMember('nope')).rejects.toBeInstanceOf(NotFound)
    db.getSlugHistory.mockResolvedValueOnce({ ok: true, data: { workspace_id: WS, released_at: daysAgo(1) } })
    db.getWorkspaceById.mockResolvedValueOnce({ ok: true, data: { ...live, deleted_at: daysAgo(0) } })
    await expect(requireMember('old-name')).rejects.toBeInstanceOf(NotFound)
  })

  it('does not consult history for a live slug', async () => {
    db.getWorkspaceBySlug.mockResolvedValue({ ok: true, data: live })
    const ctx = await requireMember('new-name', 'editor')
    expect(ctx.workspace.slug).toBe('new-name')
    expect(db.getSlugHistory).not.toHaveBeenCalled()
  })

  it('renamedWorkspaceSlug returns null when history is unreadable', async () => {
    db.getSlugHistory.mockResolvedValue({ ok: false, error: { code: 'network' } })
    expect(await renamedWorkspaceSlug(supabase as never, 'old-name')).toBeNull()
  })
})
