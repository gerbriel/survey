'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { newChildId } from '@/lib/builder/ops'
import { TextArea } from './fields'

type Item = { id: string; label: string }

/**
 * Ordered list editor for options, matrix rows and matrix columns. Ids are
 * generated once and never change (00 R5), so relabeling and reordering are
 * safe changes. `extra` renders per-item controls (score, Other, exclusive).
 */
export function OptionsEditor<T extends Item>({
  title,
  items,
  kind,
  onChange,
  extra,
  disabled,
  bulk,
}: {
  title: string
  items: T[]
  kind: 'option' | 'row' | 'column'
  onChange: (items: T[]) => void
  extra?: (item: T, update: (patch: Partial<T>) => void) => ReactNode
  disabled?: boolean
  /** Show the bulk paste box (dropdown lists). */
  bulk?: boolean
}) {
  const [paste, setPaste] = useState('')
  const noun = kind === 'option' ? 'option' : kind
  const update = (i: number, patch: Partial<T>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j] as T, next[i] as T]
    onChange(next)
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{title}</legend>
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
            <Input label={`${noun[0]?.toUpperCase()}${noun.slice(1)} ${i + 1}`} value={it.label} disabled={disabled} onChange={(e) => update(i, { label: e.target.value } as Partial<T>)} />
            {extra ? extra(it, (patch) => update(i, patch)) : null}
            {!disabled ? (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  Down
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {!disabled ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => onChange([...items, { id: newChildId(kind, items), label: `${noun[0]?.toUpperCase()}${noun.slice(1)} ${items.length + 1}` } as T])}
        >
          Add {noun}
        </Button>
      ) : null}
      {bulk && !disabled ? (
        <div className="flex flex-col gap-2">
          <TextArea label="Paste options, one per line" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} />
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={!paste.trim()}
            onClick={() => {
              const next = [...items]
              for (const line of paste.split(/\r?\n/)) {
                const label = line.trim()
                if (label) next.push({ id: newChildId(kind, next), label } as T)
              }
              onChange(next)
              setPaste('')
            }}
          >
            Add pasted options
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}
