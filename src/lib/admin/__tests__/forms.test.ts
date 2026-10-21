import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { makeDbError } from '@/lib/db/errors'
import { formBool, formFields, fromDbError, fromResult, fromZodError } from '../forms'
import { limitsFormDefaults, parseLimitsForm } from '../limits-form'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe('form state helpers', () => {
  it('maps DbError codes to their member-safe message', () => {
    expect(fromDbError(makeDbError('slug_taken'))).toEqual({ status: 'error', message: 'That address is already taken. Pick another.' })
    expect(fromResult({ ok: true, data: 1 }, 'Saved.')).toEqual({ status: 'success', message: 'Saved.' })
    expect(fromResult({ ok: false, error: makeDbError('not_authorized') }, 'Saved.').message).toBe('You do not have permission to do that.')
  })

  it('keeps the first zod issue per field', () => {
    const r = z.object({ name: z.string().min(1, 'Enter a name.'), n: z.number() }).safeParse({ name: '', n: 'x' })
    if (r.success) throw new Error('expected failure')
    expect(fromZodError(r.error).fieldErrors).toEqual({ name: 'Enter a name.', n: expect.any(String) })
  })

  it('turns blank optional fields into null and reads checkboxes', () => {
    expect(formFields(fd({ a: 'x', b: '  ', c: '' }), ['b', 'c', 'd'])).toEqual({ a: 'x', b: null, c: null, d: null })
    expect(formBool(fd({ on: 'on' }), 'on')).toBe(true)
    expect(formBool(fd({ off: 'false' }), 'off')).toBe(false)
    expect(formBool(fd({}), 'missing')).toBe(false)
  })
})

describe('parseLimitsForm', () => {
  it('converts MB and KB, skips blanks, maps the kill switch', () => {
    const r = parseLimitsForm(fd({ maxFileMb: '50', maxDefinitionKb: '2048', maxQuestions: '', rawScript: 'blocked', note: 'Media team' }))
    expect(r).toEqual({
      ok: true,
      limits: { max_file_bytes: 52_428_800, max_definition_bytes: 2_097_152, raw_script_pixels_allowed: false },
      note: 'Media team',
    })
    expect(parseLimitsForm(fd({ rawScript: 'default', note: 'reset' }))).toEqual({ ok: true, limits: {}, note: 'reset' })
  })

  it('requires a note and positive whole numbers', () => {
    const r = parseLimitsForm(fd({ maxQuestions: '1.5', maxFilesPerResponse: '-1', note: '' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.state.fieldErrors ?? {}).sort()).toEqual(['maxFilesPerResponse', 'maxQuestions', 'note'])
  })

  it('round trips defaults from a workspace_limits row', () => {
    expect(limitsFormDefaults({ max_file_bytes: 52_428_800, raw_script_pixels_allowed: false, note: 'x' })).toMatchObject({
      maxFileMb: '50',
      maxQuestions: '',
      rawScript: 'blocked',
      note: 'x',
    })
    expect(limitsFormDefaults(null).rawScript).toBe('default')
  })
})
