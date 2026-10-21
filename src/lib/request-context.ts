import 'server-only'
import { headers } from 'next/headers'
import { classifyHost, type HostKind } from '@/lib/hosts'

/** The per-request CSP nonce set by src/proxy.ts. Pass it to any next/script. */
export async function getNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined
}

/** Which hostname this request arrived on. Layouts use it as a second guard. */
export async function getHostKind(): Promise<HostKind> {
  const h = await headers()
  return classifyHost(h.get('host'), {
    DASHBOARD_HOST: process.env.DASHBOARD_HOST,
    PUBLIC_HOST: process.env.PUBLIC_HOST,
  })
}
