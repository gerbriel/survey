import { describe, expect, it } from 'vitest'
import { DEFAULT_LOGO_SIDE, ecLevelFor, fitInside, logoBox, MAX_LOGO_AREA, MAX_LOGO_SIDE, qrFileName, qrMatrix, qrSvg, QUIET_ZONE } from './qr'

const URL = 'https://s.example.org/abcdefghij'
const LOGO = { dataUrl: 'data:image/png;base64,AAAA', width: 200, height: 100 }

describe('qr', () => {
  it('switches error correction to H only with a logo', () => {
    expect(ecLevelFor(false)).toBe('M')
    expect(ecLevelFor(true)).toBe('H')
    const m = qrMatrix(URL, false)
    const h = qrMatrix(URL, true)
    expect(m.ecLevel).toBe('M')
    expect(h.ecLevel).toBe('H')
    expect(h.size).toBeGreaterThanOrEqual(m.size)
  })

  it('renders an SVG with the requested pixel size and a 4 module quiet zone', () => {
    const svg = qrSvg(URL, { px: 512 })
    const size = qrMatrix(URL, false).size
    expect(svg).toContain('width="512" height="512"')
    expect(svg).toContain(`viewBox="0 0 ${size + QUIET_ZONE * 2} ${size + QUIET_ZONE * 2}"`)
    expect(svg).not.toContain('<image')
  })

  it('embeds the logo as a data URL with white padding when given', () => {
    const svg = qrSvg(URL, { px: 1024, logo: LOGO })
    expect(svg).toContain('width="1024"')
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
    expect(svg).toContain('fill="#ffffff"/><image')
  })

  it('keeps the logo box within 20 percent of the symbol area, centered on module edges', () => {
    for (const size of [21, 25, 33, 41, 57, 77, 97, 177]) {
      for (const scale of [0.1, DEFAULT_LOGO_SIDE, 0.4, MAX_LOGO_SIDE, 0.9]) {
        const b = logoBox(size, scale)
        expect(b.side / size).toBeLessThanOrEqual(MAX_LOGO_SIDE)
        expect((b.side * b.side) / (size * size)).toBeLessThanOrEqual(MAX_LOGO_AREA)
        expect(Number.isInteger(b.x)).toBe(true)
        expect(b.x + b.side + b.x).toBe(size)
        if (b.side >= 5) expect(b.pad).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('clamps an oversized logo scale to the maximum', () => {
    expect(logoBox(41, 0.9).side).toBe(logoBox(41, MAX_LOGO_SIDE).side)
  })

  it('fits the logo inside its box keeping the aspect ratio', () => {
    const f = fitInside(200, 100, 10)
    expect(f.w).toBe(10)
    expect(f.h).toBe(5)
    expect(f.y).toBe(2.5)
  })

  it('names downloads {key}-qr.{ext}', () => {
    expect(qrFileName('spring-feedback', 'png')).toBe('spring-feedback-qr.png')
  })
})
