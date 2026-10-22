import type { Metadata } from 'next'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { findRespondents, reviewRespondent } from '@/lib/db/privacy'
import { parseLookup } from '@/lib/privacy/lookup'
import { retentionStatus } from '@/lib/privacy/status'
import { eraseAction } from './actions'
import { EraseForm } from './EraseForm'

export const metadata: Metadata = { title: 'Privacy tools' }

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Respondent lookup, GDPR export (editor and above) and erase (admin and
 * owner), plus retention status (doc 04 section 7). Every action re-checks
 * the role in SQL.
 */
export default async function PrivacyToolsPage({ params, searchParams }: Props) {
  const { slug } = await params
  const m = await requireMember(slug, 'editor')
  const sp = await searchParams
  const raw = typeof sp.q === 'string' ? sp.q.slice(0, 500) : ''
  const query = raw ? parseLookup(raw) : null
  const isAdmin = roleAtLeast(m.role, 'admin') && !m.readOnly
  const matches = query ? await findRespondents(m.supabase, { workspaceId: m.workspace.id, query }) : null
  const reviews = matches?.ok ? await Promise.all(matches.data.map((c) => reviewRespondent(m.supabase, { contact: c }))) : []
  const retention = await retentionStatus(m.supabase, m.workspace)

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-6">
      <header>
        <p className="text-xs text-muted">Privacy tools</p>
        <h1 className="text-xl font-semibold text-fg">Find a respondent</h1>
        <p className="text-sm text-muted">Search by email, personal link token or link, or contact id. Editors can export a respondent&apos;s data; admins can erase it.</p>
      </header>

      <form method="get" className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <Input label="Email, token or contact id" name="q" defaultValue={raw} required autoComplete="off" />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {raw && !query ? <p className="text-sm text-danger">Enter an email address, a token or link, or a contact id.</p> : null}
      {matches && !matches.ok ? <p className="text-sm text-danger">{matches.error.message}</p> : null}
      {matches?.ok && matches.data.length === 0 ? (
        <EmptyState title="No respondent found" description="Anonymous responses without a contact cannot be found here; remove them from the response inbox." />
      ) : null}

      {reviews.map((r) =>
        r.ok ? (
          <section key={r.data.contact.id} aria-label="Respondent" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div>
              <h2 className="text-base font-semibold text-fg">{r.data.contact.email ?? r.data.contact.name ?? 'Contact without email'}</h2>
              <p className="text-xs text-muted">
                Found by {r.data.contact.matchedBy}. Status {r.data.contact.status}.
              </p>
            </div>
            <p className="text-sm text-fg">
              {r.data.responses} responses across {r.data.surveys} surveys, {r.data.notes} notes, {r.data.tokens} personal links, {r.data.files} files.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm text-fg hover:bg-surface-muted"
                href={`/w/${slug}/privacy-tools/export?contact=${r.data.contact.id}`}
              >
                Export data (JSON)
              </a>
              {isAdmin && r.data.contact.status !== 'deleted' ? (
                <EraseForm email={r.data.contact.email} action={eraseAction.bind(null, slug, r.data.contact.id)} />
              ) : null}
            </div>
          </section>
        ) : (
          <p key={r.error.code} className="text-sm text-danger">
            {r.error.message}
          </p>
        ),
      )}

      <section aria-label="Retention" className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-fg">Response retention</h2>
        {retention.retentionDays ? (
          <p className="text-sm text-fg">
            Responses older than {retention.retentionDays} days are deleted. The next run, {new Date(retention.nextRun).toUTCString()}, will delete about{' '}
            {retention.dueNow?.toLocaleString('en-US')} responses. Contacts are never deleted by retention.
          </p>
        ) : (
          <p className="text-sm text-fg">Responses are kept until deleted. Admins can set a retention period in workspace privacy settings.</p>
        )}
        <p className="text-xs text-muted">Raw analytics events are kept 180 days, then summarized per day.</p>
      </section>
    </main>
  )
}
