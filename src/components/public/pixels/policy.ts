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

export type CustomScriptPart = { kind: 'script'; src?: string; inline?: string; async?: boolean; defer?: boolean }

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

/**
 * custom_script parsed form. Decision: Phase 2A's pixel editor stores
 * `{ parts: [{ kind: 'script', src?, inline?, async?, defer? } | { kind: 'noscript', html }] }`
 * (a bare array is accepted too). Only https src scripts and inline bodies up
 * to 10,000 chars are kept; noscript parts are skipped because they only
 * matter when scripts are off, and raw HTML is never injected.
 */
export function parseCustomScript(parsed: unknown): CustomScriptPart[] {
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { parts?: unknown }).parts : null
  if (!Array.isArray(list)) return []
  const out: CustomScriptPart[] = []
  for (const p of list.slice(0, 20)) {
    if (!p || typeof p !== 'object') continue
    const part = p as Record<string, unknown>
    if (part.kind !== 'script') continue
    const src = typeof part.src === 'string' ? part.src : undefined
    const inline = typeof part.inline === 'string' ? part.inline : undefined
    if (src) {
      try {
        if (new URL(src).protocol !== 'https:') continue
      } catch {
        continue
      }
      out.push({ kind: 'script', src, async: part.async === true, defer: part.defer === true })
    } else if (inline && inline.trim() && inline.length <= 10_000) {
      out.push({ kind: 'script', inline })
    }
  }
  return out
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
