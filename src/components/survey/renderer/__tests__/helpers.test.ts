import { describe, expect, it } from 'vitest'
import { evaluate } from '@/lib/survey'
import { PIPING, THEME } from '@/lib/survey/__tests__/fixtures'
import { contrastRatio, ensureContrast, themeToCssVars } from '../theme'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseMdLite, richTextPlain, RichTextView, safeHref } from '../richtext'
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

  it('L4: refuses userinfo and URL encodes piped values inside link hrefs', () => {
    expect(safeHref('https://intranet.example.org@evil.example/login')).toBeNull()
    expect(safeHref('https://user:pw@x.org/')).toBeNull()
    const state = evaluate(PIPING, {}, { hidden: { p: '@evil.example/login' } })
    const html = renderToStaticMarkup(
      createElement(RichTextView, { text: '[Read](https://intranet.example.org/{{hidden:p}})', definition: PIPING, state }),
    )
    expect(html).toContain('href="https://intranet.example.org/%40evil.example%2Flogin"')
    const glued = renderToStaticMarkup(
      createElement(RichTextView, { text: '[Read](https://intranet.example.org{{hidden:p}})', definition: PIPING, state }),
    )
    expect(glued).not.toContain('evil.example/login"')
    expect(glued).not.toMatch(/href="https:\/\/[^"]*@/)
  })

  it('pipes values as text, never as markup', () => {
    const state = evaluate(PIPING, { q_namexxxx: '**Ada**' }, { hidden: {} })
    expect(richTextPlain(PIPING.questions.q_summary1?.label, PIPING, state)).toBe('Hi **Ada**')
  })
})
