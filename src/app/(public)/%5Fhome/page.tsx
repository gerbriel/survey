import { PublicFooter } from '@/components/public/PublicFooter'

// Served at `/` on PUBLIC_HOST via a proxy rewrite (src/proxy.ts). See
// PUBLIC_HOME_PATH in src/lib/hosts.ts for why it lives at /_home.
export default function PublicHome() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Survey</h1>
        <p className="text-muted">Use the link you were given.</p>
      </main>
      <footer className="text-muted">
        <PublicFooter newTab={false} />
      </footer>
    </div>
  )
}
