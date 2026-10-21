'use server'

/**
 * Server actions for the builder, list, share and settings pages. Each one
 * resolves the signed-in member and calls a src/lib/db wrapper (or the local
 * wrappers in ./queries). Authorization is RLS and the SQL functions; the
 * session check here only produces a friendly error.
 */

import { getAuthContext } from '@/lib/auth/guards'
import { getProfile } from '@/lib/db/profiles'
import { getWorkspaceById } from '@/lib/db/workspaces'
import { getEffectiveLimits } from '@/lib/db/limits'
import {
  createSurvey,
  releaseDraftLock,
  saveDraft,
  setSurveyAlias,
  takeDraftLock,
  getSurvey,
  getVersion,
  setSurveyArchived,
  updateSurveySettings,
  type SurveySettingsPatch,
} from '@/lib/db/surveys'
import type { DbError, DbResult } from '@/lib/db/errors'
import type { UserClient } from '@/lib/supabase/types'
import { publishDraft } from './publish'
import { insertTemplate } from '@/lib/db/templates'
import { listContactFields } from '@/lib/db/contacts'
import { listPixelSummaries } from '@/lib/db/pixels'
import type { ActionResult, DraftSnapshot, LockInfo, PublishOutcome } from './types'

function failed<T>(e: { code: DbError['code'] | string; message: string }): ActionResult<T> {
  return { ok: false, code: e.code, message: e.message }
}

function from<T>(r: DbResult<T>): ActionResult<T> {
  return r.ok ? { ok: true, data: r.data } : failed(r.error)
}

async function session(): Promise<{ client: UserClient; userId: string } | null> {
  const ctx = await getAuthContext()
  if (!ctx) return null
  return { client: ctx.supabase, userId: ctx.user.id }
}

const EXPIRED = { code: 'session_expired', message: 'Your session expired. Sign in again.' }

type Def = { pages: unknown[] } & Record<string, unknown>

export async function createSurveyAction(workspaceId: string, title: string, templateId?: string): Promise<ActionResult<string>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await createSurvey(s.client, { workspaceId, title, ...(templateId ? { templateId } : {}) }))
}

/**
 * New survey whose first draft is `definition` (import from text, duplicate).
 * create_survey makes an empty draft; we take its lock, save over it, release.
 */
export async function createFromDefinitionAction(workspaceId: string, title: string, definition: Def): Promise<ActionResult<string>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await createFromDefinition(s.client, workspaceId, title, definition))
}

async function createFromDefinition(client: UserClient, workspaceId: string, title: string, definition: Def): Promise<DbResult<string>> {
  const created = await createSurvey(client, { workspaceId, title })
  if (!created.ok) return created
  const survey = await getSurvey(client, { surveyId: created.data })
  if (!survey.ok) return survey
  const versionId = survey.data?.current_draft_version_id
  if (!versionId) return created
  const lock = await takeDraftLock(client, { versionId })
  if (!lock.ok) return lock
  const settings = (definition.settings ?? {}) as Record<string, unknown>
  const saved = await saveDraft(client, {
    versionId,
    expectedRevision: lock.data.revision,
    definition: { ...definition, settings: { ...settings, title } },
  })
  await releaseDraftLock(client, { versionId })
  if (!saved.ok) return saved
  return created
}

/** Duplicate (doc 03 section 6): copies the current draft, keeps question ids and keys, no responses, aliases or lock. */
export async function duplicateSurveyAction(surveyId: string): Promise<ActionResult<string>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  const survey = await getSurvey(s.client, { surveyId })
  if (!survey.ok) return from(survey)
  if (!survey.data?.current_draft_version_id) return failed({ code: 'not_found', message: 'That survey was not found.' })
  const v = await getVersion(s.client, { versionId: survey.data.current_draft_version_id })
  if (!v.ok) return from(v)
  if (!v.data) return failed({ code: 'not_found', message: 'That survey was not found.' })
  const title = `Copy of ${survey.data.title}`.slice(0, 200)
  return from(await createFromDefinition(s.client, survey.data.workspace_id, title, v.data.definition as Def))
}

