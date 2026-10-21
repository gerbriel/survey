import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, HISTORY_CAP, initHistory, pushHistory, redo, undo } from '../history'

describe('history', () => {
  it('undoes and redoes', () => {
    let h = initHistory(0)
    h = pushHistory(h, 1, { now: 0 })
    h = pushHistory(h, 2, { now: 5000 })
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toBe(2)
    h = pushHistory(undo(h), 9, { now: 9000 })
    expect(canRedo(h)).toBe(false)
  })

  it('coalesces edits with the same key within one second', () => {
    let h = initHistory('')
    h = pushHistory(h, 'a', { key: 'label', now: 0 })
    h = pushHistory(h, 'ab', { key: 'label', now: 500 })
    h = pushHistory(h, 'abc', { key: 'label', now: 900 })
    expect(h.past).toEqual([''])
    h = pushHistory(h, 'abcd', { key: 'label', now: 3000 })
    expect(h.past).toEqual(['', 'abc'])
  })

  it('caps the history at 100 steps', () => {
    let h = initHistory(0)
    for (let i = 1; i <= HISTORY_CAP + 20; i++) h = pushHistory(h, i, { now: i * 2000 })
    expect(h.past).toHaveLength(HISTORY_CAP)
    let n = 0
    while (canUndo(h)) {
      h = undo(h)
      n++
    }
    expect(n).toBe(HISTORY_CAP)
  })
})
