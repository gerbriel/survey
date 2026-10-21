import 'server-only'

// Phase 1D implements this (docs/06-build-plan.md, docs/02-public-delivery.md section 1).
// Service-role client. Bypasses RLS. Route handlers only, after the caller is authenticated and authorized. Never imported under src/app/(public).
export function createAdminClient(): never {
  throw new Error('not implemented in Phase 0')
}
