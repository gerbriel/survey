import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { createExportJob, getExportJob } from '@/lib/db/exports'
import { getSurvey } from '@/lib/db/surveys'
import { parseFilters, toResponseFilters } from '@/lib/analytics/filters'
import { loadAnalytics, loadSnapshots } from '@/lib/analytics/load'
import { countFilteredResponses } from '@/lib/db/responses'
import { BOM, csvLine, toCsv } from '@/lib/exports/csv'
import { collectRows, csvStream, DIRECT_LIMIT, finishJob, JOB_BUDGET_MS, logExport, planExport, signedJobUrl } from '@/lib/exports/jobs'
import { SUMMARY_HEADER, summaryRows } from '@/lib/exports/summary'
import { buildXlsx, XLSX_MIME } from '@/lib/exports/xlsx'

/**
 * Exports for one survey (doc 04 section 6).
 *
 * POST { kind: 'responses' | 'summary', format: 'csv' | 'xlsx', labels?, query }
 *   summary   aggregate numbers, viewers and above, CSV.
 *   responses row level, editor and above. Up to 5,000 rows (XLSX 2,000) the
 *             file streams back directly; above that an export_jobs row is
 *             created, the file is written to the private exports bucket, and
 *             the answer is JSON { job_id, url } with a 1 hour signed URL.
 * POST form fields kind, format, labels, query (a plain HTML form, the
 *   response inbox uses one): the same export answered as a file download;
 *   a large export answers 303 to the signed URL once the file is written.
 * GET ?job={id}
 *   status of an earlier job and a fresh signed URL when done. D-05: GET
 *   never starts an export, so a cross-site link or window.open cannot.
 *
 * Every export writes activity_log with actor, scope, filters and row count.
 */
export const maxDuration = 300

type Ctx = { params: Promise<{ slug: string; id: string }> }

const body = z.object({
  kind: z.enum(['responses', 'summary']),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  labels: z.boolean().default(false),
  query: z.string().max(4000).default(''),
})

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

function fileName(title: string, suffix: string, ext: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'survey'
  return `${base}-${suffix}-${new Date().toISOString().slice(0, 10)}.${ext}`
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const type = (req.headers.get('content-type') ?? '').toLowerCase()
  if (type.startsWith('application/x-www-form-urlencoded') || type.startsWith('multipart/form-data')) {
    // D-05: the inbox's form post, answered as a download.
    const form = await req.formData().catch(() => null)
    if (!form) return json({ error: 'invalid_input' }, 400)
    const parsed = body.safeParse({
      kind: String(form.get('kind') ?? 'responses'),
      format: String(form.get('format') ?? 'csv'),
      labels: form.get('labels') === '1',
      query: String(form.get('query') ?? ''),
    })
    if (!parsed.success) return json({ error: 'invalid_input' }, 400)
    return runExport(slug, id, parsed.data, 'link')
  }
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid_input' }, 400)
  return runExport(slug, id, parsed.data, 'json')
}

