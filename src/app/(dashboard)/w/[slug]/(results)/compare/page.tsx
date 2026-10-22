import type { Metadata } from 'next'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { ComparePicker } from '@/components/compare/ComparePicker'
import { CompareQuestions, CompareStrip, CompareUnmatched } from '@/components/compare/CompareView'
import { PostExportButtons } from '@/components/results/PostExportButtons'
import { EmptyState } from '@/components/ui/EmptyState'
import { requireMember } from '@/lib/auth'
import { COMPARE_MIN_SURVEYS, parseCompareSurveys } from '@/lib/analytics/compare'
import { comparableSurveys, loadComparison } from '@/lib/analytics/compare-load'

export const metadata: Metadata = { title: 'Compare' }

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) for (const x of ([] as string[]).concat(v ?? [])) p.append(k, x)
  return p
}

/** Side by side comparison of two to five surveys, viewer and above. Reads run as the member under RLS. */
export default async function ComparePage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const m = await requireMember(slug, 'viewer')
  const base = `/w/${encodeURIComponent(slug)}/compare`
  const ids = parseCompareSurveys(sp.surveys)
  const query = toParams(sp)
  query.set('surveys', ids.join(','))

  const list = await comparableSurveys(m.supabase, m.workspace.id)
  const surveys = list.ok ? list.data.map((s) => ({ id: s.id, title: s.title })) : []
  const c = ids.length >= COMPARE_MIN_SURVEYS ? await loadComparison(m.supabase, m.workspace.id, ids, query) : null

  const selected = c?.ok
    ? c.data.surveys.map((s) => ({ id: s.survey.id, title: s.survey.title, versions: s.analytics.versions }))
    : ids.map((id) => ({ id, title: surveys.find((s) => s.id === id)?.title ?? 'Survey', versions: [] }))

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Compare surveys" description="Questions are matched by question key, then by label and type. Differences are against the first survey." />
      <ComparePicker action={base} surveys={surveys} selected={selected} params={query} />

      {!c ? (
        <EmptyState title="Pick two to five surveys" description="Choose surveys above to see their answers side by side." />
      ) : !c.ok ? (
        <EmptyState title="The comparison could not load" description={c.error.message} />
      ) : c.data.surveys.length < COMPARE_MIN_SURVEYS ? (
        <EmptyState title="Not enough published surveys" description="At least two of the picked surveys need a published version." />
      ) : (
        <>
          {c.data.skipped.length || c.data.surveys.some((s) => s.analytics.truncated) ? (
            <ul role="note" className="flex flex-col gap-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
              {c.data.skipped.length ? <li>{c.data.skipped.length} picked surveys are left out: not published or not in this workspace.</li> : null}
              {c.data.surveys
                .filter((s) => s.analytics.truncated)
                .map((s) => (
                  <li key={s.survey.id}>{s.survey.title}: this view covers the first 20,000 matching responses.</li>
                ))}
            </ul>
          ) : null}
          <PostExportButtons
            endpoint={`${base}/export`}
            actions={[
              { id: 'csv', label: 'Export comparison CSV', ext: 'csv', body: { format: 'csv', query: query.toString() } },
              { id: 'xlsx', label: 'Export comparison XLSX', ext: 'xlsx', body: { format: 'xlsx', query: query.toString() } },
            ]}
          />
          <CompareStrip c={c.data} />
          <section aria-label="Matched questions" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-fg">Matched questions ({c.data.questions.length})</h2>
            <CompareQuestions c={c.data} />
          </section>
          <CompareUnmatched c={c.data} />
        </>
      )}
    </main>
  )
}
