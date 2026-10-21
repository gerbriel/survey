import 'server-only'
import { z } from 'zod'
import type { WorkspaceRole } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id, workspaceRole } from '@/lib/db/rpc'
import { affected } from './shared'

/**
 * Members (doc 05 section 2). Reads: every member (workspace_members_select).
 * Role changes and removal: admin under RLS, with guard_workspace_member
 * enforcing the owner-only cases. Ownership moves only through
 * transfer_workspace_ownership (src/lib/db/workspaces.ts).
 *
 * Emails are not shown: they live in auth.users, which members cannot read.
 * Foundation change request: a SECURITY DEFINER members view with email.
 */
export type MemberRow = {
  user_id: string
  role: WorkspaceRole
  created_at: string
  invite_id: string | null
  display_name: string
  avatar_url: string | null
  status: string | null
}

export const listMembersInput = z.object({ workspaceId: id })

export function listMembers(client: UserClient, input: z.input<typeof listMembersInput>) {
  return call(
    listMembersInput,
    input,
    (v) =>
      client
        .from('workspace_members')
        .select('user_id, role, created_at, invite_id, profile:profiles(display_name, avatar_url, status)')
        .eq('workspace_id', v.workspaceId),
    (rows): MemberRow[] =>
      (rows ?? [])
        .map((r) => {
          const p = r.profile as { display_name: string; avatar_url: string | null; status: string } | null
          return {
            user_id: r.user_id,
            role: r.role,
            created_at: r.created_at,
            invite_id: r.invite_id,
            display_name: p?.display_name ?? 'Unknown user',
            avatar_url: p?.avatar_url ?? null,
            status: p?.status ?? null,
          }
        })
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  )
}

export const changeRoleInput = z.object({
  workspaceId: id,
  userId: id,
  role: workspaceRole.exclude(['owner']),
})

export function changeMemberRole(client: UserClient, input: z.input<typeof changeRoleInput>) {
  return call(
    changeRoleInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_members')
          .update({ role: v.role })
          .eq('workspace_id', v.workspaceId)
          .eq('user_id', v.userId)
          .select('user_id'),
      ),
    () => undefined,
  )
}

export const removeMemberInput = z.object({ workspaceId: id, userId: id })

/** Admin removes editors and viewers, owner removes anyone else, anyone but the owner may leave. */
export function removeMember(client: UserClient, input: z.input<typeof removeMemberInput>) {
  return call(
    removeMemberInput,
    input,
    (v) =>
      affected(
        client
          .from('workspace_members')
          .delete()
          .eq('workspace_id', v.workspaceId)
          .eq('user_id', v.userId)
          .select('user_id'),
      ),
    () => undefined,
  )
}
