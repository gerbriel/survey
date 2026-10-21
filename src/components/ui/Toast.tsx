'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cx, focusRing } from './cx'

type Tone = 'info' | 'success' | 'error'
type ToastItem = { id: number; message: string; tone: Tone }
type ToastApi = { toast: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi | null>(null)

const tones: Record<Tone, string> = {
  info: 'border-border',
  success: 'border-success',
  error: 'border-danger',
}

/**
 * Toasts announced through a polite live region (errors use role="alert").
 * They stay until dismissed or 5 seconds pass.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = Date.now() + Math.random()
      setItems((list) => [...list, { id, message, tone }])
      window.setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'flex items-start justify-between gap-3 rounded-md border-l-4 bg-surface p-3 text-sm text-fg shadow-lg',
              tones[t.tone],
            )}
          >
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className={cx('rounded text-muted hover:text-fg', focusRing)}
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
