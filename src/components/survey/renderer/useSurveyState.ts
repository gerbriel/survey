'use client'

import { useMemo, useReducer } from 'react'
import {
  evaluate,
  orderPageQuestions,
  orderPages,
  validateSubmission,
  type EvalState,
  type FileRef,
  type Question,
  type SurveyDefinition,
  type ValidateResult,
  type ValidationError,
} from '@/lib/survey'
import { registry } from './registry'

export interface Screen {
  pageId: string
  step: number
}

export interface Ended {
  ending_id: string | null
  ended_early: boolean
  score: { value: number; max: number } | null
}

export interface SurveyState {
  /** Wire answers keyed by question_key, raw client shapes. */
  answers: Record<string, unknown>
  pageId: string
  /** Index inside the page when one_question_per_screen is on, else 0. */
  step: number
  history: Screen[]
  touched: Record<string, true>
  /** Keyed by question_key. */
  errors: Record<string, ValidationError[]>
  /** Bumped when errors should take focus. */
  errorTick: number
  /** Bumped on every screen change so the heading takes focus. */
  navTick: number
  phase: 'answering' | 'submitting' | 'ended'
  ended: Ended | null
  submitError: string | null
}

export type SurveyAction =
  | { type: 'answer'; key: string; value: unknown }
  | { type: 'touch'; key: string }
  | { type: 'errors'; errors: Record<string, ValidationError[]>; goto?: Screen }
  | { type: 'go'; to: Screen }
  | { type: 'back' }
  | { type: 'submitting' }
  | { type: 'submit_failed'; message: string | null; errors?: Record<string, ValidationError[]>; goto?: Screen }
  | { type: 'ended'; ended: Ended }

function isEmptyRaw(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  return false
}

export function surveyReducer(state: SurveyState, action: SurveyAction): SurveyState {
  switch (action.type) {
    case 'answer': {
      const answers = { ...state.answers }
      if (isEmptyRaw(action.value)) delete answers[action.key]
      else answers[action.key] = action.value
      let errors = state.errors
      if (errors[action.key]) {
        // Decision: editing a question clears its errors; they come back on the next Next.
        errors = { ...errors }
        delete errors[action.key]
      }
      return { ...state, answers, errors, touched: { ...state.touched, [action.key]: true }, submitError: null }
    }
    case 'touch':
      return state.touched[action.key] ? state : { ...state, touched: { ...state.touched, [action.key]: true } }
    case 'errors': {
      const moved = action.goto && (action.goto.pageId !== state.pageId || action.goto.step !== state.step)
      return {
        ...state,
        errors: action.errors,
        errorTick: state.errorTick + 1,
        ...(moved && action.goto
          ? { pageId: action.goto.pageId, step: action.goto.step, history: [...state.history, { pageId: state.pageId, step: state.step }] }
          : {}),
      }
    }
    case 'go':
      return {
        ...state,
        history: [...state.history, { pageId: state.pageId, step: state.step }],
        pageId: action.to.pageId,
        step: action.to.step,
        errors: {},
        navTick: state.navTick + 1,
        submitError: null,
        // Preview's jump menu may leave the ending screen.
        phase: 'answering',
        ended: null,
      }
    case 'back': {
      const prev = state.history[state.history.length - 1]
      if (!prev) return state
      return { ...state, history: state.history.slice(0, -1), pageId: prev.pageId, step: prev.step, errors: {}, navTick: state.navTick + 1, submitError: null }
    }
    case 'submitting':
      return { ...state, phase: 'submitting', submitError: null }
    case 'submit_failed': {
      const moved = action.goto && (action.goto.pageId !== state.pageId || action.goto.step !== state.step)
      return {
        ...state,
        phase: 'answering',
        submitError: action.message,
        errors: action.errors ?? state.errors,
        errorTick: state.errorTick + 1,
        ...(moved && action.goto
          ? { pageId: action.goto.pageId, step: action.goto.step, history: [...state.history, { pageId: state.pageId, step: state.step }] }
          : {}),
      }
    }
    case 'ended':
      return { ...state, phase: 'ended', ended: action.ended, errors: {}, navTick: state.navTick + 1 }
  }
}

/** Questions that occupy space on a screen: visible, not hidden fields, not invisible calcs. */
export function isRenderable(q: Question): boolean {
  if (registry[q.type].frame === 'none') return false
  if (q.type === 'calculated' && !q.settings.visible) return false
  return true
}

/** Visible, renderable question ids of a page in display (seeded) order. */
export function screenQuestionIds(def: SurveyDefinition, pageId: string, ev: EvalState, seed: string): string[] {
  const page = def.pages.find((p) => p.id === pageId)
  if (!page) return []
  return orderPageQuestions(page, seed).filter((id) => {
    const q = def.questions[id]
    return q !== undefined && ev.visible.has(id) && isRenderable(q)
  })
}

/** Next page on the engine path after `pageId`, or null at the end (or after an early ending). */
export function nextPageId(def: SurveyDefinition, ev: EvalState, pageId: string, seed: string): string | null {
  const i = ev.path.indexOf(pageId)
  if (i >= 0) return ev.path[i + 1] ?? null
  // Off the path (its show_page condition changed under the respondent): the first path page after it in walk order.
  const order = orderPages(def, seed)
  const at = order.indexOf(pageId)
  return ev.path.find((p) => order.indexOf(p) > at) ?? null
}

