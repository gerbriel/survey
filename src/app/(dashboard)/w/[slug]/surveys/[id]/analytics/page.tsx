import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExportButtons } from '@/components/analytics/ExportButtons'
import { CompareWithLink } from '@/components/compare/CompareWithLink'
import { FilterBar, type FilterQuestion } from '@/components/analytics/FilterBar'
import { MetricView } from '@/components/analytics/MetricView'
import { QuestionSummaryView } from '@/components/analytics/QuestionSummaryView'
import { EmptyState } from '@/components/ui/EmptyState'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { questionOptions } from '@/lib/analytics/aggregate'
import { getSurvey } from '@/lib/db/surveys'
import { filtersToQuery, parseFilters } from '@/lib/analytics/filters'
import { loadAnalytics } from '@/lib/analytics/load'
import { responseFilePath } from '@/lib/exports/columns'
import { StatTile, duration, percent } from '@/components/charts'

export const metadata: Metadata = { title: 'Analytics' }

type Props = {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Per survey analytics (doc 04 section 4), viewer and above. All reads run as the member under RLS. */
export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { slug, id } = await params
  const m = await requireMember(slug, 'viewer')
  const survey = await getSurvey(m.supabase, { workspaceId: m.workspace.id, surveyId: id })
  if (!survey.ok || !survey.data) notFound()
  const s = survey.data
  const filters = parseFilters(await searchParams)
  const base = `/w/${slug}/surveys/${id}/analytics`

  if (!s.latest_published_version_id) {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
        <Header slug={slug} id={id} title={s.title} />
        <EmptyState title="Nothing to analyze yet" description="Publish this survey and collect responses to see analytics here." />
      </main>
    )
  }

  const r = await loadAnalytics(m.supabase, s, filters)
  if (!r.ok) {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
        <Header slug={slug} id={id} title={s.title} />
        <EmptyState title="Analytics could not load" description={r.error.message} />
      </main>
    )
  }
  const a = r.data
  const latest = a.snapshots.find((v) => v.versionId === s.latest_published_version_id)
  const filterQuestions: FilterQuestion[] = (latest?.questions ?? [])
    .filter((q) => !['statement', 'image'].includes(q.type))
    .map((q) => ({
      key: q.question_key,
      label: q.label,
      type: q.type,
      options: ['single_choice', 'dropdown', 'multiple_choice', 'yes_no', 'consent'].includes(q.type) ? questionOptions(q) : [],
    }))

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
      <Header slug={slug} id={id} title={s.title} />
      <FilterBar filters={filters} versions={a.versions} questions={filterQuestions} currentUserId={m.user.id} basePath={base} />
      <ExportButtons endpoint={`${base}/export`} query={filtersToQuery(filters)} canExportRows={roleAtLeast(m.role, 'editor')} />

      {a.notes.length ? (
        <ul role="note" className="flex flex-col gap-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Responses" value={a.responseCount.toLocaleString('en-US')} sub={`${a.completeCount.toLocaleString('en-US')} complete`} />
        <StatTile
          label="Completion rate"
          value={a.funnel.starts ? percent(a.funnel.completionRate) : 'No data'}
          sub={`${a.funnel.completes} of ${a.funnel.starts} starts`}
        />
        <StatTile label="Median time to complete" value={duration(a.medianSeconds)} />
        <StatTile label="Views" value={a.funnel.views.toLocaleString('en-US')} sub={a.funnel.views ? `${percent(a.funnel.startRate)} started` : undefined} />
      </section>

      <section aria-label="Trends" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <MetricView metric="responses_over_time" result={a} />
        </Card>
        <Card>
          <MetricView metric="funnel" result={a} />
        </Card>
        <Card>
          <MetricView metric="drop_off" result={a} />
        </Card>
        <Card>
          <MetricView metric="device_split" result={a} />
        </Card>
      </section>

      <section aria-label="Questions" className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-fg">Questions</h2>
        {a.blocks.length === 0 ? <EmptyState title="No questions" description="The selected version has no questions to summarize." /> : null}
        {a.blocks.map((b) => (
          <QuestionSummaryView key={b.question.question_key} block={b} fileHref={(f) => responseFilePath(slug, id, f)} />
        ))}
      </section>
    </main>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface p-4">{children}</div>
}

function Header({ slug, id, title }: { slug: string; id: string; title: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs text-muted">Analytics</p>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
      </div>
      <nav aria-label="Survey results" className="flex gap-3 text-sm">
        <Link className="text-accent underline" href={`/w/${slug}/surveys/${id}/reports`}>
          Reports
        </Link>
        <Link className="text-accent underline" href={`/w/${slug}/surveys/${id}/responses`}>
          Responses
        </Link>
        <CompareWithLink slug={slug} surveyId={id} />
      </nav>
    </header>
  )
}
