import { describe, expect, it } from 'vitest'
import { parseImportText, sniffType } from '../importText'

describe('parseImportText', () => {
  it('parses questions, options, required marks, tags and pages', () => {
    const r = parseImportText(`What is your name? *
Favorite colors [multi]
- Red
* Blue
Pick a state [dropdown] *
- CA
- NY

---
How likely are you to recommend us?
Tell us more [long]`)
    expect(r.warnings).toEqual([])
    expect(r.pages).toHaveLength(2)
    const [p1, p2] = r.pages
    expect(p1?.map((q) => [q.label, q.type, q.required, q.options])).toEqual([
      ['What is your name?', 'short_text', true, []],
      ['Favorite colors', 'multiple_choice', false, ['Red', 'Blue']],
      ['Pick a state', 'dropdown', true, ['CA', 'NY']],
    ])
    expect(p2?.map((q) => q.type)).toEqual(['nps', 'long_text'])
  })

  it('defaults options to single choice and sniffs labels without options', () => {
    const r = parseImportText('Size\n- S\n- M\nYour email\nPhone number\nStart date\nCity')
    expect(r.pages[0]?.map((q) => q.type)).toEqual(['single_choice', 'email', 'phone', 'date', 'short_text'])
    expect(sniffType('HOW LIKELY is it')).toBe('nps')
  })

  it('warns about orphan options, unknown tags and option-less choice tags', () => {
    const r = parseImportText('- stray\nQuestion [weird]\nPick [multi]')
    expect(r.warnings).toHaveLength(3)
    expect(r.pages[0]?.map((q) => q.type)).toEqual(['short_text', 'multiple_choice'])
  })

  it('ignores leading, trailing and repeated page breaks', () => {
    const r = parseImportText('---\nA\n---\n---\nB\n---')
    expect(r.pages.map((p) => p.map((q) => q.label))).toEqual([['A'], ['B']])
  })

  it('keeps a lone asterisk label and records source lines', () => {
    const r = parseImportText('\n\nOnly *')
    expect(r.pages[0]?.[0]).toMatchObject({ label: 'Only', required: true, line: 3 })
  })
})
