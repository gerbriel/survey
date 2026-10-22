import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient, UserOrAdminClient } from '@/lib/supabase/types'
import { fail, ok, toDbError, type DbResult } from './errors'
import { asJson, call, chunks, id, ilikePattern, PAGE, readAll, type PageResult } from './rpc'

/**
 * Response queries for inbox, reports and exports (migration 0013, doc 04
 * section 4.3). Both functions are SECURITY INVOKER: with a member client RLS
 * limits rows to the caller's workspaces; the service role sees everything.
 */
export type ResponseRow = Tables<'responses'>
export type QuestionRow = Tables<'questions'>

export const responseFilters = z.looseObject({
  from: z.string().optional(),
  to: z.string().optional(),
  /** 'latest' (default), 'all', or a version id. */
  version: z.union([z.literal('latest'), z.literal('all'), id]).optional(),
  status: z.enum(['complete', 'all']).optional(),
  identity: z.enum(['all', 'token', 'identified', 'anonymous']).optional(),
  contact: z
    .object({
      lead_status: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      owner_ids: z.array(id).optional(),
    })
    .optional(),
  answers: z
    .array(
      z.object({
        question_key: z.string(),
        any_of: z.array(z.string()).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .optional(),
})

export type ResponseFilters = z.input<typeof responseFilters>

export const filteredResponsesInput = z.object({ surveyId: id, filters: responseFilters.default({}) })

export function filteredResponses(client: UserOrAdminClient, input: z.input<typeof filteredResponsesInput>) {
  return call(
    filteredResponsesInput,
    input,
    (v) => client.rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) }),
    (rows): ResponseRow[] => (rows ?? []) as ResponseRow[],
  )
}

export const versionQuestionsInput = z.object({ versionId: id })

/** The normalized question snapshot of a published version, in order. */
export function versionQuestions(client: UserOrAdminClient, input: z.input<typeof versionQuestionsInput>) {
  return call(
    versionQuestionsInput,
    input,
    (v) => client.rpc('version_questions', { p_version_id: v.versionId }),
    (rows): QuestionRow[] => (rows ?? []) as QuestionRow[],
  )
}

// ---------------------------------------------------------------------------
// Paged reads for analytics and exports. filtered_responses is read in pages
// ordered by id so pages are stable; PostgREST would cut one call at 1000.
// ---------------------------------------------------------------------------

/** The response columns analytics and exports need. */
export type ResponseLite = {
  id: string
  survey_version_id: string
  status: 'partial' | 'complete'
  started_at: string
  submitted_at: string | null
  contact_id: string | null
  identity_source: string | null
  respondent_token_id: string | null
  metadata: Record<string, unknown>
}

/** An answers row without the tenancy columns. */
export type AnswerLite = {
  response_id: string
  question_key: string
  survey_version_id: string
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_json: unknown
}

const RESPONSE_COLS = 'id, survey_version_id, status, started_at, submitted_at, contact_id, identity_source, respondent_token_id, metadata'

export const readFilteredInput = z.object({
  surveyId: id,
  filters: z.record(z.string(), z.unknown()).default({}),
  max: z.number().int().min(1).max(200_000).default(20_000),
})

