import { timingSafeEqual } from 'node:crypto'
import { runRetention } from '@/lib/privacy/retention'

/**
 * Vercel Cron, daily 03:00 UTC (doc 04 section 7.5, R3). Requires
 * `Authorization: Bearer ${CRON_SECRET}`. Logs counts per workspace.
 */
export const maxDuration = 300

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  try {
    const result = await runRetention()
    for (const w of result.workspaces) console.info('retention', JSON.stringify(w))
    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('retention failed', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}
