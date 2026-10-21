import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { clientIp, rateKeyIp } = await import('../http')
const { hashIp } = await import('../ratelimit')

const h = (init: Record<string, string>) => new Headers(init)

describe('S9 clientIp header precedence (R17)', () => {
  it('prefers x-vercel-forwarded-for over everything', () => {
    expect(clientIp(h({ 'x-vercel-forwarded-for': '203.0.113.5', 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('203.0.113.5')
  })
  it('then x-real-ip', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('198.51.100.2')
  })
  it('then the LAST x-forwarded-for entry, never the client supplied first one', () => {
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.9 , ' }))).toBe('203.0.113.9')
  })
  it('falls back to a fixed placeholder', () => {
    expect(clientIp(h({}))).toBe('0.0.0.0')
  })
})

describe('S9 rateKeyIp /64 reduction', () => {
  it('leaves IPv4 unchanged', () => {
    expect(rateKeyIp('203.0.113.9')).toBe('203.0.113.9')
  })
  it('reduces IPv6 to the /64 prefix, compressed or not', () => {
    expect(rateKeyIp('2001:db8:1234:5678:9abc:def0:1:2')).toBe('2001:0db8:1234:5678::/64')
    expect(rateKeyIp('2001:db8:1234:5678::1')).toBe('2001:0db8:1234:5678::/64')
    expect(rateKeyIp('2001:DB8:1234:5678:ffff::')).toBe('2001:0db8:1234:5678::/64')
    expect(rateKeyIp('[2001:db8::1]')).toBe('2001:0db8:0000:0000::/64')
    expect(rateKeyIp('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64')
  })
  it('maps IPv4-mapped IPv6 back to IPv4', () => {
    expect(rateKeyIp('::ffff:192.0.2.1')).toBe('192.0.2.1')
  })
  it('two addresses in one /64 share a rate limit hash; another /64 does not', () => {
    const day = new Date('2026-10-21T10:00:00Z')
    const a = hashIp('2001:db8:1:2::a', 'secret-secret-123', day)
    expect(hashIp('2001:db8:1:2:ffff:1:2:3', 'secret-secret-123', day)).toBe(a)
    expect(hashIp('2001:db8:1:3::a', 'secret-secret-123', day)).not.toBe(a)
  })
  it('returns unparseable input unchanged', () => {
    expect(rateKeyIp('not:an:ip:zz')).toBe('not:an:ip:zz')
  })
})
