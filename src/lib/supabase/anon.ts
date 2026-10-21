// Phase 1D implements this (docs/06-build-plan.md, docs/02-public-delivery.md section 1).
// Anon-key client with no cookie adapter, for public pages. Anon may call exactly two SQL functions and has no table grants.
export function createAnonClient(): never {
  throw new Error('not implemented in Phase 0')
}
