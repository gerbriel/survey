// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Theme } from '@/lib/survey'
import { THEME } from '@/lib/survey/__tests__/fixtures'
import { SurveyShell } from '../SurveyShell'

afterEach(cleanup)

const resolve = (p: string) => (p.includes('..') ? null : `https://project.supabase.co/storage/v1/object/public/public-assets/${p}`)

function coverImg(theme: Theme): HTMLImageElement | null {
  const { container } = render(
    <SurveyShell theme={theme} title="T" resolveAssetUrl={resolve}>
      <p>body</p>
    </SurveyShell>,
  )
  return container.querySelector('img')
}

describe('SurveyShell cover', () => {
  it('renders a starter from the app /headers path', () => {
    const img = coverImg({ ...THEME, cover_image: { source: { kind: 'starter', id: 'dusk' }, height: 'tall', focal_y: 0.2 } })
    expect(img).toHaveAttribute('src', '/headers/dusk.svg')
    expect(img).toHaveClass('h-64')
    expect(img?.style.objectPosition).toBe('50% 20%')
  })

  it('renders a workspace image and an upload through the asset resolver', () => {
    const id = '0b5f8a52-3c1e-4c4b-9d55-7a1f3c2e9b10'
    expect(coverImg({ ...THEME, cover_image: { source: { kind: 'workspace', image_id: id, path: `w/images/${id}.png` }, height: 'short', focal_y: 0.5 } })).toHaveAttribute(
      'src',
      `https://project.supabase.co/storage/v1/object/public/public-assets/w/images/${id}.png`,
    )
    cleanup()
    expect(coverImg({ ...THEME, cover_image: { source: { kind: 'upload', path: 'w/surveys/s/c.png' }, height: 'short', focal_y: 0.5 } })).toHaveAttribute(
      'src',
      'https://project.supabase.co/storage/v1/object/public/public-assets/w/surveys/s/c.png',
    )
  })

  it('still renders the pre-library shape, and nothing for a refused path', () => {
    const legacy = { ...THEME, cover_image: { path: 'w/old.png', height: 'short', focal_y: 0.5 } } as unknown as Theme
    expect(coverImg(legacy)).toHaveAttribute('src', 'https://project.supabase.co/storage/v1/object/public/public-assets/w/old.png')
    cleanup()
    expect(coverImg({ ...THEME, cover_image: { source: { kind: 'upload', path: '../x.png' }, height: 'short', focal_y: 0.5 } })).toBeNull()
  })
})
