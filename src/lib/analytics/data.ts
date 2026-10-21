import 'server-only'
import { z } from 'zod'
import { fail, ok, toDbError, type DbResult } from '@/lib/db/errors'
import { asJson, call, id } from '@/lib/db/rpc'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient, UserOrAdminClient } from '@/lib/supabase/types'
import type { AnswerLite, EventLite, QuestionSnapshot, ResponseLite } from './types'

/**
 * Table reads and writes for analytics, reports and exports, in the
 * src/lib/db wrapper style (zod input, DbResult out, never throws).
 *
 * TODO(foundation): these belong in src/lib/db (reports.ts, responses.ts,
 * events.ts), which is frozen for Phase 2. They live here until Fable moves
 * them; see "Foundation change request" in the Phase 2E report. Every call
 * runs as the signed-in member, so RLS applies, unless noted.
 */

/** PostgREST caps a response at max_rows (1000, supabase/config.toml). */
export const PAGE = 1000

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** Reads pages of PAGE rows until a short page or `max` rows. */
export async function readAll<T>(page: (from: number, to: number) => PageResult<T>, max = 100_000): Promise<DbResult<T[]>> {
  const out: T[] = []
  try {
    for (let from = 0; from < max; from += PAGE) {
      const { data, error } = await page(from, Math.min(from + PAGE, max) - 1)
      if (error) return fail(toDbError(error))
      const rows = data ?? []
      out.push(...rows)
      if (rows.length < PAGE) break
    }
    return ok(out)
  } catch (e) {
    return fail(toDbError(e))
  }
}

/** jsonb columns are NOT NULL here; the generated type says NonNullable<Json>. */
function jsonObj(v: Record<string, unknown>): NonNullable<Json> {
  return v as NonNullable<Json>
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ------------------------------------------------------------------ surveys

export type SurveyLite = Pick<
  Tables<'surveys'>,
  'id' | 'workspace_id' | 'title' | 'state' | 'latest_published_version_id' | 'closes_at' | 'complete_count' | 'archived_at' | 'created_at'
>

const SURVEY_COLS = 'id, workspace_id, title, state, latest_published_version_id, closes_at, complete_count, archived_at, created_at'

export const surveyInput = z.object({ workspaceId: id, surveyId: id })

export function getSurvey(client: UserOrAdminClient, input: z.input<typeof surveyInput>) {
  return call(
    surveyInput,
    input,
    (v) => client.from('surveys').select(SURVEY_COLS).eq('id', v.surveyId).eq('workspace_id', v.workspaceId).maybeSingle(),
    (row): SurveyLite | null => (row as SurveyLite | null) ?? null,
  )
}

export const workspaceInput = z.object({ workspaceId: id })

export function listSurveys(client: UserClient, input: z.input<typeof workspaceInput>) {
  return call(
    workspaceInput,
    input,
    (v) =>
      client.from('surveys').select(SURVEY_COLS).eq('workspace_id', v.workspaceId).is('archived_at', null).order('created_at', { ascending: false }).limit(500),
    (rows): SurveyLite[] => (rows ?? []) as SurveyLite[],
  )
}

export type VersionLite = { id: string; version_no: number; published_at: string | null }

export const surveyIdInput = z.object({ surveyId: id })

export function listPublishedVersions(client: UserOrAdminClient, input: z.input<typeof surveyIdInput>) {
  return call(
    surveyIdInput,
    input,
    (v) =>
      client
        .from('survey_versions')
        .select('id, version_no, published_at')
        .eq('survey_id', v.surveyId)
        .eq('status', 'published')
        .order('version_no', { ascending: true }),
    (rows): VersionLite[] => (rows ?? []) as VersionLite[],
  )
}

function toSnapshot(row: Pick<Tables<'questions'>, 'survey_version_id' | 'question_key' | 'type' | 'label' | 'position' | 'page_index' | 'is_pii' | 'options' | 'config'>): QuestionSnapshot {
  const config = (row.config ?? {}) as { settings?: unknown }
  const settings = config.settings && typeof config.settings === 'object' ? (config.settings as Record<string, unknown>) : {}
  const options = Array.isArray(row.options)
    ? (row.options as { id?: unknown; label?: unknown }[])
        .filter((o) => o && typeof o.id === 'string')
        .map((o) => ({ id: o.id as string, label: typeof o.label === 'string' ? o.label : (o.id as string) }))
    : null
  return {
    survey_version_id: row.survey_version_id,
    question_key: row.question_key,
    type: row.type,
    label: row.label,
    position: row.position,
    page_index: row.page_index,
    is_pii: row.is_pii,
    options,
    settings,
  }
}

/** Every question snapshot of every published version of a survey. */
export async function listSurveyQuestions(client: UserOrAdminClient, input: z.input<typeof surveyIdInput>): Promise<DbResult<QuestionSnapshot[]>> {
  const parsed = surveyIdInput.safeParse(input)
  if (!parsed.success) return call(surveyIdInput, input, async () => ({ data: null, error: null }))
  const r = await readAll((from, to) =>
    client
      .from('questions')
      .select('survey_version_id, question_key, type, label, position, page_index, is_pii, options, config')
      .eq('survey_id', parsed.data.surveyId)
      .order('survey_version_id')
      .order('position')
      .range(from, to),
  )
  return r.ok ? ok(r.data.map(toSnapshot)) : r
}

// ---------------------------------------------------------------- responses

const RESPONSE_COLS = 'id, survey_version_id, status, started_at, submitted_at, contact_id, identity_source, respondent_token_id, metadata'

export const filteredInput = z.object({
  surveyId: id,
  filters: z.record(z.string(), z.unknown()).default({}),
  max: z.number().int().min(1).max(200_000).default(20_000),
})

/**
 * filtered_responses (migration 0013) read in pages, ordered by id so pages
 * are stable. The frozen wrapper in src/lib/db/responses.ts does not page,
 * and PostgREST would cut it at 1000 rows.
 */
export async function readFilteredResponses(client: UserOrAdminClient, input: z.input<typeof filteredInput>): Promise<DbResult<ResponseLite[]>> {
  const parsed = filteredInput.safeParse(input)
  if (!parsed.success) return call(filteredInput, input, async () => ({ data: null, error: null }))
  const v = parsed.data
  return readAll(
    (from, to) =>
      client
        .rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) })
        .select(RESPONSE_COLS)
        .order('id')
        .range(from, to) as unknown as PageResult<ResponseLite>,
    v.max,
  )
}

