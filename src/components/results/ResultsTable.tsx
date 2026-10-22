import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import type { ResultColumn, TableRow } from '@/lib/analytics/results'

/**
 * Results hub table: one row per response across the selected surveys. The
 * whole row opens the existing response detail page (a stretched link on the
 * survey cell keeps it one tab stop). Server component.
 */

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

export function ResultsTable({
  rows,
  columns,
  total,
  page,
  pageSize,
  pageHref,
}: {
  rows: TableRow[]
  columns: ResultColumn[]
  total: number
  page: number
  pageSize: number
  pageHref: (page: number) => string
}) {
  if (!rows.length) return <EmptyState title="No responses match" description="Change the surveys or filters above to see responses." />
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = page * pageSize + 1
  const last = Math.min(total, first + rows.length - 1)
  return (
    <div className="flex flex-col gap-3">
      <Table caption="Responses across surveys">
        <THead>
          <Tr>
            <Th>Survey</Th>
            <Th>Submitted at (UTC)</Th>
            <Th>Respondent</Th>
            <Th>Version</Th>
            <Th>Device</Th>
            {columns.map((c) => (
              <Th key={c.key} title={c.label} className="max-w-48 truncate">
                {c.label}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.id} className="relative hover:bg-surface-muted focus-within:bg-surface-muted">
              <Td className="max-w-56">
                <Link href={r.href} className="block truncate font-medium text-fg after:absolute after:inset-0 after:content-['']" title={`Open response in ${r.survey}`}>
                  {r.survey}
                </Link>
              </Td>
              <Td className="whitespace-nowrap tabular-nums">
                {r.submittedAt ? when(r.submittedAt) : <Badge>Partial, started {when(r.startedAt)}</Badge>}
              </Td>
              <Td className="max-w-48 truncate">{r.respondent}</Td>
              <Td>{r.version}</Td>
              <Td className="capitalize">{r.device}</Td>
              {r.cells.map((c, i) => (
                <Td key={columns[i]?.key ?? i} className="max-w-48 truncate" title={c}>
                  {c}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
      <nav aria-label="Pages" className="flex items-center justify-between text-sm text-muted">
        <span>
          {first.toLocaleString('en-US')} to {last.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
        </span>
        <span className="flex gap-3">
          {page > 0 ? (
            <Link className="text-accent underline" href={pageHref(page - 1)}>
              Previous
            </Link>
          ) : null}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <Link className="text-accent underline" href={pageHref(page + 1)}>
              Next
            </Link>
          ) : null}
        </span>
      </nav>
    </div>
  )
}