async function runExport(slug: string, id: string, input: z.output<typeof body>, mode: 'json' | 'link'): Promise<Response> {
  const m = await requireMember(slug, 'viewer')
  const survey = await getSurvey(m.supabase, { workspaceId: m.workspace.id, surveyId: id })
  if (!survey.ok || !survey.data) return json({ error: 'not_found' }, 404)
  const filters = parseFilters(new URLSearchParams(input.query))
  const sqlFilters = toResponseFilters(filters)

  if (input.kind === 'summary') {
    const a = await loadAnalytics(m.supabase, survey.data, filters)
    if (!a.ok) return json({ error: a.error.message }, 500)
    const rows = summaryRows(a.data.blocks)
    await logExport(m.supabase, { workspaceId: m.workspace.id, surveyId: id, scope: 'summary', format: 'csv', filters: sqlFilters, rows: a.data.responseCount })
    return new Response(toCsv(SUMMARY_HEADER, rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName(survey.data.title, 'summary', 'csv')}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // Row level: editor and above (doc 04 section 6). RLS still decides what rows come back.
  if (!roleAtLeast(m.role, 'editor')) return json({ error: 'not_authorized' }, 403)
  const snaps = await loadSnapshots(m.supabase, id)
  if (!snaps.ok) return json({ error: snaps.error.message }, 500)
  const plan = planExport(snaps.data.snapshots, { slug, surveyId: id })
  const total = await countFilteredResponses(m.supabase, { surveyId: id, filters: sqlFilters })
  if (!total.ok) return json({ error: total.error.message }, 500)
  const header = plan.columns.map((c) => c.id)
  const labels = plan.columns.map((c) => c.label)

  if (total.data <= DIRECT_LIMIT[input.format]) {
    await logExport(m.supabase, { workspaceId: m.workspace.id, surveyId: id, scope: 'responses', format: input.format, filters: sqlFilters, rows: total.data })
    if (input.format === 'csv') {
      return new Response(csvStream(m.supabase, id, sqlFilters, plan, { labels: input.labels }), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName(survey.data.title, 'responses', 'csv')}"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    const [rows, a] = await Promise.all([collectRows(m.supabase, id, sqlFilters, plan), loadAnalytics(m.supabase, survey.data, filters)])
    const buf = await buildXlsx({
      header,
      labels,
      rows,
      summary: a.ok ? summaryRows(a.data.blocks) : [],
      questions: questionInfo(plan, snaps.data.snapshots),
    })
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${fileName(survey.data.title, 'responses', 'xlsx')}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const job = await createExportJob(m.supabase, { workspaceId: m.workspace.id, surveyId: id, format: input.format, filters: sqlFilters, userId: m.user.id })
  if (!job.ok) return json({ error: job.error.message }, job.error.category === 'auth' ? 403 : 500)
  const deadline = Date.now() + JOB_BUDGET_MS
  const done = await finishJob(job.data, async () => {
    const rows = await collectRows(m.supabase, id, sqlFilters, plan, { deadline })
    if (input.format === 'csv') {
      let s = BOM + csvLine(header)
      if (input.labels) s += csvLine(labels)
      for (const r of rows) s += csvLine(r)
      return { body: Buffer.from(s, 'utf8'), rows: rows.length }
    }
    const a = await loadAnalytics(m.supabase, survey.data!, filters)
    const body = await buildXlsx({ header, labels, rows, summary: a.ok ? summaryRows(a.data.blocks) : [], questions: questionInfo(plan, snaps.data.snapshots) })
    return { body, rows: rows.length }
  })
  await logExport(m.supabase, {
    workspaceId: m.workspace.id,
    surveyId: id,
    scope: 'responses',
    format: input.format,
    filters: sqlFilters,
    rows: done.ok ? done.data.rows : 0,
    jobId: job.data.id,
  })
  if (!done.ok) {
    const timeout = done.error.detail === 'export_timeout'
    return json({ job_id: job.data.id, status: 'failed', error: timeout ? 'The export took too long. Narrow the date range or filters and try again.' : 'The export failed. Try again.' }, 500)
  }
  if (mode === 'link') return NextResponse.redirect(done.data.url, 303)
  return json({ job_id: job.data.id, status: 'done', url: done.data.url, rows: done.data.rows })
}

export async function GET(req: Request, { params }: Ctx) {
  const { slug } = await params
  const sp = new URL(req.url).searchParams
  // D-05: GET is the job status poll only; exports start with POST.
  if (!sp.has('job')) return json({ error: 'method_not_allowed' }, 405)
  const m = await requireMember(slug, 'viewer')
  const jobId = sp.get('job') ?? ''
  const job = await getExportJob(m.supabase, { jobId })
  if (!job.ok || !job.data || job.data.workspace_id !== m.workspace.id) return json({ error: 'not_found' }, 404)
  const url = job.data.status === 'done' && job.data.storage_path ? await signedJobUrl(m.workspace.id, job.data.storage_path) : null
  return json({ job_id: job.data.id, status: job.data.status, rows: job.data.row_count, url, expired: job.data.status === 'done' && !job.data.storage_path })
}

function questionInfo(plan: ReturnType<typeof planExport>, snapshots: { versionId: string; versionNo: number; questions: { question_key: string }[] }[]) {
  return plan.questions.map((q) => ({
    question_key: q.question_key,
    label: q.label,
    type: q.type,
    versions: snapshots
      .filter((s) => s.questions.some((x) => x.question_key === q.question_key))
      .map((s) => `v${s.versionNo}`)
      .join(', '),
  }))
}
