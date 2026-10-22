import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireMember } from '@/lib/auth'
import { parseResultsFilters, parseResultsFiltersObject } from '@/lib/analytics/results-filters'
import { exportSurveys, type BulkExportResult } from '@/lib/exports/bulk'

/**
 * Bulk response export across surveys (Results hub), editor and above.
 * POST only: a GET can never start an export (D-05).
 *
 * JSON  { surveyIds: string[], filters?: {Results hub filter fields}, format, labels? }
 *       answers with the file, or JSON { job_id, url, rows } for a large export.
 * Form  fields surveyIds (repeated, or one comma joined value), format, and
 *       optionally the Results hub filter fields (range, from, to, status,
 *       version, identity, lead, tags, owner, mk, mv, q). No filter fields
 *       means every response of those surveys. Answers with the file, or a
 *       303 to the job's signed URL once a large export is written.
 *
 * Every survey exported writes log_export with scope responses.
 */
export const maxDuration = 300

type Ctx = { params: Promise<{ slug: string }> }

const jsonBody = z.object({
  surveyIds: z.array(z.string()).min(1).max(50),
  filters: z.unknown().optional(),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  labels: z.boolean().default(true),
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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Repeated fields and comma joined values both work. */
function surveyIdsFromForm(form: FormData): string[] {
  return [...new Set(form.getAll('surveyIds').flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean))]
}

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const type = (req.headers.get('content-type') ?? '').toLowerCase()
  const isForm = type.startsWith('application/x-www-form-urlencoded') || type.startsWith('multipart/form-data')

  let surveyIds: string[]
  let format: 'csv' | 'xlsx'
  let labels = true
  let filters
  if (isForm) {
    const form = await req.formData().catch(() => null)
    if (!form) return json({ error: 'invalid_input' }, 400)
    surveyIds = surveyIdsFromForm(form)
    const f = String(form.get('format') ?? 'csv')
    if (f !== 'csv' && f !== 'xlsx') return json({ error: 'invalid_input' }, 400)
    format = f
    labels = form.get('labels') !== '0'
    const sp = new URLSearchParams()
    for (const [k, v] of form.entries()) if (typeof v === 'string' && k !== 'surveyIds' && k !== 'surveys') sp.append(k, v)
    filters = parseResultsFilters(sp)
  } else {
    const parsed = jsonBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return json({ error: 'invalid_input' }, 400)
    surveyIds = parsed.data.surveyIds
    format = parsed.data.format
    labels = parsed.data.labels
    filters = parseResultsFiltersObject(parsed.data.filters)
  }
  if (!surveyIds.length) return json({ error: 'Pick at least one survey to export.' }, 400)

  const m = await requireMember(slug, 'viewer')
  const result = await exportSurveys(
    { supabase: m.supabase, workspaceId: m.workspace.id, userId: m.user.id, role: m.role, slug },
    { surveyIds, filters: { ...filters, surveys: surveyIds }, format, labels },
  )
  return respond(result, isForm)
}

function respond(r: BulkExportResult, isForm: boolean): Response {
  switch (r.kind) {
    case 'file':
      return new Response(r.body as BodyInit, {
        headers: { 'Content-Type': r.contentType, 'Content-Disposition': `attachment; filename="${r.filename}"`, 'Cache-Control': 'no-store' },
      })
    case 'job':
      if (isForm) return NextResponse.redirect(r.url, 303)
      return json({ job_id: r.jobId, status: 'done', url: r.url, rows: r.rows })
    case 'error':
      return json({ error: r.error, ...(r.jobId ? { job_id: r.jobId, status: 'failed' } : {}) }, r.status)
  }
}
