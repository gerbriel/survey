'use client'

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { safeMigrateDefinition, type FileRef, type ValidateResult, type ValidationError } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import type { InputContext, RendererEvent, SurveyRendererProps } from './types'
import { fmt, mergeStrings } from './strings'
import { ThemeProvider } from './ThemeProvider'
import { SurveyShell } from './SurveyShell'
import { Progress } from './Progress'
import { PageView } from './PageView'
import { PreviewBanner, PreviewTools } from './PreviewTools'
import { endingRedirect, endingView, ThankYouScreen } from './Endings'
import { RichTextView } from './richtext'
import { isAnswerable } from './registry'
import { screenQuestionIds, useSurveyState } from './useSurveyState'
import { useAutosave } from './useAutosave'

const EMPTY_HIDDEN: Record<string, string> = {}
const EMPTY_FILES: Record<string, FileRef[]> = {}

/**
 * Root of the survey renderer (doc 03 section 5). Used by the builder preview
 * (mode "preview") and the public page (mode "live"). Pure client component:
 * no data access, no fetch, no pixels, no Turnstile. The caller owns
 * transport through onAutosave, onSubmit and uploads.
 */
export function SurveyRenderer(props: SurveyRendererProps) {
  const migrated = useMemo(() => safeMigrateDefinition(props.definition), [props.definition])
  if (!migrated.ok) {
    const s = mergeStrings(props.strings)
    return (
      <div role="alert" className="p-6">
        {s.invalidDefinition}
      </div>
    )
  }
  return <RendererInner {...props} definition={migrated.definition} />
}

