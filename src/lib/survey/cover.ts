/**
 * Cover (survey header) image helpers (doc 03 section 8.1). Pure and
 * framework free: used by migrateDefinition, the renderer, the builder and
 * the OG card.
 */

import { starterHeaderDataUri, starterHeaderPath } from '../images/starters'
import type { CoverImage, CoverSource } from './types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPath = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 500
const isImageId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

function normalizeSource(v: unknown): CoverSource | null {
  if (!isObj(v)) return null
  if (v.kind === 'starter') return typeof v.id === 'string' && starterHeaderPath(v.id) ? { kind: 'starter', id: v.id } : null
  if (v.kind === 'workspace') return isImageId(v.image_id) && isPath(v.path) ? { kind: 'workspace', image_id: v.image_id, path: v.path } : null
  if (v.kind === 'upload') return isPath(v.path) ? { kind: 'upload', path: v.path } : null
  return null
}

/**
 * Reads either cover shape and returns the current one, or null when it is
 * not readable. The pre-library shape `{ path, height, focal_y }` becomes
 * `{ source: { kind: 'upload', path }, ... }`. A `source` wins over a stray
 * legacy `path` (a theme merge can leave both). Unknown starter ids and
 * malformed sources are null.
 */
export function normalizeCover(v: unknown): CoverImage | null {
  if (!isObj(v)) return null
  const source = v.source !== undefined ? normalizeSource(v.source) : isPath(v.path) ? ({ kind: 'upload', path: v.path } as const) : null
  if (!source) return null
  const focal = typeof v.focal_y === 'number' && Number.isFinite(v.focal_y) ? Math.min(1, Math.max(0, v.focal_y)) : 0.5
  return { source, height: v.height === 'tall' ? 'tall' : 'short', focal_y: focal }
}

/**
 * Image URL for a cover. Starters resolve to the app's own /headers path
 * (same origin on either host); library and upload paths go through
 * `resolveAsset`, which must build a public-assets URL (publicAssetUrl), so a
 * cover can never point a respondent's browser anywhere else.
 */
export function coverSrc(cover: unknown, resolveAsset?: (path: string) => string | null): string | null {
  const c = normalizeCover(cover)
  if (!c) return null
  if (c.source.kind === 'starter') return starterHeaderPath(c.source.id)
  return resolveAsset?.(c.source.path) ?? null
}

/**
 * Image source for the generated OG card (next/og). Same rules as coverSrc,
 * except a starter is embedded as a data URI: the card renders server side
 * and cannot rely on fetching its own host in every environment.
 */
export function coverOgSrc(cover: unknown, resolveAsset: (path: string) => string | null): string | null {
  const c = normalizeCover(cover)
  if (!c) return null
  if (c.source.kind === 'starter') return starterHeaderDataUri(c.source.id)
  return resolveAsset(c.source.path)
}
