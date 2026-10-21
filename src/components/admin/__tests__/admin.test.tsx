// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionState } from '@/lib/admin/forms'
import { LimitsEditor, PlatformInviteForm } from '../AdminForms'
import { MarkdownView } from '../MarkdownView'
import { AdminWorkspaceList, type AdminWorkspaceRow } from '../WorkspaceList'

afterEach(cleanup)

const rows: AdminWorkspaceRow[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Finance',
    slug: 'finance',
    owner: 'Olive Owner',
    members: 4,
    surveys: 12,
    responses: 15234,
    storage: '2.5 MB',
    created: 'Oct 1, 2026',
    state: 'active',
    stateNote: null,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Old team',
    slug: 'old-team',
    owner: 'Sam',
    members: 1,
    surveys: 0,
    responses: 0,
    storage: '0 B',
    created: 'Jan 1, 2026',
    state: 'deletion_requested',
    stateNote: 'Restorable until Nov 10, 2026',
  },
]

describe('AdminWorkspaceList', () => {
  it('lists workspaces with counts, storage and lifecycle status', () => {
    render(<AdminWorkspaceList rows={rows} />)
    const table = screen.getByRole('table', { name: 'All workspaces' })
    const finance = within(table).getByRole('link', { name: 'Finance' })
    expect(finance).toHaveAttribute('href', '/admin/workspaces/00000000-0000-0000-0000-000000000001')
    const row = finance.closest('tr')!
    expect(within(row).getByText('15,234')).toBeInTheDocument()
    expect(within(row).getByText('2.5 MB')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Deletion requested')).toBeInTheDocument()
    expect(screen.getByText('Restorable until Nov 10, 2026')).toBeInTheDocument()
  })

  it('says so when there are none', () => {
    render(<AdminWorkspaceList rows={[]} />)
    expect(screen.getByText('No workspaces yet.')).toBeInTheDocument()
  })
})

describe('LimitsEditor', () => {
  it('prefills overrides and submits the kill switch with a note', async () => {
    const action = vi.fn<(p: ActionState, f: FormData) => Promise<ActionState>>(async () => ({ status: 'success', message: 'Limits saved.' }))
    render(<LimitsEditor action={action} defaults={{ maxFileMb: '50', rawScript: 'default', note: '' }} />)
    expect(screen.getByLabelText('Max file size per upload (MB)')).toHaveValue(50)
    await userEvent.selectOptions(screen.getByLabelText(/Script pixels/), 'blocked')
    await userEvent.type(screen.getByLabelText(/Note/), 'Vendor incident')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Limits saved.'))
    const form = action.mock.calls[0]![1]
    expect(form.get('rawScript')).toBe('blocked')
    expect(form.get('note')).toBe('Vendor incident')
  })
})

describe('PlatformInviteForm', () => {
  it('shows the one-time link after issuing', async () => {
    const action = vi.fn(async (): Promise<ActionState> => ({ status: 'success', message: 'Invite created.', data: { url: 'https://survey.example.org/invite/tok12345' } }))
    render(<PlatformInviteForm action={action} />)
    await userEvent.type(screen.getByLabelText(/Email/), 'jane@org.example')
    await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
    await waitFor(() => expect(screen.getByLabelText('Invite link')).toHaveValue('https://survey.example.org/invite/tok12345'))
  })
})

describe('MarkdownView', () => {
  it('renders safe elements and escapes HTML', () => {
    render(<MarkdownView source={'# Privacy\n\nSee [policy](https://org.example/p).\n\n<b>raw</b>'} />)
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'policy' })).toHaveAttribute('href', 'https://org.example/p')
    expect(screen.getByText('<b>raw</b>')).toBeInTheDocument()
  })
})
