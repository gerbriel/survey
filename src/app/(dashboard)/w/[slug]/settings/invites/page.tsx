import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { listMembers } from '@/lib/admin/db/members'
import { listWorkspaceInvites } from '@/lib/admin/db/invites'
import { formatDate, inviteStatus } from '@/lib/admin/lifecycle'
import { inviteUrl } from '@/lib/admin/links'
import { EmptyState } from '@/components/ui/EmptyState'
import { InviteCreateForm, InvitesTable, type InviteView } from '@/components/settings/Invites'
import { invitableRoles } from '@/components/settings/member-rules'
import { createInvite, revokeInvite } from '../actions'

export const metadata: Metadata = { title: 'Invites' }

/** Invite links (doc 05 section 3.2). Admin and owner; nothing is emailed. */
export default async function InvitesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { workspace, role, supabase } = await requireMember(slug, 'admin', { deniedRedirect: `/w/${slug}/settings/general` })
  const [invites, members] = await Promise.all([
    listWorkspaceInvites(supabase, { workspaceId: workspace.id }),
    listMembers(supabase, { workspaceId: workspace.id }),
  ])
  const names = new Map((members.ok ? members.data : []).map((m) => [m.user_id, m.display_name]))
  const rows: InviteView[] = (invites.ok ? invites.data : []).map((i) => ({
    id: i.id,
    label: i.label,
    role: i.role,
    createdBy: i.created_by ? (names.get(i.created_by) ?? 'Former member') : 'Unknown',
    expires: formatDate(i.expires_at),
    uses: `${i.used_count}/${i.max_uses}`,
    status: inviteStatus(i),
    url: inviteUrl(i.token),
  }))
  const readOnly = workspace.archived_at !== null

  return (
    <div className="flex flex-col gap-8">
      {!readOnly ? (
        <section aria-labelledby="new-invite" className="flex flex-col gap-4">
          <h2 id="new-invite" className="text-lg font-semibold">
            Create an invite link
          </h2>
          <InviteCreateForm action={createInvite.bind(null, workspace.slug)} roles={invitableRoles(role)} />
        </section>
      ) : null}
      <section aria-labelledby="invite-list" className="flex flex-col gap-4">
        <h2 id="invite-list" className="text-lg font-semibold">
          Invite links
        </h2>
        {!invites.ok ? (
          <p role="alert" className="text-sm text-danger">
            {invites.error.message}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState title="No invite links yet" description="Create one above and share it however you like." />
        ) : (
          <InvitesTable invites={rows} revoke={revokeInvite.bind(null, workspace.slug)} readOnly={readOnly} />
        )}
      </section>
    </div>
  )
}
