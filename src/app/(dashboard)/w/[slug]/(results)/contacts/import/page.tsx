import Link from 'next/link'
import { ImportWizard } from '@/components/crm/ImportWizard'
import { requireMember } from '@/lib/auth'
import { listFieldDefs } from '@/lib/db/contacts'
import { listMembers } from '@/lib/db/workspaces'
import { listSurveysLite } from '@/lib/db/surveys'
import type { ImportRow } from '@/lib/crm/import'
import { finishImportAction, generateLinksAction, importChunkAction, startImportAction } from '../actions'

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, workspace } = await requireMember(slug, 'editor', { deniedRedirect: `/w/${slug}/contacts` })
  const [defs, members, surveys] = await Promise.all([
    listFieldDefs(supabase, { workspaceId: workspace.id }),
    listMembers(supabase, { workspaceId: workspace.id }),
    listSurveysLite(supabase, { workspaceId: workspace.id }),
  ])
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Link href={`/w/${slug}/contacts`} className="text-sm text-accent">
        Back to contacts
      </Link>
      <h1 className="text-xl font-semibold">Import contacts</h1>
      <ImportWizard
        defaultCountry={workspace.default_country}
        fieldDefs={defs.ok ? defs.data : []}
        members={members.ok ? members.data : []}
        surveys={(surveys.ok ? surveys.data : [])
          .filter((s) => s.latest_published_version_id)
          .map((s) => ({ id: s.id, title: s.title, state: s.state }))}
        today={new Date().toISOString().slice(0, 10)}
        start={startImportAction.bind(null, slug)}
        runChunk={async (importId: string, rows: ImportRow[]) => {
          'use server'
          return importChunkAction(slug, importId, rows)
        }}
        finish={finishImportAction.bind(null, slug)}
        generateLinks={async (emails: string[], surveyId: string, maxResponses: number) => {
          'use server'
          return generateLinksAction(slug, { surveyId, emails, maxResponses })
        }}
      />
    </main>
  )
}
