// Phase 1C renders every survey fixture here. Dev only: src/proxy.ts 404s
// /dev/* outside `next dev`.
export default function DevRendererPage() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Renderer fixtures</h1>
      <p className="text-muted">Empty until Phase 1C.</p>
    </main>
  )
}
