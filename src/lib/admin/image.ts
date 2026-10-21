/**
 * Logo checks for workspace settings (doc 05 section 5.1): PNG, JPEG or WebP
 * sniffed from the bytes (never the declared type or the extension), max
 * 1 MB, 128 to 2048 pixels on each side. SVG is refused because it can carry
 * script. Pure, unit tested.
 */
export const LOGO_MAX_BYTES = 1_048_576
export const LOGO_MIN_SIDE = 128
export const LOGO_MAX_SIDE = 2048

export type SniffedImage = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  ext: 'png' | 'jpg' | 'webp'
  width: number
  height: number
}

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
}
function u32be(b: Uint8Array, i: number): number {
  return (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0)
}
function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
}
function u24le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16)
}
function ascii(b: Uint8Array, i: number, n: number): string {
  let s = ''
  for (let k = 0; k < n; k++) s += String.fromCharCode(b[i + k] ?? 0)
  return s
}

function sniffPng(b: Uint8Array): SniffedImage | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null
  if (ascii(b, 12, 4) !== 'IHDR') return null
  return { mime: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) }
}

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1] ?? 0
    if (marker === 0xff) {
      i += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = u16be(b, i + 2)
    // SOF0..SOF15 except DHT (c4), JPG (c8), DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: 'image/jpeg', ext: 'jpg', height: u16be(b, i + 5), width: u16be(b, i + 7) }
    }
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { mime: 'image/webp', ext: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const b1 = b[21] ?? 0
    const b2 = b[22] ?? 0
    const b3 = b[23] ?? 0
    const b4 = b[24] ?? 0
    const width = 1 + (((b2 & 0x3f) << 8) | b1)
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    return { mime: 'image/webp', ext: 'webp', width, height }
  }
  if (chunk === 'VP8X') {
    return { mime: 'image/webp', ext: 'webp', width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) }
  }
  return null
}

/** Detects PNG, JPEG or WebP from the first bytes and reads the pixel size. Null for anything else. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes)
}

export type LogoCheck = { ok: true; image: SniffedImage } | { ok: false; message: string }

/** Every rule from doc 05 section 5.1 in one place. */
export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, message: 'Choose an image file.' }
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, message: 'The logo must be 1 MB or smaller.' }
  const image = sniffImage(bytes)
  if (!image) return { ok: false, message: 'Use a PNG, JPEG or WebP image. SVG is not accepted.' }
  const { width, height } = image
  if (width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE) {
    return { ok: false, message: `The logo must be at least ${LOGO_MIN_SIDE} by ${LOGO_MIN_SIDE} pixels.` }
  }
  if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) {
    return { ok: false, message: `The logo must be at most ${LOGO_MAX_SIDE} by ${LOGO_MAX_SIDE} pixels.` }
  }
  return { ok: true, image }
}