/** One page of filtered responses after a keyset cursor (exports). */
export const responsePageInput = z.object({
  surveyId: id,
  filters: z.record(z.string(), z.unknown()).default({}),
  after: id.nullable().default(null),
  limit: z.number().int().min(1).max(PAGE).default(PAGE),
})

export function readResponsePage(client: UserOrAdminClient, input: z.input<typeof responsePageInput>) {
  return call(
    responsePageInput,
    input,
    (v) => {
      let q = client.rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) }).select(RESPONSE_COLS)
      if (v.after) q = q.gt('id', v.after)
      return q.order('id').limit(v.limit) as unknown as PromiseLike<{ data: ResponseLite[] | null; error: unknown }>
    },
    (rows): ResponseLite[] => rows ?? [],
  )
}

/** Row count of filtered_responses without reading rows (head request). */
export async function countFilteredResponses(
  client: UserOrAdminClient,
  input: { surveyId: string; filters: Record<string, unknown> },
): Promise<DbResult<number>> {
  if (!id.safeParse(input.surveyId).success) return call(surveyIdInput, { surveyId: input.surveyId }, async () => ({ data: 0, error: null }))
  try {
    const res = (await client.rpc(
      'filtered_responses',
      { p_survey_id: input.surveyId, p_filters: asJson(input.filters) },
      { count: 'exact', head: true },
    )) as unknown as { count: number | null; error: unknown }
    if (res.error) return fail(toDbError(res.error))
    return ok(res.count ?? 0)
  } catch (e) {
    return fail(toDbError(e))
  }
}

const ANSWER_COLS = 'response_id, question_key, survey_version_id, value_text, value_number, value_date, value_json'

