'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cx } from '@/components/ui/cx'
import { Avatar, type Person } from '@/components/dashboard/Avatar'
import { activeFilterCount, clearFilters, listQueryHref, type ListQuery, type StateFilter, type UpdatedRange } from './listModel'
import type { AssignmentFilter } from '@/lib/db/assignments'

export type OwnerOption = Person & { id: string }

export const STATE_OPTIONS: Array<{ value: StateFilter; label: string }> = [
  { value: 'any', label: 'Any state' },
  { value: 'draft', label: 'Not public (draft)' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
]

export const ASSIGNED_OPTIONS: Array<{ value: AssignmentFilter; label: string }> = [
  { value: 'all', label: 'Everyone' },
  { value: 'mine', label: 'Assigned to me' },
  { value: 'owned', label: 'Owned by me' },
  { value: 'unassigned', label: 'Unassigned' },
]

export const UPDATED_OPTIONS: Array<{ value: UpdatedRange; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

/**
 * Filters row. A plain GET form, so it works before hydration and without
 * JavaScript (the Apply button submits it); with JavaScript every change
 * applies at once through `onChange`. On narrow screens the fields collapse
 * behind a "Filters" button.
 */
export function SurveyListFilters({
  base,
  query,
  owners,
  shown,
  total,
  hydrated,
  onChange,
}: {
  base: string
  query: ListQuery
  owners: OwnerOption[]
  shown: number
  total: number
  hydrated: boolean
  onChange: (next: ListQuery) => void
}) {
  const [open, setOpen] = useState(false)
  const active = activeFilterCount(query)
  const ownerList = query.owner && !owners.some((o) => o.id === query.owner) ? [...owners, { id: query.owner, name: 'Former member', avatarUrl: null }] : owners
  const chosenOwner = ownerList.find((o) => o.id === query.owner)
  const set = (patch: Partial<ListQuery>) => onChange({ ...query, ...patch })
  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (!hydrated) return
    e.preventDefault()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {hydrated ? (
          <Button variant="secondary" size="sm" className="sm:hidden" aria-expanded={open} aria-controls="survey-filters" onClick={() => setOpen((o) => !o)}>
            Filters{active ? ` (${active})` : ''}
          </Button>
        ) : null}
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {active ? `${shown} of ${total} surveys match` : `${total} survey${total === 1 ? '' : 's'}`}
        </p>
        {active ? (
          <Link
            href={listQueryHref(base, clearFilters(query))}
            onClick={(e) => {
              e.preventDefault()
              onChange(clearFilters(query))
            }}
            className="text-sm underline"
          >
            Clear all filters
          </Link>
        ) : null}
      </div>
      <form
        id="survey-filters"
        role="search"
        aria-label="Filter surveys"
        method="get"
        action={base}
        onSubmit={submit}
        className={cx('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(9rem,1fr))_auto] lg:items-end', hydrated && !open ? 'hidden sm:grid' : '')}
      >
        <Input label="Search" type="search" name="q" placeholder="Title or slug" value={query.q} maxLength={200} onChange={(e) => set({ q: e.target.value })} />
        <Select label="State" name="state" options={STATE_OPTIONS} value={query.state} onChange={(e) => set({ state: e.target.value as StateFilter })} />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Select
              label="Owner"
              name="owner"
              placeholder="Anyone"
              options={ownerList.map((o) => ({ value: o.id, label: o.name }))}
              value={query.owner}
              onChange={(e) => set({ owner: e.target.value })}
            />
          </div>
          {chosenOwner ? <Avatar person={chosenOwner} className="mb-1.5" /> : null}
        </div>
        <Select label="Assigned" name="assigned" options={ASSIGNED_OPTIONS} value={query.assigned} onChange={(e) => set({ assigned: e.target.value as AssignmentFilter })} />
        <Select label="Updated" name="updated" options={UPDATED_OPTIONS} value={query.updated} onChange={(e) => set({ updated: e.target.value as UpdatedRange })} />
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="dir" value={query.dir} />
        {hydrated ? null : (
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        )}
      </form>
    </div>
  )
}
