/**
 * Builder defaults and load-time normalization (doc 03 sections 2 and 8).
 * Pure, safe in the browser and on the server.
 */

import { safeMigrateDefinition, type SafeFont, type SurveyDefinition, type Theme } from '@/lib/survey'

export const SAFE_FONTS: readonly SafeFont[] = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Source Serif 4',
  'Merriweather',
  'Poppins',
  'Work Sans',
  'IBM Plex Sans',
  'system-ui',
]

/** Decision: the fallback theme when neither the workspace default nor the template carries one. */
export const DEFAULT_THEME: Theme = {
  colors: {
    primary: '#2563eb',
    text: '#111827',
    muted_text: '#4b5563',
    background: '#f3f4f6',
    surface: '#ffffff',
    error: '#b91c1c',
  },
  font: { heading: 'Inter', body: 'Inter', base_size: 'md' },
  logo: { source: 'workspace', position: 'left', size: 'md' },
  background: { kind: 'color' },
  button_text: { next: 'Next', back: 'Back', submit: 'Submit' },
  progress: { style: 'bar', position: 'top' },
  corner_radius: 'md',
  layout: 'card',
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep merge of plain objects; arrays and scalars from `over` win. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T))
  const out: Obj = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === null) continue
    out[k] = isObj(out[k]) && isObj(v) ? merge(out[k], v) : v
  }
  return out as T
}

/**
 * A theme with every required key. create_survey copies the workspace
 * default_theme, which may be `{}` until 2A's settings page saves one, and
 * system templates ship `{}`.
 */
export function fillTheme(theme: unknown, base: Theme = DEFAULT_THEME): Theme {
  const t = merge(base, isObj(theme) ? theme : {})
  if (!SAFE_FONTS.includes(t.font.heading)) t.font = { ...t.font, heading: base.font.heading }
  if (!SAFE_FONTS.includes(t.font.body)) t.font = { ...t.font, body: base.font.body }
  return t
}

export type LoadResult = { ok: true; definition: SurveyDefinition } | { ok: false; issues: string[] }

/**
 * Prepare a stored draft for the editor: fill the theme, then validate and
 * upgrade with migrateDefinition. Never mutates the input.
 */
export function loadDefinition(raw: unknown, workspaceTheme?: unknown): LoadResult {
  if (!isObj(raw)) return { ok: false, issues: ['$: expected object'] }
  const base = fillTheme(workspaceTheme)
  const withTheme = { ...raw, theme: fillTheme(raw.theme, base) }
  return safeMigrateDefinition(withTheme)
}

export function rich(text: string) {
  return { format: 'md-lite' as const, text }
}
