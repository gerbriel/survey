import { describe, expect, it } from 'vitest'
import { linksCsv, publicSurveyLink } from './links'

describe('publicSurveyLink', () => {
  it('points at the public host with the token', () => {
    expect(publicSurveyLink('s.example.com', 'k3m9x2p7qa', 'Xk3_-abc', 'production')).toBe('https://s.example.com/k3m9x2p7qa?t=Xk3_-abc')
  })
  it('uses http in development and trims slashes', () => {
    expect(publicSurveyLink('s.localhost:3000/', 'abcdefghij', 't', 'development')).toBe('http://s.localhost:3000/abcdefghij?t=t')
  })
  it('refuses an empty host', () => {
    expect(() => publicSurveyLink('', 'a', 'b', 'production')).toThrow(/PUBLIC_HOST/)
  })
})

describe('linksCsv', () => {
  it('writes the doc 04 columns, BOM, and escapes cells', () => {
    const csv = linksCsv([
      { email: 'ana@acme.com', first_name: 'Ana', last_name: 'Lopez', company: 'Acme, Inc', link: 'https://s.example.com/k?t=1' },
      { email: 'bo@x.io', first_name: null, last_name: null, company: '=cmd', link: 'https://s.example.com/k?t=2' },
    ])
    expect(csv).toBe(
      '﻿email,first_name,last_name,company,survey_link\r\n' +
        'ana@acme.com,Ana,Lopez,"Acme, Inc",https://s.example.com/k?t=1\r\n' +
        "bo@x.io,,,'=cmd,https://s.example.com/k?t=2\r\n",
    )
  })
})
