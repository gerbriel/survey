'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from '@/components/ui'
import type { InboxRow } from '@/lib/crm/data/responses'
import { contactName, IDENTITY_LABELS } from './answers'
import { formatDateTime } from './format'
import { createRealtimeHandler, rowMatches, type ChangeSignal, type InboxMatchFilters } from './realtime'
import { subscribeToResponses } from './subscribe'
import { unreadStore } from './unreadStore'

export type InboxListProps = {
  slug: string
  surveyId: string
  initialRows: InboxRow[]
  /** True on the first page: new responses are prepended live. */
  firstPage: boolean
  pageSize: number
  filters: InboxMatchFilters
  versionNumbers: Record<string, number>
  /** Server action: refetch one row through the db wrapper under RLS. */
  fetchRow: (responseId: string) => Promise<InboxRow | null>
  /** Injected in tests; defaults to the Supabase realtime channel. */
  subscribe?: (surveyId: string, onSignal: (p: ChangeSignal) => void) => () => void
}

export function InboxList({
  slug,
  surveyId,
  initialRows,
  firstPage,
  pageSize,
  filters,
  versionNumbers,
  fetchRow,
  subscribe = subscribeToResponses,
}: InboxListProps) {
  const [rows, setRows] = useState(initialRows)
  const [live, setLive] = useState('')
  const unread = useSyncExternalStore(
    unreadStore.subscribe,
    () => unreadStore.get(surveyId),
    unreadStore.serverSnapshot,
  )
  const latest = useRef({ fetchRow, filters, firstPage, pageSize })
  useEffect(() => {
    latest.current = { fetchRow, filters, firstPage, pageSize }
  })

  useEffect(() => {
    const handler = createRealtimeHandler({
      fetchRow: (id) => latest.current.fetchRow(id),
      upsert: (row, isInsert) => {
        const cur = latest.current
        const matches = rowMatches(row, cur.filters)
        setRows((list) => {
          const at = list.findIndex((r) => r.id === row.id)
          if (at >= 0) {
            if (!matches) return list.filter((r) => r.id !== row.id)
            const next = list.slice()
            next[at] = row
            return next
          }
          if (!matches || !cur.firstPage) return list
          return [row, ...list].slice(0, cur.pageSize)
        })
        if (matches && cur.firstPage && (isInsert || row.status === 'complete')) {
          unreadStore.add(surveyId, row.id)
          setLive('New response received')
        }
      },
      remove: (id) => setRows((list) => list.filter((r) => r.id !== id)),
    })
    return subscribe(surveyId, (p) => {
      void handler(p)
    })
  }, [surveyId, subscribe])

  if (rows.length === 0) {
    return (
      <>
        <p className="sr-only" aria-live="polite">
          {live}
        </p>
        <EmptyState title="No responses yet" description="Responses that match these filters appear here as they arrive." />
      </>
    )
  }

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <Table caption="Responses">
        <THead>
          <Tr>
            <Th>Respondent</Th>
            <Th>Status</Th>
            <Th>Submitted</Th>
            <Th>Version</Th>
            <Th>Identity</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const isUnread = unread.has(r.id)
            return (
              <Tr key={r.id} data-testid="inbox-row" className={isUnread ? 'font-semibold' : undefined}>
                <Td>
                  <Link
                    href={`/w/${slug}/surveys/${surveyId}/responses/${r.id}`}
                    className="text-accent underline-offset-2 hover:underline"
                    onClick={() => unreadStore.remove(surveyId, r.id)}
                  >
                    {r.contact ? contactName(r.contact) : 'Anonymous'}
                  </Link>
                  {isUnread ? (
                    <Badge tone="accent" className="ml-2">
                      New
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <Badge tone={r.status === 'complete' ? 'success' : 'warning'}>
                    {r.status === 'complete' ? 'Complete' : 'Partial'}
                  </Badge>
                </Td>
                <Td>{formatDateTime(r.submitted_at ?? r.started_at)}</Td>
                <Td>v{versionNumbers[r.survey_version_id] ?? '?'}</Td>
                <Td>
                  {r.identity_source ? (
                    <Badge tone={r.identity_source === 'hidden_field' ? 'warning' : 'neutral'}>
                      {IDENTITY_LABELS[r.identity_source] ?? r.identity_source}
                    </Badge>
                  ) : (
                    <span className="text-muted">Anonymous</span>
                  )}
                </Td>
              </Tr>
            )
          })}
        </TBody>
      </Table>
    </div>
  )
}
