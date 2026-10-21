import { GLOBAL_LIMIT_DEFAULTS, type EffectiveLimits } from '@/lib/db/limits'
import { formatBytes } from '@/lib/admin/lifecycle'

/**
 * Rows for the read-only limits table (doc 05 section 5.6). Pure, unit tested.
 * `overrides` is the workspace_limits row (null columns mean the default).
 */
export type LimitKey = keyof typeof GLOBAL_LIMIT_DEFAULTS

export const LIMIT_LABELS: Record<LimitKey, string> = {
  max_file_bytes: 'Max file size per upload',
  max_files_per_response: 'Max files per response',
  max_questions: 'Max questions per survey',
  max_definition_bytes: 'Survey definition size',
  rate_limit_per_hour: 'Submissions per IP per survey per hour',
  raw_script_pixels_allowed: 'Script pixels (GTM and custom scripts)',
}

export type LimitRow = { key: LimitKey; label: string; value: string; source: 'default' | 'override' }

export function formatLimit(key: LimitKey, value: number | boolean): string {
  if (key === 'raw_script_pixels_allowed') return value ? 'Allowed' : 'Turned off'
  if (key === 'max_file_bytes' || key === 'max_definition_bytes') return formatBytes(Number(value))
  return Number(value).toLocaleString('en-US')
}

export function limitRows(
  effective: EffectiveLimits | null,
  overrides: Partial<Record<LimitKey, number | boolean | null>> | null,
): LimitRow[] {
  return (Object.keys(GLOBAL_LIMIT_DEFAULTS) as LimitKey[]).map((key) => {
    const o = overrides?.[key]
    const v = effective ? effective[key] : GLOBAL_LIMIT_DEFAULTS[key]
    return { key, label: LIMIT_LABELS[key], value: formatLimit(key, v), source: o === null || o === undefined ? 'default' : 'override' }
  })
}
