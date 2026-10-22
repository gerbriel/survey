import { controlClass } from '@/components/ui/Field'
import type { ResultsFilters } from '@/lib/analytics/results-filters'
import type { ResultColumn } from '@/lib/analytics/results'

/**
 * Results hub filters: one plain GET form above the table (dataviz: filters
 * in one row above what they scope). No client script; submitting reloads
 * the server page with the new query. Column choices ride in the same form.
 */

const LEAD = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['qualified', 'Qualified'],
  ['customer', 'Customer'],
  ['lost', 'Lost'],
] as const

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
      {children}
    </label>
  )
}

export function ResultsFilterForm({
  action,
  filters,
  surveys,
  members,
  columns,
  pickedColumns,
  hiddenParams,
}: {
  action: string
  filters: ResultsFilters
  surveys: { id: string; title: string; state: string }[]
  members: { user_id: string; display_name: string }[]
  columns: ResultColumn[]
  pickedColumns: string[]
  hiddenParams: string[]
}) {
  const chosen = new Set(filters.surveys)
  const cols = new Set(pickedColumns)
  const metaKeys = [...hiddenParams.map((p) => `hidden.${p}`), ...UTM]
  return (
    <form method="get" action={action} aria-label="Filter responses" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:hidden">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <details className="relative">
          <summary className={`${controlClass} flex cursor-pointer items-center`}>
            {chosen.size ? `${chosen.size} surveys selected` : 'Surveys: all open and closed'}
          </summary>
          <fieldset className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface p-2 shadow">
            <legend className="sr-only">Surveys</legend>
            {surveys.map((s) => (
              <label key={s.id} className="flex items-center gap-2 py-1 text-sm text-fg">
                <input type="checkbox" name="surveys" value={s.id} defaultChecked={chosen.has(s.id)} />
                <span className="truncate">{s.title}</span>
                {s.state === 'draft' ? <span className="text-xs text-muted">(draft)</span> : null}
              </label>
            ))}
          </fieldset>
        </details>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-range">Date range</Label>
          <select id="rf-range" name="range" defaultValue={filters.range} className={controlClass}>
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="rf-from">From (custom)</Label>
            <input id="rf-from" type="date" name="from" defaultValue={filters.from ?? ''} className={controlClass} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="rf-to">To (custom)</Label>
            <input id="rf-to" type="date" name="to" defaultValue={filters.to ?? ''} className={controlClass} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-status">Status</Label>
          <select id="rf-status" name="status" defaultValue={filters.status} className={controlClass}>
            <option value="all">Complete and partial</option>
            <option value="complete">Complete</option>
            <option value="partial">Partial</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-version">Version</Label>
          <input
            id="rf-version"
            name="version"
            list="rf-version-list"
            placeholder="all, latest, or v2"
            defaultValue={filters.version === 'all' ? '' : typeof filters.version === 'number' ? `v${filters.version}` : filters.version}
            className={controlClass}
          />
          <datalist id="rf-version-list">
            <option value="all" />
            <option value="latest" />
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-identity">Identity</Label>
          <select id="rf-identity" name="identity" defaultValue={filters.identity} className={controlClass}>
            <option value="all">Everyone</option>
            <option value="token">Token links</option>
            <option value="identified">Identified contacts</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-lead">Lead status</Label>
          <select id="rf-lead" name="lead" defaultValue={filters.lead[0] ?? ''} className={controlClass}>
            <option value="">Any</option>
            {LEAD.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-tags">Tags (comma separated)</Label>
          <input id="rf-tags" name="tags" defaultValue={filters.tags.join(', ')} className={controlClass} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-owner">Contact owner</Label>
          <select id="rf-owner" name="owner" defaultValue={filters.owners[0] ?? ''} className={controlClass}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="rf-mk">Hidden field or UTM</Label>
            <select id="rf-mk" name="mk" defaultValue={filters.meta?.key ?? ''} className={controlClass}>
              <option value="">None</option>
              {metaKeys.map((k) => (
                <option key={k} value={k}>
                  {k.startsWith('hidden.') ? `Hidden: ${k.slice(7)}` : k}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="rf-mv">Value</Label>
            <input id="rf-mv" name="mv" defaultValue={filters.meta?.value ?? ''} className={controlClass} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rf-q">Search open text answers</Label>
          <input id="rf-q" type="search" name="q" minLength={2} maxLength={100} defaultValue={filters.text ?? ''} className={controlClass} />
        </div>
        <details className="relative">
          <summary className={`${controlClass} flex cursor-pointer items-center`}>Columns</summary>
          <fieldset className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface p-2 shadow">
            <legend className="sr-only">Answer columns</legend>
            {columns.length === 0 ? <p className="text-xs text-muted">No questions in the selected surveys.</p> : null}
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 py-1 text-sm text-fg">
                <input type="checkbox" name="cols" value={c.key} defaultChecked={cols.has(c.key)} />
                <span className="truncate" title={c.label}>
                  {c.label}
                </span>
                <span className="text-xs text-muted">{c.surveys > 1 ? `${c.surveys} surveys` : ''}</span>
              </label>
            ))}
          </fieldset>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90">
          Apply filters
        </button>
        <a href={action} className="text-sm text-accent underline">
          Reset
        </a>
        {filters.lead.length || filters.tags.length || filters.owners.length ? (
          <span className="text-xs text-muted">Contact filters leave out anonymous responses.</span>
        ) : null}
      </div>
    </form>
  )
}
