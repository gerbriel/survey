'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Badge, Button, EmptyState } from '@/components/ui'
import { displayName, type ActionResult, type Contact } from './types'

export const REASON_LABELS: Record<string, string> = {
  same_phone: 'Same phone number',
  same_name_company: 'Same name and company',
  email_variant: 'Email differs only by dots or a plus tag',
  alt_email: 'A response gave the other email',
  similar_email: 'Very similar email at the same domain',
}

export type Pair = { a: Contact; b: Contact; reason: string }

function Side({ slug, c }: { slug: string; c: Contact }) {
  return (
    <div className="flex flex-col text-sm">
      <Link href={`/w/${slug}/contacts/${c.id}`} className="font-medium text-accent">
        {displayName(c)}
      </Link>
      <span className="text-muted">{c.email ?? 'No email'}</span>
      <span className="text-muted">{[c.phone, c.company].filter(Boolean).join(', ')}</span>
      <span className="text-muted">
        {c.response_count} responses, created {c.created_at.slice(0, 10)}
      </span>
    </div>
  )
}

/** Candidate pairs with "Merge" and "Not a duplicate" (doc 04 section 2.4). */
export function DuplicatePairs({
  slug,
  pairs: initial,
  canEdit,
  dismiss,
  compact = false,
}: {
  slug: string
  pairs: Pair[]
  canEdit: boolean
  dismiss: (a: string, b: string) => Promise<ActionResult>
  compact?: boolean
}) {
  const [pairs, setPairs] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (pairs.length === 0) {
    return compact ? (
      <p className="text-sm text-muted">No possible duplicates.</p>
    ) : (
      <EmptyState title="No possible duplicates" description="Pairs show up here when phones, names, or emails look alike." />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {pairs.map((p) => (
          <li key={`${p.a.id}-${p.b.id}`} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <Badge tone="warning" className="self-start">
              {REASON_LABELS[p.reason] ?? p.reason}
            </Badge>
            <div className={compact ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-4'}>
              {!compact ? <Side slug={slug} c={p.a} /> : null}
              <Side slug={slug} c={p.b} />
            </div>
            {canEdit ? (
              <div className="flex gap-2">
                <Link href={`/w/${slug}/contacts/merge?ids=${p.a.id},${p.b.id}`} className="text-sm text-accent underline">
                  Merge
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await dismiss(p.a.id, p.b.id)
                      if (!r.ok) return setError(r.message)
                      setPairs((list) => list.filter((x) => x !== p))
                    })
                  }
                >
                  Not a duplicate
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
