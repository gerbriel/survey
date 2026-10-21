import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { AdminClient, UserClient } from '@/lib/supabase/types'
import { fail, ok, toDbError, type DbResult } from './errors'
import { LEAD_STATUSES } from './contacts'
import { asJsonObject, call, id } from './rpc'

/**
 * Public shared report payload (migrations 0013 and 0018, doc 04 section
 * 5.4). Service role only: the /r/[token] page on the public host calls
 * reportShareGate on every load (it counts the view) and then
 * sharedReportPayload through server library code. The payload is aggregates
 * only, cells under 3 suppressed, and null for an unknown, revoked or expired
 * token or a wrong password. Saved reports, widgets and shares are table rows
 * under RLS (editor and above), below.
 */
export type SharedReportWidget = {
  id: string
  position: number
  chart_type: string
  question_key: string | null
  metric: string | null
  label: string | null
  options: Json | null
  result: Json
}

export type SharedReportPayload = {
  report: { name: string }
  survey: { title: string }
  workspace: { name: string; logo_path: string | null }
  widgets: SharedReportWidget[]
}

export const sharedReportInput = z.object({
  token: z.string().min(1).max(100),
  password: z.string().max(200).nullable().default(null),
})

export function sharedReportPayload(client: AdminClient, input: z.input<typeof sharedReportInput>) {
  return call(
    sharedReportInput,
    input,
    // The generated type marks p_password as string; SQL accepts null for no password.
    (v) => client.rpc('shared_report_payload', { p_token: v.token, p_password: v.password as string }),
    (d): SharedReportPayload | null => (d ? (d as unknown as SharedReportPayload) : null),
  )
}

export const REPORT_SHARE_GATE_STATUSES = ['not_found', 'needs_password', 'open'] as const
export type ReportShareGateStatus = (typeof REPORT_SHARE_GATE_STATUSES)[number]
export type ReportShareGate = { status: ReportShareGateStatus; report_id: string | null }

/**
 * Service role. not_found for an unknown, revoked or expired token (or a
 * deleted workspace), needs_password when the share has a password and none
 * or a wrong one was given, open otherwise. Every open counts one view.
 */
export function reportShareGate(client: AdminClient, input: z.input<typeof sharedReportInput>) {
  return call(
    sharedReportInput,
    input,
    (v) => client.rpc('report_share_gate', { p_token: v.token, ...(v.password !== null ? { p_password: v.password } : {}) }).maybeSingle(),
    (row): ReportShareGate => {
      const status = (REPORT_SHARE_GATE_STATUSES as readonly string[]).includes(row?.status ?? '')
        ? (row!.status as ReportShareGateStatus)
        : 'not_found'
      return { status, report_id: status === 'open' ? (row?.report_id ?? null) : null }
    },
  )
}

export const SHARE_PASSWORD_MIN = 6
export const SHARE_PASSWORD_MAX = 200

export const hashSharePasswordInput = z.object({ password: z.string().min(SHARE_PASSWORD_MIN).max(SHARE_PASSWORD_MAX) })

/** bcrypt hash for report_shares.password_hash, computed in SQL (migration 0018). */
export function hashSharePassword(client: UserClient, input: z.input<typeof hashSharePasswordInput>) {
  return call(
    hashSharePasswordInput,
    input,
    (v) => client.rpc('hash_share_password', { p_password: v.password }),
    (d): string => d as string,
  )
}

// ---------------------------------------------------------------------------
// Saved reports, widgets and share links (doc 04 section 5) under RLS.
// ---------------------------------------------------------------------------

export type ReportRow = Tables<'reports'>
export type WidgetRow = Tables<'report_widgets'>
export type ShareRow = Omit<Tables<'report_shares'>, 'password_hash'> & { has_password: boolean }

export const reportListInput = z.object({ surveyId: id })

export function listReports(client: UserClient, input: z.input<typeof reportListInput>) {
  return call(
    reportListInput,
    input,
    (v) => client.from('reports').select('*').eq('survey_id', v.surveyId).order('is_default', { ascending: false }).order('created_at'),
    (rows): ReportRow[] => rows ?? [],
  )
}

export const reportIdInput = z.object({ reportId: id })

export function getReport(client: UserClient, input: z.input<typeof reportIdInput>) {
  return call(reportIdInput, input, (v) => client.from('reports').select('*').eq('id', v.reportId).maybeSingle(), (row): ReportRow | null => row ?? null)
}

export const createReportInput = z.object({
  workspaceId: id,
  surveyId: id,
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().default(false),
  filters: z.record(z.string(), z.unknown()).default({}),
  userId: id,
})