export async function archiveSurveyAction(surveyId: string, archived: boolean): Promise<ActionResult<undefined>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await setSurveyArchived(s.client, { surveyId, archived }))
}

export async function saveDraftAction(versionId: string, expectedRevision: number, definition: Def): Promise<ActionResult<number>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await saveDraft(s.client, { versionId, expectedRevision, definition }))
}

export async function takeLockAction(versionId: string, force: boolean): Promise<ActionResult<LockInfo>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  const r = await takeDraftLock(s.client, { versionId, force })
  if (!r.ok) return failed(r.error)
  let name: string | null = null
  if (r.data.locked_by && r.data.locked_by !== s.userId) {
    const p = await getProfile(s.client, { userId: r.data.locked_by })
    name = p.ok ? (p.data?.display_name ?? null) : null
  }
  return { ok: true, data: { ok: r.data.ok, revision: r.data.revision, lockedBy: r.data.locked_by, lockedByName: name, lockedAt: r.data.locked_at } }
}

export async function releaseLockAction(versionId: string): Promise<ActionResult<undefined>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await releaseDraftLock(s.client, { versionId }))
}

/** The survey's current draft, for a reload after a takeover or publish. */
export async function loadDraftAction(surveyId: string): Promise<ActionResult<DraftSnapshot>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  const survey = await getSurvey(s.client, { surveyId })
  if (!survey.ok) return from(survey)
  const vid = survey.data?.current_draft_version_id
  if (!vid) return failed({ code: 'not_found', message: 'That survey was not found.' })
  const v = await getVersion(s.client, { versionId: vid })
  if (!v.ok) return from(v)
  if (!v.data) return failed({ code: 'not_found', message: 'That survey was not found.' })
  return { ok: true, data: { versionId: v.data.id, revision: v.data.revision, definition: v.data.definition } }
}

export async function publishAction(input: {
  surveyId: string
  versionId: string
  expectedRevision: number
  definition: Def
  acknowledgeBreaking: boolean
}): Promise<ActionResult<PublishOutcome>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  const survey = await getSurvey(s.client, { surveyId: input.surveyId })
  if (!survey.ok) return from(survey)
  if (!survey.data) return failed({ code: 'not_found', message: 'That survey was not found.' })
  const wsId = survey.data.workspace_id
  const [ws, fields, pixels, limits] = await Promise.all([
    getWorkspaceById(s.client, { workspaceId: wsId }),
    listContactFields(s.client, { workspaceId: wsId }),
    listPixelSummaries(s.client, { workspaceId: wsId }),
    getEffectiveLimits(s.client, { workspaceId: wsId }),
  ])
  const excluded = new Set(survey.data.excluded_pixel_ids)
  const loads = pixels.ok && pixels.data.some((p) => p.enabled && !excluded.has(p.id))
  return from(
    await publishDraft(s.client, {
      ...input,
      lint: {
        ...(fields.ok ? { contactFieldKeys: fields.data.map((f) => f.key) } : {}),
        ...(ws.ok && ws.data ? { pixelConsentMode: ws.data.pixel_consent_mode } : {}),
        loadsPixels: loads,
        ...(limits.ok && limits.data ? { maxQuestions: limits.data.max_questions, maxDefinitionBytes: limits.data.max_definition_bytes } : {}),
      },
    }),
  )
}

export async function saveTemplateAction(workspaceId: string, name: string, description: string, definition: Def): Promise<ActionResult<string>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await insertTemplate(s.client, { workspaceId, name, description, definition, createdBy: s.userId }))
}

export async function setAliasAction(surveyId: string, alias: string | null): Promise<ActionResult<undefined>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await setSurveyAlias(s.client, { surveyId, alias }))
}

export async function updateSettingsAction(surveyId: string, patch: SurveySettingsPatch): Promise<ActionResult<undefined>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await updateSurveySettings(s.client, { surveyId, patch }))
}
