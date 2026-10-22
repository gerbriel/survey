import 'server-only'
import { roleAtLeast } from '@/lib/auth/roles'
import { loadSnapshots } from '@/lib/analytics/load'
import { toResultsQuery, type ResultsFilters } from '@/lib/analytics/results-filters'
import { surveyQuestionOrder } from '@/lib/analytics/results'
import { textMatches, type SurveyScope } from '@/lib/analytics/results-load'
import type { ResponseLite } from '@/lib/analytics/types'
import { readContactEmails, readTokens } from '@/lib/db/contacts'
import { createExportJob } from '@/lib/db/exports'
import { readAnswers, readResultRows, type ResultRow } from '@/lib/db/responses'
import { getSurvey, type SurveyRow } from '@/lib/db/surveys'
import type { UserClient } from '@/lib/supabase/types'
import type { WorkspaceRole } from '@/types/db-helpers'
import { responseRow, type ExportColumn, type RowContext } from './columns'
import { BOM, csvLine } from './csv'
import { DIRECT_LIMIT, finishJob, JOB_BUDGET_MS, logExport, planExport, type ExportPlan } from './jobs'
import { COUNTS_HEADER, sheetNames, surveyCounts, toUnionRow, unionExportColumns } from './union'
import { buildWorkbook, XLSX_MIME, type SheetSpec } from './xlsx'

/**
 * Bulk response export across surveys (Results hub, and later the survey
 * list with selected ids). Row level: editor and above; RLS still decides
 * what rows come back. Server only.
 *
 * CSV: one survey gives the per-survey layout (doc 04 section 6.1); several
 * give one file with a survey column first and the union of columns.
 * XLSX: a sheet per survey, a Summary sheet (per survey counts) and a
 * Combined sheet (the union layout).
 * Up to DIRECT_LIMIT rows the file comes back directly; above that an
 * export_jobs row is written and a 1 hour signed URL returned, as the per
 * survey route does. Every survey exported writes one log_export row.
 *
 * Decision: export_jobs.survey_id holds the first survey; the full list is in
 * the job's filters as survey_ids (no schema change).
 * Decision: a bulk export reads at most 100,000 rows in total.
 */

export const BULK_MAX_ROWS = 100_000
export const BULK_MAX_SURVEYS = 50

export type BulkContext = {
  supabase: UserClient
  workspaceId: string
  userId: string
  role: WorkspaceRole
  slug: string
}

export type BulkInput = {
  surveyIds: string[]
  filters: ResultsFilters
  format: 'csv' | 'xlsx'
  /** Second header row with question labels (CSV). Default true. */
  labels?: boolean
}

export type BulkExportResult =
  | { kind: 'file'; body: Uint8Array; contentType: string; filename: string; rows: number }
  | { kind: 'job'; jobId: string; url: string; rows: number }
  | { kind: 'error'; status: number; error: string; jobId?: string }

function chunksOf<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

type Part = { survey: SurveyRow; plan: ExportPlan; rows: ResultRow[]; filters: Record<string, unknown> }

function fileBase(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'survey'
}

export function bulkFileName(titles: string[], ext: 'csv' | 'xlsx', now = new Date()): string {
  const base = titles.length === 1 ? fileBase(titles[0]!) : `responses-${titles.length}-surveys`
  return `${base}-responses-${now.toISOString().slice(0, 10)}.${ext}`
}

async function formatRows(supabase: UserClient, part: Part, deadline: number | null): Promise<string[][]> {
  const out: string[][] = []
  for (const rows of chunksOf(part.rows, 1000)) {
    if (deadline && Date.now() > deadline) throw new Error('export_timeout')
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
      versionNo: part.plan.versionNo,
      question: part.plan.question,
      contactEmail: new Map(emails.ok ? emails.data.map((c) => [c.id, c.email]) : []),
      tokens: new Map(tokens.ok ? tokens.data.map((t) => [t.id, t.token]) : []),
      fileUrl: part.plan.fileUrl,
    }
    for (const r of rows) out.push(responseRow(part.plan.columns, r as unknown as ResponseLite, byResponse.get(r.id) ?? [], ctx))
  }
  return out
}

/** Builds the file body for formatted rows. */
async function produce(supabase: UserClient, parts: Part[], input: BulkInput, deadline: number | null): Promise<Buffer> {
  const formatted: string[][][] = []
  for (const p of parts) formatted.push(await formatRows(supabase, p, deadline))
  const labels = input.labels ?? true
  const union = unionExportColumns(parts.map((p) => p.plan.columns))
  const combined = parts.flatMap((p, i) => formatted[i]!.map((row) => toUnionRow(p.survey.title, p.plan.columns, row, union)))

  if (input.format === 'csv') {
    const cols: ExportColumn[] = parts.length === 1 ? parts[0]!.plan.columns : union
    const rows = parts.length === 1 ? formatted[0]! : combined
    let s = BOM + csvLine(cols.map((c) => c.id))
    if (labels) s += csvLine(cols.map((c) => c.label))
    for (const r of rows) s += csvLine(r)
    return Buffer.from(s, 'utf8')
  }

  const names = sheetNames(parts.map((p) => p.survey.title))
  const sheets: SheetSpec[] = [
    {
      name: 'Summary',
      headerRows: [COUNTS_HEADER],
      rows: parts.map((p) => {
        const c = surveyCounts(p.survey.title, p.rows)
        return [c.survey, c.responses, c.complete, c.partial]
      }),
    },
    { name: 'Combined', headerRows: [union.map((c) => c.id), union.map((c) => c.label)], rows: combined },
    ...parts.map((p, i) => ({
      name: names[i]!,
      headerRows: [p.plan.columns.map((c) => c.id), p.plan.columns.map((c) => c.label)],
      rows: formatted[i]!,
    })),
  ]
  return buildWorkbook(sheets)
}

