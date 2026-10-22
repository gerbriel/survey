import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coverOgSrc, coverSrc, normalizeCover } from '../cover'
import { checkDefinitionShape, migrateDefinition } from '../migrate'
import { STARTER_HEADER_IDS, STARTER_HEADERS, starterHeaderDataUri, starterHeaderPath } from '../../images/starters'
import { PIPING } from './fixtures'

const IMG = '0b5f8a52-3c1e-4c4b-9d55-7a1f3c2e9b10'
const WS = '7d3c2a10-9f4e-4b61-8c2d-1e5f6a7b8c9d'
const withCover = (cover: unknown) => ({ ...PIPING, theme: { ...PIPING.theme, cover_image: cover } })
const asset = (p: string) => `https://project.supabase.co/storage/v1/object/public/public-assets/${p}`

describe('cover source union', () => {
  it('migrateDefinition reads the pre-library shape as source upload', () => {
    const out = migrateDefinition(withCover({ path: `${WS}/surveys/s/cover-1.png`, height: 'tall', focal_y: 0.25 }))
    expect(out.theme.cover_image).toEqual({ source: { kind: 'upload', path: `${WS}/surveys/s/cover-1.png` }, height: 'tall', focal_y: 0.25 })
  })

  it('keeps each current kind unchanged', () => {
    const covers = [
      { source: { kind: 'starter', id: 'ocean' }, height: 'short', focal_y: 0.5 },
      { source: { kind: 'workspace', image_id: IMG, path: `${WS}/images/${IMG}.png` }, height: 'tall', focal_y: 0 },
      { source: { kind: 'upload', path: `${WS}/surveys/s/cover-2.webp` }, height: 'short', focal_y: 1 },
    ]
    for (const c of covers) expect(migrateDefinition(withCover(c)).theme.cover_image).toEqual(c)
  })

  it('a source wins over a stray legacy path and junk fields are dropped', () => {
    expect(normalizeCover({ source: { kind: 'starter', id: 'grid', path: 'x' }, path: 'old.png', height: 'x', focal_y: 7 })).toEqual({
      source: { kind: 'starter', id: 'grid' },
      height: 'short',
      focal_y: 1,
    })
  })

  it('drops an unreadable cover instead of failing the definition', () => {
    for (const bad of [{ source: { kind: 'starter', id: 'nope' } }, { source: { kind: 'workspace', image_id: 'x', path: 'a' } }, { source: { kind: 'web', url: 'https://x' } }, { height: 'tall' }, 'cover.png']) {
      const out = migrateDefinition(withCover(bad))
      expect(out.theme.cover_image).toBeUndefined()
    }
  })

  it('checkDefinitionShape flags a legacy or malformed cover when called directly', () => {
    expect(checkDefinitionShape(withCover({ path: 'a.png', height: 'short', focal_y: 0.5 }))).toContain('theme.cover_image: expected { source, height, focal_y }')
    expect(checkDefinitionShape(withCover({ source: { kind: 'starter', id: 'ocean' }, height: 'short', focal_y: 0.5 }))).toEqual([])
  })

  it('coverSrc: starters from /headers, library and uploads through the asset resolver only', () => {
    expect(coverSrc({ source: { kind: 'starter', id: 'waves' }, height: 'short', focal_y: 0.5 }, asset)).toBe('/headers/waves.svg')
    expect(coverSrc({ source: { kind: 'workspace', image_id: IMG, path: `${WS}/images/${IMG}.png` }, height: 'short', focal_y: 0.5 }, asset)).toBe(
      asset(`${WS}/images/${IMG}.png`),
    )
    expect(coverSrc({ path: 'legacy/cover.png', height: 'short', focal_y: 0.5 }, asset)).toBe(asset('legacy/cover.png'))
    expect(coverSrc({ source: { kind: 'upload', path: 'a.png' }, height: 'short', focal_y: 0.5 })).toBeNull()
    expect(coverSrc({ source: { kind: 'upload', path: 'https://evil.example/a.png' }, height: 'short', focal_y: 0.5 }, () => null)).toBeNull()
    expect(coverSrc(undefined, asset)).toBeNull()
  })

  it('coverOgSrc embeds starters and resolves library images', () => {
    expect(coverOgSrc({ source: { kind: 'starter', id: 'grid' }, height: 'short', focal_y: 0.5 }, asset)).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(coverOgSrc({ source: { kind: 'workspace', image_id: IMG, path: 'w/i.png' }, height: 'short', focal_y: 0.5 }, asset)).toBe(asset('w/i.png'))
    expect(coverOgSrc(null, asset)).toBeNull()
  })
})

describe('starter headers', () => {
  it('ships eight stable ids', () => {
    expect(STARTER_HEADER_IDS).toEqual(['ocean', 'dusk', 'meadow', 'amber', 'grid', 'dots', 'waves', 'facets'])
    expect(starterHeaderPath('../etc')).toBeNull()
  })

  it('public/headers files match the module byte for byte, 1600 by 400, no text, no external references', () => {
    for (const s of STARTER_HEADERS) {
      const file = readFileSync(join(process.cwd(), 'public', 'headers', `${s.id}.svg`), 'utf8')
      expect(file).toBe(s.svg)
      expect(file).toContain('width="1600" height="400"')
      expect(file).not.toMatch(/<text|<script|<image|href=|url\((?!#)/i)
    }
  })

  it('data URI for the OG card', () => {
    expect(starterHeaderDataUri('ocean')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(starterHeaderDataUri('nope')).toBeNull()
  })
})
