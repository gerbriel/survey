import type { Metadata } from 'next'
import { requireMember } from '@/lib/auth'
import { memberCan } from '@/lib/auth/roles'
import { logoPublicUrl } from '@/lib/admin/db/workspace'
import { canRequestDeletion, deletionAvailableAt, formatDate } from '@/lib/admin/lifecycle'
import { GeneralForm } from '@/components/settings/GeneralForm'
import { LifecycleCard } from '@/components/settings/LifecycleCard'
import { LogoUploader } from '@/components/settings/LogoUploader'
import { archive, removeLogo, requestDeletion, unarchive, updateGeneral } from '../actions'

export const metadata: Metadata = { title: 'General settings' }

export default async function GeneralSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { workspace, role, supabase } = await requireMember(slug)
  const canEdit = memberCan(role, 'admin', workspace)
  const theme = workspace.default_theme && typeof workspace.default_theme === 'object' && Object.keys(workspace.default_theme).length
    ? JSON.stringify(workspace.default_theme, null, 2)
    : ''
  const deleteAt = deletionAvailableAt(workspace)

  return (
    <div className="flex flex-col gap-10">
      {sp.renamed ? (
        <p role="status" className="text-sm text-success">
          Address changed. The old address redirects here for 30 days.
        </p>
      ) : null}
      <section aria-labelledby="general-heading" className="flex flex-col gap-4">
        <h2 id="general-heading" className="text-lg font-semibold">
          General
        </h2>
        <GeneralForm
          action={updateGeneral.bind(null, workspace.slug)}
          canEdit={canEdit}
          values={{ name: workspace.name, slug: workspace.slug, defaultTheme: theme, showPoweredBy: workspace.show_powered_by }}
        />
      </section>
      <section aria-labelledby="logo-heading" className="flex flex-col gap-4">
        <h2 id="logo-heading" className="text-lg font-semibold">
          Logo
        </h2>
        <LogoUploader
          uploadUrl={`/w/${encodeURIComponent(workspace.slug)}/settings/general/logo`}
          logoUrl={logoPublicUrl(supabase, workspace.logo_path)}
          removeAction={removeLogo.bind(null, workspace.slug)}
          canEdit={canEdit}
        />
      </section>
      {role === 'owner' ? (
        <LifecycleCard
          slug={workspace.slug}
          archived={workspace.archived_at !== null}
          deletionAvailable={canRequestDeletion(workspace)}
          deletionAvailableOn={deleteAt ? formatDate(deleteAt) : null}
          archiveAction={archive.bind(null, workspace.slug)}
          unarchiveAction={unarchive.bind(null, workspace.slug)}
          deleteAction={requestDeletion.bind(null, workspace.slug)}
        />
      ) : null}
    </div>
  )
}
