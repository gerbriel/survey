import 'server-only'
import type { PublicSurvey } from '@/lib/db/publicRead'
import { getHostKind } from '@/lib/request-context'
import type { Json } from '@/types/db-helpers'
import { selectPixels, type PixelConsentMode, type ResolvedPixel } from '@/components/public/pixels/policy'
import { definitionExclusions, hasTrackingGate } from './consent'
import type { SurveyContext } from './load'

/**
 * Server half of pixel injection (doc 02 section 7): which pixels this
 * response may load. Public host only, exclusions applied, the raw script
 * kill switch from effective_limits, and in_form without a gating consent
 * block means none.
 */
export async function pixelsFor(
  survey: PublicSurvey,
  definition: Json,
  ctx: SurveyContext | null,
): Promise<{ pixels: ResolvedPixel[]; mode: PixelConsentMode }> {
  const mode = survey.pixel_consent_mode as PixelConsentMode
  const pixels = selectPixels(survey.pixels, {
    hostKind: await getHostKind(),
    excludedIds: definitionExclusions(definition),
    // SQL already omits gtm and custom_script under the kill switch; this is the second check.
    // S3 (R16): fails closed when the limits cannot be read.
    rawScriptAllowed: ctx?.limits.raw_script_pixels_allowed === true,
  })
  if (mode === 'in_form' && !hasTrackingGate(definition)) return { pixels: [], mode }
  return { pixels, mode }
}
