'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge, Button, EmptyState, Input, Table, TBody, Td, Th, THead, Tr } from '@/components/ui'
import { COLUMN_LABELS } from '@/lib/crm/filters'
import { GenerateLinksDialog, type SurveyOption } from './GenerateLinksDialog'
import { customText, displayName, memberName, STATUS_LABELS, type ActionResult, type Contact, type FieldDef, type MemberLite } from './types'

export type ContactsTableProps = {
  slug: string
  rows: Contact[]
  columns: string[]
  members: MemberLite[]
  fieldDefs: FieldDef[]
  canEdit: boolean
  surveys: SurveyOption[]
  exportHref: string
  nextHref: string | null
  bulkTag: (ids: string[], add: string[], remove: string[]) => Promise<ActionResult<{ updated: number; failed: number }>>
  generateLinks: (
    contactIds: string[],
    surveyId: string,
    maxResponses: number,
  ) => Promise<ActionResult<{ csv: string; count: number; skipped: number }>>
}

function cell(c: Contact, col: string, members: MemberLite[]) {
  switch (col) {
    case 'name':
      return displayName(c)
    case 'lead_status':
      return <Badge>{STATUS_LABELS[c.lead_status] ?? c.lead_status}</Badge>
    case 'owner':
      return memberName(members, c.owner_id)
    case 'tags':
      return c.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </span>
      ) : null
    case 'response_count':
      return c.response_count
    case 'last_response_at':
    case 'created_at':
      return (c[col] ?? '').slice(0, 10)
    case 'follow_up_at':
      return c.follow_up_at ?? ''
    default:
      if (col.startsWith('custom.')) {
        const custom = (c.custom ?? {}) as Record<string, unknown>
        return customText(custom[col.slice(7)])
      }
      return String((c as Record<string, unknown>)[col] ?? '')
  }
}

export function ContactsTable(props: ContactsTableProps) {
  const { slug, rows, columns, members, fieldDefs, canEdit } = props
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tag, setTag] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [linksOpen, setLinksOpen] = useState(false)
  const [pending, start] = useTransition()
  const router = useRouter()
  const ids = [...selected]
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))

  const label = (col: string) =>
    col.startsWith('custom.') ? (fieldDefs.find((d) => d.key === col.slice(7))?.label ?? col.slice(7)) : (COLUMN_LABELS[col] ?? col)

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function runTag(add: boolean) {
    const t = tag.trim()
    if (!t) return
    start(async () => {
      const r = await props.bulkTag(ids, add ? [t] : [], add ? [] : [t])
      setMsg(r.ok ? `Updated ${r.data.updated} contacts.${r.data.failed ? ` ${r.data.failed} failed.` : ''}` : r.message)
      if (r.ok) router.refresh()
    })
  }

  if (rows.length === 0) {
    return <EmptyState title="No contacts match" description="Change the filters, or import contacts from a CSV file." />
  }

  const exportHref = selected.size ? `/w/${slug}/contacts/export?ids=${ids.join(',')}` : props.exportHref

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3" aria-label="Bulk actions">
          <p className="mr-2 self-center text-sm text-muted">{selected.size ? `${selected.size} selected` : 'Select contacts for bulk actions'}</p>
          <div className="w-48">
            <Input label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} />
          </div>
          <Button size="sm" variant="secondary" disabled={!selected.size || !tag.trim()} loading={pending} onClick={() => runTag(true)}>
            Add tag
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size || !tag.trim()} loading={pending} onClick={() => runTag(false)}>
            Remove tag
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setLinksOpen(true)}>
            Generate links
          </Button>
          {selected.size >= 2 && selected.size <= 5 ? (
            <Link className="self-center text-sm text-accent underline" href={`/w/${slug}/contacts/merge?ids=${ids.join(',')}`}>
              Merge selected
            </Link>
          ) : null}
          <a className="self-center text-sm text-accent underline" href={exportHref}>
            {selected.size ? 'Export selected' : 'Export CSV'}
          </a>
          {msg ? (
            <p role="status" className="w-full text-sm">
              {msg}
            </p>
          ) : null}
        </div>
      ) : null}
      <Table caption="Contacts">
        <THead>
          <Tr>
            {canEdit ? (
              <Th>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </Th>
            ) : null}
            {columns.map((c) => (
              <Th key={c}>{label(c)}</Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.id} data-testid="contact-row">
              {canEdit ? (
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${displayName(r)}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </Td>
              ) : null}
              {columns.map((c, i) => (
                <Td key={c}>
                  {i === 0 ? (
                    <Link href={`/w/${slug}/contacts/${r.id}`} className="text-accent underline-offset-2 hover:underline">
                      {cell(r, c, members) || displayName(r)}
                    </Link>
                  ) : (
                    cell(r, c, members)
                  )}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
      {props.nextHref ? (
        <Link href={props.nextHref} className="self-end text-sm text-accent">
          Next page
        </Link>
      ) : null}
      {canEdit ? (
        <GenerateLinksDialog
          open={linksOpen}
          onClose={() => setLinksOpen(false)}
          surveys={props.surveys}
          target={`${selected.size} selected contacts`}
          generate={(surveyId, max) => props.generateLinks(ids, surveyId, max)}
        />
      ) : null}
    </div>
  )
}