/**
 * The bulk export. Validates role and survey ownership, reads matching rows
 * per survey, then answers with the file or an export job link.
 */
export async function exportSurveys(ctx: BulkContext, input: BulkInput): Promise<BulkExportResult> {
  if (!roleAtLeast(ctx.role, 'editor')) return { kind: 'error', status: 403, error: 'not_authorized' }
  const ids = [...new Set(input.surveyIds)].slice(0, BULK_MAX_SURVEYS)
  if (!ids.length) return { kind: 'error', status: 400, error: 'Pick at least one survey to export.' }

  const surveys: SurveyRow[] = []
  for (const surveyId of ids) {
    // D-15: an id from another workspace reads as null and is refused.
    const s = await getSurvey(ctx.supabase, { workspaceId: ctx.workspaceId, surveyId })
    if (!s.ok) return { kind: 'error', status: 400, error: s.error.message }
    if (!s.data) return { kind: 'error', status: 404, error: 'not_found' }
    surveys.push(s.data)
  }

  const parts: Part[] = []
  const scopes: SurveyScope[] = []
  let budget = BULK_MAX_ROWS
  for (const survey of surveys) {
    const snaps = await loadSnapshots(ctx.supabase, survey.id)
    if (!snaps.ok) return { kind: 'error', status: 500, error: snaps.error.message }
    const plan = planExport(snaps.data.snapshots, { slug: ctx.slug, surveyId: survey.id })
    scopes.push({ survey, versions: snaps.data.versions, snapshots: snaps.data.snapshots, questions: surveyQuestionOrder(snaps.data.snapshots) })
    const query = toResultsQuery(input.filters, snaps.data.versions)
    if (!query) {
      parts.push({ survey, plan, rows: [], filters: {} })
      continue
    }
    const rows = budget > 0 ? await readResultRows(ctx.supabase, { surveyId: survey.id, filters: query.rpc, where: query.where, max: budget }) : null
    if (rows && !rows.ok) return { kind: 'error', status: 500, error: rows.error.message }
    const list = rows?.data ?? []
    budget -= list.length
    parts.push({ survey, plan, rows: list, filters: { ...query.rpc, ...(query.where.length ? { where: query.where } : {}), ...(query.text ? { text: query.text } : {}) } })
  }

  const text = await textMatches(ctx.supabase, scopes, input.filters.text)
  if (!text.ok) return { kind: 'error', status: 500, error: text.error.message }
  if (text.data) for (const p of parts) p.rows = p.rows.filter((r) => text.data!.ids.has(r.id))
  for (const p of parts) p.rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const total = parts.reduce((n, p) => n + p.rows.length, 0)
  const surveyIds = surveys.map((s) => s.id)
  const log = (jobId?: string, rows?: number[]) =>
    Promise.all(
      parts.map((p, i) =>
        logExport(ctx.supabase, {
          workspaceId: ctx.workspaceId,
          surveyId: p.survey.id,
          scope: 'responses',
          format: input.format,
          filters: { ...p.filters, bulk: true, survey_ids: surveyIds },
          rows: rows ? (rows[i] ?? 0) : p.rows.length,
          ...(jobId ? { jobId } : {}),
        }),
      ),
    )
  const filename = bulkFileName(surveys.map((s) => s.title), input.format)
  const contentType = input.format === 'csv' ? 'text/csv; charset=utf-8' : XLSX_MIME

  if (total <= DIRECT_LIMIT[input.format]) {
    try {
      const body = await produce(ctx.supabase, parts, input, null)
      await log()
      return { kind: 'file', body: new Uint8Array(body), contentType, filename, rows: total }
    } catch {
      return { kind: 'error', status: 500, error: 'The export failed. Try again.' }
    }
  }

  const job = await createExportJob(ctx.supabase, {
    workspaceId: ctx.workspaceId,
    surveyId: surveyIds[0]!,
    format: input.format,
    filters: { bulk: true, survey_ids: surveyIds, ...(parts[0]?.filters ?? {}) },
    userId: ctx.userId,
  })
  if (!job.ok) return { kind: 'error', status: job.error.category === 'auth' ? 403 : 500, error: job.error.message }
  const deadline = Date.now() + JOB_BUDGET_MS
  const done = await finishJob(job.data, async () => ({ body: await produce(ctx.supabase, parts, input, deadline), rows: total }))
  await log(job.data.id, done.ok ? undefined : parts.map(() => 0))
  if (!done.ok) {
    const timeout = done.error.detail === 'export_timeout'
    return {
      kind: 'error',
      status: 500,
      jobId: job.data.id,
      error: timeout ? 'The export took too long. Pick fewer surveys or narrow the filters and try again.' : 'The export failed. Try again.',
    }
  }
  return { kind: 'job', jobId: job.data.id, url: done.data.url, rows: done.data.rows }
}
