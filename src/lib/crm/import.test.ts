import { describe, expect, it } from 'vitest'
import { csvCell, parseCsv, toCsv } from './csv'
import { splitTags } from './email'
import { autoMap, chunk, customValue, mapRows, suggestedImportTag, type FieldDefLite } from './import'

const defs: FieldDefLite[] = [
  { key: 'plan', label: 'Plan', type: 'select', options: ['Basic', 'Pro'] },
  { key: 'seats', label: 'Seats', type: 'number' },
  { key: 'renews', label: 'Renews on', type: 'date' },
  { key: 'interests', label: 'Interests', type: 'multiselect', options: [{ value: 'a' }, { value: 'b' }] },
  { key: 'vip', label: 'VIP', type: 'boolean' },
]

describe('parseCsv', () => {
  it('reads headers, quoted cells, BOM and blank lines', () => {
    const text = '﻿Email,First Name,Notes\r\nana@acme.com,Ana,"hello, ""world"""\r\n\r\nbo@x.io,Bo,\n'
    const p = parseCsv(text)
    expect(p.headers).toEqual(['Email', 'First Name', 'Notes'])
    expect(p.rows).toEqual([
      ['ana@acme.com', 'Ana', 'hello, "world"'],
      ['bo@x.io', 'Bo', ''],
    ])
  })
  it('names empty headers and pads short rows', () => {
    const p = parseCsv('email,\na@b.co')
    expect(p.headers).toEqual(['email', 'Column 2'])
    expect(p.rows[0]).toEqual(['a@b.co', ''])
  })
})

describe('autoMap', () => {
  it('maps common header spellings and custom fields by key or label', () => {
    expect(autoMap(['E-mail', 'First name', 'Surname', 'Organization', 'Mobile', 'Stage', 'Tags', 'Owner', 'Plan', 'seats', 'Other'], defs)).toEqual([
      'email',
      'first_name',
      'last_name',
      'company',
      'phone',
      'lead_status',
      'tags',
      'owner_email',
      'custom:plan',
      'custom:seats',
      'ignore',
    ])
  })
  it('uses each target once', () => {
    expect(autoMap(['email', 'Email Address'])).toEqual(['email', 'ignore'])
  })
})

describe('mapRows', () => {
  const mapping = autoMap(['email', 'first name', 'phone', 'tags', 'status', 'plan', 'seats'], defs)

  it('normalizes values, splits tags, and collapses in-file duplicates to the first row', () => {
    const r = mapRows(
      [
        [' Ana@Acme.COM ', 'Ana', '(213) 373-4253', 'VIP; event,vip', 'Qualified', 'pro', '1,200'],
        ['ana@acme.com', 'Second Ana', '', '', '', '', ''],
        ['bo@x.io', 'Bo', 'not a phone', '', '', '', ''],
      ],
      mapping,
      { defaultCountry: 'US', defs },
    )
    expect(r.duplicates).toBe(1)
    expect(r.invalid).toEqual([])
    expect(r.valid[0]!.row).toEqual({
      email: 'ana@acme.com',
      first_name: 'Ana',
      phone: '+12133734253',
      tags: ['vip', 'event'],
      lead_status: 'qualified',
      custom: { plan: 'Pro', seats: 1200 },
    })
    expect(r.valid[0]!.line).toBe(2)
    expect(r.valid[1]!.row.phone).toBeUndefined()
    expect(r.valid[1]!.warnings[0]).toMatch(/could not be read/)
  })

  it('reports invalid rows with their file line', () => {
    const r = mapRows(
      [
        ['nope', 'X', '', '', '', '', ''],
        ['', 'Y', '', '', '', '', ''],
        ['c@d.co', 'Z', '', '', 'hot', '', ''],
        ['e@f.co', 'W', '', '', '', 'Gold', ''],
      ],
      mapping,
      { defaultCountry: 'US', defs },
    )
    expect(r.valid).toEqual([])
    expect(r.invalid.map((i) => [i.line, i.error.split(' ')[0]])).toEqual([
      [2, 'Invalid'],
      [3, 'Missing'],
      [4, 'Lead'],
      [5, 'Plan'],
    ])
  })
})

describe('customValue', () => {
  it('converts by field type', () => {
    expect(customValue(defs[2]!, '2026-10-21')).toBe('2026-10-21')
    expect(() => customValue(defs[2]!, '10/21/2026')).toThrow()
    expect(customValue(defs[3]!, 'a; B')).toEqual(['a', 'b'])
    expect(customValue(defs[4]!, 'Yes')).toBe(true)
    expect(customValue(defs[4]!, 'n')).toBe(false)
    expect(() => customValue({ key: 'u', label: 'Site', type: 'url' }, 'example.com')).toThrow()
  })
})

describe('helpers', () => {
  it('splits and normalizes tags', () => {
    expect(splitTags(' A ;b,, a ')).toEqual(['a', 'b'])
    expect(splitTags('x'.repeat(50))[0]).toHaveLength(40)
  })
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('suggests a dated import tag', () => {
    expect(suggestedImportTag(new Date('2026-10-21T12:00:00Z'))).toBe('import-2026-10-21')
  })
})

describe('CSV writing', () => {
  it('escapes quotes and guards against formula injection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@x')).toBe("'@x")
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(['a', 'b'])).toBe('a; b')
  })
  it('writes a BOM and CRLF lines', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n')
    expect(toCsv(['a'], [], { bom: false })).toBe('a\r\n')
  })
})
