'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireMember } from '@/lib/auth'
import {
  createReport,
  createShare,
  deleteReport,
  getReport,
  hashSharePassword,
  listReports,
  replaceWidgets,
  revokeShare,
  SHARE_PASSWORD_MAX,
  SHARE_PASSWORD_MIN,
  updateReport,
  widgetInput,
} from '@/lib/db/reports'
import { getSurvey } from '@/lib/db/surveys'
import { parseFilters, reportFiltersFrom } from '@/lib/analytics/filters'
import { loadSnapshots } from '@/lib/analytics/load'
import { defaultWidgets } from '@/lib/analytics/widgets'
import { publicReportUrl } from '@/lib/analytics/share-url'

/**
 * Report and share link actions (doc 04 sections 5.1, 5.2, 5.4). Editor and
 * above; every write runs as the member and RLS refuses anything else.
 */

export type ActionResult = { ok: true; url?: string } | { ok: false; error: string }

const ids = z.object({ slug: z.string().min(1).max(64), surveyId: z.guid() })

async function editor(slug: string, surveyId: string) {
  ids.parse({ slug, surveyId })
  const m = await requireMember(slug, 'editor')
  const s = await getSurvey(m.supabase, { workspaceId: m.workspace.id, surveyId })
  if (!s.ok || !s.data) throw new Error('not_found')
  return { m, survey: s.data }
}

function base(slug: string, surveyId: string) {
  return `/w/${slug}/surveys/${surveyId}/reports`
}

async function seedWidgets(m: Awaited<ReturnType<typeof editor>>['m'], surveyId: string, latestId: string | null) {
  const snaps = await loadSnapshots(m.supabase, surveyId)
  const latest = snaps.ok ? snaps.data.snapshots.find((v) => v.versionId === latestId) : undefined
  return defaultWidgets(latest?.questions ?? []).map((w) => ({
    question_key: w.question_key,
    metric: w.metric,
    chart_type: w.chart_type,
    cross_tab_key: null,
    options: {},
  }))
}

export async function createReportAction(slug: string, surveyId: string, formData: FormData): Promise<void> {
  const { m, survey } = await editor(slug, surveyId)
  const name = String(formData.get('name') ?? '').trim() || 'Untitled report'
  const created = await createReport(m.supabase, {
    workspaceId: m.workspace.id,
    surveyId,
    name: name.slice(0, 120),
    filters: reportFiltersFrom(parseFilters({})),
    userId: m.user.id,
  })
  if (!created.ok) throw new Error(created.error.message)
  await replaceWidgets(m.supabase, {
    reportId: created.data.id,
    workspaceId: m.workspace.id,
    widgets: await seedWidgets(m, surveyId, survey.latest_published_version_id),
  })
  redirect(`${base(slug, surveyId)}/${created.data.id}`)
}

/** "Customize" on the virtual default report: materialize it with is_default = true. */
export async function customizeDefaultAction(slug: string, surveyId: string): Promise<void> {
  const { m, survey } = await editor(slug, surveyId)
  const existing = await listReports(m.supabase, { surveyId })
  const found = existing.ok ? existing.data.find((r) => r.is_default) : undefined
  if (found) redirect(`${base(slug, surveyId)}/${found.id}`)
  const created = await createReport(m.supabase, {
    workspaceId: m.workspace.id,
    surveyId,
    name: 'Default report',
    isDefault: true,
    filters: reportFiltersFrom(parseFilters({})),
    userId: m.user.id,
  })
  if (!created.ok) throw new Error(created.error.message)
  await replaceWidgets(m.supabase, {
    reportId: created.data.id,
    workspaceId: m.workspace.id,
    widgets: await seedWidgets(m, surveyId, survey.latest_published_version_id),
  })
  redirect(`${base(slug, surveyId)}/${created.data.id}`)
}

const saveInput = z.object({ name: z.string().trim().min(1).max(120), widgets: z.array(widgetInput).max(100) })

