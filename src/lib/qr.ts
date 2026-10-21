/**
 * QR codes for the share page (doc 02 section 8, 00 Stack). Pure geometry
 * and SVG output, plus a canvas painter for PNG downloads in the browser.
 *
 * - Error correction M without a logo, H with one.
 * - Quiet zone 4 modules.
 * - Logo box, including at least one module of white padding on every side,
 *   covers at most 20 percent of the symbol area (side at most 0.447 of the
 *   symbol width). Default box side 0.30.
 *
 * Decision: doc 02 asks for a jsqr decode check with 10 percent shrink steps.
 * jsqr is not a dependency and no new dependency is allowed, so the box is
 * capped by geometry only (H recovers up to 30 percent of codewords; the cap
 * keeps the logo under 20 percent of the area).
 */

import QRCode from 'qrcode'

export const QUIET_ZONE = 4
export const DEFAULT_LOGO_SIDE = 0.3
/** sqrt(0.2): a square box of this side covers 20 percent of the symbol. */
export const MAX_LOGO_SIDE = 0.447
export const MAX_LOGO_AREA = 0.2
export const PNG_SIZES = [512, 1024, 2048] as const

export type EcLevel = 'M' | 'H'

export function ecLevelFor(hasLogo: boolean): EcLevel {
  return hasLogo ? 'H' : 'M'
}

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number
  ecLevel: EcLevel
  dark: (row: number, col: number) => boolean
}

export function qrMatrix(text: string, hasLogo: boolean): QrMatrix {
  const ecLevel = ecLevelFor(hasLogo)
  const code = QRCode.create(text, { errorCorrectionLevel: ecLevel })
  const m = code.modules
  return { size: m.size, ecLevel, dark: (r, c) => m.get(r, c) === 1 }
}

export interface LogoBox {
  /** Offsets and side in modules, relative to the symbol's top-left (quiet zone excluded). */
  x: number
  y: number
  side: number
  /** White padding inside the box, in modules. */
  pad: number
}

/**
 * Centered logo box for a symbol of `size` modules. `scale` is the box side
 * as a fraction of the symbol width, clamped to MAX_LOGO_SIDE. The side is
 * rounded down to whole modules so the box never cuts a module in half.
 */
export function logoBox(size: number, scale = DEFAULT_LOGO_SIDE): LogoBox {
  const s = Math.min(Math.max(scale, 0), MAX_LOGO_SIDE)
  let side = Math.floor(size * s)
  // Keep the same parity as size so the box centers on module boundaries.
  if ((size - side) % 2 !== 0) side -= 1
  side = Math.max(0, side)
  const pad = side >= 5 ? 1 : 0
  const x = (size - side) / 2
  return { x, y: x, side, pad }
}

/** Fit an image of w x h inside a square of `side`, keeping its aspect ratio, centered. */
export function fitInside(w: number, h: number, side: number): { x: number; y: number; w: number; h: number } {
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: side, h: side }
  const k = Math.min(side / w, side / h)
  const fw = w * k
  const fh = h * k
  return { x: (side - fw) / 2, y: (side - fh) / 2, w: fw, h: fh }
}

export interface QrLogo {
  /** data: URL (SVG output embeds it so the file is self-contained). */
  dataUrl: string
  width: number
  height: number
}

export interface QrSvgOptions {
  /** Pixel width and height attributes. Default 512. */
  px?: number
  logo?: QrLogo | null
  logoScale?: number
  foreground?: string
  background?: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Standalone SVG document. Units are modules; the quiet zone is included. */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  const logo = opts.logo ?? null
  const m = qrMatrix(text, !!logo)
  const total = m.size + QUIET_ZONE * 2
  const px = opts.px ?? 512
  const fg = opts.foreground ?? '#000000'
  const bg = opts.background ?? '#ffffff'
  const box = logo ? logoBox(m.size, opts.logoScale) : null
  let path = ''
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.dark(r, c)) continue
      if (box && c >= box.x && c < box.x + box.side && r >= box.y && r < box.y + box.side) continue
      path += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`
    }
  }
  let logoSvg = ''
  if (logo && box && box.side > 0) {
    const bx = box.x + QUIET_ZONE
    const by = box.y + QUIET_ZONE
    const inner = box.side - box.pad * 2
    const f = fitInside(logo.width, logo.height, inner)
    logoSvg =
      `<rect x="${bx}" y="${by}" width="${box.side}" height="${box.side}" rx="${Math.min(1, box.side / 6)}" fill="#ffffff"/>` +
      `<image href="${esc(logo.dataUrl)}" x="${bx + box.pad + f.x}" y="${by + box.pad + f.y}" width="${f.w}" height="${f.h}" preserveAspectRatio="xMidYMid meet"/>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/>` +
    `<path d="${path}" fill="${fg}"/>` +
    logoSvg +
    `</svg>`
  )
}

/** Paint the code onto a canvas of px x px (browser only). Draws the logo image when given. */
export function drawQr(
  canvas: HTMLCanvasElement,
  text: string,
  opts: { px: number; logo?: { image: CanvasImageSource; width: number; height: number } | null; logoScale?: number },
): void {
  const m = qrMatrix(text, !!opts.logo)
  const total = m.size + QUIET_ZONE * 2
  canvas.width = opts.px
  canvas.height = opts.px
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const unit = opts.px / total
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, opts.px, opts.px)
  ctx.fillStyle = '#000000'
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark(r, c)) ctx.fillRect(Math.floor((c + QUIET_ZONE) * unit), Math.floor((r + QUIET_ZONE) * unit), Math.ceil(unit), Math.ceil(unit))
    }
  }
  if (!opts.logo) return
  const box = logoBox(m.size, opts.logoScale)
  if (box.side <= 0) return
  const bx = (box.x + QUIET_ZONE) * unit
  const by = (box.y + QUIET_ZONE) * unit
  const side = box.side * unit
  ctx.fillStyle = '#ffffff'
  const radius = Math.min(unit, side / 6)
  ctx.beginPath()
  ctx.roundRect(bx, by, side, side, radius)
  ctx.fill()
  const inner = (box.side - box.pad * 2) * unit
  const f = fitInside(opts.logo.width, opts.logo.height, inner)
  ctx.drawImage(opts.logo.image, bx + box.pad * unit + f.x, by + box.pad * unit + f.y, f.w, f.h)
}

/** File name per doc 02 section 8: `{key}-qr.{ext}`. */
export function qrFileName(key: string, ext: 'svg' | 'png'): string {
  return `${key}-qr.${ext}`
}
