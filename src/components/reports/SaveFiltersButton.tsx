'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

/** Stores the filters in the URL as the report's saved filters. */
export function SaveFiltersButton({ save }: { save: () => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await save()
          if (r.ok) {
            toast('Filters saved to this report', 'success')
            router.refresh()
          } else toast(r.error, 'error')
        })
      }
    >
      Save these filters to the report
    </Button>
  )
}
