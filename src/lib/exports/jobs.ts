import 'server-only'
import { orderedQuestions } from '@/lib/analytics/analyze'
import {
  readAnswers,
  readContactEmails,
  readResponsePage,
  readTokens,
  type ExportJobRow,
} from '@/lib/analytics/data'
import { fail, makeDbError, ok, type DbResult } from '@/lib/db/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserClient } from '@/lib/supabase/types'
import type { VersionSnapshot } from '@/lib/analytics/versions'
import type { QuestionSnapshot } from '@/lib/analytics/types'
import { buildColumns, responseFilePath, responseRow, type ExportColumn, type RowContext } from './columns'
import { BOM, csvLine } from './csv'

/**
 * Response exports (doc 04 section 6.4). Row reads run as the signed-in
 * member (RLS applies). The service role is used only for what members
 * cannot do under RLS: writing the export file to the private `exports`
 * bucket, updating the export_jobs row, signing its URL, and writing the
 * activity_log entry. Callers have already checked editor and above.
 */

export const DIRECT_LIMIT = { csv: 5000, xlsx: 2000 } as const
export const PAGE_SIZE = 1000
/** Stop a large job before the route's 300 s maxDuration. */
export const JOB_BUDGET_MS = 250_000

export function dashboardOrigin(): string {
  const host = process.env.DASHBOARD_HOST ?? 'localhost'
  return `${process.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}`
}

export type ExportPlan = {
  fileUrl: (fileId: string) => string
  columns: ExportColumn[]
  questions: QuestionSnapshot[]
  versionNo: Map<string, number>
  question: (versionId: string, key: string) => QuestionSnapshot | undefined
}

export function planExport(snapshots: VersionSnapshot[], files: { slug: string; surveyId: string }): ExportPlan {
  const all = snapshots.map((s) => s.versionId)
  // Hidden questions stay in the list: they become hidden.{param} columns.
  const questions = orderedQuestions(snapshots, all)
  const index = new Map<string, QuestionSnapshot>()
  for (const s of snapshots) for (const q of s.questions) index.set(`${s.versionId}:${q.question_key}`, q)
  const latest = new Map(questions.map((q) => [q.question_key, q]))
  return {
    fileUrl: (fileId) => `${dashboardOrigin()}${responseFilePath(files.slug, files.surveyId, fileId)}`,
    columns: buildColumns(questions),
    questions,
    versionNo: new Map(snapshots.map((s) => [s.versionId, s.versionNo])),
    question: (v, k) => index.get(`${v}:${k}`) ?? latest.get(k),
  }
}

/** Reads matching responses in keyset pages and yields formatted rows. */
export async function* exportRows(
  supabase: UserClient,
  surveyId: string,
  filters: Record<string, unknown>,
  plan: ExportPlan,
  opts: { deadline?: number; max?: number } = {},
): AsyncGenerator<string[], void, void> {
  let after: string | null = null
  let count = 0
  for (;;) {
    if (opts.deadline && Date.now() > opts.deadline) throw new Error('export_timeout')
    const page = await readResponsePage(supabase, { surveyId, filters, after, limit: PAGE_SIZE })
    if (!page.ok) throw new Error(page.error.code)
    const rows = page.data
    if (rows.length === 0) return
    const [answers, emails, tokens] = await Promise.all([
      readAnswers(supabase, { responseIds: rows.map((r) => r.id) }),
      readContactEmails(supabase, rows.map((r) => r.contact_id).filter((x): x is string => Boolean(x))),
      readTokens(supabase, rows.map((r) => r.respondent_token_id).filter((x): x is string => Boolean(x))),
    ])
    if (!answers.ok) throw new Error(answers.error.code)
    const byResponse = new Map<string, typeof answers.data>()
    for (const a of answers.data) {
      const l = byResponse.get(a.response_id)
      if (l) l.push(a)
      else byResponse.set(a.response_id, [a])
    }
    const ctx: RowContext = {
      versionNo: plan.versionNo,
      question: plan.question,
      contactEmail: new Map(emails.ok ? emails.data.map((c) => [c.id, c.email]) : []),
      tokens: new Map(tokens.ok ? tokens.data.map((t) => [t.id, t.token]) : []),
      fileUrl: plan.fileUrl,
    }
    for (const r of rows) {
      yield responseRow(plan.columns, r, byResponse.get(r.id) ?? [], ctx)
      count++
      if (opts.max && count >= opts.max) return
    }
    if (rows.length < PAGE_SIZE) return
    after = rows[rows.length - 1]!.id
  }
}

