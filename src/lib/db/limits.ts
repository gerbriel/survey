import { z } from 'zod'
import type { UserOrAdminClient } from '@/lib/supabase/types'
import { call, id } from './rpc'

/**
 * Global limits (docs/00 "Global limits", R13) and the per-workspace view of
 * them from SQL effective_limits(). These defaults must equal the constants in
 * the latest effective_limits() definition (migration 0019); a unit test pins them.
 */
export const GLOBAL_LIMIT_DEFAULTS = {
  max_file_bytes: 26_214_400, // 25 MB
  max_files_per_response: 20,
  max_questions: 300,
  max_definition_bytes: 1_048_576, // 1 MB
  rate_limit_per_hour: 20,
  // S3 (R16): GTM and custom scripts are off until a platform admin enables them per workspace.
  raw_script_pixels_allowed: false,
} as const

export type EffectiveLimits = {
  max_file_bytes: number
  max_files_per_response: number
  max_questions: number
  max_definition_bytes: number
  rate_limit_per_hour: number
  raw_script_pixels_allowed: boolean
}

export const effectiveLimitsInput = z.object({ workspaceId: id })

/** Defaults merged with overrides. Null when the caller is not a member (RLS-style filter in SQL). */
export function getEffectiveLimits(client: UserOrAdminClient, input: z.input<typeof effectiveLimitsInput>) {
  return call(
    effectiveLimitsInput,
    input,
    (v) => client.rpc('effective_limits', { p_workspace_id: v.workspaceId }).maybeSingle(),
    (row): EffectiveLimits | null => (row ? (row as EffectiveLimits) : null),
  )
}
