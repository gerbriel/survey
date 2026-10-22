import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireMember: vi.fn(), getAuthContext: vi.fn() }))
vi.mock('@/lib/auth/guards', () => auth)
vi.mock('../publish', () => ({ publishDraft: vi.fn() }))
const db = vi.hoisted(() => ({ getSurvey: vi.fn(), deleteSurvey: vi.fn() }))
vi.mock('@/lib/db/surveys', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...db }))

import { bulkDeleteSurveysAction } from '../actions'
import { BULK_MAX } from '../list'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const WS = { id: id(900), slug: 'acme', archived_at: null }
const member = (role: string) => ({ supabase: {}, workspace: WS, role })
const survey = (n: number, archived: boolean) => ({ ok: true, data: { id: id(n), workspace_id: WS.id, archived_at: archived ? '2026-10-01T00:00:00Z' : null } })

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireMember.mockResolvedValue(member('admin'))
})

describe('bulkDeleteSurveysAction', () => {
  it('deletes archived surveys, refuses live and foreign ones, and aggregates', async () => {
    db.getSurvey.mockImplementation(async (_c: unknown, { surveyId, workspaceId }: { surveyId: string; workspaceId: string }) => {
      expect(workspaceId).toBe(WS.id)
      if (surveyId === id(1)) return survey(1, true)
      if (surveyId === id(2)) return survey(2, false)
      if (surveyId === id(3)) return { ok: true, data: null }
      return survey(4, true)
    })
    db.deleteSurvey.mockImplementation(async (_c: unknown, { surveyId }: { surveyId: string }) =>
      surveyId === id(4) ? { ok: false, error: { code: 'not_authorized', message: 'You do not have permission to do that.' } } : { ok: true, data: undefined },
    )
    const r = await bulkDeleteSurveysAction('acme', [id(1), id(2), id(3), id(4)])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.succeeded).toBe(1)
    expect(r.data.failed).toBe(3)
    expect(r.data.items).toEqual([
      { surveyId: id(1), ok: true },
      { surveyId: id(2), ok: false, message: 'Archive it first.' },
      { surveyId: id(3), ok: false, message: 'That survey was not found.' },
      { surveyId: id(4), ok: false, message: 'Only workspace admins and owners can delete surveys.' },
    ])
    expect(db.deleteSurvey).toHaveBeenCalledTimes(2)
    expect(db.deleteSurvey).not.toHaveBeenCalledWith(expect.anything(), { surveyId: id(2) })
  })

  it('refuses editors before touching any survey and keeps the cap', async () => {
    auth.requireMember.mockResolvedValue(member('editor'))
    const denied = await bulkDeleteSurveysAction('acme', [id(1)])
    expect(denied).toMatchObject({ ok: false, code: 'permission_denied' })
    expect(db.getSurvey).not.toHaveBeenCalled()

    auth.requireMember.mockResolvedValue(member('owner'))
    db.getSurvey.mockImplementation(async (_c: unknown, { surveyId }: { surveyId: string }) => ({ ok: true, data: { id: surveyId, archived_at: '2026-10-01T00:00:00Z' } }))
    db.deleteSurvey.mockResolvedValue({ ok: true, data: undefined })
    const r = await bulkDeleteSurveysAction('acme', Array.from({ length: BULK_MAX + 20 }, (_, i) => id(i + 1)))
    expect(r.ok && r.data.items.length).toBe(BULK_MAX)
  })
})
