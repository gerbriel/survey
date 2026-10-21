import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { listPlatformAudit, listProfiles } from '@/lib/admin/db/platform'
import { formatDateTime } from '@/lib/admin/lifecycle'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { DiffDetails } from '@/components/settings/DiffDetails'
import { LogPager } from '@/components/settings/LogPager'
import { readFilters, readPage } from '@/components/settings/activity-view'

export const metadata: Metadata = { title: 'Audit log' }

const TARGETS = ['workspace', 'user', 'invite', 'survey', 'abuse_report', 'settings']

/** platform_audit_log viewer. It outlives deleted workspaces (doc 05 decision 14). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requirePlatformAdmin()
  const sp = await searchParams
  const filters = readFilters(sp, ['action', 'targetType', 'targetId'])
  const page = readPage(sp)
  const [log, profiles] = await Promise.all([
    listPlatformAudit(supabase, {
      action: filters.action,
      targetType: filters.targetType && TARGETS.includes(filters.targetType) ? filters.targetType : undefined,
      targetId: filters.targetId && /^[0-9a-f-]{36}$/i.test(filters.targetId) ? filters.targetId : undefined,
      page,
    }),
    listProfiles(supabase),
  ])
  const names = new Map((profiles.ok ? profiles.data : []).map((p) => [p.id, p.display_name]))

  return (
    <>
      <PageHeader title="Audit log" description="Every platform admin action and workspace purge." />
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-4 sm:items-end">
        <Input label="Action contains" name="action" defaultValue={filters.action ?? ''} placeholder="workspace." />
        <Select
          label="Target type"
          name="targetType"
          defaultValue={filters.targetType ?? ''}
          placeholder="Any"
          options={TARGETS.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
        />
        <Input label="Target id" name="targetId" defaultValue={filters.targetId ?? ''} />
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <Link href="/admin/audit" className="inline-flex h-10 items-center px-2 text-sm text-accent underline underline-offset-2">
            Clear
          </Link>
        </div>
      </form>
      {!log.ok ? (
        <p role="alert" className="text-sm text-danger">{log.error.message}</p>
      ) : log.data.rows.length === 0 ? (
        <EmptyState title="No entries" />
      ) : (
        <>
          <Table caption="Platform audit log, newest first">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </Tr>
            </THead>
            <TBody>
              {log.data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                  <Td>{r.actor ? (names.get(r.actor) ?? 'Unknown') : 'System'}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td>
                    <div>{r.target_type}</div>
                    {r.target_id ? <div className="font-mono text-xs text-muted">{r.target_id}</div> : null}
                  </Td>
                  <Td>
                    <DiffDetails diff={r.details} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <div className="mt-4">
            <LogPager path="/admin/audit" filters={filters} page={page} total={log.data.total} pageSize={log.data.pageSize} />
          </div>
        </>
      )}
    </>
  )
}
