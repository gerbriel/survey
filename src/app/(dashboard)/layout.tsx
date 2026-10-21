import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getHostKind } from '@/lib/request-context'
import { ToastProvider } from '@/components/ui/Toast'
import '../globals.css'

// Phase 2A adds the workspace chrome under w/[slug]/layout.tsx.

export const metadata: Metadata = {
  title: 'Survey',
  robots: { index: false, follow: false },
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Second guard after src/proxy.ts: dashboard pages render on DASHBOARD_HOST only.
  if ((await getHostKind()) !== 'dashboard') notFound()
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
