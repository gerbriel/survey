import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { memberCan } from '@/lib/auth/roles'
import { getMembership, getWorkspaceBySlug, removeLogoObject, setWorkspaceLogoPath, uploadLogoObject } from '@/lib/db/workspaces'
import { checkLogo, LOGO_MAX_BYTES } from '@/lib/admin/image'

/**
 * POST a logo file (doc 05 section 5.1). Checks the role for a clear
 * message, sniffs type and size from the bytes, then uploads with the
 * member's own client: Storage RLS (logo paths need admin) and the
 * workspaces update policy are the authorization.
 */
function reply(status: number, message: string, ok = false) {
  return NextResponse.json({ ok, message }, { status })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // Same-origin only. SameSite=Lax already keeps the session cookie off cross-site POSTs.
  const origin = req.headers.get('origin')
  if (origin && origin !== req.nextUrl.origin) return reply(403, 'Cross-origin upload refused.')

  const { slug } = await params
  const ctx = await getAuthContext()
  if (!ctx || ctx.profile?.status !== 'active') return reply(401, 'Your session has ended. Sign in again.')
  const ws = await getWorkspaceBySlug(ctx.supabase, { slug })
  if (!ws.ok || !ws.data) return reply(404, 'Workspace not found.')
  const role = await getMembership(ctx.supabase, { workspaceId: ws.data.id, userId: ctx.user.id })
  if (!role.ok || !memberCan(role.data, 'admin', ws.data)) return reply(403, 'Only owners and admins can change the logo.')

  // D-18: Content-Length is required, so a chunked body is never buffered unchecked.
  const declared = req.headers.get('content-length')
  const len = declared === null ? NaN : Number(declared)
  if (!Number.isFinite(len) || len <= 0) return reply(411, 'The upload must declare its size. Try again.')
  if (len > LOGO_MAX_BYTES + 64 * 1024) return reply(413, 'The logo must be 1 MB or smaller.')

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    file = f instanceof File ? f : null
  } catch {
    return reply(400, 'Choose an image file.')
  }
  if (!file) return reply(400, 'Choose an image file.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = checkLogo(bytes)
  if (!check.ok) return reply(400, check.message)

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const path = `${ws.data.id}/logo-${hash}.${check.image.ext}`
  const up = await uploadLogoObject(ctx.supabase, { workspaceId: ws.data.id, path, contentType: check.image.mime, bytes })
  if (!up.ok) return reply(400, up.error.message)
  const set = await setWorkspaceLogoPath(ctx.supabase, { workspaceId: ws.data.id, logoPath: path })
  if (!set.ok) return reply(400, set.error.message)
  const old = ws.data.logo_path
  if (old && old !== path) await removeLogoObject(ctx.supabase, { path: old })
  return reply(200, 'Logo updated.', true)
}
