'use server'

/**
 * Server actions for the builder, list, share and settings pages. Each one
 * resolves the signed-in member and calls a src/lib/db wrapper (or the local
 * wrappers in ./queries). Authorization is RLS and the SQL functions; the
 * session check here only produces a friendly error.
 */

import { getAuthContext, requireMember } from '@/lib/auth/guards'
import { memberCan } from '@/lib/auth/roles'
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
  deleteSurvey,
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
import { cleanBulkIds, runBulk, type BulkResult } from './list'

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
  return duplicateOne(s.client, surveyId)
}

const NOT_FOUND = { code: 'not_found', message: 'That survey was not found.' }

/** `workspaceId`, when given, makes a survey of another workspace read as not found (D-15). */
async function duplicateOne(client: UserClient, surveyId: string, workspaceId?: string): Promise<ActionResult<string>> {
  const survey = await getSurvey(client, { surveyId, ...(workspaceId ? { workspaceId } : {}) })
  if (!survey.ok) return from(survey)
  if (!survey.data?.current_draft_version_id) return failed(NOT_FOUND)
  const v = await getVersion(client, { versionId: survey.data.current_draft_version_id })
  if (!v.ok) return from(v)
  if (!v.data) return failed(NOT_FOUND)
  const title = `Copy of ${survey.data.title}`.slice(0, 200)
  return from(await createFromDefinition(client, survey.data.workspace_id, title, v.data.definition as Def))
}

export async function archiveSurveyAction(surveyId: string, archived: boolean): Promise<ActionResult<undefined>> {
  const s = await session()
  if (!s) return failed(EXPIRED)
  return from(await setSurveyArchived(s.client, { surveyId, archived }))
}

/**
 * Bulk actions for the surveys list. Editor and above (UX check; RLS and the
 * SQL functions decide). Each id is checked against the workspace in the slug
 * and handled one at a time with the single-survey logic; the result lists
 * every survey so failures are reported per survey.
 */
async function bulk(
  slug: string,
  surveyIds: string[],
  fn: (client: UserClient, workspaceId: string, id: string) => Promise<{ ok: boolean; message?: string; newId?: string }>,
  gate: { role: 'editor' | 'admin'; message: string } = { role: 'editor', message: 'Editors and above can change surveys in bulk.' },
): Promise<ActionResult<BulkResult>> {
  const member = await requireMember(slug, 'viewer')
  if (!memberCan(member.role, gate.role, member.workspace)) return failed({ code: 'permission_denied', message: gate.message })
  const ids = cleanBulkIds(surveyIds)
  if (ids.length === 0) return failed({ code: 'invalid_input', message: 'Select at least one survey.' })
  return { ok: true, data: await runBulk(ids, (id) => fn(member.supabase, member.workspace.id, id)) }
}

export async function bulkDuplicateSurveysAction(slug: string, surveyIds: string[]): Promise<ActionResult<BulkResult>> {
  return bulk(slug, surveyIds, async (client, workspaceId, id) => {
    const r = await duplicateOne(client, id, workspaceId)
    return r.ok ? { ok: true, newId: r.data } : { ok: false, message: r.message }
  })
}

/** `archived` false restores (the archived view). */
export async function bulkArchiveSurveysAction(slug: string, surveyIds: string[], archived: boolean): Promise<ActionResult<BulkResult>> {
  return bulk(slug, surveyIds, async (client, workspaceId, id) => {
    const found = await getSurvey(client, { surveyId: id, workspaceId })
    if (!found.ok) return { ok: false, message: found.error.message }
    if (!found.data) return { ok: false, message: NOT_FOUND.message }
    const r = await setSurveyArchived(client, { surveyId: id, archived })
    return r.ok ? { ok: true } : { ok: false, message: r.error.message }
  })
}

const DELETE_DENIED = 'Only workspace admins and owners can delete surveys.'

/**
 * Permanent delete from the archived view (doc 00, Tenancy: admin and owner
 * only). The role check here is UX; delete_survey refuses anyone below admin
 * with not_authorized. Only archived surveys of this workspace are deleted, so
 * a live survey always takes two deliberate steps to remove.
 */
export async function bulkDeleteSurveysAction(slug: string, surveyIds: string[]): Promise<ActionResult<BulkResult>> {
  return bulk(
    slug,
    surveyIds,
    async (client, workspaceId, id) => {
      const found = await getSurvey(client, { surveyId: id, workspaceId })
      if (!found.ok) return { ok: false, message: found.error.message }
      if (!found.data) return { ok: false, message: NOT_FOUND.message }
      if (found.data.archived_at === null) return { ok: false, message: 'Archive it first.' }
      const r = await deleteSurvey(client, { surveyId: id })
      if (r.ok) return { ok: true }
      return { ok: false, message: r.error.code === 'not_authorized' || r.error.code === 'permission_denied' ? DELETE_DENIED : r.error.message }
    },
    { role: 'admin', message: DELETE_DENIED },
  )
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
