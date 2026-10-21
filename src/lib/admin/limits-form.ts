import { failure, type ActionState } from './forms'

/**
 * Parses the /admin workspace limits form into admin_set_workspace_limits
 * overrides. Pure, unit tested. A blank number means "use the default";
 * sizes are entered in MB (files) and KB (definition) for humans.
 */
export type LimitOverrides = {
  max_file_bytes?: number
  max_files_per_response?: number
  max_questions?: number
  max_definition_bytes?: number
  rate_limit_per_hour?: number
  raw_script_pixels_allowed?: boolean
}

export const LIMIT_FIELDS = [
  { name: 'maxFileMb', key: 'max_file_bytes', label: 'Max file size per upload (MB)', scale: 1_048_576, max: 1024 },
  { name: 'maxFilesPerResponse', key: 'max_files_per_response', label: 'Max files per response', scale: 1, max: 500 },
  { name: 'maxQuestions', key: 'max_questions', label: 'Max questions per survey', scale: 1, max: 5000 },
  { name: 'maxDefinitionKb', key: 'max_definition_bytes', label: 'Survey definition size (KB)', scale: 1024, max: 20_480 },
  { name: 'rateLimitPerHour', key: 'rate_limit_per_hour', label: 'Submissions per IP per survey per hour', scale: 1, max: 100_000 },
] as const

export type LimitsFormResult =
  | { ok: true; limits: LimitOverrides; note: string }
  | { ok: false; state: ActionState }

export function parseLimitsForm(form: FormData): LimitsFormResult {
  const limits: LimitOverrides = {}
  const errors: Record<string, string> = {}
  for (const f of LIMIT_FIELDS) {
    const raw = String(form.get(f.name) ?? '').trim()
    if (raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || n > f.max || (f.scale === 1 && !Number.isInteger(n))) {
      errors[f.name] = `Enter a positive number up to ${f.max.toLocaleString('en-US')}, or leave blank for the default.`
      continue
    }
    limits[f.key] = Math.round(n * f.scale)
  }
  const raw = String(form.get('rawScript') ?? 'default')
  if (raw === 'allowed') limits.raw_script_pixels_allowed = true
  else if (raw === 'blocked') limits.raw_script_pixels_allowed = false
  else if (raw !== 'default') errors.rawScript = 'Pick an option.'
  const note = String(form.get('note') ?? '').trim()
  if (!note) errors.note = 'Add a note explaining the change.'
  else if (note.length > 2000) errors.note = 'Use 2000 characters or fewer.'
  if (Object.keys(errors).length) return { ok: false, state: failure('Check the highlighted fields.', errors) }
  return { ok: true, limits, note }
}

/** Current overrides as form defaults (blank when null). */
export function limitsFormDefaults(row: Partial<Record<string, unknown>> | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of LIMIT_FIELDS) {
    const v = row?.[f.key]
    out[f.name] = typeof v === 'number' ? String(Math.round((v / f.scale) * 100) / 100) : ''
  }
  const r = row?.raw_script_pixels_allowed
  out.rawScript = r === true ? 'allowed' : r === false ? 'blocked' : 'default'
  out.note = typeof row?.note === 'string' ? row.note : ''
  return out
}
