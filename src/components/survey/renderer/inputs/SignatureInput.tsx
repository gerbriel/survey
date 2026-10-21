'use client'

import { useRef, useState, type PointerEvent } from 'react'
import type { FileRef, SignatureQuestion } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cx } from '@/components/ui/cx'
import type { InputProps } from '../types'
import { Hint, joinIds } from './shared'

const WIDTH = 600
const HEIGHT = 200

export function asFileRef(v: unknown): FileRef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const f = v as FileRef
  return typeof f.path === 'string' && typeof f.name === 'string' ? f : null
}

/**
 * Signature: a plain canvas for pointer drawing, plus a typed-name keyboard
 * alternative rendered onto the same canvas. Decision: the PNG is uploaded
 * only when the respondent presses Save signature, so strokes never upload.
 */
export function SignatureInput({ question, value, onChange, inputId, labelId, describedBy, invalid, ctx }: InputProps<SignatureQuestion>) {
  const saved = asFileRef(value)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const pen = question.settings.pen_color ?? '#000000'
  const howId = `${inputId}-how`
  const uploads = ctx.uploads

  function context2d(): CanvasRenderingContext2D | null {
    try {
      return canvasRef.current?.getContext('2d') ?? null
    } catch {
      return null
    }
  }

  function point(e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = rect.width > 0 ? WIDTH / rect.width : 1
    const sy = rect.height > 0 ? HEIGHT / rect.height : 1
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  function onDown(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drawing.current = point(e)
  }

  function onMove(e: PointerEvent<HTMLCanvasElement>) {
    const from = drawing.current
    const g = context2d()
    if (!from || !g) return
    const to = point(e)
    g.strokeStyle = pen
    g.lineWidth = 2.5
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(from.x, from.y)
    g.lineTo(to.x, to.y)
    g.stroke()
    drawing.current = to
    if (!hasInk) setHasInk(true)
  }

  function onUp() {
    drawing.current = null
  }

  function clearCanvas() {
    context2d()?.clearRect(0, 0, WIDTH, HEIGHT)
    setHasInk(false)
  }

  function applyTyped() {
    const g = context2d()
    const name = typed.trim()
    if (!g || name === '') return
    g.clearRect(0, 0, WIDTH, HEIGHT)
    g.fillStyle = pen
    g.font = 'italic 48px "Brush Script MT", "Segoe Script", cursive'
    g.textBaseline = 'middle'
    g.fillText(name, 24, HEIGHT / 2, WIDTH - 48)
    setHasInk(true)
  }

  async function save() {
    const canvas = canvasRef.current
    if (!uploads || !canvas || !hasInk) {
      setNote(ctx.strings.signatureEmpty)
      return
    }
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const ref = await uploads.request(question.question_key, new File([blob], 'signature.png', { type: 'image/png' }))
      if (ref) {
        onChange(ref)
        setNote(ctx.strings.signatureSaved)
      }
    } catch {
      setNote(ctx.strings.signatureEmpty)
    } finally {
      setBusy(false)
    }
  }

  async function clearSaved() {
    if (saved) {
      onChange(undefined)
      await uploads?.remove(question.question_key, saved)
    }
    clearCanvas()
    setNote('')
  }

  if (saved) {
    return (
      <div id={inputId} className="flex flex-wrap items-center gap-3" aria-describedby={describedBy}>
        <p>
          {ctx.strings.signatureSaved}: <span className="text-muted">{saved.name}</span>
        </p>
        <Button variant="secondary" size="sm" className="min-h-11" onClick={() => void clearSaved()}>
          {ctx.strings.signatureClear}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Hint id={howId}>{ctx.strings.signatureDraw}</Hint>
      <canvas
        ref={canvasRef}
        id={inputId}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={ctx.strings.signatureCanvas}
        aria-labelledby={`${labelId} ${inputId}-canvas-name`}
        aria-describedby={joinIds(describedBy, howId)}
        className={cx('h-40 w-full touch-none rounded-[var(--sv-radius)] border bg-white', invalid ? 'border-2 border-[var(--sv-error)]' : 'border-border')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
      <span id={`${inputId}-canvas-name`} className="sr-only">
        {ctx.strings.signatureCanvas}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            id={`${inputId}-typed`}
            label={ctx.strings.signatureTyped}
            autoComplete="name"
            className="h-11 text-base rounded-[var(--sv-radius)]"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <Button variant="secondary" className="min-h-11" disabled={typed.trim() === ''} onClick={applyTyped}>
          {ctx.strings.signatureUseTyped}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" loading={busy} disabled={!uploads} onClick={() => void save()}>
          {ctx.strings.signatureSave}
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={clearCanvas}>
          {ctx.strings.signatureClear}
        </Button>
      </div>
      {!uploads ? <Hint>{ctx.strings.fileUnavailable}</Hint> : null}
      <p aria-live="polite" className="text-sm text-muted">
        {note}
      </p>
    </div>
  )
}
