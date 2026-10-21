import { EmptyState } from '@/components/ui/EmptyState'

// Placeholder. Phase 2A turns `/` into a redirect to the last workspace or /login.
export default function DashboardHome() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Survey dashboard</h1>
      <EmptyState title="Nothing here yet" description="Workspaces arrive in Phase 2." />
    </main>
  )
}
