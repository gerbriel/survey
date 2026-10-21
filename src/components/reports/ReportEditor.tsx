'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { CHART_LABELS, chartsForType, isCrossTabbable, METRIC_CHARTS, METRIC_LABELS, METRICS, type ChartType, type Metric, type WidgetSpec } from '@/lib/analytics/widgets'

export type EditorQuestion = { key: string; label: string; type: string }

type Row = { uid: string; question_key: string | null; metric: Metric | null; chart_type: ChartType; cross_tab_key: string | null; title: string }

export type SaveWidgets = (input: {
  name: string
  widgets: { question_key: string | null; metric: string | null; chart_type: ChartType; cross_tab_key: string | null; options: { title?: string } }[]
}) => Promise<{ ok: true } | { ok: false; error: string }>

let seq = 0
const uid = () => `w${++seq}`

/**
 * Report builder (doc 04 section 5.1): name, ordered widgets bound to a
 * question_key or a funnel metric, a chart type, an optional cross-tab key
 * and title. Reorder by drag and drop or with the Move buttons (keyboard).
 */
export function ReportEditor({ name, widgets, questions, save }: { name: string; widgets: WidgetSpec[]; questions: EditorQuestion[]; save: SaveWidgets }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, start] = useTransition()
  const [title, setTitle] = useState(name)
  const [rows, setRows] = useState<Row[]>(() =>
    widgets.map((w) => ({
      uid: uid(),
      question_key: w.question_key,
      metric: w.metric,
      chart_type: w.chart_type,
      cross_tab_key: w.cross_tab_key,
      title: w.options.title ?? '',
    })),
  )
  const [drag, setDrag] = useState<number | null>(null)
  const qByKey = new Map(questions.map((q) => [q.key, q]))
  const crossTabbable = questions.filter((q) => isCrossTabbable(q.type))

  const move = (from: number, to: number) =>
    setRows((r) => {
      if (to < 0 || to >= r.length || from === to) return r
      const next = [...r]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x!)
      return next
    })
  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)))

  function bindingValue(r: Row) {
    return r.metric ? `m:${r.metric}` : `q:${r.question_key}`
  }

  function setBinding(i: number, v: string) {
    if (v.startsWith('m:')) {
      const metric = v.slice(2) as Metric
      patch(i, { metric, question_key: null, chart_type: METRIC_CHARTS[metric][0]!, cross_tab_key: null })
    } else {
      const key = v.slice(2)
      patch(i, { question_key: key, metric: null, chart_type: chartsForType(qByKey.get(key)?.type ?? '')[0]!, cross_tab_key: null })
    }
  }

  const bindings = [
    ...METRICS.map((m) => ({ value: `m:${m}`, label: `Metric: ${METRIC_LABELS[m]}` })),
    ...questions.map((q) => ({ value: `q:${q.key}`, label: q.label || q.key })),
  ]

  function onSave() {
    start(async () => {
      const r = await save({
        name: title,
        widgets: rows.map((x) => ({
          question_key: x.question_key,
          metric: x.metric,
          chart_type: x.chart_type,
          cross_tab_key: x.cross_tab_key,
          options: x.title.trim() ? { title: x.title.trim() } : {},
        })),
      })
      if (r.ok) {
        toast('Report saved', 'success')
        router.refresh()
      } else toast(r.error, 'error')
    })
  }

  return (
    <section aria-label="Report editor" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 print:hidden">
      <Input label="Report name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      <ol className="flex flex-col gap-2" aria-label="Widgets">
        {rows.map((r, i) => {
          const charts = r.metric ? METRIC_CHARTS[r.metric] : chartsForType(qByKey.get(r.question_key ?? '')?.type ?? '')
          const canXt = r.question_key && isCrossTabbable(qByKey.get(r.question_key)?.type ?? '')
          return (
            <li
              key={r.uid}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) move(drag, i)
                setDrag(null)
              }}
              className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-[auto_2fr_1fr_1fr_1.5fr_auto]"
            >
              <span aria-hidden="true" className="cursor-grab select-none self-center text-muted" title="Drag to reorder">
                ::
              </span>
              <Select label={`Widget ${i + 1} data`} value={bindingValue(r)} onChange={(e) => setBinding(i, e.target.value)} options={bindings} />
              <Select
                label="Chart"
                value={r.chart_type}
                onChange={(e) => patch(i, { chart_type: e.target.value as ChartType })}
                options={charts.map((c) => ({ value: c, label: CHART_LABELS[c] }))}
              />
              {canXt ? (
                <Select
                  label="Cross-tab"
                  value={r.cross_tab_key ?? ''}
                  placeholder="None"
                  onChange={(e) => patch(i, { cross_tab_key: e.target.value || null })}
                  options={crossTabbable.filter((q) => q.key !== r.question_key).map((q) => ({ value: q.key, label: q.label || q.key }))}
                />
              ) : (
                <span />
              )}
              <Input label="Title (optional)" value={r.title} maxLength={120} onChange={(e) => patch(i, { title: e.target.value })} />
              <div className="flex items-end gap-1">
                <Button size="sm" variant="ghost" aria-label={`Move widget ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  Up
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Move widget ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                  Down
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Remove widget ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={rows.length >= 100}
          onClick={() =>
            setRows((x) => [...x, { uid: uid(), question_key: null, metric: 'completion', chart_type: 'stat', cross_tab_key: null, title: '' }])
          }
        >
          Add widget
        </Button>
        <Button size="sm" loading={pending} onClick={onSave}>
          Save report
        </Button>
      </div>
    </section>
  )
}
