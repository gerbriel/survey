import { describe, expect, it } from 'vitest'
import * as admin from '../admin'
import * as assignments from '../assignments'
import * as workspaces from '../workspaces'
import { SQL_ERROR_CODES } from '../errors'
import { fakeClient } from './fake-client'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('assignment and membership zod schemas (0020, R19 and R20)', () => {
  it('assignInput needs two ids', () => {
    expect(assignments.assignInput.safeParse({ surveyId: A, userId: B }).success).toBe(true)
    expect(assignments.assignInput.safeParse({ surveyId: A }).success).toBe(false)
    expect(assignments.assignInput.safeParse({ surveyId: 'x', userId: B }).success).toBe(false)
  })

  it('assignmentsForSurveysInput caps the id list', () => {
    expect(assignments.assignmentsForSurveysInput.safeParse({ surveyIds: [] }).success).toBe(true)
    expect(assignments.assignmentsForSurveysInput.safeParse({ surveyIds: [A, B] }).success).toBe(true)
    expect(assignments.assignmentsForSurveysInput.safeParse({ surveyIds: Array(1001).fill(A) }).success).toBe(false)
    expect(assignments.assignmentsForSurveysInput.safeParse({ surveyIds: ['nope'] }).success).toBe(false)
  })

  it('addWorkspaceMemberInput never accepts owner', () => {
    for (const role of ['admin', 'editor', 'viewer']) {
      expect(workspaces.addWorkspaceMemberInput.safeParse({ workspaceId: A, userId: B, role }).success).toBe(true)
    }
    expect(workspaces.addWorkspaceMemberInput.safeParse({ workspaceId: A, userId: B, role: 'owner' }).success).toBe(false)
    expect(workspaces.addWorkspaceMemberInput.safeParse({ workspaceId: A, userId: B, role: 'boss' }).success).toBe(false)
  })

  it('admin member schemas never accept owner', () => {
    expect(admin.adminMemberRoleInput.safeParse({ workspaceId: A, userId: B, role: 'editor' }).success).toBe(true)
    expect(admin.adminMemberRoleInput.safeParse({ workspaceId: A, userId: B, role: 'owner' }).success).toBe(false)
    expect(admin.adminMemberInput.safeParse({ workspaceId: A, userId: B }).success).toBe(true)
    expect(admin.adminMemberInput.safeParse({ workspaceId: A }).success).toBe(false)
  })
})

describe('wrappers call the SQL functions with the exact argument names', () => {
  it('assignment functions', async () => {
    const f = fakeClient()
    await assignments.setSurveyOwner(f.user, { surveyId: A, userId: B })
    await assignments.addSurveyCollaborator(f.user, { surveyId: A, userId: B })
    await assignments.removeSurveyCollaborator(f.user, { surveyId: A, userId: B })
    expect(f.calls).toEqual([
      { fn: 'set_survey_owner', args: { p_survey_id: A, p_user_id: B } },
      { fn: 'add_survey_collaborator', args: { p_survey_id: A, p_user_id: B } },
      { fn: 'remove_survey_collaborator', args: { p_survey_id: A, p_user_id: B } },
    ])
  })

  it('membership functions', async () => {
    const f = fakeClient()
    await workspaces.addWorkspaceMember(f.user, { workspaceId: A, userId: B, role: 'viewer' })
    await admin.adminAddWorkspaceMember(f.user, { workspaceId: A, userId: B, role: 'editor' })
    await admin.adminRemoveWorkspaceMember(f.user, { workspaceId: A, userId: B })
    await admin.adminSetMemberRole(f.user, { workspaceId: A, userId: B, role: 'admin' })
    expect(f.calls.map((c) => c.fn)).toEqual([
      'add_workspace_member',
      'admin_add_workspace_member',
      'admin_remove_workspace_member',
      'admin_set_member_role',
    ])
    expect(f.calls[0]?.args).toEqual({ p_workspace_id: A, p_user_id: B, p_role: 'viewer' })
  })

  it('refuses owner before any network call', async () => {
    const f = fakeClient()
    const r = await workspaces.addWorkspaceMember(f.user, { workspaceId: A, userId: B, role: 'owner' as 'admin' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_input')
    expect(f.calls).toEqual([])
  })

  it('maps the new SQL codes', async () => {
    for (const code of ['assignee_not_member', 'invalid_role', 'already_member', 'target_not_active']) {
      expect(SQL_ERROR_CODES).toContain(code)
      const f = fakeClient({ data: null, error: { message: code, code: 'P0001' } })
      const r = await assignments.setSurveyOwner(f.user, { surveyId: A, userId: B })
      expect(r.ok ? null : r.error.code).toBe(code)
    }
  })
})

describe('assignment list helpers', () => {
  const row = (survey_id: string, user_id: string, kind: 'owner' | 'collaborator', display_name: string) => ({
    survey_id,
    user_id,
    kind,
    display_name,
    avatar_url: null,
    assigned_at: '2026-10-22T00:00:00Z',
  })
  const groups = assignments.groupAssignments([
    row('s1', B, 'collaborator', 'Zed'),
    row('s1', A, 'owner', 'Ann'),
    row('s1', C, 'collaborator', 'Bo'),
    row('s2', B, 'collaborator', 'Zed'),
  ])

  it('groups owner and collaborators per survey, collaborators by name', () => {
    expect(groups.get('s1')?.owner?.user_id).toBe(A)
    expect(groups.get('s1')?.collaborators.map((c) => c.display_name)).toEqual(['Bo', 'Zed'])
    expect(groups.get('s2')?.owner).toBeNull()
  })

  it('filters', () => {
    const m = assignments.matchesAssignmentFilter
    expect(m('all', undefined, A)).toBe(true)
    expect(m('owned', groups.get('s1'), A)).toBe(true)
    expect(m('owned', groups.get('s1'), B)).toBe(false)
    expect(m('mine', groups.get('s1'), B)).toBe(true)
    expect(m('mine', groups.get('s2'), A)).toBe(false)
    expect(m('unassigned', groups.get('s2'), A)).toBe(true)
    expect(m('unassigned', undefined, A)).toBe(true)
    expect(m('unassigned', groups.get('s1'), A)).toBe(false)
  })

  it('reads the query param', () => {
    expect(assignments.readAssignmentFilter('owned')).toBe('owned')
    expect(assignments.readAssignmentFilter('bogus')).toBe('all')
    expect(assignments.readAssignmentFilter(undefined)).toBe('all')
    expect(assignments.readAssignmentFilter(['mine'])).toBe('all')
  })
})
