import type { ReactNode } from 'react'
import {
  orderPageQuestions,
  pipeText,
  type Ending,
  type EvalState,
  type RichText,
  type SurveyDefinition,
} from '@/lib/survey'
import { fmt, mergeStrings, type RendererStrings } from './strings'
import { registry, isAnswerable } from './registry'
import { RichTextView, richTextPlain } from './richtext'

export interface SummaryItem {
  question_key: string
  label: string
  value: string
}

/** The respondent's own visible answers in path order, from client state (doc 02 section 10). */
export function summarizeAnswers(definition: SurveyDefinition, state: EvalState, seed: string): SummaryItem[] {
  const out: SummaryItem[] = []
  for (const pid of state.path) {
    const page = definition.pages.find((p) => p.id === pid)
    if (!page) continue
    for (const id of orderPageQuestions(page, seed)) {
      const q = definition.questions[id]
      const v = state.answers[id]
      if (!q || v === undefined || !state.visible.has(id) || !isAnswerable(q.type)) continue
      const summarize = registry[q.type].summarize as ((q: unknown, v: unknown) => string) | undefined
      out.push({ question_key: q.question_key, label: richTextPlain(q.label, definition, state), value: summarize ? summarize(q, v) : String(v) })
    }
  }
  return out
}

/** https only, checked with new URL (doc 02 section 10). */
export function safeRedirect(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** calcOverrides that pipe the server score into `{{calc:score_key}}` on endings. */
export function scoreOverrides(definition: SurveyDefinition, score: { value: number } | null | undefined): Record<string, number> {
  const id = definition.settings.quiz?.score_calc_id
  if (!score || !id) return {}
  // The scored calc is stripped from public_definition, so its id is the key (new questions have id === key).
  const key = definition.questions[id]?.question_key ?? id
  return { [key]: score.value }
}

export function endingRedirect(definition: SurveyDefinition, ending: Ending, state: EvalState, score?: { value: number } | null): string | null {
  if (!ending.redirect_url) return null
  return safeRedirect(pipeText(ending.redirect_url, definition, state, { encode: 'url', calcOverrides: scoreOverrides(definition, score) }))
}

/**
 * Thank-you screen. Phase 2C can render it on its own (resume of a finished
 * response). Score comes from the submit result, never the browser. Any
 * redirect is the caller's job; `continueHref` adds a visible Continue link.
 */
export function ThankYouScreen({
  title,
  message,
  score,
  summary,
  continueHref,
  headingId,
  strings: overrides,
}: {
  title?: ReactNode
  message: ReactNode
  score?: { value: number; max: number } | null
  summary?: SummaryItem[] | null
  continueHref?: string | null
  headingId?: string
  strings?: Partial<RendererStrings>
}) {
  const s = mergeStrings(overrides)
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} tabIndex={-1} className="text-xl font-semibold outline-none [font-family:var(--sv-font-heading)]">
        {title ?? s.thankYou}
      </h2>
      <div className="leading-relaxed">{message}</div>
      {score ? (
        <p className="text-lg font-semibold" role="status">
          {fmt(s.scoreLine, { value: score.value, max: score.max })}
        </p>
      ) : null}
      {summary && summary.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">{s.summaryTitle}</h3>
          <dl className="flex flex-col gap-2">
            {summary.map((item) => (
              <div key={item.question_key} className="flex flex-col border-b border-border pb-2">
                <dt className="text-sm text-muted">{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {continueHref ? (
        <a href={continueHref} className="self-start font-medium text-[var(--sv-primary)] underline">
          {s.continue}
        </a>
      ) : null}
    </section>
  )
}

/** The ThankYouScreen props for an ending of a definition, piped against state. */
export function endingView(
  definition: SurveyDefinition,
  ending: Ending,
  state: EvalState,
  seed: string,
  score: { value: number; max: number } | null,
) {
  const pipe = { calcOverrides: scoreOverrides(definition, score) }
  return {
    title: ending.title ? <RichTextView text={ending.title} definition={definition} state={state} pipe={pipe} /> : undefined,
    message: <RichTextView text={ending.message} definition={definition} state={state} pipe={pipe} />,
    score: ending.show_score ? score : null,
    summary: ending.show_summary ? summarizeAnswers(definition, state, seed) : null,
    continueHref: endingRedirect(definition, ending, state, score),
  }
}

/** Closed (or cap reached, or not open yet) screen with the survey's closed_message. */
export function ClosedScreen({
  title,
  message,
  strings: overrides,
}: {
  title?: ReactNode
  message: RichText | ReactNode
  strings?: Partial<RendererStrings>
}) {
  const s = mergeStrings(overrides)
  const isRich = typeof message === 'object' && message !== null && 'format' in message && (message as RichText).format === 'md-lite'
  return (
    <section className="flex flex-col gap-3" aria-labelledby="sv-closed-title">
      <h2 id="sv-closed-title" className="text-xl font-semibold [font-family:var(--sv-font-heading)]">
        {title ?? s.closedTitle}
      </h2>
      <div className="leading-relaxed">{isRich ? <RichTextView text={message as RichText} /> : (message as ReactNode)}</div>
    </section>
  )
}
