import { describe, expect, it } from 'vitest'
import { allowScriptAttrs, initialConsent, parseCustomScript, pixelEventPlan, selectPixels, type PixelRow } from '../pixels/policy'
import { fileIdFromPath, fileIdsFromAnswers, hiddenFromSearch } from '../protocol'

const ROWS: PixelRow[] = [
  { id: 'p1', type: 'ga4', value: 'G-ABC1234' },
  { id: 'p2', type: 'meta', value: '123456789012' },
  { id: 'p3', type: 'gtm', value: 'GTM-ABCD12' },
  {
    id: 'p4',
    type: 'custom_script',
    value: '<script>x()</script>',
    parsed: { version: 1, parts: [{ kind: 'script', src: null, code: 'x()', attrs: {} }] },
  },
]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('selectPixels', () => {
  it('loads nothing off the public host', () => {
    expect(selectPixels(ROWS, { hostKind: 'dashboard', rawScriptAllowed: true })).toEqual([])
    expect(selectPixels(ROWS, { hostKind: 'unknown', rawScriptAllowed: true })).toEqual([])
  })

  it('applies per-survey exclusions', () => {
    expect(ids(selectPixels(ROWS, { hostKind: 'public', rawScriptAllowed: true, excludedIds: ['p2', 'p4'] }))).toEqual(['p1', 'p3'])
  })

  it('drops gtm and custom_script under the kill switch', () => {
    expect(ids(selectPixels(ROWS, { hostKind: 'public', rawScriptAllowed: false }))).toEqual(['p1', 'p2'])
  })

  it('S3 (R16): the kill switch is decided by the type column, never by parsed content', () => {
    // A gtm row with custom_script shaped content and a custom_script row with gtm shaped content stay blocked.
    const rows: PixelRow[] = [
      { id: 'g', type: 'gtm', value: 'GTM-ABCD12', parsed: { version: 1, parts: [] } },
      { id: 'c', type: 'custom_script', value: 'GTM-ABCD12', parsed: ROWS[3]!.parsed },
    ]
    expect(selectPixels(rows, { hostKind: 'public', rawScriptAllowed: false })).toEqual([])
    expect(ids(selectPixels(rows, { hostKind: 'public', rawScriptAllowed: true }))).toEqual(['g', 'c'])
  })

  it('re-validates values and ignores unknown types and duplicates', () => {
    const rows: PixelRow[] = [
      { id: 'a', type: 'ga4', value: "G-1');alert(1)//" },
      { id: 'b', type: 'meta', value: 'abc' },
      { id: 'c', type: 'gtm', value: 'GTM-<x>' },
      { id: 'd', type: 'tiktok', value: '1' },
      { id: 'e', type: 'ga4', value: 'G-OK12345' },
      { id: 'e', type: 'ga4', value: 'G-OK12345' },
    ]
    expect(ids(selectPixels(rows, { hostKind: 'public', rawScriptAllowed: true }))).toEqual(['e'])
  })

  it('skips custom scripts without a usable parsed form', () => {
    const rows: PixelRow[] = [{ id: 'x', type: 'custom_script', value: '<script>a()</script>', parsed: null }]
    expect(selectPixels(rows, { hostKind: 'public', rawScriptAllowed: true })).toEqual([])
  })
})

describe('parseCustomScript', () => {
  it('reads the stored settings shape: https src or inline code, noscript kept for <noscript>', () => {
    expect(
      parseCustomScript({
        version: 1,
        parts: [
          { kind: 'script', src: 'https://cdn.example.org/a.js', code: null, attrs: { async: true } },
          { kind: 'script', src: 'http://cdn.example.org/b.js', code: null, attrs: {} },
          { kind: 'script', src: 'javascript:alert(1)', code: null, attrs: {} },
          { kind: 'script', src: null, code: 'window.x=1', attrs: {} },
          { kind: 'noscript', html: '<img src="https://px.example.org/p.gif">' },
        ],
      }),
    ).toEqual([
      { kind: 'script', src: 'https://cdn.example.org/a.js', code: null, attrs: { async: true } },
      { kind: 'script', src: null, code: 'window.x=1', attrs: {} },
      { kind: 'noscript', html: '<img src="https://px.example.org/p.gif">' },
    ])
  })

  it('treats attrs as an allow list', () => {
    const [part] = parseCustomScript({
      version: 1,
      parts: [
        {
          kind: 'script',
          src: 'https://cdn.example.org/a.js',
          code: null,
          attrs: {
            async: true,
            defer: true,
            type: 'Module',
            id: 'vendor-loader',
            'data-account': '42',
            onload: 'steal()',
            ONERROR: 'steal()',
            nonce: 'abc',
            src: 'https://evil.example.org/x.js',
            crossorigin: 'anonymous',
            style: 'x',
            'data-<bad>': '1',
          },
        },
      ],
    })
    expect(part).toEqual({
      kind: 'script',
      src: 'https://cdn.example.org/a.js',
      code: null,
      attrs: { async: true, defer: true, type: 'module', id: 'vendor-loader', 'data-account': '42', crossorigin: 'anonymous' },
    })
    expect(allowScriptAttrs({ type: 'text/html', id: '1bad"x' })).toEqual({})
  })

  it('S3 (I1): accepts the settings attribute names crossorigin, referrerpolicy and charset with safe values', () => {
    expect(allowScriptAttrs({ crossorigin: 'use-credentials', referrerpolicy: 'No-Referrer', charset: 'utf-8' })).toEqual({
      crossorigin: 'use-credentials',
      referrerpolicy: 'no-referrer',
      charset: 'utf-8',
    })
    expect(allowScriptAttrs({ crossorigin: 'x"y', referrerpolicy: 'everything', charset: 'utf 8;x' })).toEqual({})
  })

  it('ignores the pre-0018 reader shape and documents without a script', () => {
    expect(parseCustomScript({ parts: [{ kind: 'script', inline: 'x()' }] })).toEqual([])
    expect(parseCustomScript({ version: 1, parts: [{ kind: 'noscript', html: '<img src=x>' }] })).toEqual([])
    expect(parseCustomScript([{ kind: 'script', src: null, code: 'x()', attrs: {} }])).toEqual([])
  })
})

