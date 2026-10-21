/**
 * Pixel selection, consent and event mapping (doc 02 section 7). Pure and
 * client safe so it is unit tested directly. No answer values or identity
 * fields ever reach a pixel: event payloads are built here from the survey
 * id, the survey key and the step number only.
 */

export type PixelConsentMode = 'banner' | 'notice' | 'in_form'
export type HostKind = 'public' | 'dashboard' | 'unknown'

/** One row of resolve_public_survey.pixels. */
export type PixelRow = { id: string; type: string; value: string; parsed?: unknown }

/**
 * One part of a custom_script pixel as rendered. `attrs` holds only allow
 * listed attributes (async, defer, type, id, data-*); src is its own field.
 */
export type CustomScriptPart =
  | { kind: 'script'; src: string | null; code: string | null; attrs: Record<string, string | true> }
  | { kind: 'noscript'; html: string }

export type ResolvedPixel =
  | { id: string; type: 'ga4'; value: string }
  | { id: string; type: 'meta'; value: string }
  | { id: string; type: 'gtm'; value: string }
  | { id: string; type: 'custom_script'; parts: CustomScriptPart[] }

const VALUE_RE = {
  ga4: /^G-[A-Z0-9]{4,12}$/,
  meta: /^[0-9]{8,20}$/,
  gtm: /^GTM-[A-Z0-9]{4,10}$/,
} as const

const SCRIPT_TYPES = new Set(['text/javascript', 'application/javascript', 'module'])
const DATA_ATTR = /^data-[a-z0-9][a-z0-9._:-]{0,63}$/
const MAX_CODE = 10_000

/**
 * Allow list for script attributes: async, defer, type (JavaScript types
 * only), id, and data-*. Event handlers (on*), nonce, src (a field of its
 * own) and every other attribute are dropped. Values are strings up to 500
 * characters, or true for a bare attribute.
 */
export function allowScriptAttrs(raw: unknown): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.toLowerCase()
    if (value !== true && (typeof value !== 'string' || value.length > 500)) continue
    if (name === 'async' || name === 'defer') {
      out[name] = true
    } else if (name === 'type') {
      if (typeof value === 'string' && SCRIPT_TYPES.has(value.toLowerCase())) out.type = value.toLowerCase()
    } else if (name === 'id') {
      if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_:.-]{0,99}$/.test(value)) out.id = value
    } else if (DATA_ATTR.test(name)) {
      out[name] = value
    }
  }
  return out
}

/**
 * Reads workspace_pixels.parsed as the settings page stores it (Phase 2A):
 * `{ version: 1, parts: [{ kind: 'script', src, code, attrs } | { kind: 'noscript', html }] }`
 * in source order. A script keeps an https src or a non-empty inline `code`
 * up to 10,000 characters, never both; attrs go through allowScriptAttrs.
 * noscript parts keep their HTML for rendering inside <noscript> only.
 */
export function parseCustomScript(parsed: unknown): CustomScriptPart[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const doc = parsed as { version?: unknown; parts?: unknown }
  if (doc.version !== 1 || !Array.isArray(doc.parts)) return []
  const out: CustomScriptPart[] = []
  for (const p of doc.parts.slice(0, 20)) {
    if (!p || typeof p !== 'object') continue
    const part = p as Record<string, unknown>
    if (part.kind === 'noscript') {
      if (typeof part.html === 'string' && part.html.trim() && part.html.length <= MAX_CODE) out.push({ kind: 'noscript', html: part.html })
      continue
    }
    if (part.kind !== 'script') continue
    const attrs = allowScriptAttrs(part.attrs)
    if (typeof part.src === 'string' && part.src) {
      try {
        if (new URL(part.src).protocol !== 'https:') continue
      } catch {
        continue
      }
      out.push({ kind: 'script', src: part.src, code: null, attrs })
    } else if (typeof part.code === 'string' && part.code.trim() && part.code.length <= MAX_CODE) {
      out.push({ kind: 'script', src: null, code: part.code, attrs })
    }
  }
  return out.some((x) => x.kind === 'script') ? out : []
}

/**
 * The pixels a public page may load: public host only, enabled pixels from
 * SQL minus the survey's exclusions (resolve_public_survey already applies
 * excluded_pixel_ids; the definition's pixel_exclusions are applied again
 * here), gtm and custom_script only while raw_script_pixels_allowed, values
 * re-checked against the same patterns as the table constraint.
 */
