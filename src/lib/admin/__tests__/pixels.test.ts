import { describe, expect, it } from 'vitest'
import { isRawScriptType, parseAttributes, parseCustomScript, pixelValueError } from '../pixels'

describe('pixelValueError', () => {
  it('matches the SQL check constraint patterns', () => {
    expect(pixelValueError('ga4', 'G-ABC123DEF4')).toBeNull()
    expect(pixelValueError('ga4', 'UA-1234')).toMatch(/Google Analytics 4/)
    expect(pixelValueError('meta', '123456789012')).toBeNull()
    expect(pixelValueError('meta', '1234')).not.toBeNull()
    expect(pixelValueError('gtm', 'GTM-ABC1234')).toBeNull()
    expect(pixelValueError('gtm', 'gtm-abc')).not.toBeNull()
  })

  it('treats gtm and custom_script as raw script types', () => {
    expect(isRawScriptType('gtm')).toBe(true)
    expect(isRawScriptType('custom_script')).toBe(true)
    expect(isRawScriptType('ga4')).toBe(false)
  })
})

describe('parseAttributes', () => {
  it('reads quoted, unquoted and boolean attributes', () => {
    expect(parseAttributes(` src="https://a.example/x.js" async data-id='7' defer type=module`)).toEqual({
      src: 'https://a.example/x.js',
      async: true,
      'data-id': '7',
      defer: true,
      type: 'module',
    })
  })
})

describe('parseCustomScript', () => {
  it('parses script src, inline script, noscript and comments in order', () => {
    const r = parseCustomScript(`
      <!-- vendor -->
      <script async src="https://cdn.vendor.example/tag.js"></script>
      <script>window.vendor = window.vendor || []; vendor.push('init')</script>
      <noscript><img src="https://px.vendor.example/1.gif" alt=""></noscript>
    `)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.version).toBe(1)
    expect(r.parsed.parts).toEqual([
      { kind: 'script', src: 'https://cdn.vendor.example/tag.js', code: null, attrs: { async: true } },
      { kind: 'script', src: null, code: "window.vendor = window.vendor || []; vendor.push('init')", attrs: {} },
      { kind: 'noscript', html: '<img src="https://px.vendor.example/1.gif" alt="">' },
    ])
  })

  it('rejects anything that is not a script or noscript element', () => {
    expect(parseCustomScript('<div>hi</div>')).toEqual({ ok: false, message: expect.stringContaining('Only <script>') })
    expect(parseCustomScript('plain text')).toMatchObject({ ok: false })
    expect(parseCustomScript('<iframe src="https://x.example"></iframe>')).toMatchObject({ ok: false })
    expect(parseCustomScript('<script>a()</script><style>b{}</style>')).toMatchObject({ ok: false })
  })

  it('rejects unsafe attributes and sources', () => {
    expect(parseCustomScript('<script src="http://insecure.example/x.js"></script>')).toMatchObject({ ok: false, message: expect.stringContaining('https') })
    expect(parseCustomScript('<script src="javascript:alert(1)"></script>')).toMatchObject({ ok: false })
    expect(parseCustomScript('<script onload="x()" src="https://a.example/x.js"></script>')).toMatchObject({ ok: false, message: expect.stringContaining('Event handler') })
    expect(parseCustomScript('<script nonce="abc">x()</script>')).toMatchObject({ ok: false, message: expect.stringContaining('nonce') })
    expect(parseCustomScript('<script type="text/html">x</script>')).toMatchObject({ ok: false })
    expect(parseCustomScript('<script src="https://a.example/x.js">inline()</script>')).toMatchObject({ ok: false })
  })

  it('rejects unclosed tags, scripts inside noscript, and empty input', () => {
    expect(parseCustomScript('<script>x()')).toMatchObject({ ok: false, message: expect.stringContaining('not closed') })
    expect(parseCustomScript('<script>a()</script><noscript><script>b()</script></noscript>')).toMatchObject({ ok: false })
    expect(parseCustomScript('   ')).toMatchObject({ ok: false })
    expect(parseCustomScript('<noscript><img src="https://x.example/p.gif"></noscript>')).toMatchObject({ ok: false, message: expect.stringContaining('at least one') })
    expect(parseCustomScript(`<script>${'x'.repeat(10_001)}</script>`)).toMatchObject({ ok: false })
  })
})
