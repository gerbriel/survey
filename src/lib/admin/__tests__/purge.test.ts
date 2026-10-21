import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const { deleteStorageObjects, isCronAuthorized } = await import('../purge')

describe('isCronAuthorized', () => {
  it('needs the exact bearer secret', () => {
    expect(isCronAuthorized('Bearer s3cret', 's3cret')).toBe(true)
    expect(isCronAuthorized('Bearer wrong', 's3cret')).toBe(false)
    expect(isCronAuthorized('s3cret', 's3cret')).toBe(false)
    expect(isCronAuthorized(null, 's3cret')).toBe(false)
    expect(isCronAuthorized('Bearer ', '')).toBe(false)
    expect(isCronAuthorized('Bearer x', undefined)).toBe(false)
  })
})

describe('deleteStorageObjects', () => {
  it('removes per bucket in chunks and reports done and failed ids', async () => {
    const remove = vi.fn(async (paths: string[]) =>
      paths.includes('bad/1') ? { error: { message: 'boom' } } : { error: null },
    )
    const admin = { storage: { from: vi.fn(() => ({ remove })) } }
    const rows = [
      { deletion_id: 1, bucket: 'public-assets', path: 'ws/logo.png' },
      { deletion_id: 2, bucket: 'response-files', path: 'ws/a' },
      { deletion_id: 3, bucket: 'imports', path: 'bad/1' },
    ]
    const r = await deleteStorageObjects(admin as never, rows)
    expect(r.done.sort()).toEqual([1, 2])
    expect(r.failed).toEqual([{ id: 3, error: 'boom' }])
    expect(admin.storage.from).toHaveBeenCalledTimes(3)
  })
})