export function createReport(client: UserClient, input: z.input<typeof createReportInput>) {
  return call(
    createReportInput,
    input,
    (v) =>
      client
        .from('reports')
        .insert({
          workspace_id: v.workspaceId,
          survey_id: v.surveyId,
          name: v.name,
          is_default: v.isDefault,
          filters: asJsonObject(v.filters),
          created_by: v.userId,
        })
        .select('*')
        .single(),
    (row): ReportRow => row as ReportRow,
  )
}

export const updateReportInput = z.object({
  reportId: id,
  name: z.string().trim().min(1).max(120).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
})

export function updateReport(client: UserClient, input: z.input<typeof updateReportInput>) {
  return call(
    updateReportInput,
    input,
    (v) =>
      client
        .from('reports')
        .update({ ...(v.name ? { name: v.name } : {}), ...(v.filters ? { filters: asJsonObject(v.filters) } : {}) })
        .eq('id', v.reportId),
    () => undefined,
  )
}

export function deleteReport(client: UserClient, input: z.input<typeof reportIdInput>) {
  return call(reportIdInput, input, (v) => client.from('reports').delete().eq('id', v.reportId), () => undefined)
}

export function listWidgets(client: UserClient, input: z.input<typeof reportIdInput>) {
  return call(
    reportIdInput,
    input,
    (v) => client.from('report_widgets').select('*').eq('report_id', v.reportId).order('position'),
    (rows): WidgetRow[] => rows ?? [],
  )
}

export const widgetInput = z
  .object({
    question_key: z.string().regex(/^q_[a-z0-9]{8}$/).nullable(),
    metric: z.string().max(40).nullable(),
    chart_type: z.enum(['bar', 'stacked_bar', 'pie', 'table', 'histogram', 'nps_gauge', 'heat_table', 'word_list', 'line', 'stat']),
    cross_tab_key: z.string().regex(/^q_[a-z0-9]{8}$/).nullable().default(null),
    options: z.object({ title: z.string().trim().max(120).optional() }).default({}),
  })
  .refine((w) => (w.question_key === null) !== (w.metric === null), 'question_key or metric, not both')

export const replaceWidgetsInput = z.object({ reportId: id, workspaceId: id, widgets: z.array(widgetInput).max(100) })

/**
 * Replaces a report's widgets with an ordered list (positions 0..n-1).
 * Decision: delete then insert; two statements, not one transaction. A failed
 * insert leaves the report empty and the builder shows the error to retry.
 */
export async function replaceWidgets(client: UserClient, input: z.input<typeof replaceWidgetsInput>): Promise<DbResult<undefined>> {
  const del = await call(replaceWidgetsInput, input, (v) => client.from('report_widgets').delete().eq('report_id', v.reportId), () => undefined)
  if (!del.ok) return del
  const v = replaceWidgetsInput.parse(input)
  if (v.widgets.length === 0) return ok(undefined)
  return call(
    replaceWidgetsInput,
    input,
    () =>
      client.from('report_widgets').insert(
        v.widgets.map((w, i) => ({
          report_id: v.reportId,
          workspace_id: v.workspaceId,
          position: i,
          question_key: w.question_key,
          metric: w.metric,
          chart_type: w.chart_type,
          cross_tab_key: w.cross_tab_key,
          options: asJsonObject(w.options),
        })),
      ),
    () => undefined,
  )
}

const SHARE_COLS = 'id, report_id, workspace_id, token, expires_at, revoked_at, created_by, view_count, last_viewed_at, created_at, password_hash'

export function listShares(client: UserClient, input: z.input<typeof reportIdInput>) {
  return call(
    reportIdInput,
    input,
    (v) => client.from('report_shares').select(SHARE_COLS).eq('report_id', v.reportId).order('created_at', { ascending: false }),
    (rows): ShareRow[] =>
      (rows ?? []).map(({ password_hash, ...rest }) => ({ ...rest, has_password: password_hash !== null })),
  )
}

export const createShareInput = z.object({
  reportId: id,
  workspaceId: id,
  expiresAt: z.string().nullable(),
  /** From hashSharePassword above; never a plain password. */
  passwordHash: z.string().max(200).nullable(),
})

export function createShare(client: UserClient, input: z.input<typeof createShareInput>) {
  return call(
    createShareInput,
    input,
    (v) =>
      client
        .from('report_shares')
        .insert({ report_id: v.reportId, workspace_id: v.workspaceId, expires_at: v.expiresAt, password_hash: v.passwordHash })
        .select('id, token')
        .single(),
    (row): { id: string; token: string } => row as { id: string; token: string },
  )
}

export const shareIdInput = z.object({ shareId: id })

