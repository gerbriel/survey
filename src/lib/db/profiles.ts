import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from './rpc'
import { z } from 'zod'

/**
 * Profile reads and the one self-service write (last_workspace_id). The
 * profiles policy lets a member read self, people sharing a workspace, and
 * (platform admins) everyone. Status and admin flags are trigger guarded.
 */
export type Profile = Tables<'profiles'>

export const getProfileInput = z.object({ userId: id })

export function getProfile(client: UserClient, input: z.input<typeof getProfileInput>) {
  return call(
    getProfileInput,
    input,
    (v) => client.from('profiles').select('*').eq('id', v.userId).maybeSingle(),
    (row): Profile | null => row ?? null,
  )
}

export const setLastWorkspaceInput = z.object({ userId: id, workspaceId: id.nullable() })

/** Where `/` lands next time (doc 05 section 4.4). */
export function setLastWorkspace(client: UserClient, input: z.input<typeof setLastWorkspaceInput>) {
  return call(
    setLastWorkspaceInput,
    input,
    (v) => client.from('profiles').update({ last_workspace_id: v.workspaceId }).eq('id', v.userId),
    () => undefined,
  )
}

/** Whether the signed-in user is a platform admin, per SQL is_platform_admin(). */
export function isPlatformAdmin(client: UserClient) {
  return call(
    z.undefined().optional(),
    undefined,
    () => client.rpc('is_platform_admin'),
    (v): boolean => v === true,
  )
}
