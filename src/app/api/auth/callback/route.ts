import type { NextRequest } from 'next/server'
import { handleAuthCallback } from '@/lib/auth'

/**
 * OAuth return. Exchanges the code for a host-only session, claims invite
 * tokens from the HttpOnly cookies, then redirects with postSignInPath
 * (src/lib/auth/callback.ts). SQL decides what a token is worth.
 */
export async function GET(req: NextRequest) {
  return handleAuthCallback(req)
}
