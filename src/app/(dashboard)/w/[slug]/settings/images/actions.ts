'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireMember } from '@/lib/auth'
import { deleteWorkspaceImage, imageLabel, setWorkspaceImageLabel } from '@/lib/db/images'
import { failure, formFields, fromDbError, fromZodError, success, type ActionState } from '@/lib/admin/forms'

/**
 * Image library mutations (doc 03 section 8.1). requireMember is UX only;
 * the SQL functions check editor and the image's workspace. Uploads go
 * through the route handler in ./upload because of the 1 MB action body cap.
 */

const libraryPath = (slug: string) => `/w/${encodeURIComponent(slug)}/settings/images`
const imageId = z.guid()

export async function renameImage(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireMember(slug, 'editor')
  const parsed = z.object({ imageId, label: imageLabel }).safeParse(formFields(form))
  if (!parsed.success) return fromZodError(parsed.error)
  const r = await setWorkspaceImageLabel(supabase, parsed.data)
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(libraryPath(slug))
  return success('Label saved.')
}

export async function deleteImage(slug: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireMember(slug, 'editor')
  const parsed = imageId.safeParse(form.get('imageId'))
  if (!parsed.success) return failure('That image could not be found.')
  const r = await deleteWorkspaceImage(supabase, { imageId: parsed.data })
  if (!r.ok) return fromDbError(r.error)
  revalidatePath(libraryPath(slug))
  return success('Image removed from the library.')
}
