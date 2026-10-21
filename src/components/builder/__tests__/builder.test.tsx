// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { diffDefinitions, lintDefinition, type SurveyDefinition } from '@/lib/survey'
import { defn, q } from '@/lib/survey/__tests__/fixtures'
import { registry } from '@/components/survey/renderer'
import { Palette } from '../Palette'
import { Canvas } from '../Canvas'
import { PublishDialog } from '../PublishDialog'
import { PALETTE_GROUPS, PALETTE_TYPES, TYPE_LABELS } from '../model'
import { DND_QUESTION, DND_TYPE } from '../dnd'

beforeAll(() => {
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  window.requestAnimationFrame ??= (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)
})
afterEach(cleanup)

function dataTransfer(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (k: string) => data[k] ?? '', setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' }
}

const DEF: SurveyDefinition = defn({
  questions: [
    q({ id: 'q_aaaaaaaa', type: 'short_text', settings: {} }),
    q({ id: 'q_bbbbbbbb', type: 'number', settings: {} }),
    q({ id: 'q_cccccccc', type: 'email', settings: {} }),
  ],
  pages: [
    { id: 'p_one00001', question_ids: ['q_aaaaaaaa', 'q_bbbbbbbb'] },
    { id: 'p_two00001', question_ids: ['q_cccccccc'] },
  ],
})

describe('Palette', () => {
  it('lists every registry type once, grouped, and adds on click', async () => {
    const seen = PALETTE_GROUPS.flatMap((g) => g.types)
    expect(new Set(seen).size).toBe(seen.length)
    expect([...PALETTE_TYPES].sort()).toEqual(Object.keys(registry).sort())
    const onAdd = vi.fn()
    render(<Palette onAdd={onAdd} />)
    for (const g of PALETTE_GROUPS) expect(screen.getByRole('heading', { name: g.label })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: TYPE_LABELS.nps }))
    expect(onAdd).toHaveBeenCalledWith('nps')
  })

  it('starts a drag carrying the type', () => {
    render(<Palette onAdd={vi.fn()} />)
    const dt = dataTransfer({})
    fireEvent.dragStart(screen.getByRole('button', { name: TYPE_LABELS.rating }), { dataTransfer: dt })
    expect(dt.setData).toHaveBeenCalledWith(DND_TYPE, 'rating')
  })
})

function renderCanvas(overrides: Partial<Parameters<typeof Canvas>[0]> = {}) {
  const commit = vi.fn()
  const onAddType = vi.fn()
  render(
    <Canvas
      definition={DEF}
      selection={{ kind: 'survey' }}
      onSelect={vi.fn()}
      commit={commit}
      onAddType={onAddType}
      readOnly={false}
      issueCount={{}}
      breakingIds={new Set()}
      {...overrides}
    />,
  )
  return { commit, onAddType }
}

const ids = (d: SurveyDefinition) => d.pages.map((p) => p.question_ids)

describe('Canvas reorder', () => {
  it('moves a question with Alt plus arrow keys, across pages', () => {
    const { commit } = renderCanvas()
    const card = document.querySelector('[data-qcard="q_bbbbbbbb"]') as HTMLElement
    fireEvent.keyDown(card, { key: 'ArrowDown', altKey: true })
    expect(ids(commit.mock.calls[0]?.[0])).toEqual([['q_aaaaaaaa'], ['q_bbbbbbbb', 'q_cccccccc']])
    fireEvent.keyDown(card, { key: 'ArrowUp', altKey: true })
    expect(ids(commit.mock.calls[1]?.[0])).toEqual([['q_bbbbbbbb', 'q_aaaaaaaa'], ['q_cccccccc']])
    fireEvent.keyDown(card, { key: 'ArrowUp' })
    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('moves with the buttons', async () => {
    const { commit } = renderCanvas()
    const page1 = screen.getByRole('list', { name: 'Questions on page 1' })
    await userEvent.click(within(page1).getAllByRole('button', { name: 'Move question down' })[0]!)
    expect(ids(commit.mock.calls[0]?.[0])).toEqual([['q_bbbbbbbb', 'q_aaaaaaaa'], ['q_cccccccc']])
  })

  it('drops a dragged question onto another page and a palette type onto a page', () => {
    const { commit, onAddType } = renderCanvas()
    const page2 = screen.getByRole('list', { name: 'Questions on page 2' })
    fireEvent.dragOver(page2, { dataTransfer: dataTransfer({ [DND_QUESTION]: 'q_aaaaaaaa' }) })
    fireEvent.drop(page2, { dataTransfer: dataTransfer({ [DND_QUESTION]: 'q_aaaaaaaa' }) })
    expect(ids(commit.mock.calls[0]?.[0])).toEqual([['q_bbbbbbbb'], ['q_cccccccc', 'q_aaaaaaaa']])
    fireEvent.drop(page2, { dataTransfer: dataTransfer({ [DND_TYPE]: 'yes_no' }) })
    expect(onAddType).toHaveBeenCalledWith('yes_no', 'p_two00001', 1)
  })

  it('does nothing when read only', () => {
    const { commit } = renderCanvas({ readOnly: true })
    fireEvent.keyDown(document.querySelector('[data-qcard="q_bbbbbbbb"]') as HTMLElement, { key: 'ArrowDown', altKey: true })
    expect(commit).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Move question down' })).toBeNull()
  })
})

describe('PublishDialog', () => {
  const base = { open: true, onClose: vi.fn(), firstPublish: false, phase: { kind: 'review' } as const, settingsHref: '/x/settings', stateLabel: 'Open' }

  it('blocks publishing while lint errors remain', () => {
    const broken = { ...DEF, endings: [] }
    render(<PublishDialog {...base} issues={lintDefinition(broken).issues} diff={null} hasResponses={false} onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByText(/Problems/)).toBeInTheDocument()
  })

  it('requires the acknowledgment for breaking changes when there are responses', async () => {
    const next = { ...DEF, questions: { ...DEF.questions }, pages: [{ id: 'p_one00001', question_ids: ['q_aaaaaaaa', 'q_bbbbbbbb'] }, { id: 'p_two00001', question_ids: [] }] }
    delete next.questions.q_cccccccc
    const diff = diffDefinitions(DEF, next)
    const onConfirm = vi.fn()
    render(<PublishDialog {...base} issues={lintDefinition(next).issues} diff={diff} hasResponses onConfirm={onConfirm} />)
    const publish = screen.getByRole('button', { name: 'Publish' })
    expect(publish).toBeDisabled()
    await userEvent.click(screen.getByLabelText('I understand reports will split for these questions'))
    expect(publish).toBeEnabled()
    await userEvent.click(publish)
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('shows breaking changes as info when there are no responses, and the state after publishing', async () => {
    const next = { ...DEF, questions: { ...DEF.questions }, pages: [{ id: 'p_one00001', question_ids: ['q_aaaaaaaa', 'q_bbbbbbbb'] }, { id: 'p_two00001', question_ids: [] }] }
    delete next.questions.q_cccccccc
    const onConfirm = vi.fn()
    const { rerender } = render(<PublishDialog {...base} issues={[]} diff={diffDefinitions(DEF, next)} hasResponses={false} onConfirm={onConfirm} />)
    expect(screen.getByText(/no responses yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
    rerender(<PublishDialog {...base} phase={{ kind: 'done', versionNo: 3 }} issues={[]} diff={null} hasResponses={false} onConfirm={onConfirm} />)
    expect(screen.getByText(/Version 3 is live/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open state settings' })).toHaveAttribute('href', '/x/settings')
  })
})
