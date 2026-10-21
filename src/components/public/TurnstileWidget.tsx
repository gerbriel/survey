'use client'

import Script from 'next/script'
import { useCallback, useRef, type ReactNode } from 'react'
import { useNonce } from './NonceContext'

/**
 * Cloudflare Turnstile, managed and invisible unless Cloudflare asks for an
 * interaction (doc 02 section 11). The api script loads after hydration and
 * never blocks render. One widget per page; getToken(action) serializes
 * requests, re-renders the widget when the action changes, and resets it
 * before every token because a token verifies once.
 *
 * Without NEXT_PUBLIC_TURNSTILE_SITE_KEY (local dev) getToken resolves
 * undefined and the server skips verification only outside production.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileAction = 'submit' | 'upload' | 'report'

function waitForApi(timeoutMs: number): Promise<TurnstileApi | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      if (window.turnstile) return resolve(window.turnstile)
      if (Date.now() - start > timeoutMs) return resolve(null)
      setTimeout(tick, 100)
    }
    tick()
  })
}

export function useTurnstile(siteKey: string | undefined): {
  widget: ReactNode
  getToken: (action: TurnstileAction) => Promise<string | undefined>
} {
  const nonce = useNonce()
  const el = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const action = useRef<TurnstileAction | null>(null)
  const pending = useRef<((token: string | undefined) => void) | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  const run = useCallback(
    async (want: TurnstileAction): Promise<string | undefined> => {
      if (!siteKey) return undefined
      const api = await waitForApi(20_000)
      if (!api || !el.current) return undefined
      const settle = (token: string | undefined) => {
        const p = pending.current
        pending.current = null
        p?.(token)
      }
      const result = new Promise<string | undefined>((resolve) => {
        pending.current = resolve
        setTimeout(() => settle(undefined), 90_000)
      })
      if (widgetId.current && action.current !== want) {
        api.remove(widgetId.current)
        widgetId.current = null
      }
      if (!widgetId.current) {
        action.current = want
        widgetId.current = api.render(el.current, {
          sitekey: siteKey,
          action: want,
          execution: 'execute',
          appearance: 'interaction-only',
          'refresh-expired': 'manual',
          callback: (token: string) => settle(token),
          'error-callback': () => settle(undefined),
          'timeout-callback': () => settle(undefined),
        })
      } else {
        api.reset(widgetId.current)
      }
      api.execute(widgetId.current)
      return result
    },
    [siteKey],
  )

  const getToken = useCallback(
    (want: TurnstileAction) => {
      const next = chain.current.then(
        () => run(want),
        () => run(want),
      )
      chain.current = next
      return next
    },
    [run],
  )

  const widget = siteKey ? (
    <>
      <Script src={TURNSTILE_SRC} strategy="afterInteractive" nonce={nonce} />
      <div ref={el} className="flex justify-center empty:hidden" />
    </>
  ) : null

  return { widget, getToken }
}
