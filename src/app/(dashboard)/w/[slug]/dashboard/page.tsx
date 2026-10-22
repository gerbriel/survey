import type { Metadata } from 'next'
import Link from 'next/link'
import { Bar, Sparkline, StatTile, percent } from '@/components/charts'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { requireMember, memberCan } from '@/lib/auth'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { loadDashboard } from '@/lib/analytics/dashboard'

export const metadata: Metadata = { title: 'Dashboard' }

type Props = { params: Promise<{ slug: string }> }

const LEAD_LABELS: Record<string, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', customer: 'Customer', lost: 'Lost' }

/** Workspace overview (doc 04 section 5.3), viewer and above. */
export default async function DashboardPage({ params }: Props) {
  const { slug } = await params
  const m = await requireMember(slug, 'viewer')
  const d = await loadDashboard(m.supabase, m.workspace.id)
  const base = `/w/${slug}`
  const canEdit = memberCan(m.role, 'editor', m.workspace)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={m.workspace.name}
        description="What is happening across this workspace. Surveys are built and shared from the Surveys tab."
        actions={
          <>
            {canEdit ? (
              <Link href={`${base}/surveys/new`} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">
                New survey
              </Link>
            ) : null}
            <Link href={`${base}/surveys`} className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-fg">
              All surveys
            </Link>
          </>
        }
      />

      <section aria-label="This week" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Responses this week"
          value={d.thisWeek.toLocaleString('en-US')}
          delta={{ value: d.thisWeek - d.lastWeek, period: 'the week before' }}
          trend={<Sparkline values={d.daily} label="Complete responses per day, last 14 days" />}
        />
        <StatTile label="Open surveys" value={String(d.openSurveys.length)} />
        <StatTile label="New contacts this week" value={d.newContacts.toLocaleString('en-US')} />
        <StatTile
          label="Follow-ups"
          value={`${d.followUps.due} due today`}
          sub={d.followUps.overdue ? `${d.followUps.overdue} overdue` : 'None overdue'}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="Open surveys" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-fg">Open surveys</h2>
          {d.openSurveys.length === 0 ? (
            <EmptyState
              title="No open surveys"
              description="Create a survey, publish it, then open it in its Settings tab to start collecting responses."
              action={
                canEdit ? (
                  <Link href={`${base}/surveys/new`} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">
                    Create your first survey
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Table caption="Open surveys, last 7 days">
              <THead>
                <Tr>
                  <Th>Survey</Th>
                  <Th className="text-right">Responses, 7 days</Th>
                  <Th className="text-right">Completion</Th>
                </Tr>
              </THead>
              <TBody>
                {d.openSurveys.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link className="text-accent underline" href={`${base}/surveys/${s.id}/analytics`}>
                        {s.title}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums">{s.responses7d}</Td>
                    <Td className="text-right tabular-nums">{s.completionRate === null ? 'No data' : percent(s.completionRate)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          {d.closingSoon.length ? (
            <div className="mt-2">
              <h3 className="text-xs font-semibold text-fg">Closing within 7 days</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {d.closingSoon.map((s) => (
                  <li key={s.id}>
                    {s.title} <span className="text-muted">closes {new Date(s.closes_at).toLocaleDateString('en-US')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-label="Leads" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <Bar
            title="Leads by status"
            data={d.leadsByStatus.map((l) => ({ label: LEAD_LABELS[l.status] ?? l.status, value: l.count }))}
            tableColumns={['Status', 'Contacts']}
          />
          {d.newContactsBySource.length ? (
            <Bar
              title="New contacts this week by source"
              data={d.newContactsBySource.slice(0, 8).map((s) => ({ label: s.source, value: s.count }))}
              tableColumns={['Source', 'Contacts']}
            />
          ) : (
            <p className="text-sm text-muted">No new contacts this week.</p>
          )}
        </section>
      </div>

      <section aria-label="Recent activity" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-fg">Recent activity</h2>
        {d.activity.length === 0 ? (
          <EmptyState title="No recent activity to show" description="Admins see the workspace activity log here." />
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {d.activity.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>
                  {a.entity}: {a.action.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-muted">{new Date(a.created_at).toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
