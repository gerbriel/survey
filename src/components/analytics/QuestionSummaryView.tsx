import { Bar, Heatmap, Histogram, NpsGauge, StackedBar, foldSegments, percent } from '@/components/charts'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import type { QuestionBlock } from '@/lib/analytics/analyze'
import type { ChartType } from '@/lib/analytics/widgets'
import type { QuestionSummary } from '@/lib/analytics/types'
import { VersionBanner } from './VersionBanner'

/**
 * One question's summary (doc 04 section 4.1) with the chart its type or
 * report widget asks for. Server component: no hooks, renders on both the
 * analytics page and saved reports.
 */
export function QuestionSummaryView({
  block,
  chart,
  title,
  fileHref,
}: {
  block: QuestionBlock
  chart?: ChartType
  title?: string
  /** Link for a file id; files open through the dashboard redirect (Phase 2D). */
  fileHref?: (fileId: string) => string
}) {
  const q = block.question
  const heading = title || q.label || q.question_key
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" aria-label={heading}>
      {block.diff ? <VersionBanner messages={block.diff.messages} refused={block.refused} /> : null}
      {block.refused || !block.summary ? (
        <div>
          <h3 className="text-sm font-semibold text-fg">{heading}</h3>
          <p className="mt-1 text-sm text-muted">This question changed type between versions. Pick one version in the filters to see its numbers.</p>
        </div>
      ) : block.crossTab ? (
        <CrossTabView block={block} heading={heading} />
      ) : (
        <SummaryBody summary={block.summary} heading={heading} chart={chart} fileHref={fileHref} />
      )}
    </section>
  )
}

function n(s: QuestionSummary): string {
  return `${s.n.toLocaleString('en-US')} answered`
}

function Stats({ items }: { items: [string, string | number | null][] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium text-fg">{v === null ? 'No data' : typeof v === 'number' ? v.toLocaleString('en-US') : v}</dd>
        </div>
      ))}
    </dl>
  )
}

