import type { InboxRow } from '@/lib/db/responses'

/**
 * Realtime handling for the response inbox (doc 01 section 14). The
 * postgres_changes payload carries the whole row including `raw`, so it is
 * treated as a signal only: the handler takes the id and refetches the row
 * through the server (db wrapper under RLS), then hands that row on.
 */
export type ChangeSignal = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE' | string
  new?: { id?: unknown } | Record<string, unknown> | null
  old?: { id?: unknown } | Record<string, unknown> | null
}

export type RealtimeDeps = {
  fetchRow: (responseId: string) => Promise<InboxRow | null>
  upsert: (row: InboxRow, isInsert: boolean) => void
  remove: (responseId: string) => void
}

export function signalId(p: ChangeSignal): string | null {
  const id = (p.new as { id?: unknown } | null | undefined)?.id ?? (p.old as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' ? id : null
}

export function createRealtimeHandler(deps: RealtimeDeps) {
  return async (payload: ChangeSignal) => {
    const id = signalId(payload)
    if (!id) return
    if (payload.eventType === 'DELETE') {
      deps.remove(id)
      return
    }
    const row = await deps.fetchRow(id)
    if (row) deps.upsert(row, payload.eventType === 'INSERT')
    else deps.remove(id)
  }
}

export type InboxMatchFilters = {
  status: 'complete' | 'all'
  identity: 'all' | 'token' | 'identified' | 'anonymous'
  version: string
  latestVersionId: string | null
}

/** Whether a refetched row belongs in the current filtered view. */
export function rowMatches(row: InboxRow, f: InboxMatchFilters): boolean {
  if (f.status === 'complete' && row.status !== 'complete') return false
  if (f.identity === 'token' && row.identity_source !== 'token') return false
  if (f.identity === 'identified' && !row.contact_id) return false
  if (f.identity === 'anonymous' && row.contact_id) return false
  if (f.version === 'latest' && row.survey_version_id !== f.latestVersionId) return false
  if (f.version !== 'latest' && f.version !== 'all' && row.survey_version_id !== f.version) return false
  return true
}
