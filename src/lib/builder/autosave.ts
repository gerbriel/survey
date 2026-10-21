/**
 * Autosave state machine (doc 03 sections 6 and 9). Pure reducer so the
 * conflict handling is unit tested without React or the network.
 *
 *   editing  -> dirty -> saving -> saved
 *   saving   -> conflict (revision_conflict) | lock_lost (lock_lost) -> read only
 *   saving   -> error (anything else, retried on the next edit or by hand)
 *   any      -> readonly (someone else holds the lock at open)
 *   readonly | conflict | lock_lost -> saved after a forced takeover
 */

export const AUTOSAVE_DELAY_MS = 1500

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'lock_lost' | 'readonly'

export interface LockHolder {
  userId: string | null
  name: string | null
  lockedAt: string | null
}

export interface SaveState {
  status: SaveStatus
  /** Revision the next save must pass as expected. */
  revision: number
  /** Increments on every edit. */
  editSeq: number
  /** editSeq of the last successful save. */
  savedSeq: number
  /** editSeq being saved right now. */
  inFlightSeq: number | null
  error: string | null
  holder: LockHolder | null
}

export type SaveAction =
  | { type: 'edit' }
  | { type: 'save_start' }
  | { type: 'save_ok'; revision: number; seq: number }
  | { type: 'save_fail'; code: string; message: string }
  | { type: 'locked_elsewhere'; holder: LockHolder }
  | { type: 'took_lock'; revision: number }
  | { type: 'revision'; revision: number }
  /** The lock had only expired and was retaken at the same revision: keep local edits. */
  | { type: 'resumed'; revision: number }

export function initSaveState(revision: number, holder: LockHolder | null = null): SaveState {
  return {
    status: holder ? 'readonly' : 'saved',
    revision,
    editSeq: 0,
    savedSeq: 0,
    inFlightSeq: null,
    error: null,
    holder,
  }
}

export const isReadOnly = (s: SaveState) => s.status === 'readonly' || s.status === 'conflict' || s.status === 'lock_lost'

/** True when a save should be scheduled now. */
export function needsSave(s: SaveState): boolean {
  return !isReadOnly(s) && s.inFlightSeq === null && s.editSeq > s.savedSeq && s.status !== 'error'
}

export function saveReducer(s: SaveState, a: SaveAction): SaveState {
  switch (a.type) {
    case 'edit':
      if (isReadOnly(s)) return s
      return { ...s, editSeq: s.editSeq + 1, status: s.inFlightSeq === null ? 'dirty' : 'saving', error: null }
    case 'save_start':
      if (isReadOnly(s)) return s
      return { ...s, status: 'saving', inFlightSeq: s.editSeq }
    case 'save_ok': {
      const savedSeq = Math.max(s.savedSeq, a.seq)
      return {
        ...s,
        revision: a.revision,
        savedSeq,
        inFlightSeq: null,
        status: s.editSeq > savedSeq ? 'dirty' : 'saved',
        error: null,
      }
    }
    case 'save_fail':
      if (a.code === 'revision_conflict') return { ...s, status: 'conflict', inFlightSeq: null, error: a.message }
      if (a.code === 'lock_lost') return { ...s, status: 'lock_lost', inFlightSeq: null, error: a.message }
      return { ...s, status: 'error', inFlightSeq: null, error: a.message }
    case 'locked_elsewhere':
      return { ...s, status: 'readonly', holder: a.holder, inFlightSeq: null }
    case 'took_lock':
      // Decision: after a takeover the local definition is reloaded from the
      // server by the caller, so nothing unsaved remains.
      return { ...s, status: 'saved', revision: a.revision, holder: null, error: null, inFlightSeq: null, savedSeq: s.editSeq }
    case 'revision':
      return { ...s, revision: a.revision }
    case 'resumed':
      return { ...s, revision: a.revision, holder: null, error: null, inFlightSeq: null, status: s.editSeq > s.savedSeq ? 'dirty' : 'saved' }
  }
}

export function statusLabel(s: SaveState): string {
  switch (s.status) {
    case 'saved':
      return 'All changes saved'
    case 'dirty':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving...'
    case 'error':
      return 'Save failed'
    case 'conflict':
      return 'Your editing session was taken over'
    case 'lock_lost':
      return 'Editing lock expired'
    case 'readonly':
      return 'Read only'
  }
}