export async function readFilteredResponses(
  client: UserOrAdminClient,
  input: z.input<typeof readFilteredInput>,
): Promise<DbResult<ResponseLite[]>> {
  const parsed = readFilteredInput.safeParse(input)
  if (!parsed.success) return call(readFilteredInput, input, async () => ({ data: null, error: null }))
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

export const countFilteredInput = z.object({ surveyId: id, filters: z.record(z.string(), z.unknown()).default({}) })

/** Row count of filtered_responses without reading rows (head request). */
export async function countFilteredResponses(
  client: UserOrAdminClient,
  input: z.input<typeof countFilteredInput>,
): Promise<DbResult<number>> {
  const parsed = countFilteredInput.safeParse(input)
  if (!parsed.success) return call(countFilteredInput, input, async () => ({ data: 0, error: null }))
  try {
    const res = (await client.rpc(
      'filtered_responses',
      { p_survey_id: parsed.data.surveyId, p_filters: asJson(parsed.data.filters) },
      { count: 'exact', head: true },
    )) as unknown as { count: number | null; error: unknown }
    if (res.error) return fail(toDbError(res.error))
    return ok(res.count ?? 0)
  } catch (e) {
    return fail(toDbError(e))
  }
}

const ANSWER_COLS = 'response_id, question_key, survey_version_id, value_text, value_number, value_date, value_json'

export const readAnswersInput = z.object({ responseIds: z.array(z.string()), questionKeys: z.array(z.string()).optional() })

/** Answers for a set of responses, 200 ids per request, paged. Malformed ids are skipped. */
export async function readAnswers(client: UserOrAdminClient, input: z.input<typeof readAnswersInput>): Promise<DbResult<AnswerLite[]>> {
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

export type QuestionSnapshotRow = Pick<
  QuestionRow,
  'survey_version_id' | 'question_key' | 'type' | 'label' | 'position' | 'page_index' | 'is_pii' | 'options' | 'config'
>

export const surveyQuestionsInput = z.object({ surveyId: id })

/** Every normalized question row of every published version of a survey, paged. */
export async function listSurveyQuestionRows(
  client: UserOrAdminClient,
  input: z.input<typeof surveyQuestionsInput>,
): Promise<DbResult<QuestionSnapshotRow[]>> {
  const parsed = surveyQuestionsInput.safeParse(input)
  if (!parsed.success) return call(surveyQuestionsInput, input, async () => ({ data: null, error: null }))
  return readAll((from, to) =>
    client
      .from('questions')
      .select('survey_version_id, question_key, type, label, position, page_index, is_pii, options, config')
      .eq('survey_id', parsed.data.surveyId)
      .order('survey_version_id')
      .order('position')
      .range(from, to),
  )
}

// ---------------------------------------------------------------------------
// Inbox and response detail (doc 04 section 2) under RLS. The inbox list
// reuses filtered_responses (the same filter semantics as reports) and pages
// it with PostgREST order and range. `raw` is never selected.
// ---------------------------------------------------------------------------

export const INBOX_COLUMNS =
  'id, survey_id, survey_version_id, status, contact_id, respondent_token_id, identity_source, started_at, submitted_at, last_question_key, score, score_max, metadata, contact:contacts(id, email, first_name, last_name)'

export type InboxRow = {
  id: string
  survey_id: string
  survey_version_id: string
  status: 'partial' | 'complete'
  contact_id: string | null
  respondent_token_id: string | null
  identity_source: string | null
  started_at: string
  submitted_at: string | null
  last_question_key: string | null
  score: number | null
  score_max: number | null
  metadata: Json
  contact: { id: string; email: string | null; first_name: string | null; last_name: string | null } | null
}

export const inboxInput = z.object({
  surveyId: id,
  filters: responseFilters.default({}),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export function listInbox(client: UserClient, input: z.input<typeof inboxInput>) {
  return call(inboxInput, input, async (v) => {
    const from = v.page * v.pageSize
    const r = await client
      .rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) }, { count: 'exact' })
      .select(INBOX_COLUMNS)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false })
      .range(from, from + v.pageSize - 1)
    return { data: { rows: (r.data ?? []) as unknown as InboxRow[], total: r.count ?? 0 }, error: r.error }
  })
}

export const responseIdInput = z.object({ responseId: id })

/** One inbox row, used by the realtime handler: the event is only a signal. */
export function getInboxRow(client: UserClient, input: z.input<typeof responseIdInput>) {
  return call(
    responseIdInput,
    input,
    (v) => client.from('responses').select(INBOX_COLUMNS).eq('id', v.responseId).maybeSingle(),
    (row): InboxRow | null => (row ?? null) as unknown as InboxRow | null,
  )
}

export type AnswerRow = Tables<'answers'>

export function listAnswers(client: UserClient, input: z.input<typeof responseIdInput>) {
  return call(
    responseIdInput,
    input,
    (v) => client.from('answers').select('*').eq('response_id', v.responseId),
    (rows): AnswerRow[] => rows ?? [],
  )
}

export const answersForInput = z.object({ responseIds: z.array(id).max(200) })

export function listAnswersFor(client: UserClient, input: z.input<typeof answersForInput>) {
  return call(
    answersForInput,
    input,
    (v) => client.from('answers').select('*').in('response_id', v.responseIds),
    (rows): AnswerRow[] => rows ?? [],
  )
}

/**
 * Admin. L-13 (0019): delete_response(p_response_id) checks admin on the
 * response's own workspace, logs the delete, adjusts complete_count and the
 * contact's response_count; files cascade and are queued for Storage
 * deletion by trigger. A direct table delete removes nothing since 0019.
 */
export function deleteResponse(client: UserClient, input: z.input<typeof responseIdInput>) {
  return call(
    responseIdInput,
    input,
    (v) => client.rpc('delete_response', { p_response_id: v.responseId }),
    () => undefined,
  )
}

export type ContactResponse = {
  id: string
  survey_id: string
  survey_version_id: string
  status: 'partial' | 'complete'
  identity_source: string | null
  started_at: string
  submitted_at: string | null
  survey: { title: string } | null
}

export const contactResponsesInput = z.object({ contactId: id })

/** Every response linked to a contact, across surveys (doc 04 section 1.3). */
export function listContactResponses(client: UserClient, input: z.input<typeof contactResponsesInput>) {
  return call(
    contactResponsesInput,
    input,
    (v) =>
      client
        .from('responses')
        .select('id, survey_id, survey_version_id, status, identity_source, started_at, submitted_at, survey:surveys(title)')
        .eq('contact_id', v.contactId)
        .order('started_at', { ascending: false })
        .limit(500),
    (rows): ContactResponse[] => (rows ?? []) as unknown as ContactResponse[],
  )
}

