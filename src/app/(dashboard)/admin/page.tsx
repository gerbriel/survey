import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { listAllWorkspaces, listAccessRequests, listWorkspaceRequests } from '@/lib/db/admin'
import { PageHeader } from '@/components/dashboard/PageHeader'

/** Admin home (R21): the three sections, with the counts that need attention. There is no email, so these are the only nudge. */
export default async function AdminHome() {
  const { supabase } = await requirePlatformAdmin()
  const [access, wsReq, workspaces] = await Promise.all([
    listAccessRequests(supabase, { status: 'open' }),
    listWorkspaceRequests(supabase, { status: 'open' }),
    listAllWorkspaces(supabase),
  ])
  const live = workspaces.ok ? workspaces.data.filter((w) => !w.deleted_at).length : 0
  const accessOpen = access.ok ? access.data.length : 0
  const wsOpen = wsReq.ok ? wsReq.data.length : 0
  const cards = [
    {
      href: '/admin/workspaces',
      title: 'Workspaces',
      line: 'Every department with counts, limits, archive and delete. Open one to build surveys.',
      stats: [`${live} ${live === 1 ? 'workspace' : 'workspaces'}`],
    },
    {
      href: accessOpen + wsOpen > 0 ? '/admin/users?tab=requests' : '/admin/users',
      title: 'Users',
      line: 'People and their memberships, platform invites, and access or workspace requests.',
      stats: [`${accessOpen} open access ${accessOpen === 1 ? 'request' : 'requests'}`, `${wsOpen} open workspace ${wsOpen === 1 ? 'request' : 'requests'}`],
    },
    {
      href: '/admin/settings',
      title: 'Settings',
      line: 'The organization privacy notice and the platform audit log.',
      stats: [],
    },
  ]
  return (
    <>
      <PageHeader title="Platform admin" description="Workspaces, users and deployment-wide settings." />
      <ul className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="flex h-full flex-col gap-2 rounded-lg border border-border p-4 hover:bg-surface-muted">
              <span className="text-lg font-semibold">{c.title}</span>
              <span className="text-sm text-muted">{c.line}</span>
              {c.stats.map((s) => (
                <span key={s} className="text-sm font-medium tabular-nums">
                  {s}
                </span>
              ))}
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
