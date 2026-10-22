import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { StatTile, duration, percent } from '@/components/charts'
import { PostExportButtons } from '@/components/results/PostExportButtons'
import { ResultsFilterForm } from '@/components/results/ResultsFilterForm'
import { ResultsTable } from '@/components/results/ResultsTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { ANALYTICS_MAX_RESPONSES } from '@/lib/analytics/load'
import { parseResultsFilters, resultsFiltersToQuery } from '@/lib/analytics/results-filters'
import { buildTableRows } from '@/lib/analytics/results'
import { loadResults } from '@/lib/analytics/results-load'
import { listMembers } from '@/lib/db/workspaces'

export const metadata: Metadata = { title: 'Results' }

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function many(v: string | string[] | undefined): string[] {
  return ([] as string[]).concat(v ?? []).flatMap((x) => x.split(',')).map((s) => s.trim()).filter(Boolean)
}

/** Cross-survey response explorer, viewer and above. Reads run as the member under RLS. */
export default async function ResultsPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const m = await requireMember(slug, 'viewer')
  const filters = parseResultsFilters(sp)
  const picked = many(sp.cols).filter((k) => /^[A-Za-z0-9_]{1,64}$/.test(k)).slice(0, 12)
  const pageNo = Math.max(0, Number.parseInt(String(([] as string[]).concat(sp.page ?? '1')[0]), 10) - 1 || 0)
  const base = `/w/${encodeURIComponent(slug)}/results`

  const [r, members] = await Promise.all([
    loadResults(m.supabase, m.workspace.id, filters, { page: pageNo, columns: picked }),
    listMembers(m.supabase, { workspaceId: m.workspace.id }),
  ])
  if (!r.ok) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
        <PageHeader title="Results" />
        <EmptyState title="Results could not load" description={r.error.message} />
      </main>
    )
  }
  const v = r.data
  const query = resultsFiltersToQuery(filters)
  const pageHref = (p: number) => {
    const q = new URLSearchParams(query)
    if (picked.length) q.set('cols', picked.join(','))
    if (p > 0) q.set('page', String(p + 1))
    const s = q.toString()
    return s ? `${base}?${s}` : base
  }
  const hiddenParams = [
    ...new Set(
      v.scopes.flatMap((s) =>
        s.questions.filter((q) => q.type === 'hidden').map((q) => (typeof q.settings.param === 'string' && q.settings.param ? q.settings.param : q.question_key)),
      ),
    ),
  ].filter((p) => /^[A-Za-z0-9_]{1,64}$/.test(p))
  const surveyIds = v.scopes.map((s) => s.survey.id)
  const compareIds = surveyIds.slice(0, 5)
  const rows = buildTableRows(slug, v.rows, v.scopes, v.shownColumns, v.answers)
  const filterObject = Object.fromEntries(new URLSearchParams(query).entries())

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Results"
        description="Responses across surveys. Pick surveys and filters, then open any row for the full response."
        actions={
          compareIds.length >= 2 ? (
            <Link className="text-sm text-accent underline" href={`/w/${encodeURIComponent(slug)}/compare?surveys=${compareIds.join(',')}`}>
              Compare these surveys
            </Link>
          ) : null
        }
      />
      <ResultsFilterForm
        action={base}
        filters={filters}
        surveys={v.allSurveys.filter((s) => s.latest_published_version_id).map((s) => ({ id: s.id, title: s.title, state: s.state }))}
        members={members.ok ? members.data : []}
        columns={v.columns}
        pickedColumns={v.shownColumns.map((c) => c.key)}
        hiddenParams={hiddenParams}
      />

      {v.truncated || v.textCapped ? (
        <ul role="note" className="flex flex-col gap-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
          {v.truncated ? <li>This view covers the first {ANALYTICS_MAX_RESPONSES.toLocaleString('en-US')} matching responses. Narrow the surveys or dates to see the rest.</li> : null}
          {v.textCapped ? <li>The text search stopped at its first 2,000 matching answers. Use a more specific phrase.</li> : null}
        </ul>
      ) : null}

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Responses" value={v.summary.responses.toLocaleString('en-US')} sub={`${v.summary.complete.toLocaleString('en-US')} complete, ${v.scopes.length} surveys`} />
        <StatTile label="Completion rate" value={v.summary.completionRate === null ? 'No data' : percent(v.summary.completionRate)} sub="Complete out of all submitted and partial responses" />
        <StatTile label="Median time to complete" value={duration(v.summary.medianSeconds)} />
        <StatTile label="Unique contacts" value={v.summary.uniqueContacts.toLocaleString('en-US')} />
      </section>

      {roleAtLeast(m.role, 'editor') && surveyIds.length ? (
        <PostExportButtons
          endpoint={`${base}/export`}
          note={`Exports every response that matches, across ${surveyIds.length} surveys.`}
          actions={[
            { id: 'csv', label: 'Export CSV', ext: 'csv', body: { surveyIds, filters: filterObject, format: 'csv', labels: true } },
            { id: 'xlsx', label: 'Export XLSX', ext: 'xlsx', body: { surveyIds, filters: filterObject, format: 'xlsx', labels: true } },
          ]}
        />
      ) : null}

      {v.scopes.length === 0 ? (
        <EmptyState title="No published surveys" description="Publish a survey and collect responses to explore them here." />
      ) : (
        <ResultsTable rows={rows} columns={v.shownColumns} total={v.total} page={v.page} pageSize={v.pageSize} pageHref={pageHref} />
      )}
    </main>
  )
}
