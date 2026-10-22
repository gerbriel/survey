import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { memberCan } from '@/lib/auth/roles'
import { listWorkspaceImages } from '@/lib/db/images'
import { publicAssetUrl } from '@/lib/builder/share'
import { ImageLibrary } from '@/components/settings/ImageLibrary'
import { deleteImage, renameImage } from './actions'

export const metadata: Metadata = { title: 'Images' }

/** Workspace image library (doc 03 section 8.1). Every member sees it; editors and above change it. */
export default async function ImagesSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { workspace, role, supabase } = await requireMember(slug)
  const canEdit = memberCan(role, 'editor', workspace)
  const r = await listWorkspaceImages(supabase, { workspaceId: workspace.id })
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const images = r.ok
    ? r.data.map((img) => ({
        id: img.id,
        label: img.label,
        url: publicAssetUrl(base, img.path),
        kind: img.kind,
        width: img.width,
        height: img.height,
        bytes: img.bytes,
      }))
    : []

  return (
    <div className="flex flex-col gap-4">
      {!r.ok ? (
        <p role="alert" className="text-sm text-danger">
          {r.error.message}
        </p>
      ) : null}
      <ImageLibrary
        images={images}
        uploadUrl={`/w/${encodeURIComponent(workspace.slug)}/settings/images/upload`}
        canEdit={canEdit}
        renameAction={renameImage.bind(null, workspace.slug)}
        deleteAction={deleteImage.bind(null, workspace.slug)}
      />
    </div>
  )
}
