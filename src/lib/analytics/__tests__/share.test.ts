import { describe, expect, it } from 'vitest'
import { allKeys, sanitizeSharedPayload, sealPassword, SHARED_PAYLOAD_KEYS, shareCookieName, unsealPassword } from '../share-payload'

const RAW = {
  report: { name: 'Board', id: 'leak-report-id' },
  survey: { title: 'Spring', workspace_id: 'leak' },
  workspace: { name: 'Acme', logo_path: 'ws/logo.png' },
  widgets: [
    {
      id: 'w1',
      position: 0,
      chart_type: 'bar',
      question_key: 'q_aaaaaaaa',
      metric: null,
      label: 'Pick one',
      options: [{ id: 'opt_a', label: 'Alpha', score: 5 }],
      result: {
        n: 10,
        suppressed: false,
        type: 'single_choice',
        data: [
          { option_id: 'opt_a', count: 8, suppressed: false, email: 'x@y.z' },
          { option_id: 'opt_b', count: null, suppressed: true },
        ],
        rows: [{ id: 'resp', raw: { q: 'secret' } }],
        verbatims: ['I am Jane'],
      },
    },
  ],
  responses: [{ id: 'r1' }],
}

describe('shared report payload allow-list', () => {
  it('keeps only allow-listed keys at every depth', () => {
    const safe = sanitizeSharedPayload(RAW)!
    for (const k of allKeys(safe)) expect(SHARED_PAYLOAD_KEYS.has(k)).toBe(true)
    const s = JSON.stringify(safe)
    for (const leak of ['x@y.z', 'secret', 'I am Jane', 'logo.png', 'leak', 'score']) expect(s).not.toContain(leak)
    expect(safe.widgets[0]!.options).toEqual([{ id: 'opt_a', label: 'Alpha' }])
    expect(safe.workspace).toEqual({ name: 'Acme' })
  })
  it('keeps suppression flags', () => {
    const safe = sanitizeSharedPayload(RAW)!
    expect(safe.widgets[0]!.result.data).toEqual([
      { option_id: 'opt_a', count: 8, suppressed: false },
      { option_id: 'opt_b', count: null, suppressed: true },
    ])
  })
  it('null for junk', () => {
    expect(sanitizeSharedPayload(null)).toBeNull()
    expect(sanitizeSharedPayload('x')).toBeNull()
  })
})

describe('password cookie', () => {
  it('seals and unseals, bound to the token and the secret', () => {
    const sealed = sealPassword('hunter22', 'tokenAAAAAAAAAAAAAAAAA', 's3cret')
    expect(sealed).not.toContain('hunter22')
    expect(unsealPassword(sealed, 'tokenAAAAAAAAAAAAAAAAA', 's3cret')).toBe('hunter22')
    expect(unsealPassword(sealed, 'tokenBBBBBBBBBBBBBBBBB', 's3cret')).toBeNull()
    expect(unsealPassword(sealed, 'tokenAAAAAAAAAAAAAAAAA', 'other')).toBeNull()
    expect(unsealPassword('garbage', 'tokenAAAAAAAAAAAAAAAAA', 's3cret')).toBeNull()
  })
  it('cookie name does not reveal the token', () => {
    const n = shareCookieName('tokenAAAAAAAAAAAAAAAAA')
    expect(n).toMatch(/^rs_[0-9a-f]{16}$/)
    expect(n).not.toContain('token')
  })
})
