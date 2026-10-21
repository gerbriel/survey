import { describe, expect, it } from 'vitest'
import { initSaveState, isReadOnly, needsSave, saveReducer, type SaveAction, type SaveState } from '../autosave'

const run = (s: SaveState, ...actions: SaveAction[]) => actions.reduce(saveReducer, s)

describe('autosave reducer', () => {
  it('saves after an edit and records the new revision', () => {
    let s = initSaveState(3)
    expect(needsSave(s)).toBe(false)
    s = run(s, { type: 'edit' })
    expect(s.status).toBe('dirty')
    expect(needsSave(s)).toBe(true)
    s = run(s, { type: 'save_start' })
    expect(needsSave(s)).toBe(false)
    s = run(s, { type: 'save_ok', revision: 4, seq: 1 })
    expect(s).toMatchObject({ status: 'saved', revision: 4, savedSeq: 1, inFlightSeq: null })
  })

  it('stays dirty when edits land during a save', () => {
    const s = run(initSaveState(0), { type: 'edit' }, { type: 'save_start' }, { type: 'edit' }, { type: 'save_ok', revision: 1, seq: 1 })
    expect(s.status).toBe('dirty')
    expect(needsSave(s)).toBe(true)
  })

  it('goes read only on revision_conflict and lock_lost', () => {
    const base = run(initSaveState(0), { type: 'edit' }, { type: 'save_start' })
    const c = run(base, { type: 'save_fail', code: 'revision_conflict', message: 'x' })
    const l = run(base, { type: 'save_fail', code: 'lock_lost', message: 'x' })
    expect(c.status).toBe('conflict')
    expect(l.status).toBe('lock_lost')
    expect(isReadOnly(c) && isReadOnly(l)).toBe(true)
    expect(run(c, { type: 'edit' })).toBe(c)
    expect(needsSave(run(c, { type: 'edit' }))).toBe(false)
  })

  it('treats other failures as retryable errors', () => {
    const s = run(initSaveState(0), { type: 'edit' }, { type: 'save_start' }, { type: 'save_fail', code: 'network', message: 'offline' })
    expect(s.status).toBe('error')
    expect(isReadOnly(s)).toBe(false)
    expect(needsSave(s)).toBe(false)
    expect(needsSave(run(s, { type: 'edit' }))).toBe(true)
  })

  it('opens read only when someone else holds the lock, and a takeover makes it writable', () => {
    let s = initSaveState(2, { userId: 'u', name: 'Maria', lockedAt: null })
    expect(s.status).toBe('readonly')
    s = run(s, { type: 'took_lock', revision: 3 })
    expect(s).toMatchObject({ status: 'saved', revision: 3, holder: null })
  })

  it('resumes with local edits when only the lock expired', () => {
    const s = run(initSaveState(5), { type: 'edit' }, { type: 'save_start' }, { type: 'save_fail', code: 'lock_lost', message: '' }, { type: 'resumed', revision: 5 })
    expect(s.status).toBe('dirty')
    expect(needsSave(s)).toBe(true)
  })

  it('locked_elsewhere during editing flips to read only', () => {
    const s = run(initSaveState(1), { type: 'edit' }, { type: 'locked_elsewhere', holder: { userId: 'x', name: 'Sam', lockedAt: '2026-10-21T10:00:00Z' } })
    expect(s.status).toBe('readonly')
    expect(s.holder?.name).toBe('Sam')
  })
})
