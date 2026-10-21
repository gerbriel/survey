import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { getHostKind, getNonce } from '@/lib/request-context'
import { NonceProvider } from '@/components/public/NonceContext'
import '../globals.css'

/**
 * Public root layout (doc 02 sections 1, 7 and 9, R15). Host guard, the CSP
 * nonce for client components, nothing cookie bound: no server, browser or
 * auth Supabase client is imported anywhere under (public) (ESLint).
 *
 * Decision: the footer, theme font and pixels are rendered by each page,
 * not here. A root layout receives no route params, so it cannot know the
 * survey's footer values, theme or pixel list. Shared report links under
 * r/[token] (Phase 2E) inherit this layout and load no pixels.
 */

export const metadata: Metadata = {
  title: 'Survey',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Second guard after src/proxy.ts: public pages render on PUBLIC_HOST only.
  if ((await getHostKind()) !== 'public') notFound()
  const nonce = await getNonce()
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <NonceProvider nonce={nonce}>{children}</NonceProvider>
      </body>
    </html>
  )
}
