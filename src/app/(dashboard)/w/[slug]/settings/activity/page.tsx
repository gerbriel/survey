import type { Metadata } from 'next'
import Link from 'next/link'
import { requireMember } from '@/lib/auth'
import { ACTIVITY_ENTITIES, listActivity } from '@/lib/admin/db/activity'
import { listMembers } from '@/lib/admin/db/members'
import { formatDateTime } from '@/lib/admin/lifecycle'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { DiffDetails } from '@/components/settings/DiffDetails'
import { LogPager } from '@/components/settings/LogPager'
import { readFilters, readPage } from '@/components/settings/activity-view'

export const metadata: Metadata = { title: 'Activity' }

const KEYS = ['entity', 'actor', 'action', 'from', 'to'] as const

/**
 * Activity log (doc 05 section 5.7). Admin and owner. Filters are GET
 * parameters. Decision: the CSV export of the filtered view is not built in
 * Phase 2A (its own activity row needs an insert path that does not exist).
 */
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { workspace, supabase } = await requireMember(slug, 'admin', { deniedRedirect: `/w/${slug}/settings/general` })
  const filters = readFilters(sp, KEYS)
  const page = readPage(sp)
  const validDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined)
  const validId = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : undefined)

  const [log, members] = await Promise.all([
    listActivity(supabase, {
      workspaceId: workspace.id,
      entity: filters.entity,
      actor: validId(filters.actor),
      action: filters.action,
      from: validDate(filters.from),
      to: validDate(filters.to),
      page,
    }),
    listMembers(supabase, { workspaceId: workspace.id }),
  ])
  const names = new Map((members.ok ? members.data : []).map((m) => [m.user_id, m.display_name]))
  const path = `/w/${encodeURIComponent(workspace.slug)}/settings/activity`

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Activity</h2>
      <form method="get" action={path} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
        <Select
          label="Entity"
          name="entity"
          defaultValue={filters.entity ?? ''}
          placeholder="Any"
          options={ACTIVITY_ENTITIES.map((e) => ({ value: e, label: e.replace('_', ' ') }))}
        />
        <Select
          label="Actor"
          name="actor"
          defaultValue={filters.actor ?? ''}
          placeholder="Anyone"
          options={[...names].map(([id, name]) => ({ value: id, label: name }))}
        />
        <Input label="Action" name="action" defaultValue={filters.action ?? ''} placeholder="update" />
        <Input label="From" name="from" type="date" defaultValue={filters.from ?? ''} />
        <Input label="To" name="to" type="date" defaultValue={filters.to ?? ''} />
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <Link href={path} className="inline-flex h-10 items-center px-2 text-sm text-accent underline underline-offset-2">
            Clear
          </Link>
        </div>
      </form>
      {!log.ok ? (
        <p role="alert" className="text-sm text-danger">
          {log.error.message}
        </p>
      ) : log.data.rows.length === 0 ? (
        <EmptyState title="No activity" description="Nothing matches these filters." />
      ) : (
        <>
          <Table caption="Activity log, newest first">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Entity</Th>
                <Th>Action</Th>
                <Th>Changes</Th>
              </Tr>
            </THead>
            <TBody>
              {log.data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                  <Td>{r.actor ? (names.get(r.actor) ?? 'Former member') : 'System'}</Td>
                  <Td>{r.entity}</Td>
                  <Td>{r.action}</Td>
                  <Td>
                    <DiffDetails diff={r.diff} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <LogPager path={path} filters={filters} page={page} total={log.data.total} pageSize={log.data.pageSize} />
        </>
      )}
    </div>
  )
}
