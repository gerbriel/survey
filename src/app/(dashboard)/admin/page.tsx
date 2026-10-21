import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { countOpenAbuseReports, listAllWorkspaces } from '@/lib/admin/db/platform'
import { listAccessRequests, listWorkspaceRequests } from '@/lib/admin/db/requests'
import { PageHeader } from '@/components/dashboard/PageHeader'

/** Admin home: the queues that need attention. There is no email, so these counts are the only nudge. */
export default async function AdminHome() {
  const { supabase } = await requirePlatformAdmin()
  const [reports, access, wsReq, workspaces] = await Promise.all([
    countOpenAbuseReports(supabase),
    listAccessRequests(supabase, { status: 'open' }),
    listWorkspaceRequests(supabase, { status: 'open' }),
    listAllWorkspaces(supabase),
  ])
  const cards = [
    { href: '/admin/reports', label: 'Open abuse reports', value: reports.ok ? reports.data : 0 },
    { href: '/admin/requests', label: 'Open access requests', value: access.ok ? access.data.length : 0 },
    { href: '/admin/requests', label: 'Open workspace requests', value: wsReq.ok ? wsReq.data.length : 0 },
    { href: '/admin/workspaces', label: 'Workspaces', value: workspaces.ok ? workspaces.data.filter((w) => !w.deleted_at).length : 0 },
  ]
  return (
    <>
      <PageHeader title="Platform admin" description="Invites, workspaces, limits, abuse reports and the organization privacy notice." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <li key={c.label}>
            <Link href={c.href} className="block rounded-lg border border-border p-4 hover:bg-surface-muted">
              <span className="block text-3xl font-semibold tabular-nums">{c.value}</span>
              <span className="text-sm text-muted">{c.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
