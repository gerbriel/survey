'use client'

import { useEffect, useEffectEvent, useRef } from 'react'
import type { AutosaveSnapshot } from './types'

export const AUTOSAVE_DEBOUNCE_MS = 2000

/**
 * Autosave (doc 03 section 5): fires 2 seconds after the last answer change
 * and immediately on every page change. Fire and forget: a rejected or
 * throwing onAutosave is swallowed so the respondent is never blocked.
 * Retry with backoff, localStorage mirroring and the visibilitychange beacon
 * (doc 02 section 11) are the caller's job; wrap onAutosave to add them.
 */
export function useAutosave({
  enabled,
  answers,
  pageId,
  seed,
  onAutosave,
  delayMs = AUTOSAVE_DEBOUNCE_MS,
}: {
  enabled: boolean
  answers: Record<string, unknown>
  pageId: string
  seed: string
  onAutosave?: (snapshot: AutosaveSnapshot) => Promise<void> | void
  delayMs?: number
}) {
  const lastAnswers = useRef(answers)
  const lastPage = useRef(pageId)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fire = useEffectEvent(() => {
    if (!enabled || !onAutosave) return
    try {
      void Promise.resolve(onAutosave({ answers, page_id: pageId, seed })).catch(() => undefined)
    } catch {
      // Never block the respondent.
    }
  })

  useEffect(() => {
    if (!enabled || lastAnswers.current === answers) return
    lastAnswers.current = answers
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      fire()
    }, delayMs)
  }, [answers, enabled, delayMs])

  useEffect(() => {
    if (!enabled || lastPage.current === pageId) return
    lastPage.current = pageId
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    fire()
  }, [pageId, enabled])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
}
