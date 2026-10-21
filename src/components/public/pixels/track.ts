'use client'

import type { PixelEventPlan, ResolvedPixel } from './policy'

/**
 * Client dispatch of a planned pixel event to the loaded tags. Every call
 * is guarded: a blocked or missing tag never throws into the survey.
 */

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    fbq?: (...args: unknown[]) => void
  }
}

const GRANTED = { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' }
const DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }

/** Completion waits for pixel callbacks or this long, whichever is first (doc 02 section 7.3). */
export const PIXEL_FLUSH_MS = 500

export function firePixelEvent(plan: PixelEventPlan, pixels: ResolvedPixel[], waitMs = 0): Promise<void> {
  const types = new Set(pixels.map((p) => p.type))
  const waits: Promise<void>[] = []
  const w = window
  try {
    if (plan.ga4 && types.has('ga4') && typeof w.gtag === 'function') {
      if (waitMs > 0) {
        waits.push(
          new Promise((resolve) => w.gtag?.('event', plan.ga4!.name, { ...plan.ga4!.params, event_callback: () => resolve(), event_timeout: waitMs })),
        )
      } else {
        w.gtag('event', plan.ga4.name, plan.ga4.params)
      }
    }
    if (plan.meta && types.has('meta') && typeof w.fbq === 'function') {
      w.fbq(plan.meta.method, plan.meta.name, plan.meta.params)
    }
    if (plan.gtm && types.has('gtm')) {
      w.dataLayer = Array.isArray(w.dataLayer) ? w.dataLayer : []
      if (waitMs > 0) {
        waits.push(new Promise((resolve) => w.dataLayer?.push({ ...plan.gtm, eventCallback: () => resolve(), eventTimeout: waitMs })))
      } else {
        w.dataLayer.push({ ...plan.gtm })
      }
    }
    if (types.has('custom_script')) {
      w.dispatchEvent(new CustomEvent(plan.custom.name, { detail: { ...plan.custom.detail } }))
    }
  } catch {
    // A vendor tag must never break the survey.
  }
  if (waitMs <= 0 || waits.length === 0) return Promise.resolve()
  return Promise.race([Promise.all(waits).then(() => undefined), new Promise<void>((r) => setTimeout(r, waitMs))])
}

/** Google Consent Mode v2 update plus Meta consent, for withdrawal and re-grant. */
export function setTrackingConsent(granted: boolean): void {
  try {
    window.gtag?.('consent', 'update', granted ? GRANTED : DENIED)
    window.fbq?.('consent', granted ? 'grant' : 'revoke')
  } catch {
    // ignore
  }
}
