import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { dashboardOrigin } from '@/lib/auth/paths'
import { getAuthContext } from '@/lib/auth'
import { memberCan } from '@/lib/auth/roles'
import { getMembership, getWorkspaceBySlug } from '@/lib/db/workspaces'
import { imageKind, imageLabel, imageObjectPath, registerWorkspaceImage, removeImageObject, uploadImageObject } from '@/lib/db/images'
import { checkLibraryImage, IMAGE_UPLOAD_MAX_BYTES } from '@/lib/images/check'

/**
 * POST an image to the workspace library (doc 03 section 8.1), multipart
 * with `file`, optional `kind` (header, logo, other) and `label`. Same
 * hardening as the logo route: same origin, Content-Length required, type
 * and pixel size sniffed from the bytes, 2 MB cap. Uploads with the member's
 * own client to public-assets at {workspace_id}/images/{id}.{ext} (Storage
 * RLS: editor), then registers through register_workspace_image, which is
 * the authorization. Returns the image record.
 *
 * Decision: this lives at settings/images/upload, not settings/images,
 * because Next refuses a route.ts next to the library page.tsx.
 */
function reply(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get('origin')
  if (origin && origin !== dashboardOrigin()) return reply(403, 'Cross-origin upload refused.')

  const { slug } = await params
  const ctx = await getAuthContext()
  if (!ctx || ctx.profile?.status !== 'active') return reply(401, 'Your session has ended. Sign in again.')
  const ws = await getWorkspaceBySlug(ctx.supabase, { slug })
  if (!ws.ok || !ws.data) return reply(404, 'Workspace not found.')
  const role = await getMembership(ctx.supabase, { workspaceId: ws.data.id, userId: ctx.user.id })
  if (!role.ok || !memberCan(role.data, 'editor', ws.data)) return reply(403, 'Only editors, admins and owners can add images.')

  // D-18: Content-Length is required, so a chunked body is never buffered unchecked.
  const declared = req.headers.get('content-length')
  const len = declared === null ? NaN : Number(declared)
  if (!Number.isFinite(len) || len <= 0) return reply(411, 'The upload must declare its size. Try again.')
  if (len > IMAGE_UPLOAD_MAX_BYTES + 64 * 1024) return reply(413, 'Images must be 2 MB or smaller.')

  let file: File | null = null
  let kindRaw: unknown = 'header'
  let labelRaw: unknown = ''
  try {
    const form = await req.formData()
    const f = form.get('file')
    file = f instanceof File ? f : null
    kindRaw = form.get('kind') ?? 'header'
    labelRaw = form.get('label') ?? ''
  } catch {
    return reply(400, 'Choose an image file.')
  }
  if (!file) return reply(400, 'Choose an image file.')
  const kind = imageKind.safeParse(kindRaw)
  if (!kind.success) return reply(400, 'Pick header, logo or other.')
  const label = imageLabel.safeParse(typeof labelRaw === 'string' ? labelRaw : '')
  if (!label.success) return reply(400, 'Use a label of 120 characters or fewer.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = checkLibraryImage(bytes)
  if (!check.ok) return reply(400, check.message)

  const imageId = randomUUID()
  const path = imageObjectPath(ws.data.id, imageId, check.image.ext)
  const up = await uploadImageObject(ctx.supabase, { path, contentType: check.image.mime, bytes })
  if (!up.ok) return reply(400, 'The upload failed. Try again.')
  // Decision: an empty label defaults to the file name without its extension.
  const fallback = file.name.replace(/\.[^.]*$/, '').trim().slice(0, 120)
  const reg = await registerWorkspaceImage(ctx.supabase, {
    workspaceId: ws.data.id,
    imageId,
    path,
    kind: kind.data,
    mime: check.image.mime,
    bytes: bytes.length,
    width: check.image.width,
    height: check.image.height,
    label: label.data || fallback,
  })
  if (!reg.ok) {
    await removeImageObject(ctx.supabase, { path })
    return reply(400, reg.error.message)
  }
  return NextResponse.json({ ok: true, message: 'Image added.', image: reg.data }, { status: 200 })
}
