import 'server-only'
import type { User } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import type { WorkspaceRole } from '@/types/db-helpers'
import { createServerClient } from '@/lib/supabase/server'
import type { UserClient } from '@/lib/supabase/types'
import { getProfile, type Profile } from '@/lib/db/profiles'
import { getMembership, getWorkspaceBySlug, listMemberships, type MembershipSummary, type Workspace } from '@/lib/db/workspaces'
import { loginPath, PENDING_PATH } from './paths'
import { memberCan } from './roles'

/**
 * Route guards for the (dashboard) group: server components, layouts and
 * server actions on DASHBOARD_HOST.
 *
 * UX ONLY. These decide what to render and where to redirect so the UI makes
 * sense. They are not authorization: RLS policies and the SQL functions refuse
 * the request whatever a guard decided. Never skip an RLS-backed query because
 * a guard passed, and never use a guard result to justify the admin client.
 */

export type AuthContext = {
  supabase: UserClient
  user: User
  /** Null only if the signup trigger failed; treated as pending. */
  profile: Profile | null
}

/**
 * The signed-in user for this request, or null. Cached per request with
 * React cache, so layouts and pages share one getUser round trip.
 * getUser() revalidates the JWT with Supabase Auth; never trust getSession().
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  const profile = await getProfile(supabase, { userId: data.user.id })
  return { supabase, user: data.user, profile: profile.ok ? profile.data : null }
})

export type RequireUserOptions = {
  /** Path to come back to after sign-in. */
  next?: string
  /** The /pending page itself passes true. */
  allowPending?: boolean
}

/** Signed in and active, else redirect to /login or /pending. */
export async function requireUser(opts: RequireUserOptions = {}): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) redirect(loginPath(opts.next))
  const status = ctx.profile?.status ?? 'pending'
  if (status === 'disabled' || status === 'deleted') redirect(loginPath(null, 'account_disabled'))
  if (status === 'pending' && !opts.allowPending) redirect(PENDING_PATH)
  return ctx
}

export type MemberContext = AuthContext & {
  workspace: Workspace
  role: WorkspaceRole
  /** Archived workspaces are read only for everyone (is_member allows viewer checks only). */
  readOnly: boolean
}

export type RequireMemberOptions = {
  /** Where to send a member whose role is too low. Default: notFound(). */
  deniedRedirect?: string
}

/**
 * Member of the workspace with at least `minRole`, else redirect to login or
 * pending, or 404 for a workspace the caller cannot see. A platform admin who
 * is not a member gets a 404 too: admins do not read workspace data unless
 * they are members (00 "Tenancy and authorization").
 */
export async function requireMember(
  workspaceSlug: string,
  minRole: WorkspaceRole = 'viewer',
  opts: RequireMemberOptions = {},
): Promise<MemberContext> {
  const ctx = await requireUser({ next: `/w/${workspaceSlug}` })
  const ws = await getWorkspaceBySlug(ctx.supabase, { slug: workspaceSlug })
  if (!ws.ok || !ws.data) notFound()
  const membership = await getMembership(ctx.supabase, { workspaceId: ws.data.id, userId: ctx.user.id })
  const role = membership.ok ? membership.data : null
  if (!role) notFound()
  if (!memberCan(role, minRole, ws.data)) {
    if (opts.deniedRedirect) redirect(opts.deniedRedirect)
    notFound()
  }
  return { ...ctx, workspace: ws.data, role, readOnly: ws.data.archived_at !== null }
}

/** profiles.is_platform_admin, else 404. The /admin pages call this. */
export async function requirePlatformAdmin(): Promise<AuthContext & { profile: Profile }> {
  const ctx = await requireUser({ next: '/admin' })
  if (!ctx.profile?.is_platform_admin) notFound()
  return ctx as AuthContext & { profile: Profile }
}

export type CurrentWorkspace = MembershipSummary & { memberships: MembershipSummary[] }

/**
 * Where `/` should land: the profile's last_workspace_id when the user is
 * still a member there, else the first workspace by name. Null when signed
 * out or a member of nothing (doc 05 section 4.4 sends that user to /welcome).
 */
export async function getCurrentWorkspace(): Promise<CurrentWorkspace | null> {
  const ctx = await getAuthContext()
  if (!ctx) return null
  const list = await listMemberships(ctx.supabase, { userId: ctx.user.id })
  if (!list.ok || list.data.length === 0) return null
  const memberships = list.data
  const last = ctx.profile?.last_workspace_id
  const pick = memberships.find((m) => m.workspace.id === last) ?? memberships[0]!
  return { ...pick, memberships }
}
