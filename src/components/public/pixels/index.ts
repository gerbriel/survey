/** Tracking pixels for the public host only (R15). The dashboard may never import this folder (ESLint). */
export { Pixels } from './Pixels'
export { firePixelEvent, setTrackingConsent, PIXEL_FLUSH_MS } from './track'
export {
  allowScriptAttrs,
  consentStorageKey,
  initialConsent,
  parseCustomScript,
  pixelEventPlan,
  selectPixels,
  type ConsentStart,
  type CustomScriptPart,
  type HostKind,
  type PixelConsentMode,
  type PixelEventContext,
  type PixelEventKind,
  type PixelEventPlan,
  type PixelRow,
  type ResolvedPixel,
  type StoredConsent,
} from './policy'
