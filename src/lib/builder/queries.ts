import 'server-only'
import { z } from 'zod'
import type { Json, Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { asJson, call, id } from '@/lib/db/rpc'

/**
 * Table reads and writes the builder needs that src/lib/db does not have yet.
 * Same contract as a src/lib/db wrapper: zod input, one query under RLS,
 * DbResult out, never throws.
 *
 * TODO(foundation): move these into src/lib/db/surveys.ts (and a templates
 * area) once the foundation unfreezes. Listed as a foundation change request
 * in the Phase 2B report. src/lib/db is frozen for Phase 2.
 */

export type SurveyRow = Tables<'surveys'>
export type VersionRow = Tables<'survey_versions'>
export type TemplateRow = Tables<'survey_templates'>

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

const listInput = z.object({ workspaceId: id, archived: z.boolean().default(false) })

export function listSurveys(client: UserClient, input: z.input<typeof listInput>) {
  return call(
    listInput,
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

const surveyInput = z.object({ surveyId: id })

export function getSurvey(client: UserClient, input: z.input<typeof surveyInput>) {
  return call(
    surveyInput,
    input,
    (v) => client.from('surveys').select('*').eq('id', v.surveyId).maybeSingle(),
    (row): SurveyRow | null => row ?? null,
  )
}

const versionInput = z.object({ versionId: id })

export function getVersion(client: UserClient, input: z.input<typeof versionInput>) {
  return call(
    versionInput,
    input,
    (v) => client.from('survey_versions').select('*').eq('id', v.versionId).maybeSingle(),
    (row): VersionRow | null => row ?? null,
  )
}

export type VersionSummary = Pick<VersionRow, 'id' | 'version_no' | 'status' | 'published_at' | 'published_by'>

export function listVersions(client: UserClient, input: z.input<typeof surveyInput>) {
  return call(
    surveyInput,
    input,
    (v) =>
      client
        .from('survey_versions')
        .select('id, version_no, status, published_at, published_by')
        .eq('survey_id', v.surveyId)
        .order('version_no', { ascending: false }),
    (rows): VersionSummary[] => rows ?? [],
  )
}

export function getActiveAlias(client: UserClient, input: z.input<typeof surveyInput>) {
  return call(
    surveyInput,
    input,
    (v) => client.from('survey_aliases').select('alias').eq('survey_id', v.surveyId).is('retired_at', null).maybeSingle(),
    (row): string | null => row?.alias ?? null,
  )
}

const wsInput = z.object({ workspaceId: id })

export type TemplateSummary = Pick<TemplateRow, 'id' | 'workspace_id' | 'name' | 'description' | 'created_at'>

/** System templates (workspace_id null) and the workspace's own. */
export function listTemplates(client: UserClient, input: z.input<typeof wsInput>) {
  return call(
    wsInput,
    input,
    (v) =>
      client
        .from('survey_templates')
        .select('id, workspace_id, name, description, created_at')
        .or(`workspace_id.is.null,workspace_id.eq.${v.workspaceId}`)
        .order('name'),
    (rows): TemplateSummary[] => rows ?? [],
  )
}

const insertTemplateInput = z.object({
  workspaceId: id,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  definition: z.looseObject({ pages: z.array(z.unknown()) }),
  createdBy: id,
})

export function insertTemplate(client: UserClient, input: z.input<typeof insertTemplateInput>) {
  return call(
    insertTemplateInput,
    input,
    (v) =>
      client
        .from('survey_templates')
        .insert({
          workspace_id: v.workspaceId,
          name: v.name,
          description: v.description || null,
          definition: asJson(v.definition) as NonNullable<Json>,
          created_by: v.createdBy,
        })
        .select('id')
        .single(),
    (row): string => row?.id ?? '',
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

const updateSettingsInput = z.object({ surveyId: id, patch: settingsPatch })
export type SurveySettingsPatch = z.input<typeof settingsPatch>

/** Editor and above (surveys_update policy). Guard columns are never in the patch. */
export function updateSurveySettings(client: UserClient, input: z.input<typeof updateSettingsInput>) {
  return call(
    updateSettingsInput,
    input,
    (v) => client.from('surveys').update(v.patch).eq('id', v.surveyId).select('id').single(),
    () => undefined,
  )
}

const archiveInput = z.object({ surveyId: id, archived: z.boolean() })

export function setSurveyArchived(client: UserClient, input: z.input<typeof archiveInput>) {
  return call(
    archiveInput,
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

export type PixelSummary = Pick<Tables<'workspace_pixels'>, 'id' | 'type' | 'label' | 'enabled'>

export function listPixels(client: UserClient, input: z.input<typeof wsInput>) {
  return call(
    wsInput,
    input,
    (v) => client.from('workspace_pixels').select('id, type, label, enabled').eq('workspace_id', v.workspaceId).order('created_at'),
    (rows): PixelSummary[] => rows ?? [],
  )
}

export type ContactFieldDef = Pick<Tables<'contact_field_defs'>, 'key' | 'label' | 'type'>

export function listContactFields(client: UserClient, input: z.input<typeof wsInput>) {
  return call(
    wsInput,
    input,
    (v) =>
      client
        .from('contact_field_defs')
        .select('key, label, type')
        .eq('workspace_id', v.workspaceId)
        .eq('archived', false)
        .order('position'),
    (rows): ContactFieldDef[] => rows ?? [],
  )
}