export type NextResult =
  | { kind: 'blocked'; errors: Record<string, ValidationError[]> }
  | { kind: 'step'; pageId: string }
  | { kind: 'moved'; from: string; to: string }
  | { kind: 'finish'; result: ValidateResult }

export interface UseSurveyStateOptions {
  definition: SurveyDefinition
  seed: string
  hidden: Record<string, string>
  now: string
  files: Record<string, FileRef[]>
  initialAnswers?: Record<string, unknown>
  initialPageId?: string
}

function initState(opts: UseSurveyStateOptions): SurveyState {
  const answers = { ...(opts.initialAnswers ?? {}) }
  const ev = evaluate(opts.definition, answers, { now: opts.now, hidden: opts.hidden, seed: opts.seed })
  const first = ev.path[0] ?? opts.definition.pages[0]?.id ?? ''
  const pageId = opts.initialPageId && ev.path.includes(opts.initialPageId) ? opts.initialPageId : first
  return {
    answers,
    pageId,
    step: 0,
    history: [],
    touched: {},
    errors: {},
    errorTick: 0,
    navTick: 0,
    phase: 'answering',
    ended: null,
    submitError: null,
  }
}

/**
 * Survey state (doc 03 section 5): answers, current screen, Back history,
 * touched, errors. `evaluate` reruns (memoized) on every answer change; Next
 * validates the page with validateSubmission in page mode and follows the
 * engine path; the last Next validates in final mode and returns `finish`.
 */
export function useSurveyState(opts: UseSurveyStateOptions) {
  const { definition, seed, hidden, now, files } = opts
  const [state, dispatch] = useReducer(surveyReducer, opts, initState)
  const oneQuestion = definition.settings.one_question_per_screen === true

  const ev = useMemo(() => evaluate(definition, state.answers, { now, hidden, seed }), [definition, state.answers, now, hidden, seed])

  const pageIds = screenQuestionIds(definition, state.pageId, ev, seed)
  const stepCount = oneQuestion ? Math.max(1, pageIds.length) : 1
  const step = Math.min(state.step, stepCount - 1)
  const screenIds = oneQuestion ? pageIds.slice(step, step + 1) : pageIds
  const upcoming = nextPageId(definition, ev, state.pageId, seed)
  const isLastScreen = upcoming === null && step >= stepCount - 1

  // Progress. Decision: total = pages visited + pages left in walk order from
  // here (the longest possible remaining path), so skips only move the bar forward.
  const order = orderPages(definition, seed)
  const visited = new Set(state.history.map((h) => h.pageId))
  visited.delete(state.pageId)
  const at = Math.max(0, order.indexOf(state.pageId))
  const progress = { current: visited.size + 1, total: visited.size + (order.length - at) }

  const keyOf = (id: string) => definition.questions[id]?.question_key ?? id

  function locate(errors: Record<string, ValidationError[]>): Screen | undefined {
    for (const pid of ev.path) {
      const ids = screenQuestionIds(definition, pid, ev, seed)
      const i = ids.findIndex((id) => errors[keyOf(id)])
      if (i >= 0) return { pageId: pid, step: oneQuestion ? i : 0 }
    }
    return undefined
  }

  function validate(mode: 'page' | 'final'): ValidateResult {
    return validateSubmission(definition, state.answers, { mode, page_id: state.pageId, now, hidden, files, seed })
  }

  function next(): NextResult {
    const page = validate('page')
    const keys = new Set(screenIds.map(keyOf))
    const errors = oneQuestion ? Object.fromEntries(Object.entries(page.errors).filter(([k]) => keys.has(k))) : page.errors
    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'errors', errors })
      return { kind: 'blocked', errors }
    }
    if (oneQuestion && step < stepCount - 1) {
      dispatch({ type: 'go', to: { pageId: state.pageId, step: step + 1 } })
      return { kind: 'step', pageId: state.pageId }
    }
    if (upcoming) {
      dispatch({ type: 'go', to: { pageId: upcoming, step: 0 } })
      return { kind: 'moved', from: state.pageId, to: upcoming }
    }
    const final = validate('final')
    if (!final.ok) {
      dispatch({ type: 'errors', errors: final.errors, goto: locate(final.errors) })
      return { kind: 'blocked', errors: final.errors }
    }
    return { kind: 'finish', result: final }
  }

  function back(): { from: string; to: string } | null {
    const prev = state.history[state.history.length - 1]
    if (!prev || !definition.settings.allow_back) return null
    dispatch({ type: 'back' })
    return { from: state.pageId, to: prev.pageId }
  }

  return {
    state,
    dispatch,
    ev,
    step,
    stepCount,
    screenIds,
    isLastScreen,
    canBack: definition.settings.allow_back && state.history.length > 0 && state.phase === 'answering',
    progress,
    setAnswer: (key: string, value: unknown) => dispatch({ type: 'answer', key, value }),
    next,
    back,
    /** Preview debug menu: show any page, logic still applies to what renders. */
    jumpTo: (pageId: string) => dispatch({ type: 'go', to: { pageId, step: 0 } }),
    locate,
  }
}

export type SurveyStateApi = ReturnType<typeof useSurveyState>
