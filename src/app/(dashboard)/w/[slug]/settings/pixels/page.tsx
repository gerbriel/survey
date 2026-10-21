import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { memberCan } from '@/lib/auth/roles'
import { getEffectiveLimits } from '@/lib/db/limits'
import { listPixels } from '@/lib/admin/db/pixels'
import type { PixelType } from '@/lib/admin/pixels'
import { EmptyState } from '@/components/ui/EmptyState'
import { PixelForm, PixelsTable, type PixelView } from '@/components/settings/Pixels'
import { removePixel, savePixel } from '../actions'

export const metadata: Metadata = { title: 'Tracking pixels' }

/** Doc 05 section 5.4: editors read, owners and admins manage. Rendering and consent are doc 02. */
export default async function PixelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { workspace, role, supabase } = await requireMember(slug, 'editor', { deniedRedirect: `/w/${slug}/settings/general` })
  const [pixels, limits] = await Promise.all([
    listPixels(supabase, { workspaceId: workspace.id }),
    getEffectiveLimits(supabase, { workspaceId: workspace.id }),
  ])
  const rawAllowed = limits.ok && limits.data ? limits.data.raw_script_pixels_allowed : true
  const canEdit = memberCan(role, 'admin', workspace)
  const rows: PixelView[] = (pixels.ok ? pixels.data : []).map((p) => ({
    id: p.id,
    type: p.type as PixelType,
    value: p.value,
    label: p.label,
    enabled: p.enabled,
  }))
  const save = savePixel.bind(null, workspace.slug)

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-2xl text-sm text-muted">
        Pixels load on every public survey in this workspace. Each survey can turn any of them off. They never load on
        the dashboard. Consent follows the mode in Privacy.
      </p>
      {!rawAllowed ? (
        <p role="status" className="max-w-2xl rounded-md border border-warning p-3 text-sm">
          A platform admin has turned off script pixels (Google Tag Manager and custom scripts) for this workspace.
          Existing ones do not load on public pages.
        </p>
      ) : null}
      <section aria-labelledby="pixel-list" className="flex flex-col gap-4">
        <h2 id="pixel-list" className="text-lg font-semibold">
          Pixels
        </h2>
        {!pixels.ok ? (
          <p role="alert" className="text-sm text-danger">
            {pixels.error.message}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState title="No pixels" description="Public surveys load no tracking tools and show no consent banner." />
        ) : (
          <PixelsTable
            pixels={rows}
            canEdit={canEdit}
            rawAllowed={rawAllowed}
            save={save}
            remove={removePixel.bind(null, workspace.slug)}
          />
        )}
      </section>
      {canEdit ? (
        <section aria-labelledby="pixel-new" className="flex max-w-xl flex-col gap-4">
          <h2 id="pixel-new" className="text-lg font-semibold">
            Add a pixel
          </h2>
          <PixelForm action={save} rawAllowed={rawAllowed} />
        </section>
      ) : null}
    </div>
  )
}
