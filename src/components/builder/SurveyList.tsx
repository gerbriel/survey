'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { focusRing } from '@/components/ui/cx'
import { AvatarStack, PersonChip, type Person } from '@/components/dashboard/Avatar'
import {
  archiveSurveyAction,
  bulkArchiveSurveysAction,
  bulkDeleteSurveysAction,
  bulkDuplicateSurveysAction,
  duplicateSurveyAction,
} from '@/lib/builder/actions'
import { bulkSummary } from '@/lib/builder/list'
import type { EffectiveState } from '@/lib/builder/state'
import {
  activeFilterCount,
  applyListQuery,
  clearFilters,
  listQueryHref,
  relativeTime,
  toggleSort,
  visibleSelection,
  type ListQuery,
  type ModelRow,
  type SortKey,
} from './listModel'
import { SurveyListFilters, type OwnerOption } from './SurveyListFilters'

export type { OwnerOption } from './SurveyListFilters'

export interface SurveyListRow extends ModelRow {
  stateText: string
  cap: number | null
  archived: boolean
  owner: Person | null
  collaborators: Person[]
}

const TONE: Record<EffectiveState, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  scheduled: 'warning',
  open: 'success',
  closed: 'danger',
}

/** The export form id; row checkboxes join it through the `form` attribute so it posts without JavaScript too. */
export const EXPORT_FORM_ID = 'survey-bulk-export'

const noop = () => () => {}

/** False on the server and during hydration, true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}

type Failure = { surveyId: string; title: string; message: string }

/** The word a member types to confirm a delete that touches more than one survey or any responses. */
export const DELETE_WORD = 'DELETE'

/** Titles listed in the delete dialog before "and N more". */
const DELETE_LIST_MAX = 10

const surveysN = (n: number) => `${n} survey${n === 1 ? '' : 's'}`

/**
 * Surveys table (doc 03 section 6): sortable columns, combinable filters kept
 * in the query string, multi-select with a sticky bulk bar (export, duplicate,
 * archive or restore, and delete in the archived view) and a per-row actions menu.
 */
