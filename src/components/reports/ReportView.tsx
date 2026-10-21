import { MetricView } from '@/components/analytics/MetricView'
import { QuestionSummaryView } from '@/components/analytics/QuestionSummaryView'
import { EmptyState } from '@/components/ui/EmptyState'
import { widgetCrossTab } from '@/lib/analytics/analyze'
import type { LoadedAnalytics } from '@/lib/analytics/load'
import { isMetric, type WidgetSpec } from '@/lib/analytics/widgets'

/**
 * Renders a report's widgets in order against one analytics load (doc 04
 * section 5). Server component, also used for the virtual default report.
 */
export function ReportView({ widgets, data, fileHref }: { widgets: WidgetSpec[]; data: LoadedAnalytics; fileHref?: (fileId: string) => string }) {
  if (widgets.length === 0) return <EmptyState title="This report has no widgets" description="Editors can add widgets with the editor above." />
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {widgets.map((w, i) => {
        const key = w.id ?? `${i}`
        if (w.metric && isMetric(w.metric)) {
          return (
            <div key={key} className="rounded-lg border border-border bg-surface p-4 break-inside-avoid">
              <MetricView metric={w.metric} result={data} chart={w.chart_type} title={w.options.title} />
            </div>
          )
        }
        const block = data.blocks.find((b) => b.question.question_key === w.question_key)
        if (!block) {
          return (
            <div key={key} className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
              {w.options.title || w.question_key}: this question is not in the versions in scope.
            </div>
          )
        }
        const xt = w.cross_tab_key ? widgetCrossTab(data.snapshots, data.scopeVersionIds, data.answers, block.question.question_key, w.cross_tab_key) : null
        const wide = block.summary?.kind === 'matrix' || xt !== null
        return (
          <div key={key} className={wide ? 'lg:col-span-2 break-inside-avoid' : 'break-inside-avoid'}>
            <QuestionSummaryView block={{ ...block, crossTab: xt }} chart={w.chart_type} title={w.options.title} fileHref={fileHref} />
          </div>
        )
      })}
    </div>
  )
}
