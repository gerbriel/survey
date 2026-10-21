import { cronAuthorized, runOrphanSweep } from '@/lib/public/sweep'

/** Hourly Vercel Cron on DASHBOARD_HOST (doc 02 section 6). Needs CRON_SECRET. */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request): Promise<Response> {
  if (!cronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    const counts = await runOrphanSweep()
    console.info('[cron] orphan-sweep', JSON.stringify(counts))
    return Response.json({ ok: true, ...counts })
  } catch (e) {
    console.error('[cron] orphan-sweep failed', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}
