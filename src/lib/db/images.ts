import { z } from 'zod'
import type { Tables } from '@/types/db-helpers'
import type { UserClient } from '@/lib/supabase/types'
import { call, id } from './rpc'

/**
 * Workspace image library (migration 0021, doc 03 section 8.1). Members read
 * through list_workspace_images; editors register, label and soft delete
 * through the SQL functions. The Storage upload and its cleanup on a failed
 * register are not SQL and live here too, like the logo upload in
 * workspaces.ts.
 */
export type WorkspaceImage = Tables<'workspace_images'>

export const IMAGE_BUCKET = 'public-assets'
export const IMAGE_KINDS = ['header', 'logo', 'other'] as const
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
/** Same ceiling as the workspace_images.bytes check. */
export const IMAGE_MAX_BYTES = 2_097_152

export const imageKind = z.enum(IMAGE_KINDS)
export const imageLabel = z.string().trim().max(120, 'Use 120 characters or fewer.')

/** `{workspace_id}/images/{id}.{ext}`, the only shape the SQL check accepts for an upload. */
export function imageObjectPath(workspaceId: string, imageId: string, ext: 'png' | 'jpg' | 'webp'): string {
  return `${workspaceId}/images/${imageId}.${ext}`
}

const IMAGE_PATH_RE = /^[0-9a-f-]{36}\/images\/[0-9a-f-]{36}\.(png|jpg|webp)$/

export const listImagesInput = z.object({ workspaceId: id })

/** Live images, newest first. Every member (RLS and the function check). */
export function listWorkspaceImages(client: UserClient, input: z.input<typeof listImagesInput>) {
  return call(
    listImagesInput,
    input,
    (v) => client.rpc('list_workspace_images', { p_workspace_id: v.workspaceId }),
    (rows): WorkspaceImage[] => (rows ?? []) as WorkspaceImage[],
  )
}

export const registerImageInput = z.object({
  workspaceId: id,
  imageId: id,
  path: z.string().regex(IMAGE_PATH_RE),
  kind: imageKind,
  mime: z.enum(IMAGE_MIMES),
  bytes: z.number().int().min(1).max(IMAGE_MAX_BYTES),
  width: z.number().int().min(1).max(20000).nullable(),
  height: z.number().int().min(1).max(20000).nullable(),
  label: imageLabel,
})

/** Editor and above. The object must already exist in public-assets at `path`. */
export function registerWorkspaceImage(client: UserClient, input: z.input<typeof registerImageInput>) {
  return call(
    registerImageInput,
    input,
    (v) =>
      client
        .rpc('register_workspace_image', {
          p_workspace_id: v.workspaceId,
          p_id: v.imageId,
          p_path: v.path,
          p_kind: v.kind,
          p_mime: v.mime,
          p_bytes: v.bytes,
          ...(v.width !== null ? { p_width: v.width } : {}),
          ...(v.height !== null ? { p_height: v.height } : {}),
          p_label: v.label,
        })
        .single(),
    (row): WorkspaceImage => row as unknown as WorkspaceImage,
  )
}

export const labelImageInput = z.object({ imageId: id, label: imageLabel })

export function setWorkspaceImageLabel(client: UserClient, input: z.input<typeof labelImageInput>) {
  return call(
    labelImageInput,
    input,
    (v) => client.rpc('set_workspace_image_label', { p_image_id: v.imageId, p_label: v.label }),
    () => undefined,
  )
}

export const deleteImageInput = z.object({ imageId: id })

/** Soft delete. The Storage object stays, because frozen published versions may reference it. */
export function deleteWorkspaceImage(client: UserClient, input: z.input<typeof deleteImageInput>) {
  return call(deleteImageInput, input, (v) => client.rpc('delete_workspace_image', { p_image_id: v.imageId }), () => undefined)
}

export const uploadImageInput = z.object({
  path: z.string().regex(IMAGE_PATH_RE),
  contentType: z.enum(IMAGE_MIMES),
  bytes: z.instanceof(Uint8Array),
})

/** Storage write under storage.objects RLS: editor under the workspace folder (migration 0008). Never overwrites. */
export function uploadImageObject(client: UserClient, input: z.input<typeof uploadImageInput>) {
  return call(
    uploadImageInput,
    input,
    (v) => client.storage.from(IMAGE_BUCKET).upload(v.path, v.bytes, { contentType: v.contentType, upsert: false, cacheControl: '31536000' }),
    () => undefined,
  )
}

export const removeImageObjectInput = z.object({ path: z.string().regex(IMAGE_PATH_RE) })

/** Cleanup after a failed register only; a registered image is never removed here. */
export function removeImageObject(client: UserClient, input: z.input<typeof removeImageObjectInput>) {
  return call(removeImageObjectInput, input, (v) => client.storage.from(IMAGE_BUCKET).remove([v.path]), () => undefined)
}
