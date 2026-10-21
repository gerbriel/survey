// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionState } from '@/lib/admin/forms'
import { GeneralForm } from '../GeneralForm'
import { InviteCreateForm } from '../Invites'
import { MembersTable, type MemberView } from '../MembersTable'
import { PixelForm } from '../Pixels'
import { PrivacyForm, type PrivacyValues } from '../PrivacyForm'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/' }))

afterEach(cleanup)

function actionReturning(state: ActionState) {
  return vi.fn<(prev: ActionState, form: FormData) => Promise<ActionState>>(async () => state)
}

function lastForm(fn: ReturnType<typeof actionReturning>): FormData {
  const call = fn.mock.calls.at(-1)
  if (!call) throw new Error('action was not called')
  return call[1]
}

describe('GeneralForm', () => {
  const values = { name: 'Finance', slug: 'finance', defaultTheme: '', showPoweredBy: true }

  it('submits name, slug, theme and the footer toggle, then shows the result', async () => {
    const action = actionReturning({ status: 'success', message: 'Settings saved.' })
    render(<GeneralForm action={action} values={values} canEdit />)
    const name = screen.getByLabelText(/Workspace name/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Finance Ops')
    await userEvent.click(screen.getByLabelText(/Powered by Survey/))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Settings saved.'))
    const form = lastForm(action)
    expect(form.get('name')).toBe('Finance Ops')
    expect(form.get('slug')).toBe('finance')
    expect(form.get('showPoweredBy')).toBeNull()
  })

  it('shows field errors from the server', async () => {
    const action = actionReturning({ status: 'error', message: 'Check the highlighted fields.', fieldErrors: { slug: 'That address is already taken. Pick another.' } })
    render(<GeneralForm action={action} values={values} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByText('That address is already taken. Pick another.')).toBeInTheDocument())
    expect(screen.getByLabelText(/Address/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('is read only below admin', () => {
    render(<GeneralForm action={actionReturning({ status: 'idle' })} values={values} canEdit={false} />)
    expect(screen.getByLabelText(/Workspace name/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })
})

describe('PrivacyForm', () => {
  const values: PrivacyValues = {
    storeIp: false,
    retentionDays: null,
    defaultCountry: 'US',
    privacyNoticeUrl: '',
    consentDefaultText: '',
    pixelConsentMode: 'banner',
    noticeAcknowledged: false,
    noticeAckLine: null,
  }

  it('asks for the acknowledgment only when switching to notice mode', async () => {
    render(<PrivacyForm action={actionReturning({ status: 'idle' })} values={values} canEdit />)
    expect(screen.queryByLabelText(/responsible for getting consent/)).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Tracking pixel consent'), 'notice')
    expect(screen.getByLabelText(/responsible for getting consent/)).toBeRequired()
  })

  it('reveals the days field for automatic deletion and submits it', async () => {
    const action = actionReturning({ status: 'success', message: 'Privacy settings saved.' })
    render(<PrivacyForm action={action} values={values} canEdit />)
    expect(screen.queryByLabelText('Days to keep responses')).toBeNull()
    await userEvent.click(screen.getByLabelText(/Delete responses automatically/))
    const days = screen.getByLabelText('Days to keep responses')
    await userEvent.clear(days)
    await userEvent.type(days, '90')
    await userEvent.click(screen.getByRole('button', { name: 'Save privacy settings' }))
    await waitFor(() => expect(action).toHaveBeenCalled())
    expect(lastForm(action).get('retentionMode')).toBe('days')
    expect(lastForm(action).get('retentionDays')).toBe('90')
  })
})

describe('PixelForm', () => {
  it('switches to a script textarea with the warning for custom scripts', async () => {
    render(<PixelForm action={actionReturning({ status: 'idle' })} rawAllowed />)
    expect(screen.getByLabelText(/^ID/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'custom_script')
    expect(screen.getByLabelText(/^Script/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('full access to the page')
  })

  it('disables GTM and custom scripts when the kill switch is off', () => {
    render(<PixelForm action={actionReturning({ status: 'idle' })} rawAllowed={false} />)
    expect(screen.getByRole('option', { name: /Google Tag Manager/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: /Custom script/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Google Analytics 4' })).not.toBeDisabled()
  })
})

describe('InviteCreateForm', () => {
  it('offers only the roles passed in and shows the new link to copy', async () => {
    const action = actionReturning({ status: 'success', message: 'Invite link created.', data: { url: 'https://survey.example.org/invite/abc12345' } })
    render(<InviteCreateForm action={action} roles={['editor', 'viewer']} />)
    expect(screen.queryByRole('option', { name: 'Admin' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }))
    await waitFor(() => expect(screen.getByLabelText('New invite link')).toHaveValue('https://survey.example.org/invite/abc12345'))
    expect(lastForm(action).get('expiresInDays')).toBe('7')
    expect(lastForm(action).get('maxUses')).toBe('1')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  })
})

describe('MembersTable', () => {
  const members: MemberView[] = [
    { userId: '00000000-0000-0000-0000-00000000000a', name: 'Olive Owner', avatarUrl: null, role: 'owner', joined: 'Oct 1, 2026', inviteLabel: null },
    { userId: '00000000-0000-0000-0000-00000000000b', name: 'Ada Admin', avatarUrl: null, role: 'admin', joined: 'Oct 2, 2026', inviteLabel: null },
    { userId: '00000000-0000-0000-0000-00000000000c', name: 'Ed Editor', avatarUrl: null, role: 'editor', joined: 'Oct 3, 2026', inviteLabel: 'Fall interns' },
  ]

  it('as an admin: can change and remove editors, not the owner or other admins', () => {
    render(
      <MembersTable
        members={members}
        currentUserId="00000000-0000-0000-0000-00000000000b"
        actorRole="admin"
        readOnly={false}
        changeRole={actionReturning({ status: 'idle' })}
        remove={actionReturning({ status: 'idle' })}
      />,
    )
    expect(screen.getByLabelText('Role for Ed Editor')).toBeInTheDocument()
    expect(screen.queryByLabelText('Role for Olive Owner')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument()
    expect(screen.getByText('Invite: Fall interns')).toBeInTheDocument()
  })

  it('submits a role change for the row', async () => {
    const changeRole = actionReturning({ status: 'success', message: 'Role updated.' })
    render(
      <MembersTable
        members={members}
        currentUserId="00000000-0000-0000-0000-00000000000a"
        actorRole="owner"
        readOnly={false}
        changeRole={changeRole}
        remove={actionReturning({ status: 'idle' })}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Role for Ed Editor'), 'viewer')
    const buttons = screen.getAllByRole('button', { name: 'Change' })
    await userEvent.click(buttons[1]!)
    await waitFor(() => expect(changeRole).toHaveBeenCalled())
    expect(lastForm(changeRole).get('userId')).toBe('00000000-0000-0000-0000-00000000000c')
    expect(lastForm(changeRole).get('role')).toBe('viewer')
  })

  it('shows no controls in an archived workspace', () => {
    render(
      <MembersTable
        members={members}
        currentUserId="00000000-0000-0000-0000-00000000000a"
        actorRole="owner"
        readOnly
        changeRole={actionReturning({ status: 'idle' })}
        remove={actionReturning({ status: 'idle' })}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
