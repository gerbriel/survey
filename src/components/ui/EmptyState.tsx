import type { ReactNode } from 'react'

/** Placeholder for an empty list or page, with an optional call to action. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  )
}
