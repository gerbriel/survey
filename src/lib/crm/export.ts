import 'server-only'
import type { UserClient } from '@/lib/supabase/types'
import { searchContacts, type ContactFilters } from '@/lib/db/contacts'
import { BOM, csvLine } from './csv'
import { chunk } from './import'
import { listContactsByIds, type Contact, type FieldDef, type MemberLite } from './data/contacts'

/**
 * Contact CSV export (doc 04 section 1.6), streamed page by page through
 * search_contacts under RLS so memory stays flat.
 *
 * Decision: the owner column holds the member's display name. Member emails
 * live in auth.users, which a member client cannot read.
 *
 * TODO(foundation): doc 04 section 6 requires an activity_log row per export
 * (actor, scope, filter, row count). activity_log has no insert policy and
 * write_activity is not granted to authenticated, so nothing reachable under
 * RLS can log it yet. See the Foundation change request in the 2D report.
 */
export const MAX_EXPORT_ROWS = 50_000

export function exportHeader(defs: FieldDef[]): string[] {
  return [
    'id',
    'email',
    'first_name',
    'last_name',
    'phone',
    'company',
    'lead_status',
    'owner',
    'tags',
    'source',
    'follow_up_at',
    'follow_up_note',
    'response_count',
    'last_response_at',
    'created_at',
    'updated_at',
    ...defs.map((d) => `custom.${d.key}`),
  ]
}

export function exportRow(c: Contact, defs: FieldDef[], members: MemberLite[]): unknown[] {
  const custom = (c.custom ?? {}) as Record<string, unknown>
  return [
    c.id,
    c.email,
    c.first_name,
    c.last_name,
    c.phone,
    c.company,
    c.lead_status,
    c.owner_id ? (members.find((m) => m.user_id === c.owner_id)?.display_name ?? '') : '',
    c.tags.join(';'),
    c.source,
    c.follow_up_at,
    c.follow_up_note,
    c.response_count,
    c.last_response_at,
    c.created_at,
    c.updated_at,
    ...defs.map((d) => {
      const v = custom[d.key]
      if (v === undefined || v === null) return ''
      return Array.isArray(v) ? v.join(';') : typeof v === 'object' ? JSON.stringify(v) : v
    }),
  ]
}

export function contactsCsvStream(
  client: UserClient,
  input: { workspaceId: string; filters: ContactFilters; ids?: string[]; defs: FieldDef[]; members: MemberLite[] },
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(BOM + csvLine(exportHeader(input.defs))))
      try {
        if (input.ids?.length) {
          for (const part of chunk(input.ids.slice(0, MAX_EXPORT_ROWS), 500)) {
            const r = await listContactsByIds(client, { workspaceId: input.workspaceId, ids: part })
            if (!r.ok) throw new Error(r.error.message)
            const live = r.data.filter((c) => c.status === 'active' && !c.merged_into)
            controller.enqueue(enc.encode(live.map((c) => csvLine(exportRow(c, input.defs, input.members))).join('')))
          }
        } else {
          let cursor: { updated_at: string; id: string } | null = null
          let total = 0
          while (total < MAX_EXPORT_ROWS) {
            const r = await searchContacts(client, { workspaceId: input.workspaceId, filters: input.filters, cursor, limit: 200 })
            if (!r.ok) throw new Error(r.error.message)
            if (r.data.length === 0) break
            controller.enqueue(enc.encode(r.data.map((c) => csvLine(exportRow(c, input.defs, input.members))).join('')))
            total += r.data.length
            const last = r.data[r.data.length - 1]!
            cursor = { updated_at: last.updated_at, id: last.id }
            if (r.data.length < 200) break
          }
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
}
