/**
 * Unread markers for the inbox, kept in sessionStorage per survey.
 *
 * Decision: "unread" means a response that arrived through realtime while the
 * inbox was open in this browser session and has not been opened since.
 * There is no read state in the database (doc 04 does not define one).
 */
type Listener = () => void

const EMPTY: ReadonlySet<string> = new Set()
const cache = new Map<string, ReadonlySet<string>>()
const listeners = new Set<Listener>()

const storageKey = (surveyId: string) => `survey.inbox.unread.${surveyId}`

function read(surveyId: string): ReadonlySet<string> {
  const hit = cache.get(surveyId)
  if (hit) return hit
  let set: ReadonlySet<string> = EMPTY
  try {
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey(surveyId)) : null
    if (raw) set = new Set(JSON.parse(raw) as string[])
  } catch {
    set = EMPTY
  }
  cache.set(surveyId, set)
  return set
}

function write(surveyId: string, set: ReadonlySet<string>) {
  cache.set(surveyId, set)
  try {
    window.sessionStorage.setItem(storageKey(surveyId), JSON.stringify([...set].slice(-500)))
  } catch {
    // Private mode or storage blocked: the marker lives in memory only.
  }
  for (const l of listeners) l()
}

export const unreadStore = {
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: read,
  serverSnapshot: (): ReadonlySet<string> => EMPTY,
  add(surveyId: string, responseId: string) {
    const cur = read(surveyId)
    if (cur.has(responseId)) return
    write(surveyId, new Set([...cur, responseId]))
  },
  remove(surveyId: string, responseId: string) {
    const cur = read(surveyId)
    if (!cur.has(responseId)) return
    const next = new Set(cur)
    next.delete(responseId)
    write(surveyId, next)
  },
  /** Test helper. */
  reset() {
    cache.clear()
  },
}
