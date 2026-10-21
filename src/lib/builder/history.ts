/**
 * Undo and redo for one editor session (doc 03 section 6): in memory, 100
 * steps, edits tagged with the same `key` within 1 second coalesce into one
 * step (typing in one field).
 *
 * Decision: snapshots instead of Immer patches. Every edit in ops.ts copies
 * only the path it changes, so snapshots share structure and stay cheap, and
 * no new dependency is needed.
 */

export const HISTORY_CAP = 100
export const COALESCE_MS = 1000

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  lastKey: string | null
  lastAt: number
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 }
}

export function pushHistory<T>(h: History<T>, next: T, opts: { key?: string; now: number }): History<T> {
  if (next === h.present) return h
  const key = opts.key ?? null
  if (key !== null && key === h.lastKey && opts.now - h.lastAt < COALESCE_MS) {
    return { ...h, present: next, future: [], lastAt: opts.now }
  }
  const past = [...h.past, h.present]
  if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP)
  return { past, present: next, future: [], lastKey: key, lastAt: opts.now }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (h.past.length === 0) return h
  return { past: h.past.slice(0, -1), present: prev as T, future: [h.present, ...h.future], lastKey: null, lastAt: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const [next, ...rest] = h.future
  return { past: [...h.past, h.present], present: next as T, future: rest, lastKey: null, lastAt: 0 }
}

export const canUndo = (h: History<unknown>) => h.past.length > 0
export const canRedo = (h: History<unknown>) => h.future.length > 0
