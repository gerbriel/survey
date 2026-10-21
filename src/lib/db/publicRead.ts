import { z } from 'zod'
import type { Enums, Json } from '@/types/db-helpers'
import type { AnonClient } from '@/lib/supabase/types'
import { call, id } from './rpc'

/**
 * The anon read path (migration 0011, R1, doc 02 section 4). These are the
 * only two functions anon may execute, and these wrappers accept only the
 * anon client so the dashboard session can never be used here by mistake.
 * Unknown keys, drafts and deleted workspaces return null, identical to each
 * other, so the public key never enumerates surveys.
 */

export type PublicSurveyState = 'scheduled' | 'open' | 'closed'
export type PublicStateReason = 'manual' | 'schedule' | 'cap' | 'admin' | 'workspace_archived'

export type PublicPixel = { id: string; type: Enums<'pixel_type'>; value: string; parsed: Json }

/** resolve_public_survey row. Columns the SQL can return as null are typed nullable. */
export type PublicSurvey = {
  survey_id: string
  slug: string
  alias: string | null
  matched_by: 'slug' | 'alias' | 'retired_alias'
  effective_state: PublicSurveyState
  state_reason: PublicStateReason | null
  opens_at: string | null
  closes_at: string | null
  closed_message: string | null
  /** Set only when effective_state is open. */
  version_id: string | null
  version_no: number | null
  title: string
  og_title: string | null
  og_description: string | null
  og_image_path: string | null
  allow_indexing: boolean
  workspace_name: string
  logo_path: string | null
  show_powered_by: boolean
  privacy_notice_url: string | null
  pixel_consent_mode: Enums<'pixel_consent_mode'>
  /** Enabled pixels minus exclusions; [] unless open. */
  pixels: PublicPixel[]
}

export type PublicDefinition = { version_id: string; version_no: number; public_definition: Json }

/** A slug or alias as typed in the URL. SQL lowercases and trims. */
export const publicKey = z.string().min(1).max(100)

export const resolvePublicSurveyInput = z.object({ key: publicKey })

/** Per request (state depends on now()). */
export function resolvePublicSurvey(client: AnonClient, input: z.input<typeof resolvePublicSurveyInput>) {
  return call(
    resolvePublicSurveyInput,
    input,
    (v) => client.rpc('resolve_public_survey', { p_key: v.key }).maybeSingle(),
    (row): PublicSurvey | null => (row ? (row as unknown as PublicSurvey) : null),
  )
}

export const getPublicDefinitionInput = z.object({ versionId: id, key: publicKey })

/**
 * Browser-safe definition of a published version of the keyed survey. Safe to
 * cache forever by (versionId, key): published versions are immutable.
 */
export function getPublicDefinition(client: AnonClient, input: z.input<typeof getPublicDefinitionInput>) {
  return call(
    getPublicDefinitionInput,
    input,
    (v) => client.rpc('get_public_definition', { p_version_id: v.versionId, p_key: v.key }).maybeSingle(),
    (row): PublicDefinition | null => (row ? (row as PublicDefinition) : null),
  )
}
