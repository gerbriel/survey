'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Checkbox } from './form'

export type PickerPerson = {
  id: string
  name: string
  /** Extra text after the name, for example a role, or an email on admin pages only. */
  detail?: string | null
}

/** Case-insensitive match on name and detail. Pure, unit tested. */
export function filterPeople<T extends PickerPerson>(people: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return people
  return people.filter((p) => p.name.toLowerCase().includes(q) || (p.detail ?? '').toLowerCase().includes(q))
}

function optionLabel(p: PickerPerson): string {
  return p.detail ? `${p.name} (${p.detail})` : p.name
}

/**
 * Pick one person: a search box that narrows a native select, so keyboard,
 * screen reader and mobile behavior come from the platform. The select posts
 * `name` (the person id) with its form. The chosen person stays listed while
 * the search changes.
 */
export function PersonPicker({
  people,
  name,
  label,
  placeholder = 'Pick a person',
  required = true,
  hint,
}: {
  people: PickerPerson[]
  name: string
  label: string
  placeholder?: string
  required?: boolean
  hint?: string
}) {
  const [query, setQuery] = useState('')
  const [value, setValue] = useState('')
  const matches = filterPeople(people, query)
  const chosen = people.find((p) => p.id === value)
  const options = chosen && !matches.includes(chosen) ? [chosen, ...matches] : matches
  return (
    <div className="flex flex-col gap-2">
      <Input label={`Search: ${label.toLowerCase()}`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      <Select
        label={label}
        name={name}
        required={required}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={matches.length === 0 ? 'No one matches the search' : placeholder}
        options={options.map((p) => ({ value: p.id, label: optionLabel(p) }))}
        hint={hint ?? `${matches.length} of ${people.length} shown`}
      />
    </div>
  )
}

/**
 * Pick several people: a search box over a list of checkboxes, each posting
 * `name` with the person id. Checked people stay listed while the search
 * changes.
 */
export function PeopleMultiPicker({ people, name, legend }: { people: PickerPerson[]; name: string; legend: string }) {
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const legendId = useId()
  const matches = filterPeople(people, query)
  const shown = people.filter((p) => checked.has(p.id) || matches.includes(p))
  function toggle(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }
  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-2">
      <legend id={legendId} className="text-sm font-medium text-fg">
        {legend}
      </legend>
      <Input label={`Search: ${legend.toLowerCase()}`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No one matches the search.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
          {shown.map((p) => (
            <li key={p.id}>
              <Checkbox
                name={name}
                value={p.id}
                checked={checked.has(p.id)}
                onChange={(e) => toggle(p.id, e.target.checked)}
                label={optionLabel(p)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted" aria-live="polite">
        {people.filter((p) => checked.has(p.id)).length} selected
      </p>
    </fieldset>
  )
}
