import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/lib/auth'
import { listPlatformInvites, listProfiles } from '@/lib/admin/db/platform'
import { listAuthUsers, type AuthUserSummary } from '@/lib/admin/service'
import { formatDate, inviteStatus } from '@/lib/admin/lifecycle'
import { inviteUrl } from '@/lib/admin/links'
import { Badge } from '@/components/ui/Badge'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { CopyButton } from '@/components/dashboard/CopyButton'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { PlatformInviteForm } from '@/components/admin/AdminForms'
import { issuePlatformInvite, revokePlatformInviteAction } from '../actions'

export const metadata: Metadata = { title: 'Invites' }

const LABEL = { open: 'Open', used: 'Claimed', expired: 'Expired', revoked: 'Revoked' } as const
const TONE = { open: 'success', used: 'neutral', expired: 'neutral', revoked: 'danger' } as const

/** Platform invites (doc 05 section 3.1) with claim status and email mismatch warnings. */
export default async function AdminInvitesPage() {
  const { supabase } = await requirePlatformAdmin()
  const [invites, profiles, users] = await Promise.all([listPlatformInvites(supabase), listProfiles(supabase), listAuthUsers()])
  const names = new Map((profiles.ok ? profiles.data : []).map((p) => [p.id, p.display_name]))
  const emails = users.ok ? users.data : new Map<string, AuthUserSummary>()

  return (
    <>
      <PageHeader title="Platform invites" description="An invite lets one person become an active user. Links are never emailed." />
      <section aria-labelledby="new" className="mb-10 flex flex-col gap-4">
        <h2 id="new" className="text-lg font-semibold">
          Issue an invite
        </h2>
        <PlatformInviteForm action={issuePlatformInvite} />
      </section>
      <section aria-labelledby="list" className="flex flex-col gap-4">
        <h2 id="list" className="text-lg font-semibold">
          All invites
        </h2>
        {!invites.ok ? (
          <p role="alert" className="text-sm text-danger">
            {invites.error.message}
          </p>
        ) : (
          <Table caption="Platform invites">
            <THead>
              <Tr>
                <Th>Email or note</Th>
                <Th>Created by</Th>
                <Th>Created</Th>
                <Th>Expires</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {invites.data.map((i) => {
                const status = inviteStatus(i)
                const claimedEmail = i.used_by ? (emails.get(i.used_by)?.email ?? null) : null
                const mismatch = Boolean(i.email && claimedEmail && claimedEmail.toLowerCase() !== i.email)
                return (
                  <Tr key={i.id}>
                    <Td>
                      <div>{i.email ?? <span className="text-muted">Link only</span>}</div>
                      {i.note ? <div className="text-xs text-muted">{i.note}</div> : null}
                    </Td>
                    <Td>{i.invited_by ? (names.get(i.invited_by) ?? 'Unknown') : 'System'}</Td>
                    <Td className="whitespace-nowrap">{formatDate(i.created_at)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(i.expires_at)}</Td>
                    <Td>
                      <Badge tone={TONE[status]}>{LABEL[status]}</Badge>
                      {claimedEmail ? (
                        <div className={mismatch ? 'mt-1 text-xs text-warning' : 'mt-1 text-xs text-muted'}>
                          {mismatch ? 'Warning: ' : ''}Claimed by {claimedEmail}
                          {mismatch ? ` (invited ${i.email})` : ''}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      {status === 'open' ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <CopyButton value={inviteUrl(i.token)} />
                          <InlineAction
                            action={revokePlatformInviteAction}
                            fields={{ inviteId: i.id }}
                            label="Revoke"
                            variant="danger"
                            confirm="The link and the email match stop working at once."
                          />
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </section>
    </>
  )
}
