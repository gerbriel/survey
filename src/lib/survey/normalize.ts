/**
 * Answer normalization (doc 03 section 3 step 1). Turns a raw client value
 * into the storage-shaped AnswerValue, or reports that the shape is wrong.
 * Bounds and formats are the validator's job; this only coerces types.
 */

import type { AddressValue, AnswerValue, FileRef, Question } from './types'
import { ADDRESS_PARTS } from './types'

export type Normalized = { kind: 'value'; value: AnswerValue } | { kind: 'empty' } | { kind: 'invalid' }

const EMPTY: Normalized = { kind: 'empty' }
const INVALID: Normalized = { kind: 'invalid' }

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function bool01(v: unknown): 0 | 1 | null {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1
  if (v === false || v === 0 || v === '0' || v === 'false') return 0
  return null
}

export function isFileRef(v: unknown): v is FileRef {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return typeof f.path === 'string' && typeof f.name === 'string' && typeof f.size === 'number' && typeof f.mime === 'string'
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null
  return v as string[]
}

/**
 * Best effort E.164. Decision: only NANP numbers (default_country US or CA, 10
 * digits) get a country code added; other countries must be typed with `+`.
 */
export function toE164(raw: string, defaultCountry: string): string {
  const cleaned = raw.replace(/[\s().-]/g, '')
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2)
  const nanp = defaultCountry === 'US' || defaultCountry === 'CA'
  if (nanp && /^\d{10}$/.test(cleaned)) return '+1' + cleaned
  if (nanp && /^1\d{10}$/.test(cleaned)) return '+' + cleaned
  return cleaned
}

/** Email answers: a string, or `{ email, confirm }` when the confirm-entry field is on. */
export function emailParts(v: unknown): { email: string; confirm?: string } | null {
  if (typeof v === 'string') return { email: v.trim().toLowerCase() }
  if (v && typeof v === 'object' && typeof (v as { email?: unknown }).email === 'string') {
    const o = v as { email: string; confirm?: unknown }
    return {
      email: o.email.trim().toLowerCase(),
      ...(typeof o.confirm === 'string' ? { confirm: o.confirm.trim().toLowerCase() } : {}),
    }
  }
  return null
}

export function normalizeAnswer(q: Question, raw: unknown): Normalized {
  if (raw === undefined || raw === null) return EMPTY
  switch (q.type) {
    case 'statement':
    case 'image':
    case 'calculated':
      return EMPTY
    case 'short_text':
    case 'long_text':
    case 'hidden':
    case 'time': {
      const s = str(raw)
      if (s === null) return INVALID
      return s === '' ? EMPTY : { kind: 'value', value: s }
    }
    case 'email': {
      const p = emailParts(raw)
      if (!p) return INVALID
      return p.email === '' ? EMPTY : { kind: 'value', value: p.email }
    }
    case 'phone': {
      const s = str(raw)
      if (s === null) return INVALID
      return s === '' ? EMPTY : { kind: 'value', value: toE164(s, q.settings.default_country) }
    }
    case 'date': {
      if (typeof raw !== 'string') return INVALID
      const s = raw.trim()
      return s === '' ? EMPTY : { kind: 'value', value: s }
    }
    case 'number':
    case 'rating':
    case 'nps': {
      if (raw === '') return EMPTY
      const n = num(raw)
      return n === null ? INVALID : { kind: 'value', value: n }
    }
    case 'yes_no':
    case 'consent': {
      const b = bool01(raw)
      return b === null ? INVALID : { kind: 'value', value: b }
    }
    case 'single_choice':
    case 'dropdown': {
      if (typeof raw === 'string') return raw === '' ? EMPTY : { kind: 'value', value: raw }
      if (typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string') {
        const o = raw as { id: string; other?: unknown }
        const other = typeof o.other === 'string' ? o.other.trim() : ''
        return { kind: 'value', value: other ? { id: o.id, other } : o.id }
      }
      return INVALID
    }
    case 'multiple_choice': {
      const arr = stringArray(raw)
      if (arr) return arr.length === 0 ? EMPTY : { kind: 'value', value: arr }
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as { ids?: unknown; other?: unknown }
        const ids = stringArray(o.ids)
        if (!ids) return INVALID
        if (ids.length === 0) return EMPTY
        const other = typeof o.other === 'string' ? o.other.trim() : ''
        return { kind: 'value', value: other ? { ids, other } : ids }
      }
      return INVALID
    }
    case 'ranking': {
      const arr = stringArray(raw)
      if (!arr) return INVALID
      return arr.length === 0 ? EMPTY : { kind: 'value', value: arr }
    }
    case 'matrix': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return INVALID
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (v === null || v === undefined || v === '') continue
        if (typeof v !== 'string') return INVALID
        out[k] = v
      }
      return Object.keys(out).length === 0 ? EMPTY : { kind: 'value', value: out }
    }
    case 'file_upload': {
      if (!Array.isArray(raw) || !raw.every(isFileRef)) return INVALID
      return raw.length === 0 ? EMPTY : { kind: 'value', value: raw.map((f) => ({ path: f.path, name: f.name, size: f.size, mime: f.mime })) }
    }
    case 'signature': {
      if (!isFileRef(raw)) return INVALID
      return { kind: 'value', value: { path: raw.path, name: raw.name, size: raw.size, mime: raw.mime } }
    }
    case 'address': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return INVALID
      const out: AddressValue = {}
      for (const part of ADDRESS_PARTS) {
        const v = (raw as Record<string, unknown>)[part]
        if (v === undefined || v === null) continue
        if (typeof v !== 'string') return INVALID
        if (v.trim() !== '') out[part] = v.trim()
      }
      return Object.keys(out).length === 0 ? EMPTY : { kind: 'value', value: out }
    }
  }
}

/** The option id(s) a choice answer holds, in answer order. */
export function choiceIds(v: AnswerValue | undefined): string[] {
  if (v === undefined) return []
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'object') {
    if ('ids' in v && Array.isArray(v.ids)) return v.ids as string[]
    if ('id' in v && typeof v.id === 'string' && !('path' in v)) return [v.id]
  }
  return []
}

export function otherText(v: AnswerValue | undefined): string | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'other' in v && typeof v.other === 'string') return v.other
  return undefined
}
