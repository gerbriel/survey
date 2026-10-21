'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { filtersToQuery, type AnalyticsFilters, type RangeKey } from '@/lib/analytics/filters'

export type FilterQuestion = { key: string; label: string; type: string; options: { id: string; label: string }[] }

const LEAD = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'customer', label: 'Customer' },
  { value: 'lost', label: 'Lost' },
]

/**
 * One filter row above everything it scopes (doc 04 section 4.3, dataviz:
 * filters live above the charts, never inside a card). Applies by updating
 * the URL so the server re-renders every chart from the same slice.
 */
export function FilterBar({
  filters,
  versions,
  questions,
  currentUserId,
  basePath,
}: {
  filters: AnalyticsFilters
  versions: { id: string; version_no: number }[]
  questions: FilterQuestion[]
  currentUserId: string
  basePath: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [f, setF] = useState<AnalyticsFilters>(filters)
  const set = (patch: Partial<AnalyticsFilters>) => setF((x) => ({ ...x, ...patch }))
  const choice = questions.filter((q) => q.options.length > 0)
  const numeric = questions.filter((q) => ['number', 'rating', 'nps', 'calculated'].includes(q.type))
  const answerQ = questions.find((q) => q.key === f.answer?.question_key)

  function apply(next: AnalyticsFilters) {
    const q = filtersToQuery(next)
    start(() => router.push(q ? `${basePath}?${q}` : basePath))
  }

  const contactActive = f.lead.length > 0 || f.tags.length > 0 || f.owners.length > 0

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:hidden"
      aria-label="Analytics filters"
      onSubmit={(e) => {
        e.preventDefault()
        apply(f)
      }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Select
          label="Date range"
          value={f.range}
          onChange={(e) => set({ range: e.target.value as RangeKey })}
          options={[
            { value: '7d', label: 'Last 7 days' },
            { value: '30d', label: 'Last 30 days' },
            { value: '90d', label: 'Last 90 days' },
            { value: 'all', label: 'All time' },
            { value: 'custom', label: 'Custom range' },
          ]}
        />
        {f.range === 'custom' ? (
          <>
            <Input label="From" type="date" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
            <Input label="To" type="date" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
          </>
        ) : null}
        <Select
          label="Version"
          value={f.version}
          onChange={(e) => set({ version: e.target.value })}
          options={[
            { value: 'latest', label: 'Latest published' },
            { value: 'all', label: 'All versions' },
            ...[...versions].reverse().map((v) => ({ value: v.id, label: `Version ${v.version_no}` })),
          ]}
        />
        <Select
          label="Identity"
          value={f.identity}
          onChange={(e) => set({ identity: e.target.value as AnalyticsFilters['identity'] })}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'token', label: 'Personal link' },
            { value: 'identified', label: 'Identified' },
            { value: 'anonymous', label: 'Anonymous' },
          ]}
        />
        <Select
          label="Status"
          value={f.status}
          onChange={(e) => set({ status: e.target.value as AnalyticsFilters['status'] })}
          options={[
            { value: 'complete', label: 'Complete only' },
            { value: 'all', label: 'Include partial' },
          ]}
        />
      </div>

      <details open={contactActive || f.answer !== null || f.crossTab !== null}>
        <summary className="cursor-pointer text-sm text-muted hover:text-fg">Contact, answer and cross-tab filters</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-fg">Lead status</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {LEAD.map((l) => (
                <label key={l.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={f.lead.includes(l.value)}
                    onChange={(e) => set({ lead: e.target.checked ? [...f.lead, l.value] : f.lead.filter((x) => x !== l.value) })}
                  />
                  {l.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Input
            label="Tags"
            hint="Comma separated, any of"
            value={f.tags.join(', ')}
            onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          />
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={f.owners.includes(currentUserId)}
              onChange={(e) => set({ owners: e.target.checked ? [currentUserId] : [] })}
            />
            Contacts I own
          </label>
          {contactActive ? <p className="self-end text-xs text-muted">Contact filters leave out anonymous responses.</p> : null}

          <Select
            label="Answer filter"
            value={f.answer?.question_key ?? ''}
            placeholder="None"
            onChange={(e) => set({ answer: e.target.value ? { question_key: e.target.value } : null })}
            options={[...choice, ...numeric].map((q) => ({ value: q.key, label: q.label || q.key }))}
          />
          {answerQ && answerQ.options.length > 0 ? (
            <fieldset className="flex flex-col gap-1 md:col-span-2">
              <legend className="text-sm font-medium text-fg">Is any of</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {answerQ.options.map((o) => {
                  const on = f.answer?.any_of?.includes(o.id) ?? false
                  return (
                    <label key={o.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const cur = f.answer?.any_of ?? []
                          set({ answer: { question_key: answerQ.key, any_of: e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id) } })
                        }}
                      />
                      {o.label}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ) : answerQ ? (
            <>
              <Input
                label="Minimum"
                type="number"
                value={f.answer?.min ?? ''}
                onChange={(e) => set({ answer: { ...f.answer!, min: e.target.value === '' ? undefined : Number(e.target.value) } })}
              />
              <Input
                label="Maximum"
                type="number"
                value={f.answer?.max ?? ''}
                onChange={(e) => set({ answer: { ...f.answer!, max: e.target.value === '' ? undefined : Number(e.target.value) } })}
              />
            </>
          ) : null}
          <Select
            label="Cross-tab by"
            hint="Choice questions show a table against this question"
            value={f.crossTab ?? ''}
            placeholder="None"
            onChange={(e) => set({ crossTab: e.target.value || null })}
            options={choice.map((q) => ({ value: q.key, label: q.label || q.key }))}
          />
        </div>
      </details>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Apply filters
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            start(() => router.push(basePath))
          }}
        >
          Reset
        </Button>
      </div>
    </form>
  )
}