describe('initialConsent', () => {
  it('shows nothing and loads nothing without pixels', () => {
    for (const mode of ['banner', 'notice', 'in_form'] as const) {
      expect(initialConsent(mode, 0, 'granted')).toEqual({ banner: null, granted: false, googleDefault: 'denied' })
    }
  })

  it('banner: opt-in with Consent Mode defaults denied until accepted', () => {
    expect(initialConsent('banner', 2, null)).toEqual({ banner: 'opt_in', granted: false, googleDefault: 'denied' })
    expect(initialConsent('banner', 2, 'granted')).toEqual({ banner: null, granted: true, googleDefault: 'denied' })
    expect(initialConsent('banner', 2, 'denied')).toEqual({ banner: null, granted: false, googleDefault: 'denied' })
  })

  it('notice: loads immediately with defaults granted, dismissable banner', () => {
    expect(initialConsent('notice', 1, null)).toEqual({ banner: 'notice', granted: true, googleDefault: 'granted' })
    expect(initialConsent('notice', 1, 'dismissed')).toEqual({ banner: null, granted: true, googleDefault: 'granted' })
  })

  it('in_form: no banner, waits for the gating consent block', () => {
    expect(initialConsent('in_form', 1, 'granted')).toEqual({ banner: null, granted: false, googleDefault: 'denied' })
  })
})

describe('pixelEventPlan', () => {
  const ctx = { surveyId: 'sid', surveyKey: 'abcdefghij' }

  it('maps doc 02 section 7.3', () => {
    expect(pixelEventPlan('start', ctx)).toEqual({
      ga4: { name: 'survey_start', params: { survey_id: 'sid', survey_key: 'abcdefghij' } },
      meta: { method: 'trackCustom', name: 'SurveyStart', params: { survey_id: 'sid', survey_key: 'abcdefghij' } },
      gtm: { event: 'survey_start', survey_id: 'sid', survey_key: 'abcdefghij' },
      custom: { name: 'survey:start', detail: { survey_id: 'sid', survey_key: 'abcdefghij' } },
    })
    expect(pixelEventPlan('step', { ...ctx, step: 2 }).meta).toBeNull()
    expect(pixelEventPlan('step', { ...ctx, step: 2 }).gtm).toEqual({ event: 'survey_step', survey_id: 'sid', survey_key: 'abcdefghij', step: 2 })
    expect(pixelEventPlan('complete', ctx).meta?.name).toBe('Lead')
    expect(pixelEventPlan('view', ctx).ga4).toBeNull()
  })

  it('never carries anything but survey id, key and step', () => {
    for (const kind of ['view', 'start', 'step', 'complete'] as const) {
      const plan = pixelEventPlan(kind, { ...ctx, step: 1 })
      const keys = new Set<string>()
      for (const part of [plan.ga4?.params, plan.meta?.params, plan.gtm, plan.custom.detail]) for (const k of Object.keys(part ?? {})) keys.add(k)
      keys.delete('event')
      expect([...keys].every((k) => ['survey_id', 'survey_key', 'step'].includes(k))).toBe(true)
    }
  })
})

describe('protocol helpers', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('reads upload ids from pending paths in file answers', () => {
    expect(fileIdFromPath(`w/s/pending/${id}/a.pdf`)).toBe(id)
    expect(fileIdFromPath('w/s/r/a.pdf')).toBeNull()
    expect(fileIdsFromAnswers({ q_a: [{ path: `w/s/pending/${id}/a.pdf`, name: 'a', size: 1, mime: 'x' }], q_b: 'text' })).toEqual([id])
  })

  it('captures hidden fields without r, t or unsafe names', () => {
    expect(hiddenFromSearch('?src=qr&r=secret&t=tok&bad%20name=1&utm_source=mail')).toEqual({ src: 'qr', utm_source: 'mail' })
    expect(Object.keys(hiddenFromSearch(Array.from({ length: 80 }, (_, i) => `k${i}=v`).join('&')))).toHaveLength(50)
  })
})
