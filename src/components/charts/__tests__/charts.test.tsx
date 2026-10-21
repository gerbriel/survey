import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Bar, Funnel, Heatmap, Histogram, Line, NpsGauge, Sparkline, StackedBar, StatTile, compact, duration, foldSegments } from '..'
import { niceMax } from '../format'

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

describe('charts render with text alternatives', () => {
  it('Bar: labelled list, values printed, "<3" for suppressed, data table', () => {
    const h = html(<Bar title="Favourite colour" data={[{ label: 'Red', value: 12 }, { label: 'Blue', value: null }]} />)
    expect(h).toContain('<figcaption>')
    expect(h).toContain('aria-label="Favourite colour"')
    expect(h).toContain('>12<')
    expect(h).toContain('&lt;3')
    expect(h).toContain('Show data table')
    expect(h).toContain('<caption class="sr-only">Favourite colour</caption>')
  })
  it('StackedBar: legend and screen reader summary', () => {
    const h = html(<StackedBar title="Devices" rows={[{ label: 'All', segments: [{ label: 'Desktop', value: 3 }, { label: 'Mobile', value: 1 }] }]} />)
    expect(h).toContain('aria-label="Legend"')
    expect(h).toContain('Desktop 3 (75%), Mobile 1 (25%)')
  })
  it('foldSegments keeps the categorical cap', () => {
    const f = foldSegments([1, 5, 3, 2].map((v, i) => ({ label: `s${i}`, value: v })))
    expect(f.map((s) => s.label)).toEqual(['s1', 's2', 'Other'])
    expect(f[2]!.value).toBe(3)
  })
  it('Histogram: svg role img with a summary and per-column titles', () => {
    const h = html(<Histogram title="Age" data={[{ label: '18', value: 2 }, { label: '30', value: 7 }]} />)
    expect(h).toContain('role="img"')
    expect(h).toContain('aria-label="Age. 2 bins; tallest 7."')
    expect(h).toContain('<title>30: 7</title>')
  })
  it('Line: legend for two series and a period summary', () => {
    const h = html(<Line title="Responses" labels={['2026-10-01', '2026-10-02']} series={[{ name: 'Complete', values: [1, 2] }, { name: 'Partial', values: [0, 1] }]} />)
    expect(h).toContain('aria-label="Responses. 2 periods from 2026-10-01 to 2026-10-02. Totals: Complete 3, Partial 1."')
    expect(h).toContain('aria-label="Legend"')
    expect(h).toContain('<title>2026-10-02: 2 complete, 1 partial</title>')
  })
  it('NpsGauge: score in the label and counts in text', () => {
    const h = html(<NpsGauge title="Recommend" score={20} promoters={5} passives={2} detractors={3} />)
    expect(h).toContain('aria-label="NPS 20 on a scale from -100 to 100, from 10 answers."')
    expect(h).toContain('Promoters (9 to 10)')
    expect(h).toContain('+20')
  })
  it('Funnel: ordered list with conversion text', () => {
    const h = html(<Funnel title="Funnel" stages={[{ label: 'Views', value: 100 }, { label: 'Starts', value: 50 }, { label: 'Completes', value: null }]} />)
    expect(h).toContain('<ol')
    expect(h).toContain('(50% of views)')
    expect(h).toContain('&lt;3')
  })
  it('Heatmap: a real table with row and column headers', () => {
    const h = html(<Heatmap title="Matrix" rows={['Speed']} columns={['Bad', 'Good']} cells={[[1, '<3']]} sub={[['10%', null]]} />)
    expect(h).toContain('<th scope="row"')
    expect(h).toContain('<th scope="col"')
    expect(h).toContain('title="Speed, Good: &lt;3"')
  })
  it('Sparkline and StatTile', () => {
    expect(html(<Sparkline values={[1, 2, 3]} label="Per day" />)).toContain('aria-label="Per day: 1, 2, 3"')
    const t = html(<StatTile label="Responses" value="12" delta={{ value: 3, period: 'last week' }} />)
    expect(t).toContain('+3 vs last week')
    expect(t).toContain('text-success')
  })
  it('formatting helpers', () => {
    expect(compact(12500)).toBe('12.5K')
    expect(compact(950)).toBe('950')
    expect(duration(75)).toBe('1m 15s')
    expect(duration(null)).toBe('No data')
    expect(niceMax(7)).toBe(10)
    expect(niceMax(130)).toBe(200)
  })
})
