import type { AssignmentFilter } from '@/lib/db/assignments'

/** Survey list URL keeping both the archived view and the assignment filter (R19). Pure, unit tested. */
export function listHref(base: string, archived: boolean, filter: AssignmentFilter): string {
  const q = new URLSearchParams()
  if (archived) q.set('archived', '1')
  if (filter !== 'all') q.set('assigned', filter)
  const s = q.toString()
  return s ? `${base}?${s}` : base
}
