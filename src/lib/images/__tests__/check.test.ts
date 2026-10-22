import { describe, expect, it } from 'vitest'
import { checkLibraryImage, IMAGE_UPLOAD_MAX_BYTES } from '../check'

/** PNG signature plus an IHDR chunk with the given size. */
function png(width: number, height: number, pad = 0): Uint8Array {
  const b = new Uint8Array(33 + pad)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const dv = new DataView(b.buffer)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  return b
}

describe('checkLibraryImage', () => {
  it('accepts a sniffed PNG and reads its size', () => {
    expect(checkLibraryImage(png(1600, 400))).toEqual({ ok: true, image: { mime: 'image/png', ext: 'png', width: 1600, height: 400 } })
  })
  it('refuses SVG, empty, oversized and huge-bitmap files', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(checkLibraryImage(svg)).toMatchObject({ ok: false, message: expect.stringMatching(/SVG is not accepted/) })
    expect(checkLibraryImage(new Uint8Array())).toMatchObject({ ok: false })
    expect(checkLibraryImage(png(100, 100, IMAGE_UPLOAD_MAX_BYTES))).toMatchObject({ ok: false, message: expect.stringMatching(/2 MB/) })
    expect(checkLibraryImage(png(9000, 100))).toMatchObject({ ok: false, message: expect.stringMatching(/8000/) })
  })
})
