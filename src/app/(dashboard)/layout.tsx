import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getHostKind } from '@/lib/request-context'
import { ToastProvider } from '@/components/ui/Toast'
import '../globals.css'

// Root of the dashboard host. The workspace chrome lives in w/[slug]/layout.tsx
// and the platform admin chrome in admin/layout.tsx.

export const metadata: Metadata = {
  title: { default: 'Survey', template: '%s | Survey' },
  robots: { index: false, follow: false },
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Second guard after src/proxy.ts: dashboard pages render on DASHBOARD_HOST only.
  if ((await getHostKind()) !== 'dashboard') notFound()
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2"
        >
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
