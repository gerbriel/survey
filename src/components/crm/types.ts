import type { Contact, FieldDef, MemberLite } from '@/lib/crm/data/contacts'

export type { Contact, FieldDef, MemberLite }

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string }

export const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  customer: 'Customer',
  lost: 'Lost',
}

export function displayName(c: Pick<Contact, 'first_name' | 'last_name' | 'email'>): string {
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  return n || c.email || 'Unnamed contact'
}

export function memberName(members: MemberLite[], id: string | null | undefined): string {
  if (!id) return 'Unassigned'
  return members.find((m) => m.user_id === id)?.display_name ?? 'Former member'
}

/** Text for a custom field value in tables and exports. */
export function customText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.join('; ')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

export function fieldOptions(def: Pick<FieldDef, 'options'>): string[] {
  const o = def.options
  if (!Array.isArray(o)) return []
  return o.map((x) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const r = x as { value?: unknown; id?: unknown; label?: unknown }
      return String(r.value ?? r.id ?? r.label ?? '')
    }
    return String(x)
  })
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
