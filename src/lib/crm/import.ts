import { normalizeEmail, splitTags } from './email'
import { normalizePhone } from './phone'

/**
 * Import mapping and dedupe (doc 04 section 1.5). Pure, so the wizard
 * previews with exactly the rules the server applies before each chunk.
 */

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'customer', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type FieldDefLite = { key: string; label: string; type: string; options?: unknown; archived?: boolean }

export const CORE_TARGETS = [
  'email',
  'phone',
  'first_name',
  'last_name',
  'company',
  'lead_status',
  'tags',
  'owner_email',
] as const
export type CoreTarget = (typeof CORE_TARGETS)[number]
/** 'ignore', a core target, or `custom:<key>`. */
export type MappingTarget = 'ignore' | CoreTarget | `custom:${string}`
export type Mapping = MappingTarget[]

export const TARGET_LABELS: Record<CoreTarget, string> = {
  email: 'Email',
  phone: 'Phone',
  first_name: 'First name',
  last_name: 'Last name',
  company: 'Company',
  lead_status: 'Lead status',
  tags: 'Tags',
  owner_email: 'Owner (member email)',
}

const SYNONYMS: Record<CoreTarget, string[]> = {
  email: ['email', 'emailaddress', 'mail', 'e-mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'cell', 'telephone', 'tel'],
  first_name: ['firstname', 'first', 'givenname', 'fname'],
  last_name: ['lastname', 'last', 'surname', 'familyname', 'lname'],
  company: ['company', 'organization', 'organisation', 'org', 'companyname', 'business'],
  lead_status: ['leadstatus', 'status', 'stage'],
  tags: ['tags', 'tag', 'labels'],
  owner_email: ['owner', 'owneremail', 'assignedto'],
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Auto-map headers to targets. Each target is used at most once. */
export function autoMap(headers: string[], defs: FieldDefLite[] = []): Mapping {
  const used = new Set<string>()
  return headers.map((h): MappingTarget => {
    const k = key(h)
    for (const t of CORE_TARGETS) {
      if (!used.has(t) && SYNONYMS[t].map(key).includes(k)) {
        used.add(t)
        return t
      }
    }
    const def = defs.find((d) => !d.archived && (key(d.key) === k || key(d.label) === k))
    if (def && !used.has(`custom:${def.key}`)) {
      used.add(`custom:${def.key}`)
      return `custom:${def.key}`
    }
    return 'ignore'
  })
}

export type ImportRow = {
  email: string
  phone?: string
  first_name?: string
  last_name?: string
  company?: string
  lead_status?: LeadStatus
  tags?: string[]
  owner_email?: string
  custom?: Record<string, unknown>
}

export type MappedRow = { line: number; row: ImportRow; warnings: string[] }
export type InvalidRow = { line: number; error: string; values: string[] }

function optionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options.map((o) => {
    if (typeof o === 'string') return o
    if (o && typeof o === 'object') {
      const r = o as { value?: unknown; id?: unknown }
      return String(r.value ?? r.id ?? '')
    }
    return String(o)
  })
}

/** Convert one cell to a custom field value, or throw a readable error. */
export function customValue(def: FieldDefLite, raw: string): unknown {
  const s = raw.trim()
  switch (def.type) {
    case 'number': {
      const n = Number(s.replace(/,/g, ''))
      if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number`)
      return n
    }
    case 'boolean': {
      const l = s.toLowerCase()
      if (['true', 'yes', 'y', '1'].includes(l)) return true
      if (['false', 'no', 'n', '0'].includes(l)) return false
      throw new Error(`${def.label} must be yes or no`)
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
        throw new Error(`${def.label} must be a date like 2026-10-21`)
      return s
    }
    case 'url':
      if (!/^https?:\/\//i.test(s)) throw new Error(`${def.label} must start with http:// or https://`)
      return s
    case 'select': {
      const opts = optionValues(def.options)
      const hit = opts.find((o) => o.toLowerCase() === s.toLowerCase())
      if (!hit) throw new Error(`${def.label} must be one of: ${opts.join(', ')}`)
      return hit
    }
    case 'multiselect': {
      const opts = optionValues(def.options)
      return s
        .split(/[;,]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const hit = opts.find((o) => o.toLowerCase() === x.toLowerCase())
          if (!hit) throw new Error(`${def.label}: ${x} is not an option`)
          return hit
        })
    }
    default:
      return s.slice(0, 1000)
  }
}

export function mapRow(
  values: string[],
  mapping: Mapping,
  opts: { defaultCountry: string; defs: FieldDefLite[] },
): { row: ImportRow; warnings: string[] } {
  const row: Partial<ImportRow> = {}
  const warnings: string[] = []
  const custom: Record<string, unknown> = {}
  mapping.forEach((target, i) => {
    const raw = values[i] ?? ''
    if (target === 'ignore' || raw.trim() === '') return
    if (target.startsWith('custom:')) {
      const k = target.slice(7)
      const def = opts.defs.find((d) => d.key === k)
      if (!def) throw new Error(`Unknown custom field ${k}`)
      custom[k] = customValue(def, raw)
      return
    }
    switch (target as CoreTarget) {
      case 'email': {
        const e = normalizeEmail(raw)
        if (!e) throw new Error('Invalid email')
        row.email = e
        break
      }
      case 'phone': {
        const p = normalizePhone(raw, opts.defaultCountry)
        if (p) row.phone = p
        else warnings.push(`Phone ${raw.trim()} could not be read and was left out`)
        break
      }
      case 'lead_status': {
        const s = raw.trim().toLowerCase() as LeadStatus
        if (!LEAD_STATUSES.includes(s)) throw new Error(`Lead status must be one of: ${LEAD_STATUSES.join(', ')}`)
        row.lead_status = s
        break
      }
      case 'tags':
        row.tags = [...new Set([...(row.tags ?? []), ...splitTags(raw)])]
        break
      case 'owner_email':
        row.owner_email = raw.trim().toLowerCase()
        break
      default:
        row[target as 'first_name' | 'last_name' | 'company'] = raw.trim()
    }
  })
  if (!row.email) throw new Error('Missing email')
  if (Object.keys(custom).length) row.custom = custom
  return { row: row as ImportRow, warnings }
}

/**
 * Map every row, then collapse in-file duplicates on normalized email to the
 * first row (doc 04 section 1.5 step 3). Line numbers are 1-based file lines,
 * counting the header as line 1.
 */
export function mapRows(
  rows: string[][],
  mapping: Mapping,
  opts: { defaultCountry: string; defs: FieldDefLite[] },
): { valid: MappedRow[]; invalid: InvalidRow[]; duplicates: number } {
  const valid: MappedRow[] = []
  const invalid: InvalidRow[] = []
  const seen = new Set<string>()
  let duplicates = 0
  rows.forEach((values, i) => {
    const line = i + 2
    try {
      const { row, warnings } = mapRow(values, mapping, opts)
      if (seen.has(row.email)) {
        duplicates++
        return
      }
      seen.add(row.email)
      valid.push({ line, row, warnings })
    } catch (e) {
      invalid.push({ line, error: e instanceof Error ? e.message : 'Invalid row', values })
    }
  })
  return { valid, invalid, duplicates }
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function suggestedImportTag(today: Date): string {
  return `import-${today.toISOString().slice(0, 10)}`
}
