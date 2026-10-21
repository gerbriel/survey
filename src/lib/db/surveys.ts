import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient, UserOrAdminClient } from '@/lib/supabase/types'
import { asJson, call, id } from './rpc'

/**
 * Survey creation, aliases, draft locks and autosave (migration 0005,
 * doc 01 sections 3 and 4, R8). Editor and above; delete is admin.
 */

export const createSurveyInput = z.object({
  workspaceId: id,
  title: z.string().trim().max(200),
  templateId: id.optional(),
})

/** Returns the new survey id. Version 1 draft is created with it. */
export function createSurvey(client: UserClient, input: z.input<typeof createSurveyInput>) {
  return call(
    createSurveyInput,
    input,
    (v) =>
      client.rpc('create_survey', {
        p_workspace_id: v.workspaceId,
        p_title: v.title,
        ...(v.templateId ? { p_template_id: v.templateId } : {}),
      }),
    (d): string => d as string,
  )
}

export const setSurveyAliasInput = z.object({
  surveyId: id,
  /** null clears (retires) the alias. SQL enforces the format and reserved names. */
  alias: z.string().trim().toLowerCase().max(60).nullable(),
})

export function setSurveyAlias(client: UserClient, input: z.input<typeof setSurveyAliasInput>) {
  return call(
    setSurveyAliasInput,
    input,
    // The generated type marks p_alias as string; SQL accepts null to retire.
    (v) => client.rpc('set_survey_alias', { p_survey_id: v.surveyId, p_alias: v.alias as string }),
    () => undefined,
  )
}

export type DraftLock = {
  /** false: someone else holds a fresh lock; pass force to take it over. */
  ok: boolean
  locked_by: string | null
  locked_at: string | null
  revision: number
}

export const takeDraftLockInput = z.object({ versionId: id, force: z.boolean().default(false) })

/** A forced takeover bumps the revision, so the previous holder's next save fails with revision_conflict. */
export function takeDraftLock(client: UserClient, input: z.input<typeof takeDraftLockInput>) {
  return call(
    takeDraftLockInput,
    input,
    (v) => client.rpc('take_draft_lock', { p_version_id: v.versionId, p_force: v.force }),
    (d): DraftLock => d as unknown as DraftLock,
  )
}

export const versionIdInput = z.object({ versionId: id })

export function releaseDraftLock(client: UserClient, input: z.input<typeof versionIdInput>) {
  return call(
    versionIdInput,
    input,
    (v) => client.rpc('release_draft_lock', { p_version_id: v.versionId }),
    () => undefined,
  )
}

/** A survey definition object (doc 03 section 2). SQL checks pages is an array. */
export const definitionObject = z.looseObject({ pages: z.array(z.unknown()) })

export const saveDraftInput = z.object({
  versionId: id,
  expectedRevision: z.number().int().min(0),
  definition: definitionObject,
})

/**
 * Autosave. Returns the new revision. Fails with lock_lost, revision_conflict,
 * definition_too_large or too_many_questions.
 */
export function saveDraft(client: UserClient, input: z.input<typeof saveDraftInput>) {
  return call(
    saveDraftInput,
    input,
    (v) =>
      client.rpc('save_draft', {
        p_version_id: v.versionId,
        p_expected_revision: v.expectedRevision,
        p_definition: asJson(v.definition),
      }),
    (d): number => d as number,
  )
}

export const surveyIdInput = z.object({ surveyId: id })

/** Admin. Responses and files go with it; file paths are queued for deletion. */
export function deleteSurvey(client: UserClient, input: z.input<typeof surveyIdInput>) {
  return call(surveyIdInput, input, (v) => client.rpc('delete_survey', { p_survey_id: v.surveyId }), () => undefined)
}

// ---------------------------------------------------------------------------
// Survey and version table reads and the settings write, under RLS (members
// read, editors write). Shared by the builder, inbox, CRM and analytics.
// ---------------------------------------------------------------------------

export type SurveyRow = Tables<'surveys'>
export type VersionRow = Tables<'survey_versions'>

export type SurveyListItem = Pick<
  SurveyRow,
  | 'id'
  | 'title'
  | 'slug'
  | 'state'
  | 'opens_at'
  | 'closes_at'
  | 'complete_count'
  | 'response_cap'
  | 'archived_at'
  | 'updated_at'
  | 'latest_published_version_id'
  | 'admin_closed_at'
>

export const listSurveysInput = z.object({ workspaceId: id, archived: z.boolean().default(false) })

/** The survey list page: live or archived surveys, most recently updated first. */
export function listSurveys(client: UserClient, input: z.input<typeof listSurveysInput>) {
  return call(
    listSurveysInput,
    input,
    (v) => {
      const q = client
        .from('surveys')
        .select('id, title, slug, state, opens_at, closes_at, complete_count, response_cap, archived_at, updated_at, latest_published_version_id, admin_closed_at')
        .eq('workspace_id', v.workspaceId)
        .order('updated_at', { ascending: false })
        .limit(500)
      return v.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
    },
    (rows): SurveyListItem[] => rows ?? [],
  )
}

export type SurveyLite = Pick<
  SurveyRow,
  | 'id'
  | 'workspace_id'
  | 'title'
  | 'slug'
  | 'state'
  | 'latest_published_version_id'
  | 'closes_at'
  | 'complete_count'
  | 'archived_at'
  | 'created_at'
