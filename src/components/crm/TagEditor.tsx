'use client'

import { useState, useTransition } from 'react'
import { Badge, Button, Input } from '@/components/ui'
import { normalizeTag } from '@/lib/crm/email'
import type { ActionResult } from './types'

export function TagEditor({
  tags: initial,
  suggestions,
  canEdit,
  save,
}: {
  tags: string[]
  suggestions: string[]
  canEdit: boolean
  save: (tags: string[]) => Promise<ActionResult<unknown>>
}) {
  const [tags, setTags] = useState(initial)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function commit(next: string[]) {
    const before = tags
    setTags(next)
    start(async () => {
      const r = await save(next)
      if (!r.ok) {
        setTags(before)
        setError(r.message)
      } else setError(null)
    })
  }

  return (
    <section aria-label="Tags" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Tags</h2>
      <ul className="flex flex-wrap gap-1">
        {tags.length === 0 ? <li className="text-sm text-muted">No tags</li> : null}
        {tags.map((t) => (
          <li key={t}>
            <Badge>
              {t}
              {canEdit ? (
                <button
                  type="button"
                  className="ml-1 text-muted hover:text-danger"
                  aria-label={`Remove tag ${t}`}
                  disabled={pending}
                  onClick={() => commit(tags.filter((x) => x !== t))}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              ) : null}
            </Badge>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = normalizeTag(draft)
            if (!t || tags.includes(t)) return
            setDraft('')
            commit([...tags, t].sort())
          }}
        >
          <Input label="Add tag" list="tag-suggestions" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} />
          <datalist id="tag-suggestions">
            {suggestions.slice(0, 200).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Add
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
