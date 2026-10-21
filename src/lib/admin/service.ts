import 'server-only'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/supabase/types'
import { fail, makeDbError, ok, toDbError, type DbResult } from '@/lib/db/errors'
import type { Json, WorkspaceRole } from '@/types/db-helpers'

/**
 * Service-role work for /admin (doc 05 section 6). BYPASSES RLS.
 *
 * Every exported function calls requirePlatformAdmin() itself before it
 * creates the admin client, so a caller cannot forget the check. That guard
 * reads profiles.is_platform_admin through the member's own RLS session.
 * Used only for what the member client cannot do:
 *   - Auth admin API: emails, password reset links, bans.
 *   - Counts across workspaces the admin is not a member of (doc 05 says
 *     admin_workspace_stats(); it does not exist yet, see the foundation
 *     change request in the Phase 2A report). Numbers only, never rows.
 *   - platform_audit_log rows for platform admin writes that are plain
 *     table updates (authenticated has no insert on that table).
 */

export type AuthUserSummary = {
  id: string
  email: string | null
  lastSignInAt: string | null
  bannedUntil: string | null
  providers: string[]
}

async function adminClient(): Promise<{ admin: AdminClient; actorId: string }> {
  const ctx = await requirePlatformAdmin()
  return { admin: createAdminClient(), actorId: ctx.user.id }
}

async function insertAudit(
  admin: AdminClient,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin
    .from('platform_audit_log')
    .insert({ actor: actorId, action, target_type: targetType, target_id: targetId, details: details as { [key: string]: Json } })
  if (error) console.error('platform audit write failed', action, error.message)
}

const auditInput = z.object({
  action: z.string().min(1).max(80),
  targetType: z.string().min(1).max(40),
  targetId: z.guid().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
})

/** Audit row for a platform admin write done under RLS (invites, notice, reports, request dismissals). */
export async function auditPlatformAction(input: z.input<typeof auditInput>): Promise<void> {
  const v = auditInput.parse(input)
  const { admin, actorId } = await adminClient()
  await insertAudit(admin, actorId, v.action, v.targetType, v.targetId, v.details)
}

/** Every auth user's email and sign-in facts, keyed by id. Up to 10,000 users. */
export async function listAuthUsers(): Promise<DbResult<Map<string, AuthUserSummary>>> {
  const { admin } = await adminClient()
  const out = new Map<string, AuthUserSummary>()
  try {
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return fail(toDbError(error))
      for (const u of data.users) {
        out.set(u.id, {
          id: u.id,
          email: u.email ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          bannedUntil: (u as { banned_until?: string | null }).banned_until ?? null,
          providers: (u.identities ?? []).map((i) => i.provider),
        })
      }
      if (data.users.length < 1000) break
    }
    return ok(out)
  } catch (e) {
    return fail(toDbError(e))
  }
}

export type WorkspaceCounts = {
  members: number
  surveys: number
  responses: number
  ownerId: string | null
}

/** Member, survey and response counts plus the owner id per workspace. Numbers only. */
export async function workspaceCounts(workspaceIds: string[]): Promise<DbResult<Record<string, WorkspaceCounts>>> {
  const ids = z.array(z.guid()).max(1000).parse(workspaceIds)
  const { admin } = await adminClient()
  try {
    const out: Record<string, WorkspaceCounts> = {}
    const members = await admin.from('workspace_members').select('workspace_id, user_id, role').in('workspace_id', ids)
    if (members.error) return fail(toDbError(members.error))
    for (const wsId of ids) out[wsId] = { members: 0, surveys: 0, responses: 0, ownerId: null }
    for (const m of members.data ?? []) {
      const c = out[m.workspace_id]
      if (!c) continue
      c.members++
      if (m.role === 'owner') c.ownerId = m.user_id
    }
    await Promise.all(
      ids.map(async (wsId) => {
        const [s, r] = await Promise.all([
          admin.from('surveys').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId),
          admin.from('responses').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId),
        ])
        const c = out[wsId]
        if (c) {
          c.surveys = s.count ?? 0
          c.responses = r.count ?? 0
        }
      }),
    )
    return ok(out)
  } catch (e) {
    return fail(toDbError(e))
  }
}

export type AdminMemberRow = { user_id: string; role: WorkspaceRole; display_name: string; status: string }

/** Members of one workspace for the force transfer picker. Names and roles only. */
export async function workspaceMembersForAdmin(workspaceId: string): Promise<DbResult<AdminMemberRow[]>> {
  const wsId = z.guid().parse(workspaceId)
  const { admin } = await adminClient()
  const { data, error } = await admin
    .from('workspace_members')
    .select('user_id, role, profile:profiles(display_name, status)')
    .eq('workspace_id', wsId)
  if (error) return fail(toDbError(error))
  return ok(
    (data ?? []).map((r) => {
      const p = r.profile as { display_name: string; status: string } | null
      return { user_id: r.user_id, role: r.role, display_name: p?.display_name ?? 'Unknown user', status: p?.status ?? 'pending' }
    }),
  )
}

/**
 * Admin-assisted password reset (doc 05 section 4.3). Returns the link once;
 * it is never stored. Audited as password_reset.mint.
 */
export async function mintPasswordResetLink(userId: string): Promise<DbResult<{ link: string; email: string }>> {
  const uid = z.guid().parse(userId)
  const { admin, actorId } = await adminClient()
  try {
    const user = await admin.auth.admin.getUserById(uid)
    if (user.error || !user.data.user) return fail(makeDbError('not_found'))
    const email = user.data.user.email
    if (!email) return fail(makeDbError('invalid_state', 'This user has no email address.'))
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    if (error || !data.properties?.action_link) return fail(error ? toDbError(error) : makeDbError('unknown'))
    await insertAudit(admin, actorId, 'password_reset.mint', 'user', uid, {})
    return ok({ link: data.properties.action_link, email })
  } catch (e) {
    return fail(toDbError(e))
  }
}

/**
 * Deactivate or reactivate sign-in at the Auth layer (Supabase ban). The
 * profiles.status change happens first under RLS in the caller, so the
 * owner guard can refuse it before anything is banned.
 */
export async function setAuthBan(userId: string, banned: boolean): Promise<DbResult<undefined>> {
  const uid = z.guid().parse(userId)
  const { admin, actorId } = await adminClient()
  try {
    const { error } = await admin.auth.admin.updateUserById(uid, { ban_duration: banned ? '876000h' : 'none' })
    if (error) return fail(toDbError(error))
    await insertAudit(admin, actorId, banned ? 'user.disable' : 'user.enable', 'user', uid, {})
    return ok(undefined)
  } catch (e) {
    return fail(toDbError(e))
  }
}

export type UserMembership = { workspaceId: string; name: string; slug: string; role: WorkspaceRole }

/** Every membership keyed by user id, for the /admin/users list. Names and roles only. */
export async function membershipsByUser(): Promise<DbResult<Map<string, UserMembership[]>>> {
  const { admin } = await adminClient()
  const { data, error } = await admin
    .from('workspace_members')
    .select('user_id, role, workspace:workspaces(id, name, slug)')
    .limit(10_000)
  if (error) return fail(toDbError(error))
  const out = new Map<string, UserMembership[]>()
  for (const r of data ?? []) {
    const w = r.workspace as { id: string; name: string; slug: string } | null
    if (!w) continue
    out.set(r.user_id, [...(out.get(r.user_id) ?? []), { workspaceId: w.id, name: w.name, slug: w.slug, role: r.role }])
  }
  return ok(out)
}
