import { handleSubmit } from '@/lib/public/submit'

// POST only: Next answers other methods with 405. Logic and the order of
// checks live in src/lib/public/submit.ts (server only, service role).
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  try {
    return await handleSubmit(req)
  } catch (e) {
    console.error('[public] /api/public/submit failed', e)
    return Response.json({ ok: false, code: 'server_error' }, { status: 500, headers: { 'cache-control': 'no-store' } })
  }
}
