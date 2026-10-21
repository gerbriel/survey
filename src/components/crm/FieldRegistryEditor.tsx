'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge, Button, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@/components/ui'
import { fieldOptions, type ActionResult, type FieldDef } from './types'

const TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url']
const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Single choice',
  multiselect: 'Multiple choice',
  boolean: 'Yes or no',
  url: 'Link',
}

/** Turns a label into a key that matches ^[a-z][a-z0-9_]{0,39}$. */
export function keyFromLabel(label: string): string {
  const k = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const withLetter = /^[a-z]/.test(k) ? k : `f_${k}`
  return withLetter.slice(0, 40).replace(/_+$/, '') || 'field'
}

/**
 * Workspace custom field registry (contact_field_defs). Keys and types never
 * change after creation; labels, options and order do; archiving hides a
 * field but keeps its data (doc 04 section 1.4).
 */
export function FieldRegistryEditor({
  defs,
  canEdit,
  create,
  update,
}: {
  defs: FieldDef[]
  canEdit: boolean
  create: (v: { key: string; label: string; type: string; options: string[]; position: number }) => Promise<ActionResult>
  update: (id: string, patch: { label?: string; options?: string[]; position?: number; archived?: boolean }) => Promise<ActionResult>
}) {
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState('text')
  const [options, setOptions] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  const effectiveKey = keyTouched ? key : keyFromLabel(label)
  const needsOptions = type === 'select' || type === 'multiselect'
  const splitOptions = (s: string) => [...new Set(s.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean))]

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn()
      if (!r.ok) return setError(r.message)
      setError(null)
      after?.()
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Table caption="Custom fields">
        <THead>
          <Tr>
            <Th>Label</Th>
            <Th>Key</Th>
            <Th>Type</Th>
            <Th>Options</Th>
            <Th>Order</Th>
            {canEdit ? <Th>Actions</Th> : null}
          </Tr>
        </THead>
        <TBody>
          {defs.length === 0 ? (
            <Tr>
              <Td colSpan={6} className="text-muted">
                No custom fields yet.
              </Td>
            </Tr>
          ) : null}
          {defs.map((d, i) => (
            <Tr key={d.id}>
              <Td>
                {canEdit ? (
                  <input
                    aria-label={`Label for ${d.key}`}
                    defaultValue={d.label}
                    className="rounded border border-border bg-surface px-2 py-1 text-sm"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== d.label) run(() => update(d.id, { label: v }))
                    }}
                  />
                ) : (
                  d.label
                )}
                {d.archived ? (
                  <Badge tone="warning" className="ml-2">
                    Archived
                  </Badge>
                ) : null}
              </Td>
              <Td>
                <code className="text-xs">{d.key}</code>
              </Td>
              <Td>{TYPE_LABELS[d.type] ?? d.type}</Td>
              <Td>
                {d.type === 'select' || d.type === 'multiselect' ? (
                  canEdit ? (
                    <input
                      aria-label={`Options for ${d.key}`}
                      defaultValue={fieldOptions(d).join(', ')}
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                      onBlur={(e) => {
                        const next = splitOptions(e.target.value)
                        if (next.join('|') !== fieldOptions(d).join('|') && next.length) run(() => update(d.id, { options: next }))
                      }}
                    />
                  ) : (
                    fieldOptions(d).join(', ')
                  )
                ) : null}
              </Td>
              <Td>{d.position}</Td>
              {canEdit ? (
                <Td className="whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${d.label} up`}
                    disabled={i === 0 || pending}
                    onClick={() => {
                      const prev = defs[i - 1]!
                      run(async () => {
                        const a = await update(d.id, { position: prev.position })
                        if (!a.ok) return a
                        return update(prev.id, { position: d.position === prev.position ? d.position + 1 : d.position })
                      })
                    }}
                  >
                    Up
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => update(d.id, { archived: !d.archived }))}>
                    {d.archived ? 'Restore' : 'Archive'}
                  </Button>
                </Td>
              ) : null}
            </Tr>
          ))}
        </TBody>
      </Table>

      {canEdit ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(
              () =>
                create({
                  key: effectiveKey,
                  label: label.trim(),
                  type,
                  options: needsOptions ? splitOptions(options) : [],
                  position: defs.length ? Math.max(...defs.map((d) => d.position)) + 1 : 0,
                }),
              () => {
                setLabel('')
                setKey('')
                setKeyTouched(false)
                setOptions('')
              },
            )
          }}
        >
          <h2 className="text-base font-semibold">Add a field</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Label" value={label} required maxLength={100} onChange={(e) => setLabel(e.target.value)} />
            <Input
              label="Key"
              hint="Lowercase letters, digits and underscores. Cannot change later."
              value={effectiveKey}
              pattern="[a-z][a-z0-9_]{0,39}"
              onChange={(e) => {
                setKeyTouched(true)
                setKey(e.target.value)
              }}
            />
            <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t]! }))} />
          </div>
          {needsOptions ? (
            <Input label="Options" hint="Separate with commas." value={options} onChange={(e) => setOptions(e.target.value)} />
          ) : null}
          <Button type="submit" className="self-start" loading={pending} disabled={!label.trim() || (needsOptions && !splitOptions(options).length)}>
            Add field
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
