import { describe, expect, it } from 'vitest'
import { checkLogo, LOGO_MAX_BYTES, sniffImage } from '../image'

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}

function jpeg(w: number, h: number): Uint8Array {
  // SOI, APP0 (len 16), SOF0 (len 17)
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, ...new Array(9).fill(0)]
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof])
}

function webpVp8x(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  b.set([...'VP8X'].map((c) => c.charCodeAt(0)), 12)
  const W = w - 1
  const H = h - 1
  b.set([W & 0xff, (W >> 8) & 0xff, (W >> 16) & 0xff], 24)
  b.set([H & 0xff, (H >> 8) & 0xff, (H >> 16) & 0xff], 27)
  return b
}

function webpVp8l(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  b.set([...'VP8L'].map((c) => c.charCodeAt(0)), 12)
  b[20] = 0x2f
  const bits = (w - 1) | ((h - 1) << 14)
  b[21] = bits & 0xff
  b[22] = (bits >> 8) & 0xff
  b[23] = (bits >> 16) & 0xff
  b[24] = (bits >> 24) & 0xff
  return b
}

describe('sniffImage', () => {
  it('reads PNG, JPEG and WebP sizes from the bytes', () => {
    expect(sniffImage(png(300, 200))).toEqual({ mime: 'image/png', ext: 'png', width: 300, height: 200 })
    expect(sniffImage(jpeg(640, 480))).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 })
    expect(sniffImage(webpVp8x(512, 256))).toEqual({ mime: 'image/webp', ext: 'webp', width: 512, height: 256 })
    expect(sniffImage(webpVp8l(400, 300))).toEqual({ mime: 'image/webp', ext: 'webp', width: 400, height: 300 })
  })

  it('refuses SVG, GIF and random bytes', () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('checkLogo', () => {
  it('accepts a square PNG within the limits', () => {
    const r = checkLogo(png(512, 512))
    expect(r.ok).toBe(true)
  })

  it('rejects too small, too large, oversize and unknown files with plain messages', () => {
    expect(checkLogo(png(64, 64))).toEqual({ ok: false, message: expect.stringContaining('at least 128') })
    expect(checkLogo(png(4096, 512))).toEqual({ ok: false, message: expect.stringContaining('at most 2048') })
    expect(checkLogo(new Uint8Array(LOGO_MAX_BYTES + 1))).toEqual({ ok: false, message: expect.stringContaining('1 MB') })
    expect(checkLogo(new Uint8Array(0))).toEqual({ ok: false, message: 'Choose an image file.' })
    expect(checkLogo(new TextEncoder().encode('<svg/>'))).toEqual({ ok: false, message: expect.stringContaining('SVG') })
  })
})
