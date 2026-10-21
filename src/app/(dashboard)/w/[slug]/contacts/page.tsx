import { ContactFilterForm } from '@/components/crm/ContactFilterForm'
import { ContactsTable } from '@/components/crm/ContactsTable'
import { ContactsToolbar, type ViewLink } from '@/components/crm/ContactsToolbar'
import { BOARD_LIMIT, KanbanBoard } from '@/components/crm/KanbanBoard'
import { LinkButton } from '@/components/crm/LinkButton'
import { requireMember, roleAtLeast } from '@/lib/auth'
import { searchContacts, type Contact } from '@/lib/db/contacts'
import { listContactViews, listFieldDefs, listMembers, listSurveysLite, listWorkspaceTags } from '@/lib/crm/data/contacts'
import {
  decodeCursor,
  encodeCursor,
  filtersToParams,
  paramsToColumns,
  paramsToFilters,
  type SearchParams,
} from '@/lib/crm/filters'
import { LEAD_STATUSES, type LeadStatus } from '@/lib/crm/import'
import {
  bulkTagAction,
  createContactAction,
  deleteViewAction,
  generateLinksAction,
  saveViewAction,
  updateContactAction,
} from './actions'

const PAGE = 50
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<SearchParams>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { supabase, workspace, role, user } = await requireMember(slug, 'viewer')
  const canEdit = roleAtLeast(role, 'editor') && !workspace.archived_at
  const board = one(sp.view) === 'board'
  const base = `/w/${slug}/contacts`

  const [views, members, defs, surveys, tags] = await Promise.all([
    listContactViews(supabase, { workspaceId: workspace.id }),
    listMembers(supabase, { workspaceId: workspace.id }),
    listFieldDefs(supabase, { workspaceId: workspace.id }),
    canEdit ? listSurveysLite(supabase, { workspaceId: workspace.id }) : Promise.resolve(null),
    listWorkspaceTags(supabase, { workspaceId: workspace.id }),
  ])
  const viewList = views.ok ? views.data : []
  const memberList = members.ok ? members.data : []
  const defList = defs.ok ? defs.data : []
  const activeView = viewList.find((v) => v.id === one(sp.sv)) ?? null

  const filters = paramsToFilters(sp)
  const columns = paramsToColumns(sp, activeView?.columns.length ? activeView.columns : undefined)
  const filterQuery = filtersToParams(filters)
  const keepQuery = new URLSearchParams(filterQuery)
  if (board) keepQuery.set('view', 'board')

  const viewLinks: ViewLink[] = viewList.map((v) => {
    const p = filtersToParams((v.filters ?? {}) as Parameters<typeof filtersToParams>[0])
    p.set('sv', v.id)
    if (v.columns.length) p.set('cols', v.columns.join(','))
    if (board) p.set('view', 'board')
    return { view: v, href: `${base}?${p.toString()}`, mine: v.created_by === user.id }
  })

  const modeHref = (toBoard: boolean) => {
    const p = new URLSearchParams(filterQuery)
    if (activeView) p.set('sv', activeView.id)
    if (toBoard) p.set('view', 'board')
    return `${base}?${p.toString()}`
  }

  let content: React.ReactNode
  let loadError: string | null = null
  if (board) {
    const statuses = filters.lead_status?.length ? (filters.lead_status as LeadStatus[]) : [...LEAD_STATUSES]
    const results = await Promise.all(
      statuses.map((s) =>
        searchContacts(supabase, { workspaceId: workspace.id, filters: { ...filters, lead_status: [s] }, limit: BOARD_LIMIT }),
      ),
    )
    const columnsByStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, [] as Contact[]])) as Record<LeadStatus, Contact[]>
    statuses.forEach((s, i) => {
      const r = results[i]
      if (r?.ok) columnsByStatus[s] = r.data
      else if (r) loadError = r.error.message
    })
    content = (
      <KanbanBoard
        key={filterQuery.toString()}
        slug={slug}
        columns={columnsByStatus}
        members={memberList}
        canEdit={canEdit}
        listHref={(() => {
          const p = new URLSearchParams(filterQuery)
          p.delete('status')
          return `${base}?${p.toString()}`
        })()}
        move={async (contactId: string, to: LeadStatus) => {
          'use server'
          return updateContactAction(slug, contactId, { lead_status: to })
        }}
      />
    )
  } else {
    const cursor = decodeCursor(sp.cursor)
    const r = await searchContacts(supabase, { workspaceId: workspace.id, filters, cursor, limit: PAGE })
    const rows = r.ok ? r.data : []
    if (!r.ok) loadError = r.error.message
    const last = rows[rows.length - 1]
    let nextHref: string | null = null
    if (rows.length === PAGE && last) {
      const p = new URLSearchParams(filterQuery)
      if (activeView) p.set('sv', activeView.id)
      p.set('cols', columns.join(','))
      p.set('cursor', encodeCursor({ updated_at: last.updated_at, id: last.id }))
      nextHref = `${base}?${p.toString()}`
    }
    const exportQuery = new URLSearchParams(filterQuery)
    exportQuery.set('cols', columns.join(','))
    content = (
      <ContactsTable
        key={`${filterQuery.toString()}|${one(sp.cursor)}`}
        slug={slug}
        rows={rows}
        columns={columns}
        members={memberList}
        fieldDefs={defList}
        canEdit={canEdit}
        surveys={(surveys && surveys.ok ? surveys.data : [])
          .filter((s) => s.latest_published_version_id)
          .map((s) => ({ id: s.id, title: s.title, state: s.state }))}
        exportHref={`${base}/export?${exportQuery.toString()}`}
        nextHref={nextHref}
        bulkTag={bulkTagAction.bind(null, slug)}
        generateLinks={async (contactIds: string[], surveyId: string, maxResponses: number) => {
          'use server'
          return generateLinksAction(slug, { surveyId, contactIds, maxResponses })
        }}
      />
    )
  }

  const owner = filters.owner
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <div className="flex gap-2">
          <LinkButton href={modeHref(false)} variant={board ? 'secondary' : 'primary'}>
            List
          </LinkButton>
          <LinkButton href={modeHref(true)} variant={board ? 'primary' : 'secondary'}>
            Board
          </LinkButton>
        </div>
      </header>
      <ContactsToolbar
        slug={slug}
        views={viewLinks}
        activeViewId={activeView?.id ?? null}
        columns={columns}
        fieldDefs={defList}
        currentQuery={keepQuery.toString()}
        canEdit={canEdit}
        saveView={async (name: string, shared: boolean) => {
          'use server'
          return saveViewAction(slug, { name, shared, filters, columns })
        }}
        deleteView={deleteViewAction.bind(null, slug)}
        createContact={createContactAction.bind(null, slug)}
      />
      <ContactFilterForm
        action={base}
        members={memberList}
        tagSuggestions={tags.ok ? tags.data : []}
        keep={{ view: board ? 'board' : '', cols: one(sp.cols), sv: activeView?.id ?? '' }}
        values={{
          q: filters.q ?? '',
          status: (filters.lead_status as string[] | undefined) ?? [],
          tags: filters.tags?.values.join(', ') ?? '',
          tagmode: filters.tags?.mode ?? 'any',
          owner: owner?.me ? 'me' : owner?.unassigned ? 'unassigned' : (owner?.ids?.[0] ?? ''),
          follow: filters.follow_up ?? '',
          lr_from: one(sp.lr_from),
          lr_to: one(sp.lr_to),
        }}
      />
      {loadError ? (
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      ) : null}
      {content}
    </main>
  )
}
