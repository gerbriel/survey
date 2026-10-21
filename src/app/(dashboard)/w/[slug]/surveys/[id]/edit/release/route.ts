import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { releaseDraftLock } from '@/lib/db/surveys'

/**
 * Best-effort lock release from navigator.sendBeacon when the editor tab
 * closes (doc 03 section 9). release_draft_lock only clears a lock the
 * caller holds, so there is nothing to authorize here beyond the session.
 */
export async function POST(req: NextRequest) {
  let versionId: unknown
  try {
    versionId = ((await req.json()) as { versionId?: unknown }).versionId
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (typeof versionId !== 'string') return new NextResponse(null, { status: 400 })
  const client = await createServerClient()
  const r = await releaseDraftLock(client, { versionId })
  return new NextResponse(null, { status: r.ok ? 204 : 400 })
}