export async function saveReportAction(slug: string, surveyId: string, reportId: string, input: z.input<typeof saveInput>): Promise<ActionResult> {
  const { m } = await editor(slug, surveyId)
  const v = saveInput.safeParse(input)
  if (!v.success) return { ok: false, error: 'Check the widgets: each needs a question or metric and a chart type.' }
  const rep = await getReport(m.supabase, { reportId })
  if (!rep.ok || !rep.data || rep.data.survey_id !== surveyId) return { ok: false, error: 'We could not find that report.' }
  const up = await updateReport(m.supabase, { reportId, name: v.data.name })
  if (!up.ok) return { ok: false, error: up.error.message }
  const w = await replaceWidgets(m.supabase, { reportId, workspaceId: m.workspace.id, widgets: v.data.widgets })
  if (!w.ok) return { ok: false, error: w.error.message }
  revalidatePath(`${base(slug, surveyId)}/${reportId}`)
  return { ok: true }
}

/** Saves the filters currently in the URL as the report's filters (frozen for share links). */
export async function saveReportFiltersAction(slug: string, surveyId: string, reportId: string, query: string): Promise<ActionResult> {
  const { m } = await editor(slug, surveyId)
  const rep = await getReport(m.supabase, { reportId })
  if (!rep.ok || !rep.data || rep.data.survey_id !== surveyId) return { ok: false, error: 'We could not find that report.' }
  const up = await updateReport(m.supabase, { reportId, filters: reportFiltersFrom(parseFilters(new URLSearchParams(query.slice(0, 4000)))) })
  if (!up.ok) return { ok: false, error: up.error.message }
  revalidatePath(`${base(slug, surveyId)}/${reportId}`)
  return { ok: true }
}

export async function deleteReportAction(slug: string, surveyId: string, reportId: string): Promise<void> {
  const { m } = await editor(slug, surveyId)
  const rep = await getReport(m.supabase, { reportId })
  if (rep.ok && rep.data && rep.data.survey_id === surveyId) await deleteReport(m.supabase, { reportId })
  redirect(base(slug, surveyId))
}

const shareInput = z.object({
  expiresDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal(0)]),
  password: z.string().max(SHARE_PASSWORD_MAX).default(''),
})

export async function createShareAction(slug: string, surveyId: string, reportId: string, input: z.input<typeof shareInput>): Promise<ActionResult> {
  const { m } = await editor(slug, surveyId)
  const v = shareInput.safeParse(input)
  if (!v.success) return { ok: false, error: 'Pick an expiry.' }
  const pw = v.data.password.trim()
  if (pw && pw.length < SHARE_PASSWORD_MIN) return { ok: false, error: `Use at least ${SHARE_PASSWORD_MIN} characters for the password, or leave it empty.` }
  const rep = await getReport(m.supabase, { reportId })
  if (!rep.ok || !rep.data || rep.data.survey_id !== surveyId) return { ok: false, error: 'We could not find that report.' }
  const expiresAt = v.data.expiresDays ? new Date(Date.now() + v.data.expiresDays * 86400000).toISOString() : null
  // bcrypt in SQL (hash_share_password); the plain password never reaches a table.
  const hash = pw ? await hashSharePassword(m.supabase, { password: pw }) : null
  if (hash && !hash.ok) return { ok: false, error: hash.error.message }
  const created = await createShare(m.supabase, {
    reportId,
    workspaceId: m.workspace.id,
    expiresAt,
    passwordHash: hash ? hash.data : null,
  })
  if (!created.ok) return { ok: false, error: created.error.message }
  revalidatePath(`${base(slug, surveyId)}/${reportId}`)
  return { ok: true, url: publicReportUrl(created.data.token) }
}

export async function revokeShareAction(slug: string, surveyId: string, reportId: string, shareId: string): Promise<ActionResult> {
  const { m } = await editor(slug, surveyId)
  const r = await revokeShare(m.supabase, { shareId })
  if (!r.ok) return { ok: false, error: r.error.message }
  revalidatePath(`${base(slug, surveyId)}/${reportId}`)
  return { ok: true }
}
