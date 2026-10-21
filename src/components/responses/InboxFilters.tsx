import { Input, Select } from '@/components/ui'
import { LinkButton } from '@/components/crm/LinkButton'

/** Plain GET form: filters live in the URL so links and reloads keep them. */
export function InboxFilters({
  action,
  status,
  identity,
  version,
  from,
  to,
  versions,
}: {
  action: string
  status: string
  identity: string
  version: string
  from: string
  to: string
  versions: { id: string; label: string }[]
}) {
  return (
    <form method="get" action={action} className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
      <Select
        name="status"
        label="Status"
        defaultValue={status}
        options={[
          { value: 'complete', label: 'Complete' },
          { value: 'all', label: 'Complete and partial' },
        ]}
      />
      <Select
        name="identity"
        label="Respondent"
        defaultValue={identity}
        options={[
          { value: 'all', label: 'Everyone' },
          { value: 'token', label: 'Personal link' },
          { value: 'identified', label: 'Linked to a contact' },
          { value: 'anonymous', label: 'Anonymous' },
        ]}
      />
      <Select
        name="version"
        label="Version"
        defaultValue={version}
        options={[{ value: 'all', label: 'All versions' }, { value: 'latest', label: 'Latest' }, ...versions.map((v) => ({ value: v.id, label: v.label }))]}
      />
      <Input name="from" type="date" label="From" defaultValue={from} />
      <Input name="to" type="date" label="To" defaultValue={to} />
      <div className="flex gap-2">
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          Apply
        </button>
        <LinkButton href={action} className="h-10">
          Reset
        </LinkButton>
      </div>
    </form>
  )
}
