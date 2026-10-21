/**
 * Tracking pixel rules (doc 02 section 7, doc 05 section 5.4). Pure, unit
 * tested, shared by the pixel form (client) and the server action.
 *
 * `custom_script` is parsed once at save into `workspace_pixels.parsed`.
 * CONTRACT FOR PHASE 2C (<CustomScript>): `parsed` is a ParsedCustomScript,
 *   { version: 1, parts: [
 *       { kind: 'script', src: 'https://...' | null, code: string | null, attrs: { async?: true, defer?: true, type?: string, id?: string, crossorigin?: string, referrerpolicy?: string, 'data-*'?: string } },
 *       { kind: 'noscript', html: string },
 *   ] }
 * in source order. `src` is always https. `code` is the inline body (null
 * when `src` is set). `attrs` never holds src, nonce or on* handlers.
 */

export const PIXEL_TYPES = ['ga4', 'meta', 'gtm', 'custom_script'] as const
export type PixelType = (typeof PIXEL_TYPES)[number]

export const PIXEL_TYPE_LABELS: Record<PixelType, string> = {
  ga4: 'Google Analytics 4',
  meta: 'Meta Pixel',
  gtm: 'Google Tag Manager',
  custom_script: 'Custom script',
}

/** Same patterns as the workspace_pixels check constraint (migration 0010). */
export const PIXEL_VALUE_PATTERNS: Record<Exclude<PixelType, 'custom_script'>, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,12}$/,
  meta: /^[0-9]{8,20}$/,
  gtm: /^GTM-[A-Z0-9]{4,10}$/,
}

export const PIXEL_VALUE_HINTS: Record<PixelType, string> = {
  ga4: 'Measurement ID, for example G-ABC123DEF4.',
  meta: 'Pixel ID, 8 to 20 digits.',
  gtm: 'Container ID, for example GTM-ABC1234.',
  custom_script: 'Only <script> and <noscript> elements. Up to 10,000 characters.',
}

export const CUSTOM_SCRIPT_MAX = 10_000

/** GTM and custom scripts can load arbitrary code; the raw script kill switch covers both (migration 0010). */
export function isRawScriptType(type: PixelType): boolean {
  return type === 'gtm' || type === 'custom_script'
}

/** S3 (R16): shown on the pixel type picker for gtm and custom_script. */
export const RAW_SCRIPT_WARNING =
  'This code runs on every public survey in this workspace with full access to the page, including what respondents type. All workspaces share the public survey address, so it also runs next to other workspaces\' surveys a respondent has open in the same browser and can call their public endpoints. Only paste code from a vendor you trust.'

/** S3 (R16): shown with the raw_script_pixels_allowed toggle on the platform admin limits page. */
export const RAW_SCRIPT_EXPOSURE =
  'Turning this on lets the workspace load Google Tag Manager containers and custom scripts on its public surveys. That code can run anything. Every workspace shares one public survey address, so a script added here runs on the same origin as every other workspace\'s public surveys: in a browser that has another workspace\'s survey open or partly answered, it can read that page\'s browser storage, such as resume links and consent choices, and call that survey\'s public endpoints. Turn it on only for a workspace whose admins you trust with that access. Separate public addresses per workspace are planned for v2.'

/** S3 (R16): kill switch state for the pixel type picker. */
export function rawScriptStateText(rawAllowed: boolean): string {
  return rawAllowed
    ? 'Script pixels (Google Tag Manager and custom scripts) are turned on for this workspace by a platform admin.'
    : 'Script pixels (Google Tag Manager and custom scripts) are turned off for this workspace. Only a platform admin can turn them on.'
}

export type ScriptPart = {
  kind: 'script'
  src: string | null
  code: string | null
  attrs: Record<string, string | true>
}
export type NoscriptPart = { kind: 'noscript'; html: string }
export type ParsedCustomScript = { version: 1; parts: Array<ScriptPart | NoscriptPart> }

export type ParseResult = { ok: true; parsed: ParsedCustomScript } | { ok: false; message: string }

const ALLOWED_SCRIPT_TYPES = new Set(['text/javascript', 'application/javascript', 'module'])
const ALLOWED_ATTRS = new Set(['src', 'async', 'defer', 'type', 'id', 'crossorigin', 'referrerpolicy', 'charset'])

