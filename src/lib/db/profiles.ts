import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id, readAll } from './rpc'
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

/** One person in the organization directory (R20). Never an email. */
export type DirectoryProfile = { id: string; display_name: string; avatar_url: string | null }

/**
 * directory_profiles() (migration 0020): display name and avatar of every
 * active profile, for "Add existing user" pickers. Active callers only.
 * Read in pages of 1000 (PostgREST max_rows).
 */
export function listDirectory(client: UserClient) {
  return readAll<DirectoryProfile>((from, to) =>
    client
      .rpc('directory_profiles')
      .range(from, to)
      .then((r) => ({ data: (r.data ?? null) as DirectoryProfile[] | null, error: r.error })),
  )
}
