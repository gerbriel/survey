'use client'

import { orderMatrixRows, type MatrixQuestion } from '@/lib/survey'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { richTextPlain } from '../richtext'
import { nativeCheck } from './shared'

function asMatrix(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string') out[k] = x
  return out
}

/**
 * Likert matrix as a real table: column headers in the head, a row header per
 * statement, and one native radio group per row. Arrow keys move within a row
 * (browser radio behavior); Tab moves between rows.
 */
export function MatrixInput({ question, value, onChange, inputId, labelId, describedBy, invalid, errors, ctx }: InputProps<MatrixQuestion>) {
  const rows = orderMatrixRows(question, ctx.seed)
  const cols = question.settings.columns
  const m = asMatrix(value)
  const badRows = new Set(errors.map((e) => e.row_id).filter(Boolean))
  const set = (rowId: string, colId: string) => onChange({ ...m, [rowId]: colId })
  return (
    <Table caption={richTextPlain(question.label, ctx.definition, ctx.state)} aria-labelledby={labelId} aria-describedby={describedBy}>
        <THead>
          <Tr>
            <Td className="min-w-32">
              <span className="sr-only">Statement</span>
            </Td>
            {cols.map((c) => (
              <Th key={c.id} id={`${inputId}-c-${c.id}`} className="text-center text-sm">
                {c.label}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((r, ri) => {
            const rowInvalid = badRows.has(r.id) || (invalid && badRows.size === 0)
            return (
              <Tr key={r.id} className={cx(badRows.has(r.id) && 'bg-[color-mix(in_srgb,var(--sv-error)_8%,transparent)]')}>
                <Th scope="row" id={`${inputId}-r-${r.id}`} className="text-sm text-fg">
                  {r.label}
                </Th>
                {cols.map((c, ci) => (
                  <Td key={c.id} className="p-0 text-center">
                    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                      <input
                        id={ri === 0 && ci === 0 ? inputId : undefined}
                        type="radio"
                        name={`${inputId}-${r.id}`}
                        value={c.id}
                        checked={m[r.id] === c.id}
                        className={cx(nativeCheck, 'focus-visible:ring-2 focus-visible:ring-focus')}
                        aria-labelledby={`${inputId}-r-${r.id} ${inputId}-c-${c.id}`}
                        data-invalid-row={rowInvalid || undefined}
                        onChange={() => set(r.id, c.id)}
                      />
                    </label>
                  </Td>
                ))}
              </Tr>
            )
          })}
        </TBody>
    </Table>
  )
}
