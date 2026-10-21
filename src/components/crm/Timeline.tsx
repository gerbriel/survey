'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge, Tabs } from '@/components/ui'
import { IDENTITY_LABELS } from '@/components/responses/answers'
import { groupBySurvey, type TimelineItem } from './timelineData'

function when(iso: string) {
  return iso.slice(0, 16).replace('T', ' ') + ' UTC'
}

function ResponseCard({ item }: { item: Extract<TimelineItem, { kind: 'response' }> }) {
  const [first, ...rest] = item.preview
  return (
    <article className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={item.href} className="font-medium text-accent">
          {item.surveyTitle}
        </Link>
        {item.versionNo !== null ? <Badge>v{item.versionNo}</Badge> : null}
        <Badge tone={item.status === 'complete' ? 'success' : 'warning'}>{item.status === 'complete' ? 'Complete' : 'Partial'}</Badge>
        {item.identitySource ? (
          <Badge tone={item.identitySource === 'hidden_field' ? 'warning' : 'neutral'}>
            {IDENTITY_LABELS[item.identitySource] ?? item.identitySource}
          </Badge>
        ) : null}
      </p>
      {first ? (
        <details className="text-sm">
          <summary className="cursor-pointer">
            <span className="text-muted">{first.label}: </span>
            {first.text}
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pl-4">
            {rest.map((p, i) => (
              <li key={i}>
                <span className="text-muted">{p.label}: </span>
                {p.text}
              </li>
            ))}
            <li>
              <Link href={item.href} className="text-accent">
                Open full response
              </Link>
            </li>
          </ul>
        </details>
      ) : null}
    </article>
  )
}

function Item({ item }: { item: TimelineItem }) {
  return (
    <li className="flex gap-3 border-l-2 border-border pl-3" data-testid={`timeline-${item.kind}`}>
      <div className="flex flex-col gap-1">
        <time dateTime={item.at} className="text-xs text-muted">
          {when(item.at)}
        </time>
        {item.kind === 'response' ? (
          <ResponseCard item={item} />
        ) : item.kind === 'note' ? (
          <p className="text-sm">
            <span className="font-medium">Note by {item.author}: </span>
            <span className="whitespace-pre-wrap">{item.body}</span>
          </p>
        ) : (
          <p className="text-sm text-muted">{item.text}</p>
        )}
      </div>
    </li>
  )
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  const [tab, setTab] = useState('all')
  const groups = groupBySurvey(items)
  const all =
    items.length === 0 ? (
      <p className="text-sm text-muted">Nothing here yet. Responses and notes appear as they happen.</p>
    ) : (
      <ol className="flex flex-col gap-4">
        {items.map((i) => (
          <Item key={`${i.kind}-${i.id}`} item={i} />
        ))}
      </ol>
    )
  const bySurvey =
    groups.length === 0 ? (
      <p className="text-sm text-muted">No responses yet.</p>
    ) : (
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <section key={g.surveyId} aria-label={g.title}>
            <h3 className="mb-2 text-sm font-semibold">
              {g.title} <span className="text-muted">({g.items.length})</span>
            </h3>
            <ol className="flex flex-col gap-4">
              {g.items.map((i) => (
                <Item key={i.id} item={i} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    )
  return (
    <section aria-label="Timeline" className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Timeline</h2>
      <Tabs
        label="Timeline grouping"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'all', label: 'Everything', content: all },
          { id: 'survey', label: 'By survey', content: bySurvey },
        ]}
      />
    </section>
  )
}
