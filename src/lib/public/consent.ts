import 'server-only'
import type { Json } from '@/types/db-helpers'

/**
 * in_form consent mode (00 R7): pixels load only after a consent block with
 * gates_tracking: true is checked. A survey without such a block never
 * loads pixels in that mode, so the page does not even send them.
 */
export function hasTrackingGate(definition: Json): boolean {
  const qs = (definition as { questions?: Record<string, { type?: unknown; settings?: { gates_tracking?: unknown } }> } | null)?.questions
  if (!qs || typeof qs !== 'object') return false
  return Object.values(qs).some((q) => q?.type === 'consent' && q.settings?.gates_tracking === true)
}

export function definitionExclusions(definition: Json): string[] {
  const ex = (definition as { pixel_exclusions?: unknown } | null)?.pixel_exclusions
  return Array.isArray(ex) ? ex.filter((x): x is string => typeof x === 'string') : []
}
