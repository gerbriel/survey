import { describe, expect, it } from 'vitest'
import { evaluate } from '@/lib/survey'
import { PIPING, THEME } from '@/lib/survey/__tests__/fixtures'
import { contrastRatio, ensureContrast, themeToCssVars } from '../theme'
import { parseMdLite, richTextPlain, safeHref } from '../richtext'
import { safeRedirect } from '../Endings'

describe('theme', () => {
  it('writes the --sv-* variables', () => {
    const vars = themeToCssVars(THEME)
    expect(vars['--sv-primary']).toBe('#2255ff')
    expect(vars['--sv-radius']).toBe('8px')
    expect(vars['--color-accent']).toBe('#2255ff')
  })

  it('flips text that fails 4.5:1 and keeps text that passes', () => {
    expect(ensureContrast('#dddddd', '#ffffff')).toBe('#000000')
    expect(ensureContrast('#111111', '#ffffff')).toBe('#111111')
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
  })
})

describe('md-lite', () => {
  it('parses bold, italic, links and line breaks', () => {
    expect(parseMdLite('a **b** *c*\n[d](https://x.org)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'br' },
      { t: 'link', href: 'https://x.org', c: [{ t: 'text', v: 'd' }] },
    ])
  })

  it('allows only https and mailto links, and https redirects', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('http://x.org')).toBeNull()
    expect(safeHref('mailto:a@b.org')).toBe('mailto:a@b.org')
    expect(safeRedirect('mailto:a@b.org')).toBeNull()
  })

  it('pipes values as text, never as markup', () => {
    const state = evaluate(PIPING, { q_namexxxx: '**Ada**' }, { hidden: {} })
    expect(richTextPlain(PIPING.questions.q_summary1?.label, PIPING, state)).toBe('Hi **Ada**')
  })
})
