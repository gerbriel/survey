import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { listProfiles } from '@/lib/admin/db/platform'
import { listAccessRequests, listWorkspaceRequests, REQUEST_STATUSES } from '@/lib/admin/db/requests'
import { listAuthUsers, type AuthUserSummary } from '@/lib/admin/service'
import { formatDate } from '@/lib/admin/lifecycle'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { approveAccessRequest, dismissAccessRequestAction, dismissWorkspaceRequestAction } from '../actions'

export const metadata: Metadata = { title: 'Requests' }

type Status = (typeof REQUEST_STATUSES)[number]

/** access_requests and workspace_requests queues (doc 05 sections 1.1 and 4.2). */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requirePlatformAdmin()
  const sp = await searchParams
  const status: Status = (REQUEST_STATUSES as readonly string[]).includes(String(sp.status)) ? (sp.status as Status) : 'open'
  const [access, ws, profiles, users] = await Promise.all([
    listAccessRequests(supabase, { status }),
    listWorkspaceRequests(supabase, { status }),
    listProfiles(supabase),
    listAuthUsers(),
  ])
  const names = new Map((profiles.ok ? profiles.data : []).map((p) => [p.id, p.display_name]))
  const emails = users.ok ? users.data : new Map<string, AuthUserSummary>()
  const open = status === 'open'

  return (
    <>
      <PageHeader title="Requests" description="People asking for access, and members asking for a new workspace." />
      <nav aria-label="Request status" className="mb-6 flex gap-3 text-sm">
        {REQUEST_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/requests?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={s === status ? 'font-semibold underline underline-offset-4' : 'text-accent underline underline-offset-2'}
          >
            {s === 'open' ? 'Open' : s === 'approved' ? 'Approved' : 'Dismissed'}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="access" className="mb-10 flex flex-col gap-4">
        <h2 id="access" className="text-lg font-semibold">
          Access requests
        </h2>
        {!access.ok ? (
          <p role="alert" className="text-sm text-danger">{access.error.message}</p>
        ) : access.data.length === 0 ? (
          <EmptyState title="No access requests" />
        ) : (
          <Table caption="Access requests">
            <THead>
              <Tr>
                <Th>Person</Th>
                <Th>Department</Th>
                <Th>Reason</Th>
                <Th>Asked</Th>
                {open ? <Th><span className="sr-only">Actions</span></Th> : null}
              </Tr>
            </THead>
            <TBody>
              {access.data.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted">{emails.get(r.user_id)?.email ?? 'No email'}</div>
                  </Td>
                  <Td>{r.department ?? ''}</Td>
                  <Td className="max-w-xs whitespace-pre-wrap break-words">{r.reason ?? ''}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.created_at)}</Td>
                  {open ? (
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <InlineAction
                          action={approveAccessRequest}
                          fields={{ requestId: r.id }}
                          label="Approve"
                          variant="primary"
                          confirm={`Activate ${r.name}? They can sign in at once. They still need a workspace invite to see any data.`}
                        />
                        <InlineAction action={dismissAccessRequestAction} fields={{ requestId: r.id }} label="Dismiss" />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
      <section aria-labelledby="ws" className="flex flex-col gap-4">
        <h2 id="ws" className="text-lg font-semibold">
          Workspace requests
        </h2>
        {!ws.ok ? (
          <p role="alert" className="text-sm text-danger">{ws.error.message}</p>
        ) : ws.data.length === 0 ? (
          <EmptyState title="No workspace requests" />
        ) : (
          <Table caption="Workspace requests">
            <THead>
              <Tr>
                <Th>Department</Th>
                <Th>Purpose</Th>
                <Th>Requested by</Th>
                <Th>Asked</Th>
                {open ? <Th><span className="sr-only">Actions</span></Th> : null}
              </Tr>
            </THead>
            <TBody>
              {ws.data.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.department_name}</Td>
                  <Td className="max-w-xs whitespace-pre-wrap break-words">{r.purpose ?? ''}</Td>
                  <Td>
                    <div>{names.get(r.requested_by) ?? 'Unknown'}</div>
                    <div className="text-xs text-muted">{emails.get(r.requested_by)?.email ?? ''}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(r.created_at)}</Td>
                  {open ? (
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/workspaces?request=${r.id}#create`}
                          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg"
                        >
                          Approve and create
                        </Link>
                        <InlineAction action={dismissWorkspaceRequestAction} fields={{ requestId: r.id }} label="Dismiss" />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  )
}
