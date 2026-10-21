import { Bar, Funnel, Line, StackedBar, StatTile, duration, foldSegments, percent } from '@/components/charts'
import type { AnalyticsResult } from '@/lib/analytics/analyze'
import { METRIC_LABELS, type ChartType, type Metric } from '@/lib/analytics/widgets'

/** One funnel metric (doc 04 section 4.2) as a report widget or analytics card. Server component. */
export function MetricView({ metric, result, chart, title }: { metric: Metric; result: AnalyticsResult; chart?: ChartType; title?: string }) {
  const heading = title || METRIC_LABELS[metric]
  switch (metric) {
    case 'completion':
      return (
        <StatTile
          label={heading}
          value={result.funnel.starts ? percent(result.funnel.completionRate) : 'No data'}
          sub={`${result.funnel.completes.toLocaleString('en-US')} completes of ${result.funnel.starts.toLocaleString('en-US')} starts. ${percent(result.funnel.startRate)} of views started.`}
        />
      )
    case 'median_time':
      return <StatTile label={heading} value={duration(result.medianSeconds)} sub={`${result.completeCount.toLocaleString('en-US')} complete responses`} />
    case 'responses_over_time':
      return (
        <Line
          title={heading}
          description={result.overTime.unit === 'week' ? 'Per week (Monday start), because the range is longer than 90 days.' : 'Per day.'}
          labels={result.overTime.points.map((p) => p.bucket)}
          series={[
            { name: 'Complete', values: result.overTime.points.map((p) => p.complete) },
            { name: 'Partial', values: result.overTime.points.map((p) => p.partial) },
          ]}
        />
      )
    case 'funnel':
      return (
        <Funnel
          title={heading}
          description={`Distinct visitors on version ${result.funnelVersionNo ?? 'none'}. ${result.funnel.abandoned.toLocaleString('en-US')} abandoned (no complete after leaving, or 24 hours idle).`}
          stages={[
            { label: 'Views', value: result.funnel.views },
            { label: 'Starts', value: result.funnel.starts },
            { label: 'Completes', value: result.funnel.completes },
          ]}
        />
      )
    case 'drop_off':
      return (
        <Bar
          title={heading}
          description="How many visitors reached each question and how many stopped there. Branching means not everyone sees every question."
          data={result.dropOff.map((d) => ({ label: d.label || d.question_key, value: d.reached, display: `${d.reached} reached, ${d.droppedHere} stopped here` }))}
          table={{ columns: ['Question', 'Reached', 'Stopped here'], rows: result.dropOff.map((d) => [d.label || d.question_key, d.reached, d.droppedHere]) }}
        />
      )
    case 'device_split': {
      const rows = result.devices.map((d) => ({ label: d.device[0]!.toUpperCase() + d.device.slice(1), value: d.count }))
      if (chart === 'bar' || chart === 'table') {
        return <Bar title={heading} description="Complete responses by device." data={rows.map((r) => ({ ...r, display: `${r.value}` }))} />
      }
      return <StackedBar title={heading} description="Complete responses by device." rows={[{ label: '', segments: foldSegments(rows) }]}
          table={{ columns: ['Device', 'Responses'], rows: rows.map((r) => [r.label, r.value]) }} />
    }
  }
}
