import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { sanitizeSharedPayload } from '@/lib/analytics/share-payload'
import { SharedReportView } from '../SharedReportView'

const payload = sanitizeSharedPayload({
  report: { name: 'Board' },
  survey: { title: 'Spring' },
  workspace: { name: 'Acme', logo_path: null },
  widgets: [
    { id: 'w0', position: 0, chart_type: 'stat', question_key: null, metric: 'funnel', label: null, options: null, result: { metric: 'funnel', funnel: { views: 40, starts: 2, completes: 1 } } },
    {
      id: 'w1',
      position: 1,
      chart_type: 'bar',
      question_key: 'q_aaaaaaaa',
      metric: null,
      label: 'Colour',
      options: [{ id: 'o1', label: 'Red' }, { id: 'o2', label: 'Blue' }],
      result: { n: 12, suppressed: false, type: 'single_choice', data: [{ option_id: 'o1', count: 10, suppressed: false }, { option_id: 'o2', count: null, suppressed: true }] },
    },
    { id: 'w2', position: 2, chart_type: 'word_list', question_key: 'q_bbbbbbbb', metric: null, label: 'Comments', options: null, result: { n: 2, suppressed: true, type: 'long_text', data: null } },
  ],
})!

describe('SharedReportView', () => {
  it('renders aggregates with small cells suppressed', () => {
    const h = renderToStaticMarkup(<SharedReportView payload={payload} />)
    expect(h).toContain('Board')
    expect(h).toContain('Red')
    expect(h).toContain('>10<')
    expect(h.match(/&lt;3/g)!.length).toBeGreaterThanOrEqual(3)
    expect(h).toContain('Not enough answers to show without identifying someone.')
  })
})
