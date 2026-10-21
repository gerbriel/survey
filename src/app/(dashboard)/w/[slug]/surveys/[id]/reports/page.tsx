import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { getSurvey, listReports } from '@/lib/analytics/data'
import { createReportAction } from './actions'

export const metadata: Metadata = { title: 'Reports' }

type Props = { params: Promise<{ slug: string; id: string }> }

/** Saved reports for a survey (doc 04 section 5.1). Viewers read; editors create. */
export default async function ReportsPage({ params }: Props) {
  const { slug, id } = await params
  const m = await requireMember(slug, 'viewer')
  const survey = await getSurvey(m.supabase, { workspaceId: m.workspace.id, surveyId: id })
  if (!survey.ok || !survey.data) notFound()
  const reports = await listReports(m.supabase, { surveyId: id })
  const list = reports.ok ? reports.data : []
  const materialized = list.find((r) => r.is_default)
  const canEdit = roleAtLeast(m.role, 'editor') && !m.readOnly
  const base = `/w/${slug}/surveys/${id}/reports`

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Reports</p>
          <h1 className="text-xl font-semibold text-fg">{survey.data.title}</h1>
        </div>
        <Link className="text-sm text-accent underline" href={`/w/${slug}/surveys/${id}/analytics`}>
          Analytics
        </Link>
      </header>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {!materialized ? (
          <li className="flex items-center justify-between gap-3 p-4">
            <div>
              <Link className="font-medium text-accent underline" href={`${base}/default`}>
                Default report
              </Link>
              <p className="text-xs text-muted">Generated from the latest version. New questions appear automatically until you customize it.</p>
            </div>
            <Badge tone="accent">Default</Badge>
          </li>
        ) : null}
        {list.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <Link className="font-medium text-accent underline" href={`${base}/${r.id}`}>
                {r.name}
              </Link>
              <p className="text-xs text-muted">Updated {new Date(r.updated_at).toLocaleDateString('en-US')}</p>
            </div>
            {r.is_default ? <Badge tone="accent">Default</Badge> : null}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <form action={createReportAction.bind(null, slug, id)} className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-end">
          <div className="flex-1">
            <Input label="New report name" name="name" maxLength={120} placeholder="Board summary" required />
          </div>
          <Button type="submit">Create report</Button>
        </form>
      ) : null}
    </main>
  )
}
