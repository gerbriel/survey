import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ReportView } from '@/components/reports/ReportView'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { getSurvey, listReports } from '@/lib/analytics/data'
import { DEFAULT_FILTERS } from '@/lib/analytics/filters'
import { loadAnalytics } from '@/lib/analytics/load'
import { responseFilePath } from '@/lib/exports/columns'
import { defaultWidgets } from '@/lib/analytics/widgets'
import { customizeDefaultAction } from '../actions'

export const metadata: Metadata = { title: 'Default report' }

type Props = { params: Promise<{ slug: string; id: string }> }

/**
 * The virtual default report (doc 04 section 5.2): completion card, responses
 * over time, then one widget per question of the latest version. Generated on
 * every view until an editor customizes it.
 */
export default async function DefaultReportPage({ params }: Props) {
  const { slug, id } = await params
  const m = await requireMember(slug, 'viewer')
  const survey = await getSurvey(m.supabase, { workspaceId: m.workspace.id, surveyId: id })
  if (!survey.ok || !survey.data) notFound()
  const reports = await listReports(m.supabase, { surveyId: id })
  const materialized = reports.ok ? reports.data.find((r) => r.is_default) : undefined
  if (materialized) redirect(`/w/${slug}/surveys/${id}/reports/${materialized.id}`)

  const data = await loadAnalytics(m.supabase, survey.data, DEFAULT_FILTERS)
  const latest = data.ok ? data.data.snapshots.find((v) => v.versionId === survey.data!.latest_published_version_id) : undefined
  const widgets = defaultWidgets(latest?.questions ?? [])
  const canEdit = roleAtLeast(m.role, 'editor') && !m.readOnly

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">
            <Link className="underline" href={`/w/${slug}/surveys/${id}/reports`}>
              Reports
            </Link>{' '}
            / {survey.data.title}
          </p>
          <h1 className="text-xl font-semibold text-fg">Default report</h1>
          <p className="text-xs text-muted">Latest version, complete responses, all time.</p>
        </div>
        {canEdit ? (
          <form action={customizeDefaultAction.bind(null, slug, id)}>
            <Button type="submit" size="sm">
              Customize
            </Button>
          </form>
        ) : null}
      </header>
      {data.ok ? <ReportView widgets={widgets} data={data.data} fileHref={(f) => responseFilePath(slug, id, f)} /> : <EmptyState title="The report could not load" description={data.error.message} />}
    </main>
  )
}
