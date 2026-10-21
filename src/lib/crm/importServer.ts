import 'server-only'
import { z } from 'zod'
import { importRow } from '@/lib/db/contacts'
import { normalizeEmail, splitTags } from './email'
import { LEAD_STATUSES, type ImportRow, type LeadStatus } from './import'
import { normalizePhone } from './phone'

export type ImportOptions = {
  on_match: 'skip' | 'fill' | 'overwrite'
  default_tags: string[]
  default_status?: LeadStatus
  default_owner?: string
}

const rowsSchema = z.array(importRow).max(500)

/**
 * Server re-check of one chunk before import_contacts_chunk: the browser
 * preview applied the same rules, but the server never trusts it. Emails are
 * normalized, phones parsed to E.164 with the workspace default country (or
 * dropped), tags normalized, unknown lead statuses removed.
 */
export function prepareImportRows(
  rows: ImportRow[],
  defaultCountry: string,
): { ok: true; rows: ImportRow[] } | { ok: false; message: string } {
  const parsed = rowsSchema.safeParse(rows)
  if (!parsed.success) return { ok: false, message: 'The import chunk is malformed. Reload and try again.' }
  const out: ImportRow[] = parsed.data.map((r) => {
    const email = normalizeEmail(r.email) ?? r.email.trim().toLowerCase()
    const phone = r.phone ? normalizePhone(r.phone, defaultCountry) : null
    const status = r.lead_status && (LEAD_STATUSES as readonly string[]).includes(r.lead_status) ? (r.lead_status as LeadStatus) : undefined
    const row: ImportRow = { email }
    if (phone) row.phone = phone
    if (r.first_name) row.first_name = r.first_name.slice(0, 200)
    if (r.last_name) row.last_name = r.last_name.slice(0, 200)
    if (r.company) row.company = r.company.slice(0, 200)
    if (status) row.lead_status = status
    if (r.tags?.length) row.tags = splitTags(r.tags.join(';'))
    if (r.owner_email) row.owner_email = r.owner_email.trim().toLowerCase()
    if (r.custom && Object.keys(r.custom).length) row.custom = r.custom
    return row
  })
  return { ok: true, rows: out }
}