export function SurveyList({
  rows,
  base,
  slug,
  exportAction,
  canEdit,
  canDelete = false,
  archivedView,
  initialQuery,
  owners,
  now,
  loadFailed = false,
}: {
  rows: SurveyListRow[]
  base: string
  slug: string
  /** POST target of the Results hub export route. */
  exportAction: string
  canEdit: boolean
  /**
   * Admin and owner (doc 00, Tenancy). UX only: it hides the Delete controls;
   * delete_survey in SQL is what refuses anyone below admin.
   */
  canDelete?: boolean
  archivedView: boolean
  initialQuery: ListQuery
  owners: OwnerOption[]
  now: number
  loadFailed?: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const hydrated = useHydrated()
  const [query, setQuery] = useState(initialQuery)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [failures, setFailures] = useState<Failure[]>([])
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [deleteWord, setDeleteWord] = useState('')
  const returnFocus = useRef<HTMLElement | null>(null)

  const shown = applyListQuery(rows, query, now)
  const picked = visibleSelection(selected, shown)
  const allPicked = shown.length > 0 && picked.length === shown.length
  const somePicked = picked.length > 0 && !allPicked
  const titleOf = (id: string) => rows.find((r) => r.id === id)?.title ?? 'Unknown survey'

  function update(next: ListQuery) {
    // The assignment filter and the archived view change which rows the server loads; everything else is local.
    const server = next.assigned !== query.assigned || (next.state === 'archived') !== (query.state === 'archived')
    setQuery(next)
    const href = listQueryHref(base, next)
    if (server) router.replace(href, { scroll: false })
    else window.history.replaceState(null, '', href)
  }

  function togglePick(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  }

  function toggleAll(on: boolean) {
    setSelected((s) => {
      const n = new Set(s)
      for (const r of shown) {
        if (on) n.add(r.id)
        else n.delete(r.id)
      }
      return n
    })
  }

  async function runOne(id: string, fn: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    setBusy(id)
    const r = await fn()
    setBusy(null)
    if (!r.ok) return toast(r.message ?? 'Something went wrong.', 'error')
    toast(done, 'success')
    router.refresh()
  }

  async function runBulk(kind: 'duplicate' | 'archive' | 'delete', ids: string[] = picked): Promise<boolean> {
    setBusy(`bulk-${kind}`)
    const r =
      kind === 'duplicate'
        ? await bulkDuplicateSurveysAction(slug, ids)
        : kind === 'delete'
          ? await bulkDeleteSurveysAction(slug, ids)
          : await bulkArchiveSurveysAction(slug, ids, !archivedView)
    setBusy(null)
    if (!r.ok) {
      toast(r.message, 'error')
      return false
    }
    const verb = kind === 'duplicate' ? 'duplicated' : kind === 'delete' ? 'deleted' : archivedView ? 'restored' : 'archived'
    const s = bulkSummary(r.data, verb)
    toast(s.text, s.tone)
    const failed = r.data.items.filter((i) => !i.ok)
    setFailures(failed.map((i) => ({ surveyId: i.surveyId, title: titleOf(i.surveyId), message: i.message ?? 'Something went wrong.' })))
    if (kind === 'delete') {
      // A delete can start from one row's menu, so only the deleted surveys leave the selection.
      const gone = new Set(r.data.items.filter((i) => i.ok).map((i) => i.surveyId))
      setSelected((cur) => new Set([...cur].filter((id) => !gone.has(id))))
    } else {
      // Decision: failed surveys stay selected so a retry is one click; the rest are cleared.
      setSelected(new Set(failed.map((i) => i.surveyId)))
    }
    router.refresh()
    return true
  }

  // Delete controls show only in the archived view; canDelete is UX, SQL decides.
  const showDelete = hydrated && canDelete && archivedView

  function openDelete(ids: string[]) {
    if (ids.length === 0) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDeleteWord('')
    setDeleteIds(ids)
  }

  function closeDelete() {
    setDeleteIds(null)
    setDeleteWord('')
    // The native dialog restores focus too, but a row menu's item is hidden by then, so focus goes back to its trigger.
    const el = returnFocus.current
    returnFocus.current = null
    if (el?.isConnected) window.setTimeout(() => el.focus(), 0)
  }

  async function confirmDelete() {
    if (!deleteIds) return
    if (await runBulk('delete', deleteIds)) closeDelete()
  }

  const deleteRows = (deleteIds ?? []).map((id) => rows.find((r) => r.id === id)).filter((r): r is SurveyListRow => r !== undefined)
  const deleteCount = deleteIds?.length ?? 0
  const deleteResponses = deleteRows.reduce((sum, r) => sum + r.responses, 0)
  const needsWord = deleteCount > 1 || deleteResponses > 0
  const wordOk = !needsWord || deleteWord.trim() === DELETE_WORD

  const sortHeader = (key: SortKey, label: string) => {
    const on = query.sort === key
    const next = toggleSort(query, key)
    return (
      <Th aria-sort={on ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <Link
          href={listQueryHref(base, next)}
          scroll={false}
          onClick={(e) => {
            e.preventDefault()
            update(next)
          }}
          className={`inline-flex items-center gap-1 rounded hover:text-fg ${focusRing}`}
        >
          {label}
          <span aria-hidden="true" className={on ? 'text-fg' : 'opacity-40'}>
            {on ? (query.dir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
          <span className="sr-only">{on ? `, sorted ${query.dir === 'asc' ? 'ascending' : 'descending'}. Activate to reverse.` : ', activate to sort.'}</span>
        </Link>
      </Th>
    )
  }

  const filtered = activeFilterCount(query) > 0

  return (
    <div className="flex flex-col gap-4">
      <SurveyListFilters base={base} query={query} owners={owners} shown={shown.length} total={rows.length} hydrated={hydrated} onChange={update} />

      {shown.length === 0 ? (
        <EmptyState
          title={
            loadFailed
              ? 'Surveys could not be loaded'
              : filtered
                ? 'No surveys match these filters'
                : query.state === 'archived'
                  ? 'No archived surveys'
                  : 'No surveys yet'
          }
          description={
            loadFailed
              ? 'Reload the page to try again.'
              : filtered
                ? 'Change or clear the filters to see more surveys.'
                : !archivedView
                  ? 'Create one from scratch or start from a template.'
                  : 'Archived surveys show up here and can be restored.'
          }
          action={
            filtered ? (
              <Button variant="secondary" onClick={() => update(clearFilters(query))}>
                Clear all filters
              </Button>
            ) : !archivedView && !loadFailed && canEdit ? (
              <Link href={`${base}/new`} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">
                New survey
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table caption={`Surveys, ${shown.length} shown`}>
          <THead>
            <Tr>
              <Th className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all shown surveys"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = somePicked
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="h-4 w-4"
                />
              </Th>
              {sortHeader('title', 'Survey')}
              {sortHeader('state', 'State')}
              {sortHeader('responses', 'Responses')}
              {sortHeader('owner', 'Owner')}
              <Th>Collaborators</Th>
              {sortHeader('updated', 'Updated')}
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {shown.map((r) => (
              <Tr key={r.id} className={selected.has(r.id) ? 'bg-surface-muted' : undefined}>
                <Td>
                  <input
                    type="checkbox"
                    form={EXPORT_FORM_ID}
                    name="surveyIds"
                    value={r.id}
                    aria-label={`Select ${r.title}`}
                    checked={selected.has(r.id)}
                    onChange={(e) => togglePick(r.id, e.target.checked)}
                    className="h-4 w-4"
                  />
                </Td>
                <Td className="max-w-xs">
                  <Link href={`${base}/${r.id}/edit`} className="font-medium underline-offset-2 hover:underline">
                    {r.title}
                  </Link>
                  <div className="truncate font-mono text-xs text-muted">{r.slug}</div>
                </Td>
                <Td>
                  <Badge tone={TONE[r.state]}>{r.stateText}</Badge>
                </Td>
                <Td className="whitespace-nowrap">
                  <Link href={`${base}/${r.id}/responses`} className="underline-offset-2 hover:underline">
                    {r.responses}
                    {r.cap ? ` of ${r.cap}` : ''}
                  </Link>
                </Td>
                <Td>{r.owner ? <PersonChip person={r.owner} /> : <span className="text-muted">Unassigned</span>}</Td>
                <Td>
                  <AvatarStack people={r.collaborators} />
                </Td>
                <Td className="whitespace-nowrap">
                  <time dateTime={r.updatedAt} title={new Date(r.updatedAt).toLocaleString()}>
                    {relativeTime(r.updatedAt, now)}
                  </time>
                </Td>
                <Td>
                  <RowMenu
                    row={r}
                    base={base}
                    canEdit={canEdit}
                    busy={busy === r.id}
                    onDuplicate={() => runOne(r.id, () => duplicateSurveyAction(r.id), 'Survey duplicated.')}
                    onArchive={() =>
                      runOne(r.id, () => archiveSurveyAction(r.id, !r.archived), r.archived ? 'Survey restored.' : 'Survey archived. Its public link stops working.')
                    }
                    onDelete={showDelete && r.archived ? () => openDelete([r.id]) : undefined}
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {failures.length > 0 ? (
        <section role="alert" className="rounded-md border border-danger p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-medium text-danger">Some surveys were not changed</h2>
            <Button size="sm" variant="ghost" onClick={() => setFailures([])}>
              Dismiss
            </Button>
          </div>
          <ul className="mt-1 list-disc pl-5">
            {failures.map((f) => (
              <li key={f.surveyId}>
                {f.title}: {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shown.length > 0 && (picked.length > 0 || !hydrated) ? (
        <form
          id={EXPORT_FORM_ID}
          method="post"
          action={exportAction}
          aria-label="Bulk actions"
          className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-3 shadow-lg sm:mx-0 sm:rounded-md sm:border"
        >
          <p role="status" aria-live="polite" className="mr-auto text-sm font-medium">
            {hydrated ? `${picked.length} selected` : 'Tick surveys, then export'}
          </p>
          {/* The Results hub route reads surveyIds (repeated, from the row checkboxes) and format. */}
          <Button type="submit" name="format" value="csv" size="sm" variant="secondary">
            Export CSV
          </Button>
          <Button type="submit" name="format" value="xlsx" size="sm" variant="secondary">
            Export XLSX
          </Button>
          {hydrated && canEdit ? (
            <>
              <Button size="sm" variant="secondary" loading={busy === 'bulk-duplicate'} disabled={busy !== null} onClick={() => runBulk('duplicate')}>
                Duplicate
              </Button>
              <Button size="sm" variant="secondary" loading={busy === 'bulk-archive'} disabled={busy !== null} onClick={() => runBulk('archive')}>
                {archivedView ? 'Restore' : 'Archive'}
              </Button>
            </>
          ) : null}
          {showDelete ? (
            <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => openDelete(picked)}>
              Delete
            </Button>
          ) : null}
          {hydrated ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          ) : null}
        </form>
      ) : null}

      {/* Outside the export form so the confirmation input never posts with it. */}
      <Dialog
        open={deleteIds !== null}
        onClose={closeDelete}
        title={deleteCount === 1 ? 'Delete this survey permanently?' : `Delete ${surveysN(deleteCount)} permanently?`}
        description="This cannot be undone. Public links will stop working."
        footer={
          <>
            <Button variant="secondary" onClick={closeDelete}>
              Cancel
            </Button>
            <Button
              variant="danger"
              aria-label={`Delete ${surveysN(deleteCount)}`}
              loading={busy === 'bulk-delete'}
              disabled={!wordOk || busy !== null}
              onClick={confirmDelete}
            >
              Delete {surveysN(deleteCount)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <ul className="list-disc pl-5" aria-label="Surveys to delete">
            {deleteRows.slice(0, DELETE_LIST_MAX).map((r) => (
              <li key={r.id}>{r.title}</li>
            ))}
            {deleteCount > DELETE_LIST_MAX ? <li>and {deleteCount - DELETE_LIST_MAX} more</li> : null}
          </ul>
          <p>
            {deleteResponses === 0
              ? 'No responses will be deleted.'
              : `${deleteResponses} response${deleteResponses === 1 ? '' : 's'} and their uploaded files will be deleted with ${deleteCount === 1 ? 'it' : 'them'}.`}
          </p>
          {needsWord && deleteIds !== null ? (
            <Input
              label={`Type ${DELETE_WORD} to confirm`}
              value={deleteWord}
              onChange={(e) => setDeleteWord(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
            />
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}

/** Per-row actions: a disclosure menu, keyboard operable, Escape closes it and returns focus. */
function RowMenu({
  row,
  base,
  canEdit,
  busy,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  row: SurveyListRow
  base: string
  canEdit: boolean
  busy: boolean
  onDuplicate: () => void
  onArchive: () => void
  /** Present only in the archived view for admins and owners. */
  onDelete?: (() => void) | undefined
}) {
  const close = (el: HTMLDetailsElement | null) => {
    if (!el) return
    el.open = false
    el.querySelector('summary')?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key === 'Escape' && e.currentTarget.open) {
      e.preventDefault()
      close(e.currentTarget)
    }
  }
  const item = `block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${focusRing}`
  const links: Array<[string, string]> = [
    ['Edit', 'edit'],
    ['Share', 'share'],
    ['Responses', 'responses'],
    ['Analytics', 'analytics'],
  ]
  return (
    <details className="relative" onKeyDown={onKey}>
      <summary
        aria-label={`Actions for ${row.title}`}
        className={`flex h-8 cursor-pointer list-none items-center rounded-md px-2 text-sm hover:bg-surface-muted [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        {busy ? 'Working' : 'Actions'}
        <span aria-hidden="true" className="ml-1">
          {'▾'}
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-44 flex-col rounded-md border border-border bg-surface p-1 shadow-lg">
        {links.map(([label, path]) => (
          <Link key={path} href={`${base}/${row.id}/${path}`} className={item}>
            {label}
          </Link>
        ))}
        {canEdit ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={`${item} disabled:opacity-50`}
              onClick={(e) => {
                close(e.currentTarget.closest('details'))
                onDuplicate()
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${item} disabled:opacity-50`}
              onClick={(e) => {
                close(e.currentTarget.closest('details'))
                onArchive()
              }}
            >
              {row.archived ? 'Restore' : 'Archive'}
            </button>
          </>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            disabled={busy}
            className={`${item} text-danger disabled:opacity-50`}
            onClick={(e) => {
              close(e.currentTarget.closest('details'))
              onDelete()
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </details>
  )
}
