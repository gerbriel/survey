'use client'

import { createContext, useContext, type ReactNode } from 'react'

const NonceContext = createContext<string | undefined>(undefined)

/** Carries the per-request CSP nonce (from the x-nonce header) to client components. */
export function NonceProvider({ nonce, children }: { nonce: string | undefined; children: ReactNode }) {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>
}

export function useNonce(): string | undefined {
  return useContext(NonceContext)
}
