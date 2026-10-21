import { describe, expect, it } from 'vitest'
import {
  CLIENT_ERROR_CODES,
  DbException,
  SQL_ERROR_CODES,
  categoryOf,
  isDbErrorCode,
  makeDbError,
  parseSqlMessage,
  toDbError,
  unwrap,
  type DbErrorCode,
} from '../errors'

describe('parseSqlMessage', () => {
  it.each(SQL_ERROR_CODES.map((c) => [c]))('parses bare code %s', (code) => {
    expect(parseSqlMessage(code)).toEqual({ code })
  })

  it.each(SQL_ERROR_CODES.map((c) => [c]))('parses %s with a detail', (code) => {
    expect(parseSqlMessage(`${code}: some detail`)).toEqual({ code, detail: 'some detail' })
  })

  it('keeps the documented detail formats', () => {
    expect(parseSqlMessage('server_only_key_in_public_definition: score')).toEqual({
      code: 'server_only_key_in_public_definition',
      detail: 'score',
    })
    expect(parseSqlMessage('unknown_limit: max_widgets')).toEqual({ code: 'unknown_limit', detail: 'max_widgets' })
    expect(parseSqlMessage('key_type_conflict: q_ab12cd34')).toEqual({ code: 'key_type_conflict', detail: 'q_ab12cd34' })
    expect(parseSqlMessage('merge_size: merge 2 to 5 contacts')).toEqual({
      code: 'merge_size',
      detail: 'merge 2 to 5 contacts',
    })
    expect(parseSqlMessage('invalid_definition: page references unknown question q_x')).toEqual({
      code: 'invalid_definition',
      detail: 'page references unknown question q_x',
    })
  })

  it('rejects unknown codes and sentences', () => {
    expect(parseSqlMessage('something_else')).toBeNull()
    expect(parseSqlMessage('Published version 1 is immutable')).toBeNull()
    expect(parseSqlMessage('')).toBeNull()
  })
})

describe('toDbError', () => {
  it.each(SQL_ERROR_CODES.map((c) => [c]))('maps a PostgREST P0001 error with message %s', (code) => {
    const e = toDbError({ message: code, code: 'P0001', details: null, hint: null })
    expect(e.code).toBe(code)
    expect(e.sqlState).toBe('P0001')
    expect(e.message.length).toBeGreaterThan(0)
    expect(e.detail).toBeUndefined()
  })

  it('carries the detail', () => {
    const e = toDbError({ message: 'server_only_key_in_public_definition: score', code: 'P0001' })
    expect(e).toMatchObject({ code: 'server_only_key_in_public_definition', detail: 'score', category: 'survey' })
  })

  it('maps trigger guard sentences to guard_violation', () => {
    const e = toDbError({ message: 'Published version 3 is immutable', code: 'P0001' })
    expect(e.code).toBe('guard_violation')
    expect(e.detail).toBe('Published version 3 is immutable')
  })

  it.each([
    ['42501', 'permission_denied'],
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['23514', 'check_violation'],
    ['23502', 'check_violation'],
    ['22P02', 'invalid_value'],
    ['22012', 'invalid_value'],
    ['23P01', 'check_violation'],
    ['PGRST116', 'no_rows'],
    ['PGRST202', 'function_not_found'],
    ['PGRST301', 'session_expired'],
    ['PGRST303', 'session_expired'],
  ] as const)('maps SQLSTATE %s to %s', (sqlState, code) => {
    expect(toDbError({ message: 'x y z', code: sqlState }).code).toBe(code)
  })

  it('maps fetch failures to network', () => {
    expect(toDbError(new TypeError('fetch failed')).code).toBe('network')
    expect(toDbError({ message: 'TypeError: Failed to fetch', code: '' }).code).toBe('network')
  })

  it('maps strings and junk', () => {
    expect(toDbError('lock_lost').code).toBe('lock_lost')
    expect(toDbError('nope').code).toBe('unknown')
    expect(toDbError(undefined).code).toBe('unknown')
    expect(toDbError(42).code).toBe('unknown')
  })
})

describe('codes and categories', () => {
  it('has a message and a category for every code', () => {
    for (const code of [...SQL_ERROR_CODES, ...CLIENT_ERROR_CODES] as DbErrorCode[]) {
      const e = makeDbError(code)
      expect(e.message).toMatch(/\S/)
      expect(['auth', 'lock', 'survey', 'limit', 'input', 'conflict', 'system']).toContain(e.category)
      expect(isDbErrorCode(code)).toBe(true)
    }
    expect(isDbErrorCode('bogus')).toBe(false)
  })

  it('groups the build plan prefixes', () => {
    expect(categoryOf('not_authorized')).toBe('auth')
    expect(categoryOf('not_authenticated')).toBe('auth')
    expect(categoryOf('lock_lost')).toBe('lock')
    expect(categoryOf('lock_held')).toBe('lock')
    expect(categoryOf('revision_conflict')).toBe('conflict')
    expect(categoryOf('too_many_questions')).toBe('limit')
    expect(categoryOf('duplicate_question_key')).toBe('survey')
    expect(categoryOf('invalid_input')).toBe('input')
  })

  it('has no duplicate codes', () => {
    const all = [...SQL_ERROR_CODES, ...CLIENT_ERROR_CODES]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('unwrap', () => {
  it('returns data or throws DbException', () => {
    expect(unwrap({ ok: true, data: 5 })).toBe(5)
    const err = makeDbError('revision_conflict')
    expect(() => unwrap({ ok: false, error: err })).toThrow(DbException)
    try {
      unwrap({ ok: false, error: makeDbError('unknown_limit', 'x') })
    } catch (e) {
      expect((e as DbException).error.code).toBe('unknown_limit')
      expect((e as DbException).message).toBe('unknown_limit: x')
    }
  })
})
