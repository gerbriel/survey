// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxRow } from '@/lib/db/responses'
import { InboxList } from './InboxList'
import type { ChangeSignal } from './realtime'
import { unreadStore } from './unreadStore'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('./subscribe', () => ({ subscribeToResponses: () => () => {} }))

afterEach(() => {
  cleanup()
  unreadStore.reset()
  window.sessionStorage.clear()
})

const row = (id: string, extra: Partial<InboxRow> = {}): InboxRow => ({
  id,
  survey_id: 's1',
  survey_version_id: 'v1',
  status: 'complete',
  contact_id: null,
  respondent_token_id: null,
  identity_source: null,
  started_at: '2026-10-21T10:00:00Z',
  submitted_at: '2026-10-21T10:05:00Z',
  last_question_key: null,
  score: null,
  score_max: null,
  metadata: {},
  contact: null,
  ...extra,
})

function setup(rows: InboxRow[], fetchRow = vi.fn(async (id: string) => row(id))) {
  let emit: (p: ChangeSignal) => void = () => {}
  const subscribe = vi.fn((_s: string, cb: (p: ChangeSignal) => void) => {
    emit = cb
    return () => {}
  })
  render(
    <InboxList
      slug="acme"
      surveyId="s1"
      initialRows={rows}
      firstPage
      pageSize={25}
      filters={{ status: 'complete', identity: 'all', version: 'all', latestVersionId: 'v1' }}
      versionNumbers={{ v1: 3 }}
      fetchRow={fetchRow}
      subscribe={subscribe}
    />,
  )
  return { emit: (p: ChangeSignal) => emit(p), fetchRow, subscribe }
}

describe('InboxList', () => {
  it('renders rows with contact, status, version and identity badges', () => {
    setup([
      row('a', {
        contact_id: 'c1',
        identity_source: 'hidden_field',
        contact: { id: 'c1', email: 'ana@acme.com', first_name: 'Ana', last_name: 'Lopez' },
      }),
      row('b', { status: 'partial', submitted_at: null }),
    ])
    const rows = screen.getAllByTestId('inbox-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByRole('link', { name: 'Ana Lopez' })).toHaveAttribute('href', '/w/acme/surveys/s1/responses/a')
    expect(within(rows[0]!).getByText('Hidden field, unverified')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('v3')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Partial')).toBeInTheDocument()
  })

  it('shows the empty state', () => {
    setup([])
    expect(screen.getByText('No responses yet')).toBeInTheDocument()
  })

  it('prepends a refetched row on a realtime insert and marks it unread', async () => {
    const { emit, fetchRow, subscribe } = setup([row('a')])
    expect(subscribe).toHaveBeenCalledWith('s1', expect.any(Function))
    await act(async () => {
      emit({ eventType: 'INSERT', new: { id: 'n1', raw: { leak: true } } })
    })
    expect(fetchRow).toHaveBeenCalledWith('n1')
    const rows = screen.getAllByTestId('inbox-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('New')).toBeInTheDocument()
  })
})
