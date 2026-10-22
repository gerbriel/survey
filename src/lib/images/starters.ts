/**
 * Starter header images (doc 03 section 8.1): eight neutral 1600 by 400 SVGs
 * in the app's color tokens (src/app/globals.css), no text, no third-party
 * artwork. Served by the app at /headers/{id}.svg from public/headers/; the
 * files are generated from this module and a unit test pins them byte for
 * byte, so the OG card (which embeds the markup) and the static file never
 * drift. Pure, no imports, safe in the browser.
 *
 * The ids are stable: a survey theme stores { kind: 'starter', id } and a
 * published version is frozen, so an id is never renamed or removed.
 */

export const STARTER_WIDTH = 1600
export const STARTER_HEIGHT = 400

// Tokens from globals.css (light and dark palettes).
const C = {
  accent: '#1d4ed8',
  focus: '#2563eb',
  accentLight: '#60a5fa',
  accentPale: '#93c5fd',
  success: '#15803d',
  successLight: '#4ade80',
  warning: '#a16207',
  warningLight: '#facc15',
  fg: '#1c1917',
  muted: '#57534e',
  mutedLight: '#a8a29e',
  border: '#d6d3d1',
  surfaceMuted: '#f5f5f4',
  surface: '#ffffff',
} as const

function svg(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" viewBox="0 0 ${STARTER_WIDTH} ${STARTER_HEIGHT}" preserveAspectRatio="xMidYMid slice">\n` +
    body +
    '</svg>\n'
  )
}

function linear(id: string, from: string, to: string, x2 = 1, y2 = 0): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>\n`
}

function gridLines(step: number, color: string): string {
  const out: string[] = []
  for (let x = step; x < STARTER_WIDTH; x += step) out.push(`M${x} 0V${STARTER_HEIGHT}`)
  for (let y = step; y < STARTER_HEIGHT; y += step) out.push(`M0 ${y}H${STARTER_WIDTH}`)
  return `<path d="${out.join('')}" stroke="${color}" stroke-width="2" fill="none"/>\n`
}

function dots(step: number, r: number, color: string): string {
  return (
    `<defs><pattern id="d" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="${r}" fill="${color}"/></pattern></defs>\n` +
    `<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="url(#d)"/>\n`
  )
}

function wave(y: number, amp: number, color: string): string {
  const seg = STARTER_WIDTH / 4
  let d = `M0 ${y}`
  for (let i = 0; i < 4; i++) {
    const x0 = i * seg
    d += `C${Math.round(x0 + seg / 3)} ${y - amp} ${Math.round(x0 + (2 * seg) / 3)} ${y + amp} ${x0 + seg} ${y}`
  }
  d += `V${STARTER_HEIGHT}H0Z`
  return `<path d="${d}" fill="${color}"/>\n`
}

function facets(): string {
  const cols = 8
  const w = STARTER_WIDTH / cols
  const tones = [C.fg, C.muted, C.mutedLight, C.muted]
  const out: string[] = []
  for (let i = 0; i < cols; i++) {
    const x = i * w
    const a = tones[i % tones.length] ?? C.fg
    const b = tones[(i + 1) % tones.length] ?? C.muted
    out.push(`<path d="M${x} 0H${x + w}L${x} ${STARTER_HEIGHT}Z" fill="${a}"/>`)
    out.push(`<path d="M${x + w} 0V${STARTER_HEIGHT}H${x}Z" fill="${b}"/>`)
  }
  return out.join('\n') + '\n'
}

export type StarterHeader = { id: string; label: string; svg: string }

export const STARTER_HEADERS: readonly StarterHeader[] = [
  {
    id: 'ocean',
    label: 'Ocean gradient',
    svg: svg(linear('g', C.accent, C.accentLight) + `<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="url(#g)"/>\n`),
  },
  {
    id: 'dusk',
    label: 'Dusk gradient',
    svg: svg(linear('g', C.fg, C.accent, 1, 1) + `<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="url(#g)"/>\n`),
  },
  {
    id: 'meadow',
    label: 'Meadow gradient',
    svg: svg(linear('g', C.success, C.successLight) + `<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="url(#g)"/>\n`),
  },
  {
    id: 'amber',
    label: 'Amber gradient',
    svg: svg(linear('g', C.warning, C.warningLight, 1, 1) + `<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="url(#g)"/>\n`),
  },
  {
    id: 'grid',
    label: 'Light grid',
    svg: svg(`<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="${C.surfaceMuted}"/>\n` + gridLines(40, C.border)),
  },
  {
    id: 'dots',
    label: 'Blue dots',
    svg: svg(`<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="${C.accent}"/>\n` + dots(32, 4, C.accentLight)),
  },
  {
    id: 'waves',
    label: 'Waves',
    svg: svg(
      `<rect width="${STARTER_WIDTH}" height="${STARTER_HEIGHT}" fill="${C.accentPale}"/>\n` +
        wave(170, 50, C.accentLight) +
        wave(250, 45, C.focus) +
        wave(320, 35, C.accent),
    ),
  },
  {
    id: 'facets',
    label: 'Stone facets',
    svg: svg(facets()),
  },
]

export const STARTER_HEADER_IDS: readonly string[] = STARTER_HEADERS.map((s) => s.id)

export function starterHeader(id: string): StarterHeader | null {
  return STARTER_HEADERS.find((s) => s.id === id) ?? null
}

/** App path of a starter on either host, or null for an unknown id. */
export function starterHeaderPath(id: string): string | null {
  return starterHeader(id) ? `/headers/${id}.svg` : null
}

/** The starter as a data URI, for next/og, which cannot fetch from its own host in every environment. */
export function starterHeaderDataUri(id: string): string | null {
  const s = starterHeader(id)
  if (!s) return null
  return `data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(s.svg) : Buffer.from(s.svg).toString('base64')}`
}
