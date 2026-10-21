import { LEAD_STATUSES } from '@/lib/crm/import'
import type { Contact, FieldDef } from './types'

/** Core fields merge_contacts can take from any contact (migration 0014). */
export const MERGE_FIELDS = [
  'email',
  'phone',
  'first_name',
  'last_name',
  'company',
  'owner_id',
  'follow_up_at',
  'follow_up_note',
  'source',
] as const

/** Default survivor: the most responses, then the oldest (doc 04 section 2.5). */
export function defaultSurvivor(contacts: Contact[]): string {
  return [...contacts].sort((a, b) => b.response_count - a.response_count || a.created_at.localeCompare(b.created_at))[0]!.id
}

export type ConflictRow = { field: string; label: string; values: { contactId: string; value: unknown }[] }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** One row per core or custom field where at least two contacts hold different non-empty values. */
export function conflictRows(contacts: Contact[], defs: FieldDef[], labels: Record<string, string>): ConflictRow[] {
  const rows: ConflictRow[] = []
  const add = (field: string, label: string, get: (c: Contact) => unknown) => {
    const values = contacts.map((c) => ({ contactId: c.id, value: get(c) })).filter((v) => v.value !== null && v.value !== undefined && v.value !== '')
    if (values.length < 2) return
    if (values.every((v) => same(v.value, values[0]!.value))) return
    rows.push({ field, label, values })
  }
  for (const f of MERGE_FIELDS) add(f, labels[f] ?? f, (c) => c[f])
  for (const d of defs) add(`custom.${d.key}`, d.label, (c) => ((c.custom ?? {}) as Record<string, unknown>)[d.key])
  return rows
}

/** Survivor preselected for every conflict, falling back to the first contact holding a value. */
export function defaultChoices(rows: ConflictRow[], survivorId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) out[r.field] = r.values.find((v) => v.contactId === survivorId)?.contactId ?? r.values[0]!.contactId
  return out
}

/** Most advanced status; lost only if all are lost (mirrors merge_contacts). */
export function mergedStatus(contacts: Contact[]): Contact['lead_status'] {
  if (contacts.every((c) => c.lead_status === 'lost')) return 'lost'
  let best = 0
  for (const c of contacts) if (c.lead_status !== 'lost') best = Math.max(best, LEAD_STATUSES.indexOf(c.lead_status))
  return LEAD_STATUSES[best]!
}
