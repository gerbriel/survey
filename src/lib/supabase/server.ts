import 'server-only'

// Phase 1D implements this (docs/06-build-plan.md, docs/02-public-delivery.md section 1).
// Cookie-bound server client for the dashboard host (server components, route handlers). Never imported under src/app/(public).
export function createServerClient(): never {
  throw new Error('not implemented in Phase 0')
}
