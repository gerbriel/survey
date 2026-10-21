import { NextResponse, type NextRequest } from 'next/server'
import { runWorkspacePurge } from '@/lib/admin/purge'

/**
 * Vercel Cron (R3): hard deletes workspaces past the 30 day restore window
 * and removes their Storage objects. The CRON_SECRET bearer check happens
 * inside runWorkspacePurge before the service role is created.
 */
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const r = await runWorkspacePurge(req.headers.get('authorization'))
  return NextResponse.json(r.body, { status: r.status })
}