export function selectPixels(
  rows: PixelRow[] | null | undefined,
  opts: { hostKind: HostKind; excludedIds?: readonly string[]; rawScriptAllowed: boolean },
): ResolvedPixel[] {
  if (opts.hostKind !== 'public' || !Array.isArray(rows)) return []
  const excluded = new Set(opts.excludedIds ?? [])
  const seen = new Set<string>()
  const out: ResolvedPixel[] = []
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || excluded.has(r.id) || seen.has(r.id)) continue
    seen.add(r.id)
    switch (r.type) {
      case 'ga4':
      case 'meta':
        if (VALUE_RE[r.type].test(r.value)) out.push({ id: r.id, type: r.type, value: r.value })
        break
      case 'gtm':
        if (opts.rawScriptAllowed && VALUE_RE.gtm.test(r.value)) out.push({ id: r.id, type: 'gtm', value: r.value })
        break
      case 'custom_script': {
        if (!opts.rawScriptAllowed) break
        const parts = parseCustomScript(r.parsed)
        if (parts.length > 0) out.push({ id: r.id, type: 'custom_script', parts })
        break
      }
    }
  }
  return out
}

export type StoredConsent = 'granted' | 'denied' | 'dismissed' | null

export type ConsentStart = {
  /** Which banner to show, if any. */
  banner: 'opt_in' | 'notice' | null
  /** Pixels may load now. */
  granted: boolean
  /** Google Consent Mode v2 default before any update. */
  googleDefault: 'granted' | 'denied'
}

/**
 * Starting consent state per pixel_consent_mode (00 R7, doc 02 section 7.2).
 * No pixels: no UI and nothing loads, in every mode.
 */
export function initialConsent(mode: PixelConsentMode, pixelCount: number, stored: StoredConsent): ConsentStart {
  if (pixelCount === 0) return { banner: null, granted: false, googleDefault: 'denied' }
  switch (mode) {
    case 'notice':
      return { banner: stored === 'dismissed' ? null : 'notice', granted: true, googleDefault: 'granted' }
    case 'in_form':
      // Loads only after a gates_tracking consent block is checked.
      return { banner: null, granted: false, googleDefault: 'denied' }
    case 'banner':
    default:
      if (stored === 'granted') return { banner: null, granted: true, googleDefault: 'denied' }
      if (stored === 'denied') return { banner: null, granted: false, googleDefault: 'denied' }
      return { banner: 'opt_in', granted: false, googleDefault: 'denied' }
  }
}

export const consentStorageKey = (scopeId: string) => `survey:consent:${scopeId}`

export type PixelEventKind = 'view' | 'start' | 'step' | 'complete'

export type PixelEventContext = { surveyId: string; surveyKey: string; step?: number }

export type PixelEventPlan = {
  ga4: { name: string; params: Record<string, string | number> } | null
  meta: { method: 'track' | 'trackCustom'; name: string; params: Record<string, string | number> } | null
  gtm: Record<string, string | number> | null
  custom: { name: string; detail: Record<string, string | number> }
}

/**
 * Doc 02 section 7.3. Every event carries survey_id and survey_key; step
 * adds the 1-based step number. GA4 page_view and Meta PageView fire from
 * the base tags themselves on load.
 */
export function pixelEventPlan(kind: PixelEventKind, ctx: PixelEventContext, metaCompletionEvent = 'Lead'): PixelEventPlan {
  const base: Record<string, string | number> = { survey_id: ctx.surveyId, survey_key: ctx.surveyKey }
  const withStep = kind === 'step' && typeof ctx.step === 'number' ? { ...base, step: ctx.step } : base
  switch (kind) {
    case 'view':
      return { ga4: null, meta: null, gtm: { event: 'survey_view', ...base }, custom: { name: 'survey:view', detail: base } }
    case 'start':
      return {
        ga4: { name: 'survey_start', params: base },
        meta: { method: 'trackCustom', name: 'SurveyStart', params: base },
        gtm: { event: 'survey_start', ...base },
        custom: { name: 'survey:start', detail: base },
      }
    case 'step':
      return {
        ga4: { name: 'survey_step', params: withStep },
        meta: null,
        gtm: { event: 'survey_step', ...withStep },
        custom: { name: 'survey:step', detail: withStep },
      }
    case 'complete':
      return {
        ga4: { name: 'survey_complete', params: base },
        meta: { method: 'track', name: metaCompletionEvent, params: base },
        gtm: { event: 'survey_complete', ...base },
        custom: { name: 'survey:complete', detail: base },
      }
  }
}
