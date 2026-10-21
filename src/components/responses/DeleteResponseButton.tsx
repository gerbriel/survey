'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Dialog } from '@/components/ui'

export function DeleteResponseButton({
  action,
  redirectTo,
}: {
  action: () => Promise<{ ok: boolean; message?: string }>
  redirectTo: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete response
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this response?"
        description="The response, its answers and its files are deleted. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await action()
                  if (!r.ok) {
                    setError(r.message ?? 'The response could not be deleted.')
                    return
                  }
                  setOpen(false)
                  router.push(redirectTo)
                  router.refresh()
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  )
}
