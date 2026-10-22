import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext, memberCan } from '@/lib/auth'
import { getMembership, getWorkspaceBySlug, listMembers } from '@/lib/db/workspaces'
import { listFieldDefs } from '@/lib/db/contacts'
import { logExport } from '@/lib/db/exports'
import { contactsCsvStream } from '@/lib/crm/export'
import { paramsToFilters } from '@/lib/crm/filters'

/** Contact CSV export, editor and above (doc 04 section 1.6). RLS applies to every read; log_export records it. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const auth = await getAuthContext()
  if (!auth) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/w/${slug}/contacts`)}`, req.url))
  const ws = await getWorkspaceBySlug(auth.supabase, { slug })
  if (!ws.ok || !ws.data) return new NextResponse('Not found', { status: 404 })
  const role = await getMembership(auth.supabase, { workspaceId: ws.data.id, userId: auth.user.id })
  // Viewers can read contacts but not export them. Archived workspaces still allow export reads.
  if (!role.ok || !memberCan(role.data, 'editor', { archived_at: null })) {
    return new NextResponse('Exports need the editor role.', { status: 403 })
  }
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const filters = paramsToFilters(sp)
  const ids = (sp.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
  const [defs, members] = await Promise.all([
    listFieldDefs(auth.supabase, { workspaceId: ws.data.id }),
    listMembers(auth.supabase, { workspaceId: ws.data.id }),
  ])
  const stream = contactsCsvStream(auth.supabase, {
    workspaceId: ws.data.id,
    filters,
    ids,
    defs: defs.ok ? defs.data.filter((d) => !d.archived) : [],
    members: members.ok ? members.data : [],
    onDone: async (rows) => {
      const log = await logExport(auth.supabase, {
        workspaceId: ws.data!.id,
        kind: 'contacts',
        scope: { filters, ...(ids.length ? { selected_ids: ids.length } : {}) },
        rowCount: rows,
      })
      if (!log.ok) console.error('contact export log failed', log.error.code)
    },
  })
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contacts-${ws.data.slug}-${date}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
