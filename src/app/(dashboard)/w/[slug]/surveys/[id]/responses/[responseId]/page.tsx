import Link from 'next/link'
import { Badge } from '@/components/ui'
import { AnswerView } from '@/components/responses/AnswerView'
import {
  answerValue,
  asDefinition,
  contactName,
  IDENTITY_LABELS,
  metadataView,
  orderedQuestions,
  plainLabel,
} from '@/components/responses/answers'
import { DeleteResponseButton } from '@/components/responses/DeleteResponseButton'
import { formatDateTime } from '@/components/responses/format'
import { MarkSeen } from '@/components/responses/MarkSeen'
import { assertBelongsToWorkspace } from '@/lib/scope'
import { roleAtLeast } from '@/lib/auth'
import { getContact } from '@/lib/db/contacts'
import { listAnswers } from '@/lib/db/responses'
import { getVersionDefinitions } from '@/lib/db/surveys'
import { deleteResponseAction } from '../actions'

function Pairs({ title, items }: { title: string; items: [string, string][] }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string; responseId: string }>
}) {
  const { slug, id, responseId } = await params
  // D-15: survey and response tied to this workspace before any other query.
  const scoped = await assertBelongsToWorkspace(slug, { surveyId: id, responseId })
  const { supabase, role } = scoped.member
  const survey = { ok: true as const, data: scoped.survey! }
  const r = scoped.response!
  const answers = await listAnswers(supabase, { responseId })
  const [versions, contact] = await Promise.all([
    getVersionDefinitions(supabase, { versionIds: [r.survey_version_id] }),
    r.contact_id ? getContact(supabase, { contactId: r.contact_id }) : Promise.resolve(null),
  ])
  const version = versions.ok ? versions.data[0] : undefined
  const def = asDefinition(version?.public_definition)
  const answerRows = answers.ok ? answers.data : []
  const byKey = new Map(answerRows.map((a) => [a.question_key, a]))
  const questions = orderedQuestions(def).filter((q) => q.type !== 'statement' && q.type !== 'image')
  const known = new Set(questions.map((q) => q.question_key))
  const orphans = answerRows.filter((a) => !known.has(a.question_key))
  const meta = metadataView(r.metadata)
  const c = contact && contact.ok ? contact.data : null
  const base = `/w/${slug}/surveys/${id}/responses`
  const fileHref = (fileId: string, inline?: boolean) => `${base}/files/${fileId}${inline ? '?inline=1' : ''}`

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <MarkSeen surveyId={id} responseId={responseId} />
      <nav className="text-sm">
        <Link href={base} className="text-accent">
          Back to responses
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{survey.data.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge tone={r.status === 'complete' ? 'success' : 'warning'}>
              {r.status === 'complete' ? 'Complete' : 'Partial'}
            </Badge>
            <Badge>Version {version?.version_no ?? '?'}</Badge>
            {r.identity_source ? (
              <Badge tone={r.identity_source === 'hidden_field' ? 'warning' : 'neutral'}>
                {IDENTITY_LABELS[r.identity_source] ?? r.identity_source}
              </Badge>
            ) : (
              <Badge>Anonymous</Badge>
            )}
            {r.anonymized_at ? <Badge tone="warning">Anonymized</Badge> : null}
            {r.score !== null ? (
              <Badge tone="accent">
                Score {r.score}
                {r.score_max !== null ? ` of ${r.score_max}` : ''}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted">
            Started {formatDateTime(r.started_at)}
            {r.submitted_at ? `. Submitted ${formatDateTime(r.submitted_at)}` : ''}
          </p>
        </div>
        {roleAtLeast(role, 'admin') ? (
          <DeleteResponseButton action={deleteResponseAction.bind(null, slug, id, responseId)} redirectTo={base} />
        ) : null}
      </header>

      <section aria-label="Contact" className="rounded-md border border-border p-4 text-sm">
        {c ? (
          <p>
            Contact:{' '}
            <Link href={`/w/${slug}/contacts/${c.id}`} className="text-accent underline">
              {contactName(c)}
            </Link>
            {c.email ? <span className="ml-2 text-muted">{c.email}</span> : null}
            {r.identity_source === 'hidden_field' ? (
              <Badge tone="warning" className="ml-2">
                Unverified
              </Badge>
            ) : null}
          </p>
        ) : (
          <p className="text-muted">Not linked to a contact.</p>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-label="Answers">
        {!def ? <p className="text-sm text-muted">The version definition could not be loaded; raw values are shown.</p> : null}
        {questions.map((q, i) => {
          const a = byKey.get(q.question_key)
          return (
            <article key={q.question_key} className="flex flex-col gap-1 border-b border-border pb-3">
              <h3 className="text-sm font-medium">
                <span className="text-muted">{i + 1}. </span>
                {plainLabel(q, q.question_key)}
              </h3>
              <AnswerView question={q} value={a ? answerValue(a) : undefined} fileHref={fileHref} />
            </article>
          )
        })}
        {orphans.map((a) => (
          <article key={a.question_key} className="flex flex-col gap-1 border-b border-border pb-3">
            <h3 className="text-sm font-medium">{a.question_key}</h3>
            <AnswerView question={undefined} value={answerValue(a)} fileHref={fileHref} />
          </article>
        ))}
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <Pairs title="Hidden fields" items={meta.hidden} />
        <Pairs title="UTM" items={meta.utm} />
        <Pairs title="Details" items={meta.other} />
      </div>
    </main>
  )
}
