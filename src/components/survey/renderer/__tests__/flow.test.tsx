// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALL_TYPES, BRANCHING, NOW, QUIZ } from '@/lib/survey/__tests__/fixtures'
import { SurveyRenderer } from '../SurveyRenderer'
import type { RendererEvent, SurveyRendererProps } from '../types'
import { publicHalf, SEED } from './helpers'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const BRANCH = publicHalf(BRANCHING)

function setup(props: Partial<SurveyRendererProps> = {}, timers?: { advanceTimers: (ms: number) => void }) {
  const onSubmit = vi.fn<SurveyRendererProps['onSubmit']>(async () => ({ ok: true }))
  const events: RendererEvent[] = []
  const user = userEvent.setup(timers ?? {})
  render(
    <SurveyRenderer
      definition={BRANCH}
      mode="live"
      seed={SEED}
      now={NOW}
      onSubmit={onSubmit}
      onEvent={(e) => events.push(e)}
      {...props}
    />,
  )
  return { user, onSubmit, events }
}

const heading = () => screen.getByRole('heading', { level: 2 })
const next = () => screen.getByRole('button', { name: /^(Next|Submit)$/ })

describe('full flow on the branching fixture', () => {
  it('answers, validates, follows skip logic, goes back with answers kept, and ends early', async () => {
    const { user, onSubmit, events } = setup()

    // Page 1. The school question is hidden until the role is Student.
    expect(screen.queryByText('Label q_schoolxx')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Student' }))
    expect(screen.getByText('Label q_schoolxx')).toBeInTheDocument()
    expect(events.filter((e) => e.type === 'start')).toHaveLength(1)
    expect(events).toContainEqual({ type: 'question_view', question_key: 'q_rolexxxx', meta: { page: 'p_start001', position: 1 } })

    // Next is blocked by the required school question; focus moves to it.
    await user.click(next())
    expect(screen.getByText('This field is required.')).toBeInTheDocument()
    const school = screen.getByRole('textbox', { name: /Label q_schoolxx/ })
    expect(school).toHaveAttribute('aria-invalid', 'true')
    expect(school).toHaveFocus()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 1 of 4, 25% complete')

    await user.type(school, 'Fresno State')
    expect(screen.queryByText('This field is required.')).not.toBeInTheDocument()
    await user.click(next())

    // Student page; the teacher page is skipped by logic. Heading takes focus.
    expect(screen.getByText('Label q_studentq')).toBeInTheDocument()
    expect(heading()).toHaveFocus()
    expect(events).toContainEqual({ type: 'page_next', meta: { from_page: 'p_start001', to_page: 'p_student1' } })
    expect(events).toContainEqual({ type: 'question_answer', question_key: 'q_rolexxxx', meta: { page: 'p_start001' } })

    // Back restores page 1 with the answers intact.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(events).toContainEqual({ type: 'page_back', meta: { from_page: 'p_student1', to_page: 'p_start001' } })
    expect(screen.getByRole('radio', { name: 'Student' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /Label q_schoolxx/ })).toHaveValue('Fresno State')

    // Teacher jumps to the teacher page.
    await user.click(screen.getByRole('radio', { name: 'Teacher' }))
    expect(screen.queryByText('Label q_schoolxx')).not.toBeInTheDocument()
    await user.click(next())
    expect(screen.getByText('Label q_teachrq1')).toBeInTheDocument()

    // Visitor ends early: the jump to an ending submits from page 1.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('radio', { name: 'Visitor' }))
    expect(next()).toHaveTextContent('Submit')
    await user.click(next())
    expect(await screen.findByText('Thanks from e_visitor1')).toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [cleaned, visibleKeys, meta] = onSubmit.mock.calls[0] ?? []
    expect(cleaned).toEqual({ q_rolexxxx: 'o_visitor1' })
    expect(visibleKeys).not.toContain('q_schoolxx')
    expect(meta).toMatchObject({ ending_id: 'e_visitor1', ended_early: true, page_id: 'p_start001', seed: SEED })
    expect(events).toContainEqual({ type: 'complete', meta: { ending_id: 'e_visitor1' } })
  })

  it('Submit passes cleaned answers and visible_keys only for the path taken', async () => {
    const { user, onSubmit } = setup()
    await user.click(screen.getByRole('radio', { name: 'Student' }))
    await user.type(screen.getByRole('textbox', { name: /Label q_schoolxx/ }), 'Stale school')
    // Switching to Teacher hides the school answer; it must never be submitted.
    await user.click(screen.getByRole('radio', { name: 'Teacher' }))
    await user.type(screen.getByRole('textbox', { name: /Label q_agexxxxx/ }), '40')
    await user.click(next())
    await user.type(screen.getByRole('textbox', { name: /Label q_teachrq1/ }), 'Math')
    await user.click(next())
    await user.type(screen.getByRole('textbox', { name: /Label q_finalxxx/ }), 'Done')
    expect(next()).toHaveTextContent('Submit')
    await user.click(next())
    expect(await screen.findByText('Thanks from e_default1')).toBeInTheDocument()

    const [cleaned, visibleKeys, meta] = onSubmit.mock.calls[0] ?? []
    expect(cleaned).toEqual({ q_rolexxxx: 'o_teacher1', q_agexxxxx: 40, q_teachrq1: 'Math', q_finalxxx: 'Done' })
    // Grade is hidden because age > 30; school and the student page are off the path.
    expect(visibleKeys).toEqual(expect.arrayContaining(['q_rolexxxx', 'q_agexxxxx', 'q_teachrq1', 'q_finalxxx']))
    for (const k of ['q_schoolxx', 'q_gradexxx', 'q_studentq']) expect(visibleKeys).not.toContain(k)
    expect(meta).toMatchObject({ ending_id: 'e_default1', ended_early: false, path: ['p_start001', 'p_teacher1', 'p_final001'] })
  })

  it('shows server field errors and keeps the respondent on the form', async () => {
    const onSubmit = vi.fn<SurveyRendererProps['onSubmit']>(async () => ({ ok: false, fieldErrors: { q_rolexxxx: 'Server says no.' } }))
    const { user } = setup({ onSubmit })
    await user.click(screen.getByRole('radio', { name: 'Visitor' }))
    await user.click(next())
    expect(await screen.findByText('Server says no.')).toBeInTheDocument()
    expect(screen.queryByText('Thanks from e_visitor1')).not.toBeInTheDocument()
  })
})

describe('hidden questions never render', () => {
  it('hidden fields and logic-hidden questions are absent from the DOM', async () => {
    const { user } = setup()
    expect(document.querySelector('[data-question-key="q_schoolxx"]')).toBeNull()
    await user.type(screen.getByRole('textbox', { name: /Label q_agexxxxx/ }), '45')
    expect(document.querySelector('[data-question-key="q_gradexxx"]')).toBeNull()
    expect(screen.queryByText('Label q_gradexxx')).not.toBeInTheDocument()
  })

  it('hidden-type fields have no markup at all', () => {
    render(<SurveyRenderer definition={publicHalf(ALL_TYPES)} mode="preview" seed={SEED} now={NOW} onSubmit={vi.fn()} />)
    expect(screen.getByText('Label q_shorttxt')).toBeInTheDocument()
    expect(document.querySelector('[data-question-key="q_hiddenxx"]')).toBeNull()
    expect(screen.queryByText('Label q_hiddenxx')).not.toBeInTheDocument()
  })

  it('scored calcs stripped from the public half never render', () => {
    render(<SurveyRenderer definition={publicHalf(QUIZ)} mode="preview" seed={SEED} now={NOW} onSubmit={vi.fn()} initialPageId="p_quiz0002" />)
    expect(document.querySelector('[data-question-key="q_scorexxx"]')).toBeNull()
    expect(screen.getByText('Label q_plaincal')).toBeInTheDocument()
  })
})

describe('autosave', () => {
  it('preview mode never calls onAutosave or onSubmit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onAutosave = vi.fn()
    const { user, onSubmit } = setup({ mode: 'preview', onAutosave }, { advanceTimers: vi.advanceTimersByTime })
    expect(screen.getByText(/Responses are not saved/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Visitor' }))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    await user.click(screen.getByRole('radio', { name: 'Teacher' }))
    await user.click(next())
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Label q_teachrq1')).toBeInTheDocument()
    expect(onAutosave).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('live mode debounces 2 seconds and saves on page change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onAutosave = vi.fn(async () => {
      throw new Error('network down')
    })
    const { user } = setup({ onAutosave }, { advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('radio', { name: 'Teacher' }))
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(onAutosave).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onAutosave).toHaveBeenCalledTimes(1)
    expect(onAutosave).toHaveBeenLastCalledWith({ answers: { q_rolexxxx: 'o_teacher1' }, page_id: 'p_start001', seed: SEED })
    // A failing save never blocks: Next still works and the page change saves at once.
    await user.click(next())
    expect(screen.getByText('Label q_teachrq1')).toBeInTheDocument()
    expect(onAutosave).toHaveBeenCalledTimes(2)
    expect(onAutosave).toHaveBeenLastCalledWith(expect.objectContaining({ page_id: 'p_teacher1' }))
  })
})

describe('preview tools', () => {
  it('jump-to-page shows any page and reports visibility', async () => {
    const user = userEvent.setup()
    render(<SurveyRenderer definition={BRANCH} mode="preview" seed={SEED} now={NOW} onSubmit={vi.fn()} />)
    await user.click(screen.getByText('Preview tools'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Jump to page' }), 'p_final001')
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByText('Label q_finalxxx')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Question visibility' })).toBeInTheDocument()
  })
})

describe('one question per screen', () => {
  it('steps through visible questions inside a page', async () => {
    const def = { ...BRANCH, settings: { ...BRANCH.settings, one_question_per_screen: true } }
    const { user } = setup({ definition: def })
    expect(screen.getByText('Label q_rolexxxx')).toBeInTheDocument()
    expect(screen.queryByText('Label q_agexxxxx')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Teacher' }))
    await user.click(next())
    expect(screen.getByText('Label q_agexxxxx')).toBeInTheDocument()
    expect(screen.queryByText('Label q_rolexxxx')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('radio', { name: 'Teacher' })).toBeChecked()
  })
})