export type FullResponse = Omit<InboxRow, 'contact'> & { workspace_id: string; anonymized_at: string | null }

export function getResponse(client: UserClient, input: z.input<typeof responseIdInput>) {
  return call(
    responseIdInput,
    input,
    (v) =>
      client
        .from('responses')
        .select(
          'id, workspace_id, survey_id, survey_version_id, status, contact_id, respondent_token_id, identity_source, started_at, submitted_at, last_question_key, score, score_max, metadata, anonymized_at',
        )
        .eq('id', v.responseId)
        .maybeSingle(),
    (row): FullResponse | null => (row ?? null) as unknown as FullResponse | null,
  )
}

export type ResponseFile = Pick<
  Tables<'response_files'>,
  'id' | 'workspace_id' | 'response_id' | 'object_path' | 'original_name' | 'status'
>

export const fileIdInput = z.object({ fileId: id })

export function getResponseFile(client: UserClient, input: z.input<typeof fileIdInput>) {
  return call(
    fileIdInput,
    input,
    (v) =>
      client
        .from('response_files')
        .select('id, workspace_id, response_id, object_path, original_name, status')
        .eq('id', v.fileId)
        .maybeSingle(),
    (row): ResponseFile | null => row ?? null,
  )
}

export const signInput = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  seconds: z.number().int().min(10).max(600).default(60),
  /** false for inline display (signature images); true forces a download. */
  download: z.boolean().default(true),
})

/** Short-lived signed download URL. Storage RLS: members of the folder's workspace. */
export function signResponseFile(client: UserClient, input: z.input<typeof signInput>) {
  return call(
    signInput,
    input,
    (v) => client.storage.from('response-files').createSignedUrl(v.path, v.seconds, v.download ? { download: v.name } : undefined),
    (d): string => d!.signedUrl,
  )
}

// ---------------------------------------------------------------------------
// Results hub (cross-survey explorer) and bulk export. filtered_responses is
// per survey; the hub calls it once per selected survey. The existing reads
// cannot express a metadata or partial-only condition or an open-text search,
// so these two add them. Both run as the member (RLS applies).
// ---------------------------------------------------------------------------

/** Columns PostgREST may compare on: status, a top level metadata key, or a hidden field. */
const RESULT_CONDITION_COLUMN = /^(status|metadata->>[A-Za-z0-9_]{1,64}|metadata->hidden->>[A-Za-z0-9_]{1,64})$/

export const resultRowsInput = z.object({
  surveyId: id,
  filters: z.record(z.string(), z.unknown()).default({}),
  where: z.array(z.object({ column: z.string().regex(RESULT_CONDITION_COLUMN), value: z.string().max(200) })).max(4).default([]),
  max: z.number().int().min(1).max(200_000).default(20_000),
})

/** A results hub row: the inbox columns (survey id, contact name and email, metadata). */
export type ResultRow = InboxRow

/**
 * filtered_responses for one survey plus equality conditions on the returned
 * rows (partial status, metadata keys), in id order pages, at most `max`.
 */
export async function readResultRows(client: UserClient, input: z.input<typeof resultRowsInput>): Promise<DbResult<ResultRow[]>> {
  const parsed = resultRowsInput.safeParse(input)
  if (!parsed.success) return call(resultRowsInput, input, async () => ({ data: null, error: null }))
  const v = parsed.data
  return readAll((from, to) => {
    let q = client.rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) }).select(INBOX_COLUMNS)
    for (const c of v.where) q = q.eq(c.column, c.value)
    return q.order('id').range(from, to) as unknown as PageResult<ResultRow>
  }, v.max)
}

export const textSearchInput = z.object({
  surveyIds: z.array(id).min(1).max(50),
  questionKeys: z.array(z.string().min(1).max(64)).min(1).max(500),
  text: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(5000).default(2000),
})

/**
 * Response ids whose open-text answers contain `text` (case-insensitive
 * substring, wildcards escaped). Bounded by `limit` answer rows; `capped`
 * says the bound was hit, so the caller can tell the member.
 */
export async function searchTextAnswers(
  client: UserClient,
  input: z.input<typeof textSearchInput>,
): Promise<DbResult<{ responseIds: string[]; capped: boolean }>> {
  return call(textSearchInput, input, async (v) => {
    const r = await client
      .from('answers')
      .select('response_id')
      .in('survey_id', v.surveyIds)
      .in('question_key', v.questionKeys)
      .ilike('value_text', ilikePattern(v.text))
      .limit(v.limit)
    const rows = (r.data ?? []) as { response_id: string }[]
    return { data: { responseIds: [...new Set(rows.map((x) => x.response_id))], capped: rows.length >= v.limit }, error: r.error }
  })
}
