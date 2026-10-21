import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SQL_ERROR_CODES } from '../errors'
import { GLOBAL_LIMIT_DEFAULTS } from '../limits'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')

describe('error codes stay in step with the migrations', () => {
  it('lists every snake_case code the SQL raises', () => {
    const raised = new Set<string>()
    for (const m of sql.matchAll(/raise exception '([a-z][a-z0-9_]*)(?::[^']*)?'/g)) raised.add(m[1]!)
    // Raised inside import_contacts_chunk and caught per row; never reaches a caller.
    raised.delete('type')
    raised.delete('max_length')
    raised.delete('unknown_option')
    raised.delete('email')
    raised.delete('gen_token')
    const listed = new Set<string>(SQL_ERROR_CODES)
    const missing = [...raised].filter((c) => !listed.has(c))
    expect(missing).toEqual([])
  })
})

describe('GLOBAL_LIMIT_DEFAULTS', () => {
  it('matches effective_limits() in migration 0003', () => {
    const body = sql.slice(sql.indexOf('create or replace function effective_limits'))
    const pick = (col: string) => {
      const m = new RegExp(`coalesce\\(l\\.${col}, ([0-9a-z]+)\\)`).exec(body)
      return m?.[1]
    }
    expect(Number(pick('max_file_bytes'))).toBe(GLOBAL_LIMIT_DEFAULTS.max_file_bytes)
    expect(Number(pick('max_files_per_response'))).toBe(GLOBAL_LIMIT_DEFAULTS.max_files_per_response)
    expect(Number(pick('max_questions'))).toBe(GLOBAL_LIMIT_DEFAULTS.max_questions)
    expect(Number(pick('max_definition_bytes'))).toBe(GLOBAL_LIMIT_DEFAULTS.max_definition_bytes)
    expect(Number(pick('rate_limit_per_hour'))).toBe(GLOBAL_LIMIT_DEFAULTS.rate_limit_per_hour)
    expect(pick('raw_script_pixels_allowed')).toBe(String(GLOBAL_LIMIT_DEFAULTS.raw_script_pixels_allowed))
  })
})
