/**
 * Theme to CSS custom properties (doc 03 section 8). Pure helpers so the
 * builder and tests can use them without React.
 */

import type { SafeFont, Theme } from '@/lib/survey'

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function parseHex(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null
  let h = hex.slice(1)
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/** WCAG contrast ratio, or null when either color is not a hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Whichever of black or white reads better on `bg`. */
export function readableOn(bg: string): '#000000' | '#ffffff' {
  const white = contrastRatio('#ffffff', bg) ?? 21
  const black = contrastRatio('#000000', bg) ?? 21
  return black >= white ? '#000000' : '#ffffff'
}

/** Keep `fg` when it meets 4.5:1 on `bg`, else flip to black or white (doc 02 section 11). */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  const r = contrastRatio(fg, bg)
  if (r === null || r >= min) return fg
  return readableOn(bg)
}

const FONT_STACKS: Record<SafeFont, string> = {
  Inter: "'Inter', system-ui, sans-serif",
  Roboto: "'Roboto', system-ui, sans-serif",
  'Open Sans': "'Open Sans', system-ui, sans-serif",
  Lato: "'Lato', system-ui, sans-serif",
  'Source Serif 4': "'Source Serif 4', Georgia, serif",
  Merriweather: "'Merriweather', Georgia, serif",
  Poppins: "'Poppins', system-ui, sans-serif",
  'Work Sans': "'Work Sans', system-ui, sans-serif",
  'IBM Plex Sans': "'IBM Plex Sans', system-ui, sans-serif",
  'system-ui': 'system-ui, sans-serif',
}

export function fontStack(font: SafeFont): string {
  return FONT_STACKS[font] ?? FONT_STACKS['system-ui']
}

const RADIUS = { none: '0px', sm: '4px', md: '8px', lg: '16px' } as const
// Decision: base_size scales body copy only; inputs stay at 16px so iOS never zooms (doc 02 section 11).
const BASE_SIZE = { sm: '15px', md: '16px', lg: '18px' } as const

export type CssVars = Record<`--${string}`, string>

/**
 * The CSS variables ThemeProvider writes. `--sv-*` are the theme contract;
 * the `--color-*` lines remap the shared UI tokens so src/components/ui
 * primitives (Button, Input, Table) take the survey colors inside the renderer.
 */
export function themeToCssVars(theme: Theme): CssVars {
  const c = theme.colors
  const text = ensureContrast(c.text, c.surface)
  const muted = ensureContrast(c.muted_text, c.surface)
  const error = ensureContrast(c.error, c.surface)
  const onPrimary = readableOn(c.primary)
  return {
    '--sv-primary': c.primary,
    '--sv-on-primary': onPrimary,
    '--sv-text': text,
    '--sv-muted': muted,
    '--sv-background': c.background,
    '--sv-on-background': ensureContrast(c.text, c.background),
    '--sv-surface': c.surface,
    '--sv-error': error,
    '--sv-border': `color-mix(in srgb, ${text} 25%, transparent)`,
    '--sv-radius': RADIUS[theme.corner_radius] ?? RADIUS.md,
    '--sv-font': fontStack(theme.font.body),
    '--sv-font-heading': fontStack(theme.font.heading),
    '--sv-base-size': BASE_SIZE[theme.font.base_size] ?? BASE_SIZE.md,
    '--color-accent': c.primary,
    '--color-accent-fg': onPrimary,
    '--color-surface': c.surface,
    '--color-surface-muted': `color-mix(in srgb, ${text} 6%, ${c.surface})`,
    '--color-fg': text,
    '--color-muted': muted,
    '--color-border': `color-mix(in srgb, ${text} 25%, transparent)`,
    '--color-danger': error,
    '--color-focus': c.primary,
  }
}
