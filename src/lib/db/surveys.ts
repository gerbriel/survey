import { z } from 'zod'
import type { UserClient } from '@/lib/supabase/types'
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
