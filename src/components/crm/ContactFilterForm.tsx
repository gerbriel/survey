import { Input, Select } from '@/components/ui'
import { LEAD_STATUSES } from '@/lib/crm/import'
import { LinkButton } from './LinkButton'
import { STATUS_LABELS, type MemberLite } from './types'

export type FilterFormValues = {
  q: string
  status: string[]
  tags: string
  tagmode: string
  owner: string
  follow: string
  lr_from: string
  lr_to: string
}

/** GET form for contact filters. Hidden inputs keep the mode, view and columns. */
export function ContactFilterForm({
  action,
  values,
  members,
  keep,
  tagSuggestions,
}: {
  action: string
  values: FilterFormValues
  members: MemberLite[]
  keep: Record<string, string>
  tagSuggestions: string[]
}) {
  return (
    <form method="get" action={action} className="flex flex-col gap-3 rounded-md border border-border p-3" aria-label="Filters">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4">
        <Input name="q" label="Search" placeholder="Name, email, company, phone" defaultValue={values.q} />
        <Select
          name="owner"
          label="Owner"
          defaultValue={values.owner}
          options={[
            { value: '', label: 'Anyone' },
            { value: 'me', label: 'Me' },
            { value: 'unassigned', label: 'Unassigned' },
            ...members.map((m) => ({ value: m.user_id, label: m.display_name })),
          ]}
        />
        <Select
          name="follow"
          label="Follow-up"
          defaultValue={values.follow}
          options={[
            { value: '', label: 'Any' },
            { value: 'due', label: 'Due today or earlier' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'this_week', label: 'This week' },
            { value: 'unset', label: 'Not set' },
          ]}
        />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input name="tags" label="Tags" list="contact-tag-suggestions" placeholder="vip, event" defaultValue={values.tags} />
          <Select
            name="tagmode"
            label="Match"
            defaultValue={values.tagmode || 'any'}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'all', label: 'All' },
              { value: 'none', label: 'None' },
            ]}
          />
          <datalist id="contact-tag-suggestions">
            {tagSuggestions.slice(0, 200).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <Input name="lr_from" type="date" label="Last response from" defaultValue={values.lr_from} />
        <Input name="lr_to" type="date" label="Last response to" defaultValue={values.lr_to} />
        <fieldset className="col-span-2 flex flex-wrap items-center gap-3">
          <legend className="mb-1 text-sm font-medium">Lead status</legend>
          {LEAD_STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="status" value={s} defaultChecked={values.status.includes(s)} />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg">
          Apply filters
        </button>
        <LinkButton href={`${action}${keep.view ? `?view=${keep.view}` : ''}`}>Clear</LinkButton>
      </div>
    </form>
  )
}
