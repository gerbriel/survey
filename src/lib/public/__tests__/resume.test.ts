import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
const { answerRowToWire, hashResumeToken, resumeHashOrNull, rowsToWire } = await import('../resume')

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 chars like gen_token(32)
const row = (r: Partial<Parameters<typeof answerRowToWire>[0]>) => ({
  question_key: 'q_aaaaaaaa',
  value_text: null,
  value_number: null,
  value_date: null,
  value_json: null,
  ...r,
})

describe('resume tokens', () => {
  it('hashes like SQL sha256_hex', () => {
    // sha256("abc")
    expect(hashResumeToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes only well-formed tokens', () => {
    expect(resumeHashOrNull(TOKEN)).toMatch(/^[0-9a-f]{64}$/)
    expect(resumeHashOrNull('short')).toBeNull()
    expect(resumeHashOrNull(`${TOKEN}'; drop table`)).toBeNull()
    expect(resumeHashOrNull(undefined)).toBeNull()
  })
})

describe('stored answers back to wire values', () => {
  it('restores scalars and choice other text', () => {
    expect(answerRowToWire(row({ value_text: 'hello' }))).toBe('hello')
    expect(answerRowToWire(row({ value_number: 7 }))).toBe(7)
    expect(answerRowToWire(row({ value_date: '2026-10-21' }))).toBe('2026-10-21')
    expect(answerRowToWire(row({ value_text: 'o_other001', value_json: { other: 'Blue' } }))).toEqual({ id: 'o_other001', other: 'Blue' })
    expect(answerRowToWire(row({ value_json: ['o_a', 'o_b'] }))).toEqual(['o_a', 'o_b'])
  })

  it('restores file answers as FileRefs', () => {
    const f = { file_id: 'id1', path: 'w/s/pending/x/a.pdf', name: 'a.pdf', size: 10, mime: 'application/pdf' }
    expect(answerRowToWire(row({ value_json: [f] }))).toEqual([{ path: f.path, name: 'a.pdf', size: 10, mime: 'application/pdf' }])
    expect(answerRowToWire(row({ value_json: f }))).toEqual({ path: f.path, name: 'a.pdf', size: 10, mime: 'application/pdf' })
  })

  it('builds the answers map and the upload manifest', () => {
    const out = rowsToWire({
      response: { id: 'r', survey_version_id: 'v', metadata: {}, last_question_key: null, started_at: '' },
      answers: [row({ question_key: 'q_a0000001', value_text: 'x' }), row({ question_key: 'q_a0000002' })],
      files: [
        { id: 'f1', question_key: 'q_files001', object_path: 'p1', original_name: 'one.pdf', declared_size: 1, declared_mime: 'application/pdf' },
        { id: 'f2', question_key: 'q_files001', object_path: 'p2', original_name: 'two.pdf', declared_size: 2, declared_mime: 'application/pdf' },
      ],
    })
    expect(out.answers).toEqual({ q_a0000001: 'x' })
    expect(out.files.q_files001?.map((f) => f.path)).toEqual(['p1', 'p2'])
  })
})
