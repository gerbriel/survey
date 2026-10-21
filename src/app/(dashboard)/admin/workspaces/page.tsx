import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/lib/auth'
import { platformStorageUsage } from '@/lib/db/admin'
import { listAllWorkspaces, listProfiles } from '@/lib/admin/db/platform'
import { getWorkspaceRequest } from '@/lib/admin/db/requests'
import { listAuthUsers, workspaceCounts, type AuthUserSummary } from '@/lib/admin/service'
import { deletionAvailableAt, formatBytes, formatDate, lifecycleState, purgeDueAt } from '@/lib/admin/lifecycle'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { AdminWorkspaceList, type AdminWorkspaceRow } from '@/components/admin/WorkspaceList'
import { CreateWorkspaceForm } from '@/components/admin/AdminForms'
import { createWorkspaceAction } from '../actions'

export const metadata: Metadata = { title: 'Workspaces' }

/** Every workspace with counts and storage (doc 05 section 6), plus create (section 1.1). */
export default async function AdminWorkspacesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requirePlatformAdmin()
  const sp = await searchParams
  const requestId = typeof sp.request === 'string' && /^[0-9a-f-]{36}$/i.test(sp.request) ? sp.request : null

  const [workspaces, storage, profiles, users, request] = await Promise.all([
    listAllWorkspaces(supabase),
    platformStorageUsage(supabase),
    listProfiles(supabase),
    listAuthUsers(),
    requestId ? getWorkspaceRequest(supabase, { requestId }) : null,
  ])
  const list = workspaces.ok ? workspaces.data : []
  const counts = await workspaceCounts(list.map((w) => w.id))
  const bytes = new Map((storage.ok ? storage.data : []).map((s) => [s.workspace_id, Number(s.bytes)]))
  const names = new Map((profiles.ok ? profiles.data : []).map((p) => [p.id, p.display_name]))
  const emails = users.ok ? users.data : new Map<string, AuthUserSummary>()

  const rows: AdminWorkspaceRow[] = list.map((w) => {
    const c = counts.ok ? counts.data[w.id] : undefined
    const state = lifecycleState(w)
    const delAt = deletionAvailableAt(w)
    const purgeAt = purgeDueAt(w)
    return {
      id: w.id,
      name: w.name,
      slug: w.slug,
      owner: c?.ownerId ? (names.get(c.ownerId) ?? 'Unknown') : 'No owner',
      members: c?.members ?? 0,
      surveys: c?.surveys ?? 0,
      responses: c?.responses ?? 0,
      storage: formatBytes(bytes.get(w.id) ?? w.storage_bytes_used),
      created: formatDate(w.created_at),
      state,
      stateNote:
        state === 'archived' && delAt
          ? `Deletable from ${formatDate(delAt)}`
          : state === 'deletion_requested' && purgeAt
            ? `Restorable until ${formatDate(purgeAt)}`
            : null,
    }
  })

  const owners = (profiles.ok ? profiles.data : [])
    .filter((p) => p.status === 'active' || p.status === 'pending')
    .map((p) => {
      const email = emails.get(p.id)?.email
      return { value: p.id, label: `${p.display_name}${email ? ` (${email})` : ''}${p.status === 'pending' ? ', pending' : ''}` }
    })
  const req = request && request.ok ? request.data : null

  return (
    <>
      <PageHeader title="Workspaces" description="Metadata and counts only. Platform admins never see responses or contacts unless they are members." />
      {!counts.ok ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          Counts are unavailable: {counts.error.message}
        </p>
      ) : null}
      <AdminWorkspaceList rows={rows} />
      <section id="create" aria-labelledby="create-heading" className="mt-10 flex flex-col gap-4">
        <h2 id="create-heading" className="text-lg font-semibold">
          Create a workspace
        </h2>
        {req ? (
          <p className="text-sm" role="status">
            From the request by {names.get(req.requested_by) ?? 'a member'}: {req.department_name}. Creating it approves the
            request.
          </p>
        ) : null}
        <CreateWorkspaceForm
          action={createWorkspaceAction}
          owners={owners}
          defaults={req && req.status === 'open' ? { name: req.department_name, requestId: req.id, ownerId: req.requested_by } : undefined}
        />
      </section>
    </>
  )
}