>

const SURVEY_LITE_COLS = 'id, workspace_id, title, slug, state, latest_published_version_id, closes_at, complete_count, archived_at, created_at'

export const listSurveysLiteInput = z.object({
  workspaceId: id,
  /** title: pickers (link generator, filters); created: dashboard, newest first. */
  order: z.enum(['title', 'created']).default('title'),
})

/** Live (not archived) surveys of a workspace, few columns, at most 500. */
export function listSurveysLite(client: UserClient, input: z.input<typeof listSurveysLiteInput>) {
  return call(
    listSurveysLiteInput,
    input,
    (v) => {
      const q = client.from('surveys').select(SURVEY_LITE_COLS).eq('workspace_id', v.workspaceId).is('archived_at', null)
      return (v.order === 'title' ? q.order('title') : q.order('created_at', { ascending: false })).limit(500)
    },
    (rows): SurveyLite[] => (rows ?? []) as SurveyLite[],
  )
}

export const getSurveyInput = z.object({
  surveyId: id,
  /** When given, a survey of another workspace reads as null. */
  workspaceId: id.optional(),
})

export function getSurvey(client: UserOrAdminClient, input: z.input<typeof getSurveyInput>) {
  return call(
    getSurveyInput,
    input,
    (v) => {
      const q = client.from('surveys').select('*').eq('id', v.surveyId)
      return (v.workspaceId ? q.eq('workspace_id', v.workspaceId) : q).maybeSingle()
    },
    (row): SurveyRow | null => row ?? null,
  )
}

export function getVersion(client: UserClient, input: z.input<typeof versionIdInput>) {
  return call(
    versionIdInput,
    input,
    (v) => client.from('survey_versions').select('*').eq('id', v.versionId).maybeSingle(),
    (row): VersionRow | null => row ?? null,
  )
}

export type VersionLite = { id: string; version_no: number; status: string; published_at: string | null }

export const listPublishedVersionsInput = z.object({ surveyId: id, order: z.enum(['asc', 'desc']).default('asc') })

/** Published versions of a survey by version_no. */
export function listPublishedVersions(client: UserOrAdminClient, input: z.input<typeof listPublishedVersionsInput>) {
  return call(
    listPublishedVersionsInput,
    input,
    (v) =>
      client
        .from('survey_versions')
        .select('id, version_no, status, published_at')
        .eq('survey_id', v.surveyId)
        .eq('status', 'published')
        .order('version_no', { ascending: v.order === 'asc' }),
    (rows): VersionLite[] => (rows ?? []) as VersionLite[],
  )
}

export type VersionDef = { id: string; survey_id: string; version_no: number; public_definition: Json | null }
export const versionDefinitionsInput = z.object({ versionIds: z.array(id).max(200) })

/** Published public definitions: labels for choices, matrix rows, ranking items. */
export function getVersionDefinitions(client: UserClient, input: z.input<typeof versionDefinitionsInput>) {
  return call(
    versionDefinitionsInput,
    input,
    (v) => client.from('survey_versions').select('id, survey_id, version_no, public_definition').in('id', v.versionIds),
    (rows): VersionDef[] => rows ?? [],
  )
}

export function getActiveAlias(client: UserClient, input: z.input<typeof surveyIdInput>) {
  return call(
    surveyIdInput,
    input,
    (v) => client.from('survey_aliases').select('alias').eq('survey_id', v.surveyId).is('retired_at', null).maybeSingle(),
    (row): string | null => row?.alias ?? null,
  )
}

const settingsPatch = z
  .object({
    state: z.enum(['draft', 'open', 'closed', 'scheduled']),
    opens_at: z.iso.datetime({ offset: true }).nullable(),
    closes_at: z.iso.datetime({ offset: true }).nullable(),
    closed_message: z.string().max(1000).nullable(),
    response_cap: z.number().int().positive().nullable(),
    excluded_pixel_ids: z.array(id),
    og_title: z.string().max(120).nullable(),
    og_description: z.string().max(300).nullable(),
    og_image_path: z.string().max(500).nullable(),
    allow_indexing: z.boolean(),
    title: z.string().trim().min(1).max(200),
  })
  .partial()

export const updateSurveySettingsInput = z.object({ surveyId: id, patch: settingsPatch })
export type SurveySettingsPatch = z.input<typeof settingsPatch>

/** Editor and above (surveys_update policy). Guard columns are never in the patch. */
export function updateSurveySettings(client: UserClient, input: z.input<typeof updateSurveySettingsInput>) {
  return call(
    updateSurveySettingsInput,
    input,
    (v) => client.from('surveys').update(v.patch).eq('id', v.surveyId).select('id').single(),
    () => undefined,
  )
}

export const setSurveyArchivedInput = z.object({ surveyId: id, archived: z.boolean() })

export function setSurveyArchived(client: UserClient, input: z.input<typeof setSurveyArchivedInput>) {
  return call(
    setSurveyArchivedInput,
    input,
    (v) =>
      client
        .from('surveys')
        .update({ archived_at: v.archived ? new Date().toISOString() : null })
        .eq('id', v.surveyId)
        .select('id')
        .single(),
    () => undefined,
  )
}
