/** Email rules shared by import and inline edit (doc 04 section 2.2). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return EMAIL_RE.test(e) ? e : null
}

/** Tags: lowercased, trimmed, max 40 chars, split on ; or , (doc 04 section 1.4). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40)
}

export function splitTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of raw.split(/[;,]/)) {
    const t = normalizeTag(part)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}
