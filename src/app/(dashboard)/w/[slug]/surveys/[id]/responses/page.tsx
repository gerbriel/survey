import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { InboxFilters } from '@/components/responses/InboxFilters'
import { InboxList } from '@/components/responses/InboxList'
import { assertBelongsToWorkspace } from '@/lib/scope'
import { roleAtLeast } from '@/lib/auth'
import { listPublishedVersions } from '@/lib/db/surveys'
import { listInbox } from '@/lib/db/responses'
import { fetchInboxRowAction } from './actions'

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PAGE_SIZE = 25

function nextDay(d: string) {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

export default async function ResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<SP>
}) {
  const { slug, id } = await params
  const sp = await searchParams
  // D-15: the survey must belong to this workspace before any other query.
  const scoped = await assertBelongsToWorkspace(slug, { surveyId: id })
  const { supabase, role } = scoped.member
  const survey = { ok: true as const, data: scoped.survey! }
  const versions = await listPublishedVersions(supabase, { surveyId: id, order: 'desc' })
  const versionList = versions.ok ? versions.data : []

  const status = one(sp.status) === 'all' ? 'all' : 'complete'
  const identityRaw = one(sp.identity)
  const identity = (['token', 'identified', 'anonymous'] as const).find((x) => x === identityRaw) ?? 'all'
  const versionRaw = one(sp.version)
  // Decision: the inbox defaults to all versions (reports default to latest).
  const version = versionRaw === 'latest' || versionList.some((v) => v.id === versionRaw) ? versionRaw : 'all'
  const from = DATE_RE.test(one(sp.from)) ? one(sp.from) : ''
  const to = DATE_RE.test(one(sp.to)) ? one(sp.to) : ''
  const page = Math.max(0, Number.parseInt(one(sp.page) || '0', 10) || 0)

  const inbox = await listInbox(supabase, {
    surveyId: id,
    filters: {
      status,
      identity,
      version,
      ...(from ? { from } : {}),
      ...(to ? { to: nextDay(to) } : {}),
    },
    page,
    pageSize: PAGE_SIZE,
  })
  const rows = inbox.ok ? inbox.data.rows : []
  const total = inbox.ok ? inbox.data.total : 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const versionNumbers = Object.fromEntries(versionList.map((v) => [v.id, v.version_no]))

  const qs = (p: number) => {
    const u = new URLSearchParams()
    if (status !== 'complete') u.set('status', status)
    if (identity !== 'all') u.set('identity', identity)
    if (version !== 'all') u.set('version', version)
    if (from) u.set('from', from)
    if (to) u.set('to', to)
    if (p) u.set('page', String(p))
    const s = u.toString()
    return s ? `?${s}` : ''
  }
  const fetchRow = fetchInboxRowAction.bind(null, slug, id)
  const base = `/w/${slug}/surveys/${id}/responses`

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Responses</p>
          <h1 className="text-xl font-semibold">{survey.data.title}</h1>
          <p className="text-sm text-muted">
            {total} {total === 1 ? 'response' : 'responses'} match
          </p>
        </div>
        {roleAtLeast(role, 'editor') ? (
          // D-05: the row-level export accepts POST only, so a cross-site link cannot start a job.
          <form method="post" action={`/w/${slug}/surveys/${id}/analytics/export`}>
            <input type="hidden" name="kind" value="responses" />
            <input type="hidden" name="format" value="csv" />
            <Button type="submit" variant="secondary">
              Export CSV
            </Button>
          </form>
        ) : null}
      </header>
      <InboxFilters
        action={base}
        status={status}
        identity={identity}
        version={version}
        from={from}
        to={to}
        versions={versionList.map((v) => ({ id: v.id, label: `Version ${v.version_no}` }))}
      />
      {!inbox.ok ? (
        <p role="alert" className="text-sm text-danger">
          {inbox.error.message}
        </p>
      ) : null}
      <InboxList
        key={qs(page)}
        slug={slug}
        surveyId={id}
        initialRows={rows}
        firstPage={page === 0}
        pageSize={PAGE_SIZE}
        filters={{ status, identity, version, latestVersionId: survey.data.latest_published_version_id }}
        versionNumbers={versionNumbers}
        fetchRow={fetchRow}
      />
      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        {page > 0 ? <Link href={`${base}${qs(page - 1)}`}>Previous page</Link> : <span />}
        <span className="text-muted">
          Page {page + 1} of {pages}
        </span>
        {page + 1 < pages ? <Link href={`${base}${qs(page + 1)}`}>Next page</Link> : <span />}
      </nav>
    </main>
  )
}