function RendererInner(props: SurveyRendererProps) {
  const { definition, mode, seed, onEvent, onSubmit, onEnding, uploads } = props
  const preview = mode === 'preview'
  const strings = mergeStrings(props.strings)
  const theme = props.theme ?? definition.theme
  const [now] = useState(() => props.now ?? new Date().toISOString())
  const hidden = props.hidden ?? EMPTY_HIDDEN
  const files = uploads?.files ?? EMPTY_FILES
  const api = useSurveyState({ definition, seed, hidden, now, files, initialAnswers: props.initialAnswers, initialPageId: props.initialPageId })
  const { state, ev } = api
  const headingId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const started = useRef(false)
  const viewed = useRef(new Set<string>())
  const answered = useRef(new Set<string>())

  useAutosave({
    // Preview never autosaves (doc 03 section 5).
    enabled: !preview && !!props.onAutosave && definition.settings.autosave_partial !== false && state.phase === 'answering',
    answers: state.answers,
    pageId: state.pageId,
    seed,
    onAutosave: props.onAutosave,
  })

  const emit = (e: RendererEvent) => onEvent?.(e)
  const markStarted = () => {
    if (started.current) return
    started.current = true
    emit({ type: 'start' })
  }

  // Focus the step heading on every screen change (doc 02 section 11), never on first load.
  useEffect(() => {
    if (state.navTick > 0) document.getElementById(headingId)?.focus()
  }, [state.navTick, headingId])

  // Move focus to the first invalid control after a blocked Next.
  useEffect(() => {
    if (state.errorTick === 0) return
    const el = formRef.current?.querySelector<HTMLElement>(
      '[data-invalid] input:not([type=hidden]):not([disabled]), [data-invalid] select, [data-invalid] textarea, [data-invalid] button',
    )
    el?.focus()
  }, [state.errorTick])

  const page = definition.pages.find((p) => p.id === state.pageId)

  const numbers: Record<string, number> = {}
  if (definition.settings.show_question_numbers) {
    let n = 0
    for (const pid of ev.path) {
      for (const id of screenQuestionIds(definition, pid, ev, seed)) {
        const q = definition.questions[id]
        if (q && isAnswerable(q.type)) numbers[id] = ++n
      }
    }
  }

  const ctx: InputContext = {
    definition,
    state: ev,
    seed,
    mode,
    now,
    strings,
    uploads,
    resolveAssetUrl: props.resolveAssetUrl,
    onTrackingConsent: props.onTrackingConsent,
  }

  function commitAnswers() {
    for (const id of api.screenIds) {
      const q = definition.questions[id]
      if (!q || !isAnswerable(q.type)) continue
      const has = ev.answers[id] !== undefined
      if (has && !answered.current.has(q.question_key)) {
        answered.current.add(q.question_key)
        emit({ type: 'question_answer', question_key: q.question_key, meta: { page: state.pageId } })
      } else if (!has) {
        // Re-fires only after the answer goes from empty to filled again (doc 04 section 3.2).
        answered.current.delete(q.question_key)
      }
    }
  }

  function showEnding(endingId: string | null, endedEarly: boolean, score: { value: number; max: number } | null) {
    api.dispatch({ type: 'ended', ended: { ending_id: endingId, ended_early: endedEarly, score } })
    emit({ type: 'complete', meta: { ending_id: endingId } })
    const ending = definition.endings.find((e) => e.id === endingId) ?? definition.endings[0]
    if (ending && onEnding) {
      onEnding({
        ending,
        redirect_url: endingRedirect(definition, ending, ev, score),
        redirect_delay_seconds: ending.redirect_delay_seconds ?? 0,
        score,
      })
    }
  }

  async function finish(result: ValidateResult) {
    if (preview) {
      // Preview never submits; it shows the ending the engine picked.
      showEnding(result.ending_id, result.ended_early, null)
      return
    }
    api.dispatch({ type: 'submitting' })
    try {
      const out = await onSubmit(result.cleaned, result.visible_keys, {
        ending_id: result.ending_id,
        ended_early: result.ended_early,
        page_id: state.pageId,
        path: result.path,
        seed,
        computed: result.computed,
      })
      if (out.ok) {
        showEnding(out.ending_id ?? result.ending_id, result.ended_early, out.score ?? null)
        return
      }
      const errors: Record<string, ValidationError[]> = {}
      for (const [k, message] of Object.entries(out.fieldErrors ?? {})) errors[k] = [{ code: 'type', message }]
      const hasField = Object.keys(errors).length > 0
      api.dispatch({
        type: 'submit_failed',
        message: out.message ?? (hasField ? strings.errorSummary : strings.submitError),
        errors: hasField ? errors : undefined,
        goto: hasField ? api.locate(errors) : undefined,
      })
    } catch {
      api.dispatch({ type: 'submit_failed', message: strings.submitError })
    }
  }

  function handleNext(e?: FormEvent) {
    e?.preventDefault()
    if (state.phase !== 'answering') return
    commitAnswers()
    const r = api.next()
    if (r.kind === 'moved') emit({ type: 'page_next', meta: { from_page: r.from, to_page: r.to } })
    else if (r.kind === 'finish') void finish(r.result)
  }

  function handleBack() {
    const r = api.back()
    if (r) emit({ type: 'page_back', meta: { from_page: r.from, to_page: r.to } })
  }

  const onQuestionView = (key: string, position: number) => {
    if (!key || viewed.current.has(key)) return
    viewed.current.add(key)
    emit({ type: 'question_view', question_key: key, meta: { page: state.pageId, position } })
  }

  const firstScreen = state.history.length === 0
  const nextLabel = api.isLastScreen
    ? theme.button_text.submit || strings.submit
    : page?.button_label || (firstScreen && theme.button_text.start) || theme.button_text.next || strings.next
  const hasErrors = Object.keys(state.errors).length > 0
  const stepText = fmt(strings.stepOf, api.progress)

  let body
  if (state.phase === 'ended' && state.ended) {
    const ending = definition.endings.find((x) => x.id === state.ended?.ending_id) ?? definition.endings[0]
    body = ending ? (
      <ThankYouScreen headingId={headingId} strings={props.strings} {...endingView(definition, ending, ev, seed, state.ended.score)} />
    ) : (
      <ThankYouScreen headingId={headingId} strings={props.strings} message={null} />
    )
  } else if (page) {
    body = (
      <form ref={formRef} noValidate onSubmit={handleNext} onFocusCapture={markStarted} aria-labelledby={headingId}>
        <PageView
          page={page}
          headingId={headingId}
          heading={page.title || stepText}
          questionIds={api.screenIds}
          answers={state.answers}
          errors={state.errors}
          numbers={numbers}
          ctx={ctx}
          showDescription={api.step === 0}
          onChange={(key, v) => {
            markStarted()
            api.setAnswer(key, v)
          }}
          onQuestionView={onQuestionView}
        >
          <p aria-live="polite" className="text-sm font-medium text-[var(--sv-error)] empty:hidden">
            {hasErrors && !state.submitError ? strings.errorSummary : ''}
          </p>
          {state.submitError ? (
            <p role="alert" className="text-sm font-medium text-[var(--sv-error)]">
              {state.submitError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            {api.canBack ? (
              <Button variant="secondary" className="min-h-11 rounded-[var(--sv-radius)]" onClick={handleBack}>
                {theme.button_text.back || strings.back}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" className="min-h-11 rounded-[var(--sv-radius)]" loading={state.phase === 'submitting'}>
              {state.phase === 'submitting' ? strings.submitting : nextLabel}
            </Button>
          </div>
        </PageView>
      </form>
    )
  } else {
    body = <p role="alert">{strings.invalidDefinition}</p>
  }

  const progress =
    definition.settings.show_progress && state.phase !== 'ended' ? (
      <Progress style={theme.progress.style} current={api.progress.current} total={api.progress.total} strings={strings} />
    ) : null

  return (
    <ThemeProvider theme={theme} fontClassName={props.fontClassName}>
      <SurveyShell
        theme={theme}
        title={definition.settings.title}
        description={
          firstScreen && state.phase !== 'ended' && definition.settings.description ? (
            <RichTextView text={definition.settings.description} definition={definition} state={ev} />
          ) : null
        }
        logoUrl={props.logoUrl}
        resolveAssetUrl={props.resolveAssetUrl}
        progress={progress}
        banner={preview ? <PreviewBanner strings={strings} /> : null}
        footer={props.footer}
      >
        {preview ? <PreviewTools definition={definition} state={ev} currentPageId={state.pageId} onJump={api.jumpTo} strings={strings} /> : null}
        {body}
      </SurveyShell>
    </ThemeProvider>
  )
}
