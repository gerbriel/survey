import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/auth'
import { ABUSE_STATUSES, listAbuseReports, listAllWorkspaces } from '@/lib/admin/db/platform'
import { formatDateTime } from '@/lib/admin/lifecycle'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { archiveReportedWorkspace, closeReportedSurvey, setReportStatus } from '../actions'

export const metadata: Metadata = { title: 'Abuse reports' }

type Status = (typeof ABUSE_STATUSES)[number]

const REASONS: Record<string, string> = {
  phishing: 'Phishing or impersonation',
  sensitive_data: 'Asks for passwords or financial data',
  harassment: 'Harassment or hateful content',
  other: 'Other',
}

/** Abuse report review (doc 05 section 7.3): dismiss, close the survey, or archive the workspace. */
export default async function AbuseReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requirePlatformAdmin()
  const sp = await searchParams
  const status: Status = (ABUSE_STATUSES as readonly string[]).includes(String(sp.status)) ? (sp.status as Status) : 'open'
  const [reports, workspaces] = await Promise.all([listAbuseReports(supabase, { status }), listAllWorkspaces(supabase)])
  const wsById = new Map((workspaces.ok ? workspaces.data : []).map((w) => [w.id, w]))

  return (
    <>
      <PageHeader title="Abuse reports" description="Submitted from the Report abuse link on public surveys. Reporters are anonymous unless they left contact details." />
      <nav aria-label="Report status" className="mb-6 flex gap-3 text-sm">
        {ABUSE_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/reports?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={s === status ? 'font-semibold underline underline-offset-4' : 'text-accent underline underline-offset-2'}
          >
            {s === 'open' ? 'Open' : s === 'dismissed' ? 'Dismissed' : 'Actioned'}
          </Link>
        ))}
      </nav>
      {!reports.ok ? (
        <p role="alert" className="text-sm text-danger">{reports.error.message}</p>
      ) : reports.data.length === 0 ? (
        <EmptyState title="Nothing here" description="No reports with this status." />
      ) : (
        <ul className="flex flex-col gap-4">
          {reports.data.map((r) => {
            const ws = r.workspace_id ? wsById.get(r.workspace_id) : undefined
            return (
              <li key={r.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">{REASONS[r.reason] ?? r.reason}</h2>
                  <span className="text-xs text-muted">{formatDateTime(r.created_at)}</span>
                </div>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted">Survey key</dt>
                  <dd className="font-mono">{r.slug_text}{r.survey_id ? '' : ' (unknown survey)'}</dd>
                  <dt className="text-muted">Workspace</dt>
                  <dd>{ws ? `${ws.name} (/w/${ws.slug})` : 'Unknown'}</dd>
                  <dt className="text-muted">Details</dt>
                  <dd className="whitespace-pre-wrap break-words">{r.details || 'None'}</dd>
                  <dt className="text-muted">Reporter contact</dt>
                  <dd className="break-words">{r.reporter_contact || 'None'}</dd>
                </dl>
                <div className="mt-4 flex flex-wrap items-start gap-3">
                  {status !== 'dismissed' ? (
                    <InlineAction action={setReportStatus} fields={{ reportId: r.id, status: 'dismissed' }} label="Dismiss" />
                  ) : null}
                  {status !== 'open' ? (
                    <InlineAction action={setReportStatus} fields={{ reportId: r.id, status: 'open' }} label="Reopen" />
                  ) : null}
                  {status === 'open' && r.survey_id ? (
                    <InlineAction
                      action={closeReportedSurvey}
                      fields={{ reportId: r.id, surveyId: r.survey_id }}
                      label="Close the survey"
                      variant="danger"
                      confirm="The survey stops accepting responses. Its owners and admins see your reason on the survey."
                    >
                      <Input label="Reason shown to the workspace" name="reason" required maxLength={1000} />
                    </InlineAction>
                  ) : null}
                  {status === 'open' && ws && !ws.archived_at ? (
                    <InlineAction
                      action={archiveReportedWorkspace}
                      fields={{ reportId: r.id, workspaceId: ws.id }}
                      label="Archive the workspace"
                      variant="danger"
                      confirm={`Archive ${ws.name}? Every public survey closes and the workspace becomes read only until it is unarchived.`}
                    />
                  ) : null}
                  {status === 'open' ? (
                    <InlineAction action={setReportStatus} fields={{ reportId: r.id, status: 'actioned' }} label="Mark actioned" />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
