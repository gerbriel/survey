import { Badge } from '@/components/ui/Badge'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import type { LimitRow } from './limits-view'

export function LimitsTable({ rows }: { rows: LimitRow[] }) {
  return (
    <Table caption="Effective limits">
      <THead>
        <Tr>
          <Th>Limit</Th>
          <Th>Value</Th>
          <Th>Source</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.key}>
            <Td>{r.label}</Td>
            <Td className="font-medium">{r.value}</Td>
            <Td>
              <Badge tone={r.source === 'override' ? 'accent' : 'neutral'}>
                {r.source === 'override' ? 'Set by platform admin' : 'Default'}
              </Badge>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}
