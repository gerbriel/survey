'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { controlClass } from '@/components/ui/Field'
import { cx, focusRing } from '@/components/ui/cx'
import { useTurnstile } from '@/components/public/TurnstileWidget'
import { postJson } from '@/components/public/transport'
import type { ReportRequest } from '@/components/public/protocol'

const REASONS: { value: ReportRequest['reason']; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'phishing', label: 'Phishing or impersonation' },
  { value: 'sensitive_data', label: 'Asks for sensitive information' },
  { value: 'harassment', label: 'Harassment or hateful content' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'other', label: 'Something else' },
]

export function ReportForm({ slug, siteKey }: { slug: string; siteKey?: string }) {
  const { widget, getToken } = useTurnstile(siteKey)
  const detailsId = useId()
  const honeypot = useRef<HTMLInputElement>(null)
  const [reason, setReason] = useState<ReportRequest['reason'] | ''>('')
  const [details, setDetails] = useState('')
  const [contact, setContact] = useState('')
  const [keyText, setKeyText] = useState(slug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!reason) {
      setReasonError('Choose a reason.')
      return
    }
    setReasonError(null)
    setError(null)
    setBusy(true)
    try {
      const turnstileToken = await getToken('report')
      const body: ReportRequest = {
        slug: keyText.trim().slice(0, 100),
        reason,
        details: details.trim() || undefined,
        contact: contact.trim() || undefined,
        turnstileToken,
        website: honeypot.current?.value ?? '',
      }
      const r = await postJson<{ ok: boolean; code?: string; retryAfter?: number }>('/api/public/report', body)
      if (r.data?.ok) setDone(true)
      else if (r.data?.code === 'rate_limited') setError(`Too many reports. Try again in ${Math.ceil((r.data.retryAfter ?? 3600) / 60)} minutes.`)
      else if (r.data?.code === 'captcha_failed') setError('Please confirm you are human, then send again.')
      else setError('We could not send your report. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" className="font-medium">
        Thanks, your report was received.
      </p>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input label="Survey link or code" value={keyText} onChange={(e) => setKeyText(e.target.value)} maxLength={100} autoComplete="off" className="h-11 text-base" />
      <Select
        label="Reason"
        required
        placeholder="Choose a reason"
        options={REASONS}
        value={reason}
        error={reasonError}
        onChange={(e) => setReason(e.target.value as ReportRequest['reason'] | '')}
        className="h-11 text-base"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={detailsId} className="text-sm font-medium text-fg">
          Details
        </label>
        <textarea
          id={detailsId}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={2000}
          rows={5}
          className={cx(controlClass, focusRing, 'h-auto py-2 text-base')}
          aria-describedby={`${detailsId}-hint`}
        />
        <p id={`${detailsId}-hint`} className="text-xs text-muted">
          Up to 2,000 characters.
        </p>
      </div>
      <Input
        label="Your contact (optional)"
        hint="Only if you want us to follow up."
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        maxLength={200}
        autoComplete="email"
        className="h-11 text-base"
      />
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {widget}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} className="min-h-11 self-start">
        Send report
      </Button>
    </form>
  )
}
