// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const actions = vi.hoisted(() => ({
  archiveSurveyAction: vi.fn(),
  duplicateSurveyAction: vi.fn(),
  bulkArchiveSurveysAction: vi.fn(),
  bulkDuplicateSurveysAction: vi.fn(),
  createSurveyAction: vi.fn(),
  createFromDefinitionAction: vi.fn(),
}))
vi.mock('@/lib/builder/actions', () => actions)

import { SurveyList, EXPORT_FORM_ID, type SurveyListRow } from '../SurveyList'
import { NewSurvey } from '../NewSurvey'
import { DEFAULT_QUERY } from '../listModel'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function row(n: number, title: string, daysAgo: number, extra: Partial<SurveyListRow> = {}): SurveyListRow {
  return {
    id: ID(n),
    title,
    slug: `s-${n}`,
    state: 'open',
    stateText: 'Open',
    responses: n * 10,
    cap: null,
    updatedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
    archived: false,
    ownerId: null,
    ownerName: null,
    owner: null,
    collaborators: [],
    ...extra,
  }
}

const ROWS = [row(1, 'Bravo', 3), row(2, 'Alpha', 1), row(3, 'Charlie', 50, { state: 'closed', stateText: 'Closed' })]

function renderList(over: Partial<Parameters<typeof SurveyList>[0]> = {}) {
  return render(
    <ToastProvider>
      <SurveyList
        rows={ROWS}
        base="/w/acme/surveys"
        slug="acme"
        exportAction="/w/acme/results/export"
        canEdit
        archivedView={false}
        initialQuery={DEFAULT_QUERY}
        owners={[]}
        now={NOW}
        {...over}
      />
    </ToastProvider>,
  )
}

const bodyTitles = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('link')[0]?.textContent)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('SurveyList', () => {
  it('sorts by updated desc, then by a clicked header with aria-sort, and writes the URL', async () => {
    renderList()
    expect(bodyTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    const updated = screen.getByRole('columnheader', { name: /Updated/ })
    expect(updated).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(within(screen.getByRole('columnheader', { name: /Survey/ })).getByRole('link'))
    expect(screen.getByRole('columnheader', { name: /Survey/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(updated).toHaveAttribute('aria-sort', 'none')
    expect(bodyTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    await userEvent.click(within(screen.getByRole('columnheader', { name: /Survey/ })).getByRole('link'))
    expect(bodyTitles()).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect(window.location.search).toBe('?sort=title&dir=desc')
  })

  it('filters by state and search with a match count and clear all', async () => {
    renderList()
    await userEvent.selectOptions(screen.getByLabelText('State'), 'closed')
    expect(bodyTitles()).toEqual(['Charlie'])
    expect(screen.getByText('1 of 3 surveys match')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Search'), 'zzz')
    expect(screen.getByText('No surveys match these filters')).toBeInTheDocument()
    await userEvent.click(screen.getAllByText('Clear all filters')[0]!)
    expect(bodyTitles()).toHaveLength(3)
  })

  it('selects rows, shows the bulk bar with the export form contract, and runs a bulk archive', async () => {
    actions.bulkArchiveSurveysAction.mockResolvedValue({ ok: true, data: { succeeded: 2, failed: 1, items: [] } })
    renderList()
    await userEvent.click(screen.getByLabelText('Select all shown surveys'))
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    const form = screen.getByRole('form', { name: 'Bulk actions' })
    expect(form).toHaveAttribute('id', EXPORT_FORM_ID)
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/w/acme/results/export')
    const boxes = screen.getAllByRole('checkbox', { name: /^Select (Alpha|Bravo|Charlie)$/ })
    for (const b of boxes) {
      expect(b).toHaveAttribute('name', 'surveyIds')
      expect(b).toHaveAttribute('form', EXPORT_FORM_ID)
    }
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveAttribute('value', 'csv')
    expect(screen.getByRole('button', { name: 'Export XLSX' })).toHaveAttribute('value', 'xlsx')
    await userEvent.click(screen.getByLabelText('Select Bravo'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Archive' }))
    expect(actions.bulkArchiveSurveysAction).toHaveBeenCalledWith('acme', [ID(2), ID(3)], true)
    await userEvent.click(screen.getByLabelText('Select Alpha'))
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('form', { name: 'Bulk actions' })).toBeNull()
  })

  it('offers Restore in the archived view and a per-row menu', async () => {
    renderList({ archivedView: true, rows: ROWS.map((r) => ({ ...r, archived: true })), initialQuery: { ...DEFAULT_QUERY, state: 'archived' } })
    await userEvent.click(screen.getByLabelText('Select Alpha'))
    expect(within(screen.getByRole('form', { name: 'Bulk actions' })).getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    const menu = screen.getByLabelText('Actions for Alpha').closest('details')!
    for (const name of ['Edit', 'Share', 'Responses', 'Analytics', 'Duplicate', 'Restore']) expect(within(menu).getByText(name)).toBeInTheDocument()
  })

  it('shows the first-run empty state', () => {
    renderList({ rows: [] })
    expect(screen.getByText('No surveys yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New survey' })).toHaveAttribute('href', '/w/acme/surveys/new')
  })
})

describe('NewSurvey', () => {
  const templates = [
    { id: 't1', name: 'Event feedback', description: 'After an event.', system: true, questionCount: 6 },
    { id: 't2', name: 'Our intake', description: null, system: false, questionCount: 1 },
  ]

  it('puts blank and templates first as equal cards, pasted text last and collapsed', () => {
    const { container } = render(
      <ToastProvider>
        <NewSurvey workspaceId={ID(9)} base="/w/acme/surveys" templates={templates} workspaceTheme={null} />
      </ToastProvider>,
    )
    expect(screen.getByLabelText(/Survey name/)).toHaveValue('Untitled survey')
    const cards = within(screen.getByTestId('start-cards')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(cards).toEqual(['Blank survey', 'Our intake', 'Event feedback'])
    expect(screen.getByText('6 questions')).toBeInTheDocument()
    expect(screen.getByText('1 question')).toBeInTheDocument()
    for (const b of screen.getAllByRole('button', { name: /^Create from / })) expect(b).toBeEnabled()
    const details = container.querySelector('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('Other ways to start')).toBeInTheDocument()
    const order = Array.from(container.querySelectorAll('[data-testid="start-cards"], details'))
    expect(order.map((e) => e.tagName)).toEqual(['UL', 'DETAILS'])
  })

  it('creates a blank survey in one click with the default title', async () => {
    actions.createSurveyAction.mockResolvedValue({ ok: true, data: ID(5) })
    render(
      <ToastProvider>
        <NewSurvey workspaceId={ID(9)} base="/w/acme/surveys" templates={[]} workspaceTheme={null} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create from Blank survey' }))
    expect(actions.createSurveyAction).toHaveBeenCalledWith(ID(9), 'Untitled survey')
    expect(router.push).toHaveBeenCalledWith(`/w/acme/surveys/${ID(5)}/edit`)
  })
})