/** Parses `name="v" name='v' name=v name` attribute lists. Null when malformed. */
export function parseAttributes(input: string): Record<string, string | true> | null {
  const attrs: Record<string, string | true> = {}
  const re = /\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?\s*/y
  const text = input.trim()
  let pos = 0
  while (pos < text.length) {
    re.lastIndex = pos
    const m = re.exec(text)
    if (!m || m[0].length === 0) return null
    const name = (m[1] ?? '').toLowerCase()
    const value = m[2] ?? m[3] ?? m[4]
    attrs[name] = value === undefined ? true : value
    pos = re.lastIndex
  }
  return attrs
}

function checkScriptAttrs(raw: Record<string, string | true>): { ok: true; src: string | null; attrs: Record<string, string | true> } | { ok: false; message: string } {
  const attrs: Record<string, string | true> = {}
  let src: string | null = null
  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith('on')) return { ok: false, message: 'Event handler attributes are not allowed.' }
    if (name === 'nonce') return { ok: false, message: 'Remove the nonce attribute. The page adds its own.' }
    if (!ALLOWED_ATTRS.has(name) && !name.startsWith('data-')) {
      return { ok: false, message: `The script attribute "${name}" is not allowed.` }
    }
    if (name === 'src') {
      if (typeof value !== 'string' || !/^https:\/\/[^\s]+$/i.test(value)) {
        return { ok: false, message: 'Script src must be an https:// address.' }
      }
      src = value
      continue
    }
    if (name === 'type' && (typeof value !== 'string' || !ALLOWED_SCRIPT_TYPES.has(value.toLowerCase()))) {
      return { ok: false, message: 'Only JavaScript script types are allowed.' }
    }
    attrs[name] = value
  }
  return { ok: true, src, attrs }
}

/**
 * Accepts only <script> (inline or src) and <noscript> elements, plus
 * whitespace and HTML comments between them. Anything else is rejected
 * (doc 02 section 7).
 */
export function parseCustomScript(value: string): ParseResult {
  const input = value.trim()
  if (!input) return { ok: false, message: 'Paste the script.' }
  if (value.length > CUSTOM_SCRIPT_MAX) return { ok: false, message: 'The script is longer than 10,000 characters.' }
  const parts: ParsedCustomScript['parts'] = []
  let i = 0
  const lower = input.toLowerCase()
  while (i < input.length) {
    const ch = input[i] ?? ''
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4)
      if (end === -1) return { ok: false, message: 'An HTML comment is not closed.' }
      i = end + 3
      continue
    }
    const open = /^<(script|noscript)(\s[^>]*)?>/i.exec(input.slice(i))
    if (!open) return { ok: false, message: 'Only <script> and <noscript> elements are allowed.' }
    const tag = (open[1] ?? '').toLowerCase()
    const attrText = (open[2] ?? '').replace(/\/\s*$/, '')
    const bodyStart = i + open[0].length
    const close = lower.indexOf(`</${tag}`, bodyStart)
    if (close === -1) return { ok: false, message: `A <${tag}> element is not closed.` }
    const closeEnd = input.indexOf('>', close)
    if (closeEnd === -1) return { ok: false, message: `A <${tag}> element is not closed.` }
    const body = input.slice(bodyStart, close)
    if (tag === 'script') {
      const raw = parseAttributes(attrText)
      if (!raw) return { ok: false, message: 'A script tag has malformed attributes.' }
      const checked = checkScriptAttrs(raw)
      if (!checked.ok) return checked
      if (checked.src && body.trim()) return { ok: false, message: 'A script with src must be empty.' }
      if (!checked.src && !body.trim()) return { ok: false, message: 'A script is empty.' }
      parts.push({ kind: 'script', src: checked.src, code: checked.src ? null : body, attrs: checked.attrs })
    } else {
      if (attrText.trim()) return { ok: false, message: 'The noscript tag cannot have attributes.' }
      if (/<\s*script/i.test(body)) return { ok: false, message: 'A noscript element cannot contain a script.' }
      parts.push({ kind: 'noscript', html: body })
    }
    i = closeEnd + 1
  }
  if (!parts.some((p) => p.kind === 'script')) return { ok: false, message: 'Add at least one <script> element.' }
  return { ok: true, parsed: { version: 1, parts } }
}

/** Validates a pixel value for its type. Returns an error message or null. */
export function pixelValueError(type: PixelType, value: string): string | null {
  if (type === 'custom_script') {
    const r = parseCustomScript(value)
    return r.ok ? null : r.message
  }
  return PIXEL_VALUE_PATTERNS[type].test(value) ? null : `That does not look like a valid ${PIXEL_TYPE_LABELS[type]} ID. ${PIXEL_VALUE_HINTS[type]}`
}
