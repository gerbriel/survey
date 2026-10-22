import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/auth'
import { gdprExport } from '@/lib/privacy/gdpr'

/**
 * GDPR export for one respondent (doc 04 section 7.3), editor and above.
 * export_respondent_data logs `gdpr_export` in activity_log as the member.
 * The editor downloads the JSON and delivers it themselves.
 */
type Ctx = { params: Promise<{ slug: string }> }

export async function GET(req: Request, { params }: Ctx) {
  const { slug } = await params
  const m = await requireMember(slug, 'editor')
  const contactId = new URL(req.url).searchParams.get('contact') ?? ''
  const r = await gdprExport(m.supabase, contactId)
  if (!r.ok) {
    const status = r.error.code === 'invalid_input' ? 400 : r.error.category === 'auth' ? 403 : 500
    return NextResponse.json({ error: r.error.message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
  return new Response(JSON.stringify(r.data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="respondent-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
