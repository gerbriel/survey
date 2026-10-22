import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/w/team/contacts/abc' }))

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}))

const { default: ResultsLayout } = await import('@/app/(dashboard)/w/[slug]/(results)/layout')
const { GET: oldPage } = await import('@/app/(dashboard)/w/[slug]/privacy-tools/route')
const { GET: oldExport } = await import('@/app/(dashboard)/w/[slug]/privacy-tools/export/route')

describe('results layout', () => {
  it('renders three tabs with the active one from the pathname', async () => {
    const html = renderToStaticMarkup(await ResultsLayout({ children: <p>page body</p>, params: Promise.resolve({ slug: 'team' }) }))
    expect(html).toContain('aria-label="Results sections"')
    for (const href of ['/w/team/results', '/w/team/compare', '/w/team/contacts']) expect(html).toContain(`href="${href}"`)
    expect(html.match(/<a /g)).toHaveLength(3)
    expect(html).toMatch(/aria-current="page"[^>]*>Contacts<|href="\/w\/team\/contacts"[^>]*aria-current="page"/)
    expect(html).not.toMatch(/aria-current="page"[^>]*>Responses</)
    expect(html).toContain('page body')
  })
})

describe('privacy tools redirects', () => {
  it('sends the old page to settings with its query', async () => {
    const res = await oldPage(new Request('http://localhost:3000/w/team/privacy-tools?q=abc'), { params: Promise.resolve({ slug: 'team' }) })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('/w/team/settings/privacy-tools?q=abc')
  })

  it('sends the old export route to the new export route', async () => {
    const res = await oldExport(new Request('http://localhost:3000/w/team/privacy-tools/export?contact=c1'), {
      params: Promise.resolve({ slug: 'team' }),
    })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('/w/team/settings/privacy-tools/export?contact=c1')
  })
})
