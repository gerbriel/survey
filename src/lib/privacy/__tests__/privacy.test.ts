import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const remove = vi.fn()
const complete = vi.fn()
vi.mock('@/lib/db/exports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/exports')>()),
  completeStorageDeletions: (...a: unknown[]) => complete(...a),
}))

const { confirmMatches, confirmPhrase } = await import('../erase')
const { parseLookup } = await import('../lookup')
const { nextRetentionRun } = await import('../retention')
const { deleteQueuedObjects, objectName } = await import('../storage')

describe('privacy helpers', () => {
  it('confirm phrase is the email or DELETE', () => {
    expect(confirmPhrase('a@b.co')).toBe('a@b.co')
    expect(confirmPhrase(null)).toBe('DELETE')
    expect(confirmMatches(' A@B.co ', 'a@b.co')).toBe(true)
    expect(confirmMatches('DELETE', 'a@b.co')).toBe(true)
    expect(confirmMatches('delete', null)).toBe(false)
    expect(confirmMatches('x@y.z', 'a@b.co')).toBe(false)
  })
  it('lookup accepts email, contact id, token and a pasted personal link', () => {
    expect(parseLookup('Pat@Example.org')).toEqual({ kind: 'email', value: 'pat@example.org' })
    expect(parseLookup('11111111-1111-4111-8111-111111111111')).toEqual({ kind: 'id', value: '11111111-1111-4111-8111-111111111111' })
    expect(parseLookup('Abc_def-12345678')).toEqual({ kind: 'token', value: 'Abc_def-12345678' })
    expect(parseLookup('https://s.example.org/spring?t=Tok_12345678')).toEqual({ kind: 'token', value: 'Tok_12345678' })
    expect(parseLookup('hi there')).toBeNull()
    expect(parseLookup('')).toBeNull()
  })
  it('next retention run is the next 03:00 UTC', () => {
    expect(nextRetentionRun(new Date('2026-10-21T02:59:00Z')).toISOString()).toBe('2026-10-21T03:00:00.000Z')
    expect(nextRetentionRun(new Date('2026-10-21T03:00:00Z')).toISOString()).toBe('2026-10-22T03:00:00.000Z')
  })
  it('deletes queued objects per bucket and reports back', async () => {
    remove.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom' } })
    const admin = { storage: { from: () => ({ remove }) } }
    const r = await deleteQueuedObjects(admin as never, [
      { deletion_id: 1, bucket: 'response-files', path: 'ws/a.pdf' },
      { deletion_id: 2, bucket: 'exports', path: 'exports/ws/x.csv' },
    ])
    expect(r).toEqual({ done: 1, failed: 1 })
    expect(remove).toHaveBeenNthCalledWith(1, ['ws/a.pdf'])
    expect(remove).toHaveBeenNthCalledWith(2, ['ws/x.csv'])
    expect(complete).toHaveBeenCalledWith(admin, { done: [1], failed: [{ id: 2, error: 'boom' }] })
    expect(objectName('imports', 'imports/ws/f.csv')).toBe('ws/f.csv')
  })
})
