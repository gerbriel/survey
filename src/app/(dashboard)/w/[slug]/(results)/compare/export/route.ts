import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireMember } from '@/lib/auth'
import { COMPARE_MIN_SURVEYS, compareDetailTable, compareSummaryTable, parseCompareSurveys } from '@/lib/analytics/compare'
import { loadComparison } from '@/lib/analytics/compare-load'
import { toResponseFilters } from '@/lib/analytics/filters'
import { toCsv } from '@/lib/exports/csv'
import { logExport } from '@/lib/exports/jobs'
import { buildWorkbook, XLSX_MIME } from '@/lib/exports/xlsx'

/**
 * Comparison export, aggregate only, viewers and above (doc 04 section 6).
 * POST { format: 'csv' | 'xlsx', query } where query is the Compare page's
 * query string. Never verbatims or files: numbers per matched question.
 *
 * CSV: the Summary layout (one row per matched question, one column per
 * survey, then differences against the first survey).
 * XLSX: Summary, Detail (every measure) and Unmatched sheets.
 * Decision: one log_export row (kind summary) per compared survey, so each
 * survey's audit trail shows the export.
 */

type Ctx = { params: Promise<{ slug: string }> }

const body = z.object({ format: z.enum(['csv', 'xlsx']).default('csv'), query: z.string().max(4000).default('') })

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid_input' }, 400)
  const m = await requireMember(slug, 'viewer')
  const sp = new URLSearchParams(parsed.data.query)
  const ids = parseCompareSurveys(sp.getAll('surveys'))
  if (ids.length < COMPARE_MIN_SURVEYS) return json({ error: 'Pick two to five surveys to compare.' }, 400)
  const c = await loadComparison(m.supabase, m.workspace.id, ids, sp)
  if (!c.ok) return json({ error: c.error.message }, 500)
  if (c.data.surveys.length < COMPARE_MIN_SURVEYS) return json({ error: 'At least two of the picked surveys need a published version.' }, 400)

  const titles = c.data.surveys.map((s) => s.survey.title)
  const summary = compareSummaryTable(titles, c.data.questions)
  const format = parsed.data.format
  await Promise.all(
    c.data.surveys.map((s) =>
      logExport(m.supabase, {
        workspaceId: m.workspace.id,
        surveyId: s.survey.id,
        scope: 'summary',
        format,
        filters: { ...toResponseFilters(s.filters), compare: true, survey_ids: c.data.surveys.map((x) => x.survey.id) },
        rows: s.analytics.responseCount,
      }),
    ),
  )
  const name = `comparison-${titles.length}-surveys-${new Date().toISOString().slice(0, 10)}.${format}`
  if (format === 'csv') {
    return new Response(toCsv(summary.header, summary.rows), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
    })
  }
  const detail = compareDetailTable(titles, c.data.questions)
  const unmatched = c.data.surveys.flatMap((s, i) => (c.data.match.unmatched[i] ?? []).map((q) => [s.survey.title, q.question_key, q.label, q.type]))
  const buf = await buildWorkbook([
    { name: 'Summary', headerRows: [summary.header], rows: summary.rows },
    { name: 'Detail', headerRows: [detail.header], rows: detail.rows },
    { name: 'Unmatched', headerRows: [['survey', 'question_key', 'question', 'type']], rows: unmatched },
  ])
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  })
}
