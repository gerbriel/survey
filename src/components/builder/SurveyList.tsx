'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { archiveSurveyAction, duplicateSurveyAction } from '@/lib/builder/actions'
import type { EffectiveState } from '@/lib/builder/state'

export interface SurveyListRow {
  id: string
  title: string
  slug: string
  state: EffectiveState
  stateText: string
  responses: number
  cap: number | null
  updatedAt: string
  archived: boolean
}

const TONE: Record<EffectiveState, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  scheduled: 'warning',
  open: 'success',
  closed: 'danger',
}

/** Survey table with client-side search, duplicate and archive (doc 03 section 6). */
export function SurveyList({ rows, base, canEdit, archivedView }: { rows: SurveyListRow[]; base: string; canEdit: boolean; archivedView: boolean }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const router = useRouter()
  const { toast } = useToast()
  const q = query.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.slug.includes(q)) : rows

  async function run(id: string, fn: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    setBusy(id)
    const r = await fn()
    setBusy(null)
    if (!r.ok) return toast(r.message ?? 'Something went wrong.', 'error')
    toast(done, 'success')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Input label="Search surveys" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Link href={archivedView ? base : `${base}?archived=1`} className="pb-2 text-sm underline">
          {archivedView ? 'Show active surveys' : 'Show archived surveys'}
        </Link>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? (archivedView ? 'No archived surveys' : 'No surveys yet') : 'No surveys match your search'}
          description={rows.length === 0 && !archivedView ? 'Create one from scratch, a template, or pasted text.' : undefined}
          action={
            rows.length === 0 && !archivedView && canEdit ? (
              <Link href={`${base}/new`} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">
                New survey
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table caption="Surveys">
          <THead>
            <Tr>
              <Th>Survey</Th>
              <Th>State</Th>
              <Th>Responses</Th>
              <Th>Updated</Th>
              {canEdit ? <Th>Actions</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {shown.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`${base}/${r.id}/edit`} className="font-medium underline-offset-2 hover:underline">
                    {r.title}
                  </Link>
                  <div className="font-mono text-xs text-muted">{r.slug}</div>
                </Td>
                <Td>
                  <Badge tone={TONE[r.state]}>{r.stateText}</Badge>
                </Td>
                <Td>
                  <Link href={`${base}/${r.id}/responses`} className="underline-offset-2 hover:underline">
                    {r.responses}
                    {r.cap ? ` of ${r.cap}` : ''}
                  </Link>
                </Td>
                <Td>
                  <time dateTime={r.updatedAt}>{new Date(r.updatedAt).toLocaleDateString()}</time>
                </Td>
                {canEdit ? (
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => run(r.id, () => duplicateSurveyAction(r.id), 'Survey duplicated.')}>
                        Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === r.id}
                        onClick={() => run(r.id, () => archiveSurveyAction(r.id, !r.archived), r.archived ? 'Survey restored.' : 'Survey archived. Its public link stops working.')}
                      >
                        {r.archived ? 'Restore' : 'Archive'}
                      </Button>
                    </div>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
