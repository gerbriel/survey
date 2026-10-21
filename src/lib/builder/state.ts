/**
 * Effective survey state for dashboard display. Mirrors SQL
 * survey_effective_state (migration 0005); the public page always asks SQL.
 */

export type EffectiveState = 'draft' | 'scheduled' | 'open' | 'closed'

export interface StateInput {
  state: 'draft' | 'open' | 'closed' | 'scheduled'
  opens_at: string | null
  closes_at: string | null
  response_cap: number | null
  complete_count: number
  archived_at: string | null
  latest_published_version_id: string | null
  admin_closed_at?: string | null
}

export function effectiveState(s: StateInput, now: number, workspaceArchived = false): { state: EffectiveState; reason: string | null } {
  const opens = s.opens_at ? Date.parse(s.opens_at) : null
  const closes = s.closes_at ? Date.parse(s.closes_at) : null
  const capped = s.response_cap !== null && s.complete_count >= s.response_cap
  if (s.archived_at || s.state === 'draft' || !s.latest_published_version_id) return { state: 'draft', reason: s.archived_at ? 'archived' : null }
  if (workspaceArchived) return { state: 'closed', reason: 'workspace_archived' }
  if (s.admin_closed_at) return { state: 'closed', reason: 'admin' }
  if (s.state === 'closed') return { state: 'closed', reason: 'manual' }
  if (opens !== null && now < opens) return { state: 'scheduled', reason: null }
  if (closes !== null && now >= closes) return { state: 'closed', reason: 'schedule' }
  if (capped) return { state: 'closed', reason: 'cap' }
  return { state: 'open', reason: null }
}

export const STATE_LABELS: Record<EffectiveState, string> = {
  draft: 'Not public',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
}

export const REASON_LABELS: Record<string, string> = {
  archived: 'archived',
  manual: 'closed by hand',
  schedule: 'past the close time',
  cap: 'response limit reached',
  admin: 'closed by a platform admin',
  workspace_archived: 'workspace archived',
}

export function stateText(s: StateInput, now: number): string {
  const e = effectiveState(s, now)
  return e.reason ? `${STATE_LABELS[e.state]} (${REASON_LABELS[e.reason] ?? e.reason})` : STATE_LABELS[e.state]
}

/** Request time for server components (state display is computed once per request). */
export function requestTime(): number {
  return Date.now()
}
