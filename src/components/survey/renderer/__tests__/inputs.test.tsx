// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUESTION_TYPES, type Question } from '@/lib/survey'
import { ALL_TYPES, ALL_TYPES_ANSWERS, ALL_TYPES_QUESTIONS, defn, q } from '@/lib/survey/__tests__/fixtures'
import { QuestionBlock } from '../QuestionFrame'
import { registry } from '../registry'
import { Harness, makeCtx, publicHalf } from './helpers'

afterEach(cleanup)

const PUBLIC = publicHalf(ALL_TYPES)

describe('type registry', () => {
  it('has an entry with an Input for every question type', () => {
    for (const t of QUESTION_TYPES) {
      expect(registry[t], t).toBeDefined()
      expect(typeof registry[t].Input, t).toBe('function')
      expect(['fieldset', 'block', 'none']).toContain(registry[t].frame)
    }
  })

  it('the fixture covers every type', () => {
    expect(new Set(ALL_TYPES_QUESTIONS.map((x) => x.type))).toEqual(new Set(QUESTION_TYPES))
  })
})

describe('smoke render: every Input with a value and an error', () => {
  const ctx = makeCtx(PUBLIC, ALL_TYPES_ANSWERS)
  for (const question of ALL_TYPES_QUESTIONS) {
    it(question.type, () => {
      const message = `Broken ${question.question_key}`
      const { container } = render(
        <QuestionBlock
          question={question}
          value={ALL_TYPES_ANSWERS[question.question_key]}
          onChange={() => undefined}
          errors={[{ code: 'required', message }]}
          ctx={ctx}
        />,
      )
      const frame = registry[question.type].frame
      if (frame === 'none') {
        expect(container).toBeEmptyDOMElement()
        return
      }
      if (frame === 'block') {
        expect(container.querySelector(`[data-question-key="${question.question_key}"]`)).not.toBeNull()
        return
      }
      const fieldset = container.querySelector('fieldset')
      expect(fieldset).not.toBeNull()
      expect(fieldset).toHaveAttribute('data-invalid', 'true')
      // The legend names the question.
      expect(within(fieldset as HTMLElement).getAllByText(`Label ${question.question_key}`).length).toBeGreaterThan(0)
      const err = screen.getByText(message)
      const region = err.closest('[aria-live]') as HTMLElement
      expect(region).toHaveAttribute('aria-live', 'polite')
      // Some control points at the error region through aria-describedby.
      const described = container.querySelectorAll(`[aria-describedby~="${region.id}"]`)
      expect(described.length).toBeGreaterThan(0)
    })
  }

  it('shows the stored value for a text question', () => {
    const shortText = ALL_TYPES_QUESTIONS[0] as Question
    render(<QuestionBlock question={shortText} value="Ada" onChange={() => undefined} errors={[]} ctx={ctx} />)
    expect(screen.getByRole('textbox')).toHaveValue('Ada')
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid')
  })

  it('renders a visible calculated value read-only', () => {
    const calc = PUBLIC.questions.q_calcxxxx as Question
    render(<QuestionBlock question={calc} value={undefined} onChange={() => undefined} errors={[]} ctx={makeCtx(PUBLIC, { q_numberxx: 21 })} />)
    expect(screen.getByRole('status')).toHaveTextContent('42')
  })
})

describe('inputs behave as controlled components', () => {
  it('multiple choice exclusive option clears the others', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    const multi = PUBLIC.questions.q_multich1 as Question
    render(<Harness question={multi} def={PUBLIC} initial={['o_aaaaaaaa']} onValue={onValue} />)
    await user.click(screen.getByRole('checkbox', { name: 'None' }))
    expect(onValue).toHaveBeenLastCalledWith(['o_none0001'])
    await user.click(screen.getByRole('checkbox', { name: 'B' }))
    expect(onValue).toHaveBeenLastCalledWith(['o_bbbbbbbb'])
  })

  it('single choice Other shows a labelled text field and stores { id, other }', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    const single = PUBLIC.questions.q_singlech as Question
    render(<Harness question={single} def={PUBLIC} onValue={onValue} />)
    await user.click(screen.getByRole('radio', { name: 'Other' }))
    await user.type(screen.getByRole('textbox', { name: 'Other, please specify' }), 'Teal')
    expect(onValue).toHaveBeenLastCalledWith({ id: 'o_other001', other: 'Teal' })
  })

  it('consent reports gates_tracking through onTrackingConsent', async () => {
    const user = userEvent.setup()
    const onTracking = vi.fn()
    const consent = PUBLIC.questions.q_consentx as Question
    render(
      <QuestionBlock question={consent} value={undefined} onChange={() => undefined} errors={[]} ctx={makeCtx(PUBLIC, {}, { onTrackingConsent: onTracking })} />,
    )
    const box = screen.getByRole('checkbox')
    expect(box).toHaveAttribute('data-gates-tracking', 'true')
    await user.click(box)
    expect(onTracking).toHaveBeenCalledWith(true, 'q_consentx')
  })

  it('file upload hands files to uploads.request and stores the refs', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    const ref = { path: 'p/a.pdf', name: 'a.pdf', size: 3, mime: 'application/pdf' }
    const request = vi.fn(async () => ref)
    const files = PUBLIC.questions.q_filesxxx as Question
    function Wrapped() {
      return (
        <QuestionBlock
          question={files}
          value={undefined}
          onChange={onValue}
          errors={[]}
          ctx={makeCtx(PUBLIC, {}, { uploads: { request, remove: vi.fn(), files: {} } })}
        />
      )
    }
    const { container } = render(<Wrapped />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File(['abc'], 'a.pdf', { type: 'application/pdf' }))
    expect(request).toHaveBeenCalledWith('q_filesxxx', expect.any(File))
    expect(onValue).toHaveBeenCalledWith([ref])
  })
})

