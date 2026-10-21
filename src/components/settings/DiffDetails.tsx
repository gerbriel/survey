import { diffLines } from './activity-view'

/** Expandable changed-fields list for one log row. */
export function DiffDetails({ diff }: { diff: unknown }) {
  const lines = diffLines(diff)
  if (lines.length === 0) return <span className="text-muted">No details</span>
  return (
    <details>
      <summary className="cursor-pointer text-sm">
        {lines.length} {lines.length === 1 ? 'field' : 'fields'}
      </summary>
      <dl className="mt-2 grid gap-1 text-xs">
        {lines.map((l) => (
          <div key={l.field} className="break-all">
            <dt className="inline font-medium">{l.field}: </dt>
            <dd className="inline">
              {l.from ? <span className="text-muted line-through">{l.from.slice(0, 300)}</span> : null}
              {l.from ? ' ' : null}
              <span>{l.to.slice(0, 300)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
