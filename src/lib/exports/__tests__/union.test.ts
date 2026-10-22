import { describe, expect, it } from 'vitest'
import { buildColumns } from '../columns'
import { sheetNames, surveyCounts, toUnionRow, unionExportColumns } from '../union'
import { q } from '@/lib/analytics/__tests__/fixtures'

describe('bulk export column union', () => {
  const s1 = buildColumns([
    q({ question_key: 'q_aaaaaaaa', type: 'short_text', label: 'Name' }),
    q({ question_key: 'q_hhhhhhhh', type: 'hidden', label: 'src', settings: { param: 'src' } }),
    q({ question_key: 'q_bbbbbbbb', type: 'nps', label: 'Recommend' }),
  ])
  const s2 = buildColumns([
    q({ question_key: 'q_bbbbbbbb', type: 'nps', label: 'Recommend us' }),
    q({ question_key: 'q_hhhhhhhh', type: 'hidden', label: 'ref', settings: { param: 'ref' } }),
    q({ question_key: 'q_cccccccc', type: 'long_text', label: 'Why' }),
  ])
  const union = unionExportColumns([s1, s2])

  it('survey column first, groups kept, keys unioned once in first seen order', () => {
    const ids = union.map((c) => c.id)
    expect(ids[0]).toBe('survey')
    expect(ids.slice(1, 10)).toEqual(['response_id', 'status', 'started_at', 'submitted_at', 'version', 'contact_id', 'contact_email', 'identity_source', 'token'])
    expect(ids.filter((i) => i.startsWith('hidden.'))).toEqual(['hidden.src', 'hidden.ref'])
    expect(ids.slice(-3)).toEqual(['q_aaaaaaaa', 'q_bbbbbbbb', 'q_cccccccc'])
    expect(ids.filter((i) => i === 'q_bbbbbbbb')).toHaveLength(1)
    expect(union.find((c) => c.id === 'q_bbbbbbbb')!.label).toBe('Recommend')
  })

  it('places a survey row by column id and leaves missing questions empty', () => {
    const row = s2.map((c) => `${c.id}-v`)
    const out = toUnionRow('Second', s2, row, union)
    expect(out[0]).toBe('Second')
    expect(out[union.findIndex((c) => c.id === 'q_cccccccc')]).toBe('q_cccccccc-v')
    expect(out[union.findIndex((c) => c.id === 'q_aaaaaaaa')]).toBe('')
    expect(out[union.findIndex((c) => c.id === 'hidden.src')]).toBe('')
    expect(out).toHaveLength(union.length)
  })

  it('sheet names: 31 characters, no reserved characters, unique', () => {
    const names = sheetNames(['A very long survey title that goes on and on', 'A very long survey title that goes on and on', 'Q1: [draft]?', 'summary'])
    expect(names[0]).toHaveLength(31)
    expect(names[1]).toMatch(/ \(2\)$/)
    expect(names[1]!.length).toBeLessThanOrEqual(31)
    expect(names[2]).toBe('Q1 draft')
    expect(names[3]).toBe('summary (2)')
  })

  it('per survey counts', () => {
    expect(surveyCounts('S', [{ status: 'complete' }, { status: 'partial' }, { status: 'complete' }])).toEqual({ survey: 'S', responses: 3, complete: 2, partial: 1 })
  })
})