export function revokeShare(client: UserClient, input: z.input<typeof shareIdInput>) {
  return call(
    shareIdInput,
    input,
    (v) => client.from('report_shares').update({ revoked_at: new Date().toISOString() }).eq('id', v.shareId).is('revoked_at', null),
    () => undefined,
  )
}

// ---------------------------------------------------------------------------
// Workspace dashboard (doc 04 section 5.3): head counts and small reads as
// the member under RLS. The analytics module turns them into widgets.
// ---------------------------------------------------------------------------

const DAY = 86_400_000

export const dashboardCountsInput = z.object({
  workspaceId: id,
  /** "Now" in ms; the 7 and 14 day windows end here. */
  now: z.number().int(),
  /** Open surveys to count 7 day responses for (at most 10). */
  openSurveyIds: z.array(id).max(10).default([]),
  leadStatuses: z.array(z.enum(LEAD_STATUSES)).max(10).default([]),
})

export type DashboardCounts = {
  thisWeek: number
  lastWeek: number
  /** submitted_at of complete responses in the last 14 days, at most 1000. */
  recentSubmittedAt: string[]
  /** source of live contacts created in the last 7 days, at most 1000. */
  newContactSources: (string | null)[]
  followUpsDue: number
  followUpsOverdue: number
  /** Last 10 activity rows; empty below admin (activity_log RLS). */
  activity: { id: number; entity: string; action: string; created_at: string }[]
  leadCounts: number[]
  /** Per open survey id: complete and partial responses started in the last 7 days. */
  openSurveyCounts: Record<string, { complete: number; partial: number }>
}

export async function workspaceDashboardCounts(
  client: UserClient,
  input: z.input<typeof dashboardCountsInput>,
): Promise<DbResult<DashboardCounts>> {
  const parsed = dashboardCountsInput.safeParse(input)
  if (!parsed.success) return call(dashboardCountsInput, input, async () => ({ data: null, error: null }))
  const { workspaceId, now: t, openSurveyIds, leadStatuses } = parsed.data
  const iso = (ms: number) => new Date(ms).toISOString()
  const today = iso(t).slice(0, 10)
  const head = { count: 'exact' as const, head: true }
  const liveContacts = () => client.from('contacts').select('id', head).eq('workspace_id', workspaceId).eq('status', 'active').is('merged_into', null)
  const responsesBetween = (from: number, to: number) =>
    client.from('responses').select('id', head).eq('workspace_id', workspaceId).eq('status', 'complete').gte('submitted_at', iso(from)).lt('submitted_at', iso(to))
  try {
    const [thisWeek, lastWeek, recent, contacts, followDue, followOver, activity, ...leads] = await Promise.all([
      responsesBetween(t - 7 * DAY, t),
      responsesBetween(t - 14 * DAY, t - 7 * DAY),
      client.from('responses').select('submitted_at').eq('workspace_id', workspaceId).eq('status', 'complete').gte('submitted_at', iso(t - 14 * DAY)).limit(1000),
      client.from('contacts').select('source').eq('workspace_id', workspaceId).eq('status', 'active').is('merged_into', null).gte('created_at', iso(t - 7 * DAY)).limit(1000),
      liveContacts().eq('follow_up_at', today),
      liveContacts().lt('follow_up_at', today),
      client.from('activity_log').select('id, entity, action, created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(10),
      ...leadStatuses.map((s) => liveContacts().eq('lead_status', s)),
    ])
    const openSurveyCounts: DashboardCounts['openSurveyCounts'] = {}
    await Promise.all(
      openSurveyIds.map(async (sid) => {
        const [c, p] = await Promise.all([
          client.from('responses').select('id', head).eq('survey_id', sid).eq('status', 'complete').gte('started_at', iso(t - 7 * DAY)),
          client.from('responses').select('id', head).eq('survey_id', sid).eq('status', 'partial').gte('started_at', iso(t - 7 * DAY)),
        ])
        openSurveyCounts[sid] = { complete: c.count ?? 0, partial: p.count ?? 0 }
      }),
    )
    return ok({
      thisWeek: thisWeek.count ?? 0,
      lastWeek: lastWeek.count ?? 0,
      recentSubmittedAt: (recent.data ?? []).flatMap((r) => (r.submitted_at ? [r.submitted_at] : [])),
      newContactSources: (contacts.data ?? []).map((c) => c.source),
      followUpsDue: followDue.count ?? 0,
      followUpsOverdue: followOver.count ?? 0,
      activity: activity.data ?? [],
      leadCounts: leads.map((l) => l.count ?? 0),
      openSurveyCounts,
    })
  } catch (e) {
    return fail(toDbError(e))
  }
}