/** Direct CSV stream (up to DIRECT_LIMIT.csv rows), keyset pages of 1,000. */
export function csvStream(
  supabase: UserClient,
  surveyId: string,
  filters: Record<string, unknown>,
  plan: ExportPlan,
  opts: { labels: boolean },
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const it = exportRows(supabase, surveyId, filters, plan, { max: DIRECT_LIMIT.csv })
  let started = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true
        let head = BOM + csvLine(plan.columns.map((c) => c.id))
        if (opts.labels) head += csvLine(plan.columns.map((c) => c.label))
        controller.enqueue(enc.encode(head))
        return
      }
      try {
        const next = await it.next()
        if (next.done) controller.close()
        else controller.enqueue(enc.encode(csvLine(next.value)))
      } catch (e) {
        controller.error(e)
      }
    },
  })
}

export async function collectRows(
  supabase: UserClient,
  surveyId: string,
  filters: Record<string, unknown>,
  plan: ExportPlan,
  opts: { deadline?: number; max?: number } = {},
): Promise<string[][]> {
  const rows: string[][] = []
  for await (const r of exportRows(supabase, surveyId, filters, plan, opts)) rows.push(r)
  return rows
}

// ---------------------------------------------------------- export_jobs side

export function jobObjectPath(job: Pick<ExportJobRow, 'workspace_id' | 'id' | 'format'>): string {
  return `${job.workspace_id}/${job.id}.${job.format}`
}

/**
 * Marks a job running, uploads the finished file, marks it done with the row
 * count, and returns a 1 hour signed URL. Service role: export_jobs has no
 * member update policy and the exports bucket is private.
 * Decision: a job runs to completion inside one request (maxDuration 300 s);
 * if it cannot finish within 250 s it is marked failed and the member is told
 * to narrow the filter. The cursor column is not used in v1 because Storage
 * objects cannot be appended to.
 */
export async function finishJob(
  job: ExportJobRow,
  produce: () => Promise<{ body: Buffer; rows: number }>,
): Promise<DbResult<{ url: string; rows: number }>> {
  const admin = createAdminClient()
  const path = jobObjectPath(job)
  try {
    await admin.from('export_jobs').update({ status: 'running' }).eq('id', job.id)
    const { body, rows } = await produce()
    const up = await admin.storage
      .from('exports')
      .upload(path, body, { contentType: job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true })
    if (up.error) throw up.error
    await admin
      .from('export_jobs')
      .update({ status: 'done', storage_path: `exports/${path}`, row_count: rows, finished_at: new Date().toISOString() })
      .eq('id', job.id)
    const url = await signedJobUrl(job.workspace_id, `exports/${path}`)
    if (!url) return fail(makeDbError('unknown', 'could not sign the export file'))
    return ok({ url, rows })
  } catch (e) {
    await admin.from('export_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', job.id)
    const timeout = e instanceof Error && e.message === 'export_timeout'
    return fail(makeDbError(timeout ? 'invalid_state' : 'unknown', timeout ? 'export_timeout' : e instanceof Error ? e.message : undefined))
  }
}

/** 1 hour signed URL for a job file the caller could already read under RLS. */
export async function signedJobUrl(workspaceId: string, storagePath: string): Promise<string | null> {
  const name = storagePath.startsWith('exports/') ? storagePath.slice('exports/'.length) : storagePath
  if (!name.startsWith(`${workspaceId}/`)) return null
  const { data, error } = await createAdminClient().storage.from('exports').createSignedUrl(name, 3600, { download: true })
  return error || !data ? null : data.signedUrl
}

// ------------------------------------------------------------ activity log

export type ExportLog = {
  workspaceId: string
  actorId: string
  surveyId: string
  scope: 'responses' | 'summary' | 'report'
  format: 'csv' | 'xlsx'
  filters: Record<string, unknown>
  rows: number
  jobId?: string
}

/**
 * Every export, aggregate or row level, writes activity_log (doc 04 section
 * 6). activity_log has no member insert policy and write_activity is not
 * granted to members, so this inserts with the service role after the route
 * verified the member. TODO(foundation): a `log_export` SQL function granted
 * to authenticated would keep this under RLS.
 */
export async function logExport(e: ExportLog): Promise<void> {
  try {
    await createAdminClient()
      .from('activity_log')
      .insert({
        workspace_id: e.workspaceId,
        actor: e.actorId,
        entity: 'export',
        entity_id: e.jobId ?? e.surveyId,
        action: `export_${e.scope}`,
        diff: { survey_id: e.surveyId, format: e.format, filters: e.filters, row_count: e.rows } as never,
      })
  } catch (err) {
    console.error('export activity log failed', err)
  }
}