/** Answers for a set of responses, 200 ids per request, paged. */
export async function readAnswers(
  client: UserOrAdminClient,
  input: { responseIds: string[]; questionKeys?: string[] },
): Promise<DbResult<AnswerLite[]>> {
  const ids = input.responseIds.filter((x) => id.safeParse(x).success)
  const out: AnswerLite[] = []
  for (const part of chunks(ids, 200)) {
    const r = await readAll((from, to) => {
      let q = client.from('answers').select(ANSWER_COLS).in('response_id', part)
      if (input.questionKeys?.length) q = q.in('question_key', input.questionKeys)
      return q.order('id').range(from, to) as unknown as PageResult<AnswerLite>
    })
    if (!r.ok) return r
    out.push(...r.data)
  }
  return ok(out)
}

// ------------------------------------------------------------------- events

export const eventsInput = z.object({
  versionIds: z.array(id).min(1).max(50),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
  max: z.number().int().min(1).max(500_000).default(200_000),
})

/** Raw events of some versions in a window (RLS: viewer and above). */
export async function readEvents(client: UserClient, input: z.input<typeof eventsInput>): Promise<DbResult<EventLite[]>> {
  const parsed = eventsInput.safeParse(input)
  if (!parsed.success) return call(eventsInput, input, async () => ({ data: null, error: null }))
  const v = parsed.data
  return readAll((from, to) => {
    let q = client.from('events').select('respondent_hash, type, question_key, occurred_at, meta').in('survey_version_id', v.versionIds)
    if (v.from) q = q.gte('occurred_at', v.from)
    if (v.to) q = q.lt('occurred_at', v.to)
    return q.order('id').range(from, to) as unknown as PageResult<EventLite>
  }, v.max)
}

// ------------------------------------------------------------------ reports

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
          filters: jsonObj(v.filters),
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
        .update({ ...(v.name ? { name: v.name } : {}), ...(v.filters ? { filters: jsonObj(v.filters) } : {}) })
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
          options: jsonObj(w.options),
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
  /** Already hashed by src/lib/analytics/password.ts. */
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

// -------------------------------------------------------------- export jobs

export type ExportJobRow = Tables<'export_jobs'>

export const createExportJobInput = z.object({
  workspaceId: id,
  surveyId: id,
  format: z.enum(['csv', 'xlsx']),
  filters: z.record(z.string(), z.unknown()),
  userId: id,
})

export function createExportJob(client: UserClient, input: z.input<typeof createExportJobInput>) {
  return call(
    createExportJobInput,
    input,
    (v) =>
      client
        .from('export_jobs')
        .insert({
          workspace_id: v.workspaceId,
          survey_id: v.surveyId,
          kind: 'responses',
          format: v.format,
          filters: jsonObj(v.filters),
          created_by: v.userId,
        })
        .select('*')
        .single(),
    (row): ExportJobRow => row as ExportJobRow,
  )
}

export const exportJobIdInput = z.object({ jobId: id })

export function getExportJob(client: UserClient, input: z.input<typeof exportJobIdInput>) {
  return call(exportJobIdInput, input, (v) => client.from('export_jobs').select('*').eq('id', v.jobId).maybeSingle(), (row): ExportJobRow | null => row ?? null)
}

// ----------------------------------------------------------------- contacts

export type ContactLite = { id: string; email: string | null }

export async function readContactEmails(client: UserClient, ids: string[]): Promise<DbResult<ContactLite[]>> {
  const out: ContactLite[] = []
  for (const part of chunks([...new Set(ids)].filter((x) => id.safeParse(x).success), 200)) {
    const r = await call(z.array(id), part, (v) => client.from('contacts').select('id, email').in('id', v), (rows): ContactLite[] => rows ?? [])
    if (!r.ok) return r
    out.push(...r.data)
  }
  return ok(out)
}

export async function readTokens(client: UserClient, ids: string[]): Promise<DbResult<{ id: string; token: string }[]>> {
  const out: { id: string; token: string }[] = []
  for (const part of chunks([...new Set(ids)].filter((x) => id.safeParse(x).success), 200)) {
    const r = await call(z.array(id), part, (v) => client.from('respondent_tokens').select('id, token').in('id', v), (rows): { id: string; token: string }[] => rows ?? [])
    if (!r.ok) return r
    out.push(...r.data)
  }
  return ok(out)
}

export type { Json }