function SummaryBody({
  summary: s,
  heading,
  chart,
  fileHref,
}: {
  summary: QuestionSummary
  heading: string
  chart?: ChartType
  fileHref?: (fileId: string) => string
}) {
  switch (s.kind) {
    case 'choice': {
      const desc = s.multi ? `${n(s)}. Respondents could pick more than one, so percentages can add up past 100.` : n(s)
      const anyBase = s.options.some((o) => o.base !== s.n)
      const note = anyBase ? `${desc} Some options were not offered in every version; their percentage uses only versions that offered them.` : desc
      if (chart === 'pie' || chart === 'stacked_bar') {
        return (
          <StackedBar
            title={heading}
            description={note}
            rows={[{ label: '', segments: foldSegments(s.options.map((o) => ({ label: o.label, value: o.count }))) }]}
            table={{ columns: ['Option', 'Count', 'Percent'], rows: s.options.map((o) => [o.label, o.count, percent(o.pct)]) }}
          />
        )
      }
      return (
        <>
          <Bar
            title={heading}
            description={note}
            data={s.options.map((o) => ({ label: o.label, value: o.count, display: `${o.count.toLocaleString('en-US')} (${percent(o.pct)})` }))}
            table={{ columns: ['Option', 'Count', 'Percent'], rows: s.options.map((o) => [o.label, o.count, percent(o.pct)]) }}
          />
          {s.other.length ? <TextList title="Other answers" items={s.other} /> : null}
        </>
      )
    }
    case 'numeric':
      return (
        <>
          <Histogram
            title={heading}
            description={n(s)}
            xLabel="Range"
            data={s.histogram.map((b) => ({ label: b.from === b.to ? String(b.from) : `${b.from} to ${b.to}`, value: b.count }))}
          />
          <Stats items={[['Mean', s.mean], ['Median', s.median], ['Min', s.min], ['Max', s.max]]} />
        </>
      )
    case 'rating':
      return (
        <>
          <Bar
            title={heading}
            description={n(s)}
            data={s.distribution.map((d) => ({ label: String(d.value), value: d.count, display: `${d.count} (${percent(d.pct)})` }))}
          />
          <Stats items={[['Mean', s.mean], ['Median', s.median]]} />
        </>
      )
    case 'nps':
      if (chart === 'bar') {
        return <Bar title={heading} description={`${n(s)}. NPS ${s.score ?? 'not available'}.`} data={s.distribution.map((d) => ({ label: String(d.value), value: d.count }))} />
      }
      return <NpsGauge title={heading} description={n(s)} score={s.score} promoters={s.promoters} passives={s.passives} detractors={s.detractors} />
    case 'text':
      return (
        <>
          <Bar
            title={heading}
            description={`${n(s)}. Top words, common words removed.`}
            data={s.words.slice(0, 15).map((w) => ({ label: w.word, value: w.count }))}
            tableColumns={['Word', 'Count']}
          />
          {s.latest.length ? <TextList title="Latest answers" items={s.latest} /> : null}
        </>
      )
    case 'matrix':
      return (
        <Heatmap
          title={heading}
          description={`${n(s)}. Each cell shows the count and the share of that row.`}
          rows={s.rows.map((r) => r.label)}
          columns={s.columns.map((c) => c.label)}
          cells={s.cells}
          sub={s.cells.map((row, i) => row.map((c) => percent(s.rowTotals[i] ? (100 * c) / s.rowTotals[i]! : 0)))}
        />
      )
    case 'ranking':
      if (chart === 'bar') {
        return <Bar title={heading} description={`${n(s)}. Share of respondents who ranked each item first.`} data={s.items.map((i) => ({ label: i.label, value: i.firstPct, display: percent(i.firstPct) }))} max={100} />
      }
      return (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{heading}</h3>
          <p className="text-xs text-muted">{n(s)}. Lower average position is better.</p>
          <Table caption={heading}>
            <THead>
              <Tr>
                <Th>Item</Th>
                <Th className="text-right">Average position</Th>
                <Th className="text-right">Ranked first</Th>
              </Tr>
            </THead>
            <TBody>
              {s.items.map((i) => (
                <Tr key={i.id}>
                  <Td>{i.label}</Td>
                  <Td className="text-right tabular-nums">{i.avgPosition ?? 'No data'}</Td>
                  <Td className="text-right tabular-nums">{percent(i.firstPct)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )
    case 'date':
      return (
        <>
          <Histogram title={heading} description={n(s)} xLabel="Month" data={s.months.map((m) => ({ label: m.month, value: m.count }))} />
          <Stats items={[['Earliest', s.earliest], ['Latest', s.latest]]} />
        </>
      )
    case 'files':
      return (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{heading}</h3>
          <Stats items={[['Responses with files', s.n], ['Files', s.fileCount]]} />
          {s.files.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {s.files.slice(0, 20).map((f) => (
                <li key={f.file_id}>
                  {fileHref ? (
                    <a className="text-accent underline" href={fileHref(f.file_id)}>
                      {f.name}
                    </a>
                  ) : (
                    f.name
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )
    case 'count':
      return (
        <div>
          <h3 className="text-sm font-semibold text-fg">{heading}</h3>
          <p className="mt-1 text-2xl font-semibold text-fg">{s.n.toLocaleString('en-US')}</p>
          <p className="text-xs text-muted">answered. Identity and free-form answers are not summarized.</p>
        </div>
      )
  }
}

function TextList({ title, items }: { title: string; items: string[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted hover:text-fg">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-fg">
        {items.map((t, i) => (
          <li key={i} className="break-words">
            {t}
          </li>
        ))}
      </ul>
    </details>
  )
}

function CrossTabView({ block, heading }: { block: QuestionBlock; heading: string }) {
  const xt = block.crossTab!
  return (
    <Heatmap
      title={`${heading} by the cross-tab question`}
      description={`${xt.n.toLocaleString('en-US')} responses answered both. Each cell shows the count and the share of its column.`}
      rows={xt.rows.map((r) => r.label)}
      columns={xt.columns.map((c, j) => `${c.label} (${xt.columnTotals[j] ?? 0})`)}
      cells={xt.counts}
      sub={xt.columnPct.map((row) => row.map((p) => percent(p)))}
    />
  )
}
