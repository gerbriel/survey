import 'server-only'
import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { asJson, call, id } from '@/lib/db/rpc'
import { responseFilters } from '@/lib/db/responses'

/**
 * Inbox and response detail reads under RLS. The inbox list reuses SQL
 * filtered_responses (the same filter semantics as reports) and pages it with
 * PostgREST order and range. `raw` is never selected.
 *
 * TODO(Phase 3): move into src/lib/db/responses.ts (Foundation change request).
 */
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
  return call(
    inboxInput,
    input,
    async (v) => {
      const from = v.page * v.pageSize
      const r = await client
        .rpc('filtered_responses', { p_survey_id: v.surveyId, p_filters: asJson(v.filters) }, { count: 'exact' })
        .select(INBOX_COLUMNS)
        .order('submitted_at', { ascending: false, nullsFirst: false })
        .order('started_at', { ascending: false })
        .range(from, from + v.pageSize - 1)
      return { data: { rows: (r.data ?? []) as unknown as InboxRow[], total: r.count ?? 0 }, error: r.error }
    },
  )
}

const responseIdInput = z.object({ responseId: id })

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

/** Admin (RLS). Files cascade and are queued for Storage deletion by trigger. */
export function deleteResponse(client: UserClient, input: z.input<typeof responseIdInput>) {
  return call(
    responseIdInput,
    input,
    (v) => client.from('responses').delete().eq('id', v.responseId).select('id'),
    (rows) => {
      if (!rows || rows.length === 0) throw new Error('permission_denied')
      return undefined
    },
  )
}

export type SurveyRow = Pick<
  Tables<'surveys'>,
  'id' | 'workspace_id' | 'title' | 'slug' | 'state' | 'latest_published_version_id'
>
const surveyIdInput = z.object({ surveyId: id })
export function getSurvey(client: UserClient, input: z.input<typeof surveyIdInput>) {
  return call(
    surveyIdInput,
    input,
    (v) =>
      client
        .from('surveys')
        .select('id, workspace_id, title, slug, state, latest_published_version_id')
        .eq('id', v.surveyId)
        .maybeSingle(),
    (row): SurveyRow | null => row ?? null,
  )
}

export type VersionLite = { id: string; version_no: number; status: string; published_at: string | null }
export function listVersions(client: UserClient, input: z.input<typeof surveyIdInput>) {
  return call(
    surveyIdInput,
    input,
    (v) =>
      client
        .from('survey_versions')
        .select('id, version_no, status, published_at')
        .eq('survey_id', v.surveyId)
        .eq('status', 'published')
        .order('version_no', { ascending: false }),
    (rows): VersionLite[] => rows ?? [],
  )
}

export type VersionDef = { id: string; survey_id: string; version_no: number; public_definition: Json | null }
export const versionsInput = z.object({ versionIds: z.array(id).max(200) })
/** Published public definitions: labels for choices, matrix rows, ranking items. */
export function getVersionDefinitions(client: UserClient, input: z.input<typeof versionsInput>) {
  return call(
    versionsInput,
    input,
    (v) => client.from('survey_versions').select('id, survey_id, version_no, public_definition').in('id', v.versionIds),
    (rows): VersionDef[] => rows ?? [],
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
const contactIdInput = z.object({ contactId: id })
/** Every response linked to a contact, across surveys (doc 04 section 1.3). */
export function listContactResponses(client: UserClient, input: z.input<typeof contactIdInput>) {
  return call(
    contactIdInput,
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
const fileIdInput = z.object({ fileId: id })
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
