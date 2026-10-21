'use client'

import { useState } from 'react'
import type { QuestionType } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { IMPORT_HELP, parseImportText, type ImportedQuestion } from '@/lib/builder/importText'
import { TextArea } from './fields'
import { PALETTE_TYPES, TYPE_LABELS } from './model'

const EXAMPLE = `What is your name? *
What is your email address? *
How did you hear about us? [dropdown]
- A friend
- Social media
- Search
---
How likely are you to recommend us?
Anything else? [long]`

/** Paste box plus a preview table to fix types before inserting (doc 03 section 6). */
export function ImportTextPanel({ onInsert, busy, insertLabel = 'Insert questions' }: { onInsert: (pages: ImportedQuestion[][]) => void; busy?: boolean; insertLabel?: string }) {
  const [text, setText] = useState('')
  const [overrides, setOverrides] = useState<Record<number, QuestionType>>({})
  const parsed = parseImportText(text)
  const pages = parsed.pages.map((p) => p.map((q) => ({ ...q, type: overrides[q.line] ?? q.type })))
  const total = pages.reduce((n, p) => n + p.length, 0)
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="list-disc pl-5 text-xs text-muted">
        {IMPORT_HELP.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <TextArea label="Questions" rows={8} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} className="font-mono" />
      {parsed.warnings.length ? (
        <ul role="status" className="list-disc pl-5 text-xs text-warning">
          {parsed.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {total > 0 ? (
        <Table caption="Questions to import">
          <THead>
            <Tr>
              <Th>Page</Th>
              <Th>Question</Th>
              <Th>Type</Th>
              <Th>Options</Th>
            </Tr>
          </THead>
          <TBody>
            {pages.flatMap((p, pi) =>
              p.map((q) => (
                <Tr key={q.line}>
                  <Td>{pi + 1}</Td>
                  <Td>
                    {q.label}
                    {q.required ? ' (required)' : ''}
                  </Td>
                  <Td>
                    <label className="sr-only" htmlFor={`imp-${q.line}`}>
                      Type for line {q.line}
                    </label>
                    <select
                      id={`imp-${q.line}`}
                      value={q.type}
                      onChange={(e) => setOverrides((o) => ({ ...o, [q.line]: e.target.value as QuestionType }))}
                      className="rounded border border-border bg-surface px-1 py-0.5"
                    >
                      {PALETTE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>{q.options.length || ''}</Td>
                </Tr>
              )),
            )}
          </TBody>
        </Table>
      ) : null}
      <Button className="self-start" disabled={total === 0} loading={busy} onClick={() => onInsert(pages)}>
        {insertLabel}
        {total ? ` (${total})` : ''}
      </Button>
    </div>
  )
}

export function ImportTextDialog({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (pages: ImportedQuestion[][]) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Import questions from text" className="max-w-2xl">
      <ImportTextPanel onInsert={onInsert} />
    </Dialog>
  )
}
