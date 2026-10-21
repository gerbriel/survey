import type { NextConfig } from 'next'

/**
 * Security headers that are the same on both hostnames live here.
 *
 * Deliberately ABSENT: Content-Security-Policy. It differs by hostname and
 * carries a per-request nonce, so `src/proxy.ts` sets it (doc 02 section 7.1).
 * Setting one here too would make browsers enforce both, and the intersection
 * would break the public pixel policy.
 *
 * Also absent: Access-Control-Allow-Origin. Route handlers are same-origin
 * by default and that is the protection.
 */
const nextConfig: NextConfig = {
  devIndicators: false,
  // `next dev` otherwise rewrites a block into AGENTS.md that contains an em
  // dash, which fails `pnpm check:copy`. AGENTS.md carries the same guidance.
  agentRules: false,
  // Both dev hostnames load dev assets from the same server.
  allowedDevOrigins: ['survey.localhost', 's.localhost'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ]
  },
}

export default nextConfig
