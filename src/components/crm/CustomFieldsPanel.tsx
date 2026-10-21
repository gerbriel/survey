'use client'

import { useState, useTransition } from 'react'
import { Button, Input, Select } from '@/components/ui'
import { customText, fieldOptions, type ActionResult, type FieldDef } from './types'

/** Parse the editor's text into the JSON type contact_field_defs expects. */
export function parseCustomInput(def: Pick<FieldDef, 'type' | 'label'>, raw: string | string[]): unknown {
  if (Array.isArray(raw)) return raw.length ? raw : null
  const s = raw.trim()
  if (s === '') return null
  switch (def.type) {
    case 'number': {
      const n = Number(s)
      if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number.`)
      return n
    }
    case 'boolean':
      return s === 'true'
    default:
      return s
  }
}

function Editor({
  def,
  value,
  onSave,
  onCancel,
  pending,
}: {
  def: FieldDef
  value: unknown
  onSave: (v: string | string[]) => void
  onCancel: () => void
  pending: boolean
}) {
  const opts = fieldOptions(def)
  const [text, setText] = useState(value === undefined || value === null ? '' : Array.isArray(value) ? '' : String(value))
  const [multi, setMulti] = useState<string[]>(Array.isArray(value) ? (value as string[]) : [])
  let control: React.ReactNode
  if (def.type === 'select') {
    control = <Select label={def.label} value={text} placeholder="Not set" onChange={(e) => setText(e.target.value)} options={opts.map((o) => ({ value: o, label: o }))} />
  } else if (def.type === 'boolean') {
    control = (
      <Select
        label={def.label}
        value={text}
        placeholder="Not set"
        onChange={(e) => setText(e.target.value)}
        options={[
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
      />
    )
  } else if (def.type === 'multiselect') {
    control = (
      <fieldset className="flex flex-wrap gap-2">
        <legend className="text-sm font-medium">{def.label}</legend>
        {opts.map((o) => (
          <label key={o} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={multi.includes(o)}
              onChange={(e) => setMulti((m) => (e.target.checked ? [...m, o] : m.filter((x) => x !== o)))}
            />
            {o}
          </label>
        ))}
      </fieldset>
    )
  } else {
    control = (
      <Input
        label={def.label}
        type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'url' ? 'url' : 'text'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    )
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(def.type === 'multiselect' ? multi : text)
      }}
    >
      {control}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function CustomFieldsPanel({
  defs,
  custom: initial,
  canEdit,
  save,
}: {
  defs: FieldDef[]
  custom: Record<string, unknown>
  canEdit: boolean
  save: (values: Record<string, unknown>) => Promise<ActionResult<Record<string, unknown>>>
}) {
  const [custom, setCustom] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const visible = defs.filter((d) => !d.archived)

  return (
    <section aria-label="Custom fields" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Custom fields</h2>
      {visible.length === 0 ? <p className="text-sm text-muted">No custom fields defined for this workspace.</p> : null}
      <dl className="flex flex-col gap-2">
        {visible.map((d) => (
          <div key={d.id}>
            {editing === d.key ? (
              <Editor
                def={d}
                value={custom[d.key]}
                pending={pending}
                onCancel={() => setEditing(null)}
                onSave={(raw) =>
                  start(async () => {
                    let value: unknown
                    try {
                      value = parseCustomInput(d, raw)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Invalid value')
                      return
                    }
                    const r = await save({ [d.key]: value })
                    if (!r.ok) {
                      setError(r.message)
                      return
                    }
                    setError(null)
                    setCustom(r.data)
                    setEditing(null)
                  })
                }
              />
            ) : (
              <>
                <dt className="text-xs text-muted">{d.label}</dt>
                <dd className="flex items-center gap-2 text-sm">
                  {d.type === 'url' && typeof custom[d.key] === 'string' ? (
                    <a href={String(custom[d.key])} rel="noopener noreferrer nofollow" target="_blank" className="text-accent underline">
                      {String(custom[d.key])}
                    </a>
                  ) : (
                    <span>{customText(custom[d.key]) || <span className="text-muted">Not set</span>}</span>
                  )}
                  {canEdit ? (
                    <button type="button" className="text-xs text-accent" aria-label={`Edit ${d.label}`} onClick={() => setEditing(d.key)}>
                      Edit
                    </button>
                  ) : null}
                </dd>
              </>
            )}
          </div>
        ))}
      </dl>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
