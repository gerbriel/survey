import 'server-only'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/supabase/types'
import { adminMembershipsByUser, adminWorkspaceMembers, insertPlatformAudit, type AdminMemberRow, type UserMembership } from '@/lib/db/admin'
import { fail, makeDbError, ok, toDbError, type DbResult } from '@/lib/db/errors'

export type { AdminMemberRow, UserMembership }

/**
 * Service-role work for /admin (doc 05 section 6). BYPASSES RLS.
 *
 * Every exported function calls requirePlatformAdmin() itself before it
 * creates the admin client, so a caller cannot forget the check. That guard
 * reads profiles.is_platform_admin through the member's own RLS session.
 * Used only for what the member client cannot do:
 *   - Auth admin API: emails, password reset links, bans. These two writes
 *     have no SQL function, so their platform_audit_log row is inserted here
 *     through insertPlatformAudit. Every other admin write audits in SQL.
 *   - Names and roles of members of workspaces the admin is not a member of
 *     (src/lib/db/admin.ts wrappers). Never response or contact rows.
 * Workspace counts come from admin_workspace_stats() as the member.
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

async function audit(admin: AdminClient, actorId: string, action: string, targetId: string): Promise<void> {
  const r = await insertPlatformAudit(admin, { actorId, action, targetType: 'user', targetId })
  if (!r.ok) console.error('platform audit write failed', action, r.error.code)
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

/** Members of one workspace for the force transfer picker. Names and roles only. */
export async function workspaceMembersForAdmin(workspaceId: string): Promise<DbResult<AdminMemberRow[]>> {
  const { admin } = await adminClient()
  return adminWorkspaceMembers(admin, { workspaceId })
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
    await audit(admin, actorId, 'password_reset.mint', uid)
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
    await audit(admin, actorId, banned ? 'user.disable' : 'user.enable', uid)
    return ok(undefined)
  } catch (e) {
    return fail(toDbError(e))
  }
}

/** Every membership keyed by user id, for the /admin/users list. Names and roles only. */
export async function membershipsByUser(): Promise<DbResult<Map<string, UserMembership[]>>> {
  const { admin } = await adminClient()
  return adminMembershipsByUser(admin)
}
