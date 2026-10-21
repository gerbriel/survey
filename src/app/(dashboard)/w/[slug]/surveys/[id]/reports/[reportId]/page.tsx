import type { Metadata } from 'next'
import Link from 'next/link'
import { ExportButtons } from '@/components/analytics/ExportButtons'
import { FilterBar } from '@/components/analytics/FilterBar'
import { ReportEditor } from '@/components/reports/ReportEditor'
import { ReportView } from '@/components/reports/ReportView'
import { SaveFiltersButton } from '@/components/reports/SaveFiltersButton'
import { ShareManager } from '@/components/reports/ShareManager'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { assertBelongsToWorkspace } from '@/lib/scope'
import { roleAtLeast } from '@/lib/auth'
import { questionOptions } from '@/lib/analytics/aggregate'
import { listShares, listWidgets } from '@/lib/db/reports'
import { filtersFromReport, filtersToQuery, parseFilters } from '@/lib/analytics/filters'
import { loadAnalytics } from '@/lib/analytics/load'
import { responseFilePath } from '@/lib/exports/columns'
import { publicReportUrl, shareState } from '@/lib/analytics/share-url'
import { isChartType, isMetric, type WidgetSpec } from '@/lib/analytics/widgets'
import { createShareAction, deleteReportAction, revokeShareAction, saveReportAction, saveReportFiltersAction } from '../actions'

export const metadata: Metadata = { title: 'Report' }

type Props = {
  params: Promise<{ slug: string; id: string; reportId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** One saved report (doc 04 section 5.1). Filters in the URL preview over the saved ones. */
export default async function ReportPage({ params, searchParams }: Props) {
  const { slug, id, reportId } = await params
  // D-15: survey and report tied to this workspace before any other query.
  const scoped = await assertBelongsToWorkspace(slug, { surveyId: id, reportId })
  const m = scoped.member
  const survey = { ok: true as const, data: scoped.survey! }
  const report = { ok: true as const, data: scoped.report! }
  const sp = await searchParams
  const previewing = Object.keys(sp).length > 0
  const filters = previewing ? parseFilters(sp) : filtersFromReport(report.data.filters)
  const canEdit = roleAtLeast(m.role, 'editor') && !m.readOnly
  const base = `/w/${slug}/surveys/${id}/reports/${reportId}`

  const [widgets, data, shares] = await Promise.all([
    listWidgets(m.supabase, { reportId }),
    loadAnalytics(m.supabase, survey.data, filters),
    canEdit ? listShares(m.supabase, { reportId }) : Promise.resolve(null),
  ])
  const specs: WidgetSpec[] = (widgets.ok ? widgets.data : []).map((w) => ({
    id: w.id,
    position: w.position,
    question_key: w.question_key,
    metric: isMetric(w.metric) ? w.metric : null,
    chart_type: isChartType(w.chart_type) ? w.chart_type : 'table',
    cross_tab_key: w.cross_tab_key,
    options: w.options && typeof w.options === 'object' && !Array.isArray(w.options) && typeof (w.options as { title?: unknown }).title === 'string' ? { title: (w.options as { title: string }).title } : {},
  }))
  const latest = data.ok ? data.data.snapshots.find((v) => v.versionId === survey.data!.latest_published_version_id) : undefined
  const qs = (latest?.questions ?? []).filter((q) => !['statement', 'image', 'hidden'].includes(q.type))

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
          <h1 className="text-xl font-semibold text-fg">{report.data.name}</h1>
        </div>
        {canEdit ? (
          <form action={deleteReportAction.bind(null, slug, id, reportId)}>
            <Button type="submit" size="sm" variant="ghost">
              Delete report
            </Button>
          </form>
        ) : null}
      </header>

      <FilterBar
        filters={filters}
        versions={data.ok ? data.data.versions : []}
        questions={qs.map((q) => ({
          key: q.question_key,
          label: q.label,
          type: q.type,
          options: ['single_choice', 'dropdown', 'multiple_choice', 'yes_no', 'consent'].includes(q.type) ? questionOptions(q) : [],
        }))}
        currentUserId={m.user.id}
        basePath={base}
      />
      <div className="flex flex-wrap items-start gap-3">
        <ExportButtons endpoint={`/w/${slug}/surveys/${id}/analytics/export`} query={filtersToQuery(filters)} canExportRows={roleAtLeast(m.role, 'editor')} />
        {canEdit && previewing ? <SaveFiltersButton save={saveReportFiltersAction.bind(null, slug, id, reportId, filtersToQuery(filters))} /> : null}
      </div>
      {previewing ? <p className="text-xs text-muted">Previewing filters from the address bar. Share links always use the saved filters.</p> : null}

      {canEdit ? (
        <ReportEditor
          name={report.data.name}
          widgets={specs}
          questions={qs.map((q) => ({ key: q.question_key, label: q.label, type: q.type }))}
          save={saveReportAction.bind(null, slug, id, reportId)}
        />
      ) : null}

      {data.ok ? <ReportView widgets={specs} data={data.data} fileHref={(f) => responseFilePath(slug, id, f)} /> : <EmptyState title="The report could not load" description={data.error.message} />}

      {canEdit && shares && shares.ok ? (
        <ShareManager
          shares={shares.data.map((s) => ({
            id: s.id,
            url: publicReportUrl(s.token),
            expires_at: s.expires_at,
            revoked_at: s.revoked_at,
            has_password: s.has_password,
            view_count: s.view_count,
            last_viewed_at: s.last_viewed_at,
            created_at: s.created_at,
            state: shareState(s),
          }))}
          create={createShareAction.bind(null, slug, id, reportId)}
          revoke={revokeShareAction.bind(null, slug, id, reportId)}
        />
      ) : null}
    </main>
  )
}
