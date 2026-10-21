import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref } from '../markdown'

describe('privacy notice markdown', () => {
  it('parses headings, paragraphs and lists', () => {
    const blocks = parseMarkdown('# Notice\n\nWe collect\nanswers.\n\n- one\n- two\n\n1. first\n2. second\n### Contact')
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'h'])
    expect(blocks[1]).toEqual({ t: 'p', c: [{ t: 'text', v: 'We collect answers.' }] })
    expect(blocks[2]).toMatchObject({ t: 'ul', items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] })
  })

  it('parses inline emphasis, code and safe links only', () => {
    expect(parseInline('**bold** and *it* and `x`')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'em', c: [{ t: 'text', v: 'it' }] },
      { t: 'text', v: ' and ' },
      { t: 'code', v: 'x' },
    ])
    expect(parseInline('[mail](mailto:privacy@org.example)')).toEqual([
      { t: 'link', href: 'mailto:privacy@org.example', c: [{ t: 'text', v: 'mail' }] },
    ])
    expect(parseInline('[bad](javascript:alert(1))')[0]).toEqual({ t: 'text', v: 'bad' })
    expect(safeHref('http://plain.example')).toBeNull()
  })

  it('never produces markup from raw HTML', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] }])
  })
})