describe('keyboard: ranking', () => {
  const ranking = q({
    id: 'q_rankkbd1',
    type: 'ranking',
    settings: {
      options: [
        { id: 'o_one', label: 'One' },
        { id: 'o_two', label: 'Two' },
        { id: 'o_three', label: 'Three' },
      ],
      randomize: false,
    },
  })
  const def = defn({ questions: [ranking] })

  const order = () => screen.getAllByRole('listitem').map((li) => li.textContent?.replace(/,.*$/, '').replace(/^\d*/, '').trim())

  it('moves items with Enter and Space on the move buttons and keeps focus on the moved item', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness question={ranking} def={def} onValue={onValue} />)
    const up = screen.getByRole('button', { name: 'Move Two up' })
    up.focus()
    await user.keyboard('{Enter}')
    expect(onValue).toHaveBeenLastCalledWith(['o_two', 'o_one', 'o_three'])
    expect(order()).toEqual(['Two', 'One', 'Three'])
    expect(screen.getByRole('button', { name: 'Move Two up' })).toHaveFocus()
    // Down twice with Tab to the sibling button and Space.
    await user.tab()
    expect(screen.getByRole('button', { name: 'Move Two down' })).toHaveFocus()
    await user.keyboard(' ')
    await user.keyboard(' ')
    expect(onValue).toHaveBeenLastCalledWith(['o_one', 'o_three', 'o_two'])
    expect(screen.getByRole('button', { name: 'Move Two down' })).toHaveFocus()
    // At the end of the list the button is aria-disabled and does nothing.
    expect(screen.getByRole('button', { name: 'Move Two down' })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Enter}')
    expect(onValue).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Two moved to position 3 of 3')).toBeInTheDocument()
  })

  it('"Use this order" accepts the initial order from the keyboard', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness question={ranking} def={def} onValue={onValue} />)
    screen.getByRole('button', { name: 'Use this order' }).focus()
    await user.keyboard('{Enter}')
    expect(onValue).toHaveBeenLastCalledWith(['o_one', 'o_two', 'o_three'])
  })
})

describe('keyboard: matrix', () => {
  const matrix = q({
    id: 'q_matrixkb',
    type: 'matrix',
    settings: {
      rows: [
        { id: 'r_speed', label: 'Speed' },
        { id: 'r_price', label: 'Price' },
      ],
      columns: [
        { id: 'c_bad', label: 'Bad' },
        { id: 'c_ok', label: 'OK' },
        { id: 'c_good', label: 'Good' },
      ],
      randomize_rows: false,
      all_rows_required: true,
    },
  })
  const def = defn({ questions: [matrix] })

  it('is a real table with row and column headers and labelled radios', () => {
    render(<Harness question={matrix} def={def} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Bad', 'OK', 'Good'])
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Speed', 'Price'])
    expect(screen.getByRole('radio', { name: 'Price Good' })).toBeInTheDocument()
  })

  it('Space selects, arrows move within a row, Tab moves to the next row', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness question={matrix} def={def} onValue={onValue} />)
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Speed Bad' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onValue).toHaveBeenLastCalledWith({ r_speed: 'c_bad' })
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Speed OK' })).toHaveFocus()
    expect(onValue).toHaveBeenLastCalledWith({ r_speed: 'c_ok' })
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Price Bad' })).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(onValue).toHaveBeenLastCalledWith({ r_speed: 'c_ok', r_price: 'c_good' })
  })

  it('names the row in a per-row error', () => {
    render(<Harness question={matrix} def={def} errors={[{ code: 'required', message: 'This field is required.', row_id: 'r_price' }]} />)
    expect(screen.getByText('Price: This field is required.')).toBeInTheDocument()
  })
})
