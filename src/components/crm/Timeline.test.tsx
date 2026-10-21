// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurveyDefinition } from '@/lib/survey'
import { Timeline } from './Timeline'
import { activityText, buildTimeline } from './timelineData'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

const def = {
  pages: [{ id: 'p', question_ids: ['q_name0001'] }],
  questions: {
    q_name0001: { id: 'q_name0001', question_key: 'q_name0001', type: 'short_text', required: false, label: { format: 'md-lite', text: 'Your name' }, settings: {} },
  },
} as unknown as SurveyDefinition

function items() {
  return buildTimeline({
    slug: 'acme',
    responses: [
      { id: 'r1', survey_id: 's1', survey_version_id: 'v1', status: 'complete', identity_source: 'token', started_at: '2026-10-01T09:00:00Z', submitted_at: '2026-10-01T09:05:00Z', survey: { title: 'Onboarding' } },
      { id: 'r2', survey_id: 's2', survey_version_id: 'v9', status: 'partial', identity_source: null, started_at: '2026-10-03T09:00:00Z', submitted_at: null, survey: { title: 'NPS' } },
    ],
    answers: [{ response_id: 'r1', question_key: 'q_name0001', value_text: 'Ana', value_number: null, value_date: null, value_json: null }],
    versions: new Map([['v1', { version_no: 2, def }]]),
    notes: [{ id: 'n1', created_at: '2026-10-02T00:00:00Z', author: 'u1', body: 'Called her' }],
    activity: [
      { id: 7, created_at: '2026-10-04T00:00:00Z', action: 'status_change', diff: { lead_status: ['new', 'qualified'] } },
      { id: 8, created_at: '2026-10-02T00:00:00Z', action: 'note.create', diff: {} },
    ],
    authorName: (id) => (id === 'u1' ? 'Gabriel' : 'Unassigned'),
  })
}

describe('buildTimeline', () => {
  it('interleaves responses, notes and activity newest first', () => {
    expect(items().map((i) => `${i.kind}:${i.id}`)).toEqual(['activity:7', 'response:r2', 'note:n1', 'response:r1'])
  })
  it('describes activity rows', () => {
    expect(activityText('owner_change', { owner_id: [null, 'u1'] }, (id) => (id ? 'Gabriel' : 'Unassigned'))).toBe(
      'Owner changed from Unassigned to Gabriel',
    )
    expect(activityText('merge', { merged: ['a', 'b'] }, () => '')).toBe('Merged 2 contacts into this one')
  })
})

describe('Timeline', () => {
  it('renders every item with a quick answer preview and groups by survey', async () => {
    render(<Timeline items={items()} />)
    expect(screen.getAllByTestId('timeline-response')).toHaveLength(2)
    expect(screen.getByText('Status changed from New to Qualified')).toBeInTheDocument()
    expect(screen.getByText(/Called her/)).toBeInTheDocument()
    const first = screen.getAllByTestId('timeline-response')[1]!
    expect(within(first).getByRole('link', { name: 'Onboarding' })).toHaveAttribute('href', '/w/acme/surveys/s1/responses/r1')
    expect(within(first).getByText('Ana')).toBeInTheDocument()
    expect(within(first).getByText('Personal link')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'By survey' }))
    expect(screen.getByRole('region', { name: 'Onboarding' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'NPS' })).toBeInTheDocument()
    expect(screen.queryByText(/Called her/)).not.toBeInTheDocument()
  })
})
