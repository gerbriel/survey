import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getResponseFile, signResponseFile } from '@/lib/db/responses'

/**
 * Authenticated file redirect (doc 04 section 6: signed URLs expire and leak,
 * so links point here). The server client runs as the member: RLS on
 * response_files and on storage.objects decides, then a 60 second signed URL
 * is minted. `?inline=1` skips the download disposition (signature images).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string; id: string; fileId: string }> }) {
  const { slug, id, fileId } = await ctx.params
  const auth = await getAuthContext()
  if (!auth) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/w/${slug}/surveys/${id}/responses`)}`, req.url))
  }
  const file = await getResponseFile(auth.supabase, { fileId })
  if (!file.ok || !file.data || file.data.status !== 'attached') {
    return new NextResponse('Not found', { status: 404 })
  }
  const inline = req.nextUrl.searchParams.get('inline') === '1'
  const signed = await signResponseFile(auth.supabase, {
    path: file.data.object_path,
    name: file.data.original_name,
    download: !inline,
  })
  if (!signed.ok) return new NextResponse('Not found', { status: 404 })
  const res = NextResponse.redirect(signed.data, 302)
  res.headers.set('Cache-Control', 'private, no-store')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}
