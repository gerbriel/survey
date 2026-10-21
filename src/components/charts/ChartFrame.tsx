import type { ReactNode } from 'react'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { VizStyles } from './tokens'

export type DataTable = { columns: string[]; rows: (string | number)[][] }

/**
 * Figure wrapper every chart uses: a title, an optional note, the plot, and a
 * collapsible data table (the WCAG equivalent of the chart, and the relief
 * for light series colors under 3:1).
 */
export function ChartFrame({
  title,
  description,
  table,
  children,
  headingLevel = 3,
}: {
  title: ReactNode
  description?: ReactNode
  table?: DataTable
  children: ReactNode
  headingLevel?: 2 | 3 | 4
}) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <figure className="viz m-0 flex flex-col gap-3">
      <VizStyles />
      <figcaption>
        <H className="text-sm font-semibold text-fg">{title}</H>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </figcaption>
      {children}
      {table && table.rows.length > 0 ? (
        <details className="text-sm print:hidden">
          <summary className="cursor-pointer text-xs text-muted hover:text-fg">Show data table</summary>
          <div className="mt-2">
            <Table caption={typeof title === 'string' ? title : 'Chart data'}>
              <THead>
                <Tr>
                  {table.columns.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                {table.rows.map((r, i) => (
                  <Tr key={i}>
                    {r.map((v, j) => (
                      <Td key={j} className={typeof v === 'number' ? 'viz-num text-right' : undefined}>
                        {typeof v === 'number' ? v.toLocaleString('en-US') : v}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </details>
      ) : null}
    </figure>
  )
}
