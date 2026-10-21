import { describe, expect, it } from 'vitest'
import { ROLE_ORDER, compareRolesDesc, isWorkspaceRole, memberCan, roleAtLeast, roleRank } from '../roles'
import { Constants } from '@/types/database'

describe('role ordering mirrors is_member', () => {
  it('matches the workspace_role enum order in the database', () => {
    expect([...ROLE_ORDER]).toEqual([...Constants.public.Enums.workspace_role])
  })

  it('ranks viewer < editor < admin < owner', () => {
    expect(roleRank('viewer')).toBeLessThan(roleRank('editor'))
    expect(roleRank('editor')).toBeLessThan(roleRank('admin'))
    expect(roleRank('admin')).toBeLessThan(roleRank('owner'))
  })

  it('roleAtLeast covers the full matrix', () => {
    for (const role of ROLE_ORDER) {
      for (const min of ROLE_ORDER) {
        expect(roleAtLeast(role, min)).toBe(ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min))
      }
    }
    expect(roleAtLeast(null, 'viewer')).toBe(false)
    expect(roleAtLeast(undefined, 'viewer')).toBe(false)
  })

  it('archived workspaces allow viewer checks only', () => {
    const archived = { archived_at: '2026-10-01T00:00:00Z' }
    const live = { archived_at: null }
    expect(memberCan('owner', 'viewer', archived)).toBe(true)
    expect(memberCan('owner', 'editor', archived)).toBe(false)
    expect(memberCan('owner', 'owner', archived)).toBe(false)
    expect(memberCan('editor', 'editor', live)).toBe(true)
    expect(memberCan('viewer', 'editor', live)).toBe(false)
    expect(memberCan(null, 'viewer', live)).toBe(false)
  })

  it('sorts highest first and recognizes roles', () => {
    expect(['viewer', 'owner', 'editor', 'admin'].sort((a, b) => compareRolesDesc(a as never, b as never))).toEqual([
      'owner',
      'admin',
      'editor',
      'viewer',
    ])
    expect(isWorkspaceRole('admin')).toBe(true)
    expect(isWorkspaceRole('superuser')).toBe(false)
    expect(isWorkspaceRole(3)).toBe(false)
  })
})
