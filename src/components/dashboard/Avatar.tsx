import { cx } from '@/components/ui/cx'

export type Person = { name: string; avatarUrl: string | null }

const SIZES = { sm: 'h-6 w-6 text-[10px]', md: 'h-7 w-7 text-xs' } as const

/** Round avatar: the OAuth picture, or the first letter of the name. Decorative; the name is always shown or announced next to it. */
export function Avatar({ person, size = 'md', className }: { person: Person; size?: keyof typeof SIZES; className?: string }) {
  if (person.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- OAuth avatar URL
      <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" className={cx('shrink-0 rounded-full', SIZES[size], className)} />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cx('flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-medium text-fg', SIZES[size], className)}
    >
      {person.name.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}

/** Avatar and name on one line. */
export function PersonChip({ person, size = 'sm' }: { person: Person; size?: keyof typeof SIZES }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar person={person} size={size} />
      <span className="truncate">{person.name}</span>
    </span>
  )
}

/**
 * Overlapping avatars, at most `max`, then "+n". The title lists every name
 * for pointer users and the same list is in screen reader text.
 */
export function AvatarStack({ people, max = 3, label = 'Collaborators' }: { people: Person[]; max?: number; label?: string }) {
  if (people.length === 0) return <span className="text-muted">None</span>
  const names = people.map((p) => p.name).join(', ')
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <span className="inline-flex items-center" title={names}>
      <span className="sr-only">
        {label}: {names}
      </span>
      <span aria-hidden="true" className="inline-flex items-center -space-x-2">
        {shown.map((p, i) => (
          <Avatar key={`${p.name}-${i}`} person={p} size="sm" className="ring-2 ring-surface" />
        ))}
        {extra > 0 ? (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-muted px-1 text-[10px] font-medium ring-2 ring-surface">
            +{extra}
          </span>
        ) : null}
      </span>
    </span>
  )
}
