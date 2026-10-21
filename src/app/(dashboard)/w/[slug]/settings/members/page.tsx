import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { listMembers, listMembersWithEmail, type MemberWithEmail } from '@/lib/db/workspaces'
import { listWorkspaceInvites } from '@/lib/db/invites'
import { formatDate } from '@/lib/admin/lifecycle'
import { memberCan } from '@/lib/auth/roles'
import { MembersTable, TransferOwnershipForm, type MemberView } from '@/components/settings/MembersTable'
import { changeRole, removeMemberAction, transferOwnership } from '../actions'

export const metadata: Metadata = { title: 'Members' }

/**
 * Member list (doc 05 section 2). Admins and the owner see sign-in emails
 * through workspace_members_with_email; everyone else sees names only.
 */
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { workspace, role, supabase, user } = await requireMember(slug)
  const isAdmin = memberCan(role, 'admin', workspace)
  const [members, invites] = await Promise.all([
    isAdmin ? listMembersWithEmail(supabase, { workspaceId: workspace.id }) : listMembers(supabase, { workspaceId: workspace.id }),
    isAdmin ? listWorkspaceInvites(supabase, { workspaceId: workspace.id }) : null,
  ])
  const labels = new Map((invites?.ok ? invites.data : []).map((i) => [i.id, i.label]))
  const rows: MemberView[] = (members.ok ? members.data : []).map((m) => ({
    userId: m.user_id,
    name: m.display_name,
    email: (m as Partial<MemberWithEmail>).email ?? null,
    avatarUrl: m.avatar_url,
    role: m.role,
    joined: formatDate(m.created_at),
    inviteLabel: m.invite_id ? (labels.get(m.invite_id) ?? null) : null,
  }))
  const readOnly = workspace.archived_at !== null

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="members-heading" className="flex flex-col gap-4">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members ({rows.length})
        </h2>
        {!members.ok ? (
          <p role="alert" className="text-sm text-danger">
            {members.error.message}
          </p>
        ) : null}
        <MembersTable
          members={rows}
          currentUserId={user.id}
          actorRole={role}
          readOnly={readOnly}
          changeRole={changeRole.bind(null, workspace.slug)}
          remove={removeMemberAction.bind(null, workspace.slug)}
        />
        <p className="text-sm text-muted">
          There is exactly one owner. Admins manage editors and viewers; only the owner promotes or demotes admins. To
          add people, create an invite link.
        </p>
      </section>
      {role === 'owner' && !readOnly ? (
        <section aria-labelledby="transfer-heading" className="flex flex-col gap-4 rounded-lg border border-danger p-4">
          <h2 id="transfer-heading" className="text-lg font-semibold">
            Transfer ownership
          </h2>
          <TransferOwnershipForm
            action={transferOwnership.bind(null, workspace.slug)}
            candidates={rows.filter((r) => r.userId !== user.id)}
          />
        </section>
      ) : null}
    </div>
  )
}
