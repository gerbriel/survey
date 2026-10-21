import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/auth'
import { getEffectiveLimits } from '@/lib/db/limits'
import { getAnyWorkspace, getWorkspaceLimitsRow } from '@/lib/admin/db/platform'
import { workspaceMembersForAdmin } from '@/lib/admin/service'
import {
  canRequestDeletion,
  canRestore,
  deletionAvailableAt,
  formatDate,
  formatDateTime,
  lifecycleState,
  purgeDueAt,
} from '@/lib/admin/lifecycle'
import { limitsFormDefaults } from '@/lib/admin/limits-form'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { roleLabel } from '@/components/dashboard/RoleBadge'
import { LimitsEditor } from '@/components/admin/AdminForms'
import { AdminLifecycle, ForceTransferForm } from '@/components/admin/AdminLifecycle'
import { LimitsTable } from '@/components/settings/LimitsTable'
import { limitRows } from '@/components/settings/limits-view'
import {
  adminArchive,
  adminForceTransfer,
  adminRequestDeletion,
  adminRestore,
  adminUnarchive,
  setLimitsAction,
} from '../../actions'

export const metadata: Metadata = { title: 'Workspace' }

function timingText(ws: { archived_at: string | null; deleted_at: string | null }): string {
  const state = lifecycleState(ws)
  if (state === 'active') return 'Active. Archive first; deletion becomes available 7 days after archiving.'
  if (state === 'archived') {
    const at = deletionAvailableAt(ws)
    return canRequestDeletion(ws)
      ? `Archived ${formatDate(ws.archived_at)}. Deletion is available now.`
      : `Archived ${formatDate(ws.archived_at)}. Deletion becomes available on ${formatDate(at)}.`
  }
  const purge = purgeDueAt(ws)
  return canRestore(ws)
    ? `Deletion requested ${formatDate(ws.deleted_at)}. Restorable until ${formatDate(purge)}; after that the nightly job deletes everything.`
    : `Deletion requested ${formatDate(ws.deleted_at)}. The restore window has passed; the purge job will delete it.`
}

export default async function AdminWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { supabase } = await requirePlatformAdmin()
  const { id } = await params
  const sp = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const ws = await getAnyWorkspace(supabase, { workspaceId: id })
  if (!ws.ok || !ws.data) notFound()
  const w = ws.data
  const [limitsRow, effective, members] = await Promise.all([
    getWorkspaceLimitsRow(supabase, { workspaceId: id }),
    getEffectiveLimits(supabase, { workspaceId: id }),
    workspaceMembersForAdmin(id),
  ])
  const memberList = members.ok ? members.data : []
  const owner = memberList.find((m) => m.role === 'owner')
  const candidates = memberList
    .filter((m) => m.role !== 'owner' && m.status === 'active')
    .map((m) => ({ value: m.user_id, label: `${m.display_name} (${roleLabel(m.role)})` }))
  const row = limitsRow.ok ? limitsRow.data : null

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/workspaces" className="underline underline-offset-2">All workspaces</Link>}
        title={w.name}
        description={`/w/${w.slug}. Owner: ${owner?.display_name ?? 'none'}. ${memberList.length} members.`}
      />
      {sp.created ? (
        <p role="status" className="mb-6 text-sm text-success">
          Workspace created. Share an invite link from its Settings, or ask the owner to.
        </p>
      ) : null}
      <div className="flex flex-col gap-10">
        <section aria-labelledby="limits" className="flex flex-col gap-4">
          <h2 id="limits" className="text-lg font-semibold">
            Limits
          </h2>
          <LimitsTable rows={limitRows(effective.ok ? effective.data : null, row)} />
          {row?.updated_at ? (
            <p className="text-xs text-muted">
              Last changed {formatDateTime(row.updated_at)}
              {row.note ? `: ${row.note}` : ''}
            </p>
          ) : null}
          <LimitsEditor action={setLimitsAction.bind(null, id)} defaults={limitsFormDefaults(row)} />
        </section>
        <section aria-labelledby="lifecycle" className="flex flex-col gap-4 rounded-lg border border-danger p-4">
          <h2 id="lifecycle" className="text-lg font-semibold">
            Archive, delete, restore
          </h2>
          <AdminLifecycle
            slug={w.slug}
            state={lifecycleState(w)}
            timing={timingText(w)}
            canDelete={canRequestDeletion(w)}
            canRestore={canRestore(w)}
            archive={adminArchive.bind(null, id)}
            unarchive={adminUnarchive.bind(null, id)}
            requestDeletion={adminRequestDeletion.bind(null, id)}
            restore={adminRestore.bind(null, id)}
          />
        </section>
        {!w.deleted_at ? (
          <section aria-labelledby="transfer" className="flex flex-col gap-4">
            <h2 id="transfer" className="text-lg font-semibold">
              Force transfer ownership
            </h2>
            <p className="text-sm text-muted">For when the owner has left the organization. Logged in both audit logs.</p>
            <ForceTransferForm action={adminForceTransfer.bind(null, id)} members={candidates} />
          </section>
        ) : null}
      </div>
    </>
  )
}
