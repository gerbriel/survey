import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getHostKind } from '@/lib/request-context'
import '../globals.css'

// Phase 2C replaces this with the real public layout: pixels, consent UI,
// footer, nonce. Nothing here may import the server or admin Supabase clients
// (ESLint no-restricted-imports enforces it).

export const metadata: Metadata = {
  title: 'Survey',
  robots: { index: false, follow: false },
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Second guard after src/proxy.ts: public pages render on PUBLIC_HOST only.
  if ((await getHostKind()) !== 'public') notFound()
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
