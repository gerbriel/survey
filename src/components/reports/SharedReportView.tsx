import { Bar, Funnel, Heatmap, StatTile, type HeatCell } from '@/components/charts'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import type { SafeSharedPayload, SafeSharedWidget, SharedResultItem } from '@/lib/analytics/share-payload'
import { suppressCount } from '@/lib/analytics/suppress'

/**
 * Public shared report body (doc 04 section 5.4): aggregates only, counts
 * under 3 print as "<3", no verbatims, no files, no rows. Server component on
 * PUBLIC_HOST; it receives the allow-listed payload and nothing else.
 */
export function SharedReportView({ payload }: { payload: SafeSharedPayload }) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs text-muted">{payload.workspace.name}</p>
        <h1 className="text-xl font-semibold text-fg">{payload.report.name}</h1>
        <p className="text-sm text-muted">{payload.survey.title}</p>
      </header>
      {payload.widgets.length === 0 ? <p className="text-sm text-muted">This report has no charts.</p> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {payload.widgets.map((w) => (
          <div key={w.id} className="rounded-lg border border-border bg-surface p-4 break-inside-avoid">
            <SharedWidget w={w} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Counts under 3 are shown as &quot;&lt;3&quot; to protect respondents.</p>
    </div>
  )
}

const METRIC_TITLES: Record<string, string> = {
  completion: 'Completion',
  responses_over_time: 'Responses',
  funnel: 'Views, starts and completes',
  drop_off: 'Visitors',
  median_time: 'Responses',
  device_split: 'Visitors',
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function itemCount(i: SharedResultItem): number | null {
  const c = suppressCount(i.count ?? null, i.suppressed)
  return typeof c === 'number' ? c : null
}

export function SharedWidget({ w }: { w: SafeSharedWidget }) {
  const r = w.result
  const title = w.label || (w.metric ? METRIC_TITLES[w.metric] ?? 'Summary' : 'Question')
  if (!w.question_key) {
    const f = r.funnel ?? {}
    const v = (x: unknown) => {
      const c = suppressCount(numOrNull(x))
      return typeof c === 'number' ? c : null
    }
    return (
      <Funnel
        title={title}
        description="Distinct visitors on the latest version."
        stages={[
          { label: 'Views', value: v(f.views) },
          { label: 'Starts', value: v(f.starts) },
          { label: 'Completes', value: v(f.completes) },
        ]}
      />
    )
  }
  const n = suppressCount(numOrNull(r.n), r.suppressed)
  const nText = typeof n === 'number' ? `${n.toLocaleString('en-US')} answered` : 'Fewer than 3 answered'
  if (r.suppressed || n === '<3') {
    return <StatTile label={title} value="<3" sub="Not enough answers to show without identifying someone." />
  }
  const data = r.data
  const label = (id: string | undefined) => w.options?.find((o) => o.id === id)?.label ?? id ?? ''

  if (Array.isArray(data)) {
    const first = data[0]
    if (first && 'word' in first) {
      return <Bar title={title} description={`${nText}. Top words, common words removed.`} data={data.map((d) => ({ label: d.word ?? '', value: itemCount(d) }))} tableColumns={['Word', 'Count']} />
    }
    if (first && 'row_id' in first) {
      const rows = [...new Set(data.map((d) => d.row_id ?? ''))]
      const cols = [...new Set(data.map((d) => d.column_id ?? ''))]
      const cells: HeatCell[][] = rows.map((rid) => cols.map((cid) => suppressCount(data.find((d) => d.row_id === rid && d.column_id === cid)?.count ?? 0, false)))
      const rowLabel = (id: string) => w.rows?.find((o) => o.id === id)?.label ?? id
      const colLabel = (id: string) => w.columns?.find((o) => o.id === id)?.label ?? id
      return <Heatmap title={title} description={nText} rows={rows.map(rowLabel)} columns={cols.map(colLabel)} cells={cells} />
    }
    if (data.some((d) => d.avg_position !== undefined && d.avg_position !== null)) {
      return (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="text-xs text-muted">{nText}. Lower average position is better.</p>
          <Table caption={title}>
            <THead>
              <Tr>
                <Th>Item</Th>
                <Th className="text-right">Times ranked</Th>
                <Th className="text-right">Average position</Th>
              </Tr>
            </THead>
            <TBody>
              {[...data]
                .sort((a, b) => (a.avg_position ?? Infinity) - (b.avg_position ?? Infinity))
                .map((d) => (
                  <Tr key={d.option_id}>
                    <Td>{label(d.option_id)}</Td>
                    <Td className="text-right tabular-nums">{d.suppressed ? '<3' : d.count}</Td>
                    <Td className="text-right tabular-nums">{d.avg_position ?? ''}</Td>
                  </Tr>
                ))}
            </TBody>
          </Table>
        </div>
      )
    }
    return (
      <Bar
        title={title}
        description={nText}
        data={data.map((d) => ({ label: label(d.option_id), value: itemCount(d) }))}
        tableColumns={['Option', 'Count']}
      />
    )
  }
  if (data && typeof data === 'object') {
    const stats: string[] = []
    if (data.nps !== undefined && data.nps !== null) stats.push(`NPS ${data.nps > 0 ? '+' : ''}${data.nps}`)
    if (data.mean !== undefined) stats.push(`Mean ${data.mean}`)
    if (data.median !== undefined) stats.push(`Median ${data.median}`)
    const dist = Array.isArray(data.distribution) ? data.distribution : null
    if (dist) {
      return (
        <Bar
          title={title}
          description={[nText, ...stats].join('. ')}
          data={dist.map((d) => ({ label: String(d.value ?? ''), value: itemCount(d) }))}
          tableColumns={['Value', 'Count']}
        />
      )
    }
    return <StatTile label={title} value={data.nps !== undefined && data.nps !== null ? String(data.nps) : String(data.mean ?? '')} sub={[nText, ...stats].join('. ')} />
  }
  return <StatTile label={title} value={typeof n === 'number' ? n.toLocaleString('en-US') : n} sub="answered" />
}
