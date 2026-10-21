'use client'

import { useState } from 'react'
import { Button, type ButtonProps } from '@/components/ui/Button'

/** Copies `value` to the clipboard and says so in a live region. */
export function CopyButton({
  value,
  label = 'Copy link',
  ...rest
}: Omit<ButtonProps, 'onClick' | 'value'> & { value: string; label?: string }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        {...rest}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied('ok')
          } catch {
            setCopied('fail')
          }
          window.setTimeout(() => setCopied('idle'), 3000)
        }}
      >
        {label}
      </Button>
      <span aria-live="polite" className="text-xs text-muted">
        {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed. Select the link and copy it.' : ''}
      </span>
    </span>
  )
}
