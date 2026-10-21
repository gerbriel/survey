'use client'

import { useState } from 'react'
import { formatCalc, type EvalState, type SurveyDefinition } from '@/lib/survey'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { fmt, type RendererStrings } from './strings'

export function PreviewBanner({ strings }: { strings: RendererStrings }) {
  return (
    <div role="note" className="flex items-center gap-2 bg-[var(--sv-primary)] px-4 py-2 text-sm text-[var(--sv-on-primary)]">
      <span className="font-semibold">Preview</span>
      <span>{strings.previewBanner}</span>
    </div>
  )
}

/**
 * Preview-only debug menu (doc 03 section 5): jump to any page and read the
 * live visibility, calculated values and natural ending. Logic is the same
 * evaluate() the live page runs.
 */
export function PreviewTools({
  definition,
  state,
  currentPageId,
  onJump,
  strings,
}: {
  definition: SurveyDefinition
  state: EvalState
  currentPageId: string
  onJump: (pageId: string) => void
  strings: RendererStrings
}) {
  const [target, setTarget] = useState(currentPageId)
  const pages = definition.pages.map((p, i) => ({
    value: p.id,
    label: `${i + 1}. ${p.title ?? p.id} (${state.path.includes(p.id) ? strings.debugOnPath : strings.debugOffPath})`,
  }))
  const calcs = Object.entries(state.calcs)
  return (
    <details className="rounded-[var(--sv-radius)] border border-border bg-[var(--sv-surface)] p-3 text-sm text-[var(--sv-text)]">
      <summary className="cursor-pointer font-semibold">{strings.debugTitle}</summary>
      <div className="mt-3 flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Select label={strings.debugJump} options={pages} value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={() => onJump(target)}>
            {strings.debugGo}
          </Button>
        </div>
        <p>{fmt(strings.debugEnding, { ending: state.ending_id ?? 'none' })}</p>
        <Table caption={strings.debugVisibility}>
          <THead>
            <Tr>
              <Th>Key</Th>
              <Th>Type</Th>
              <Th>Page</Th>
              <Th>State</Th>
            </Tr>
          </THead>
          <TBody>
            {Object.values(definition.questions).map((q) => {
              const page = definition.pages.find((p) => p.question_ids.includes(q.id))
              const vis = state.visible.has(q.id)
              return (
                <Tr key={q.id}>
                  <Td className="font-mono text-xs">{q.question_key}</Td>
                  <Td>{q.type}</Td>
                  <Td className="font-mono text-xs">{page?.id ?? 'none'}</Td>
                  <Td>
                    <Badge tone={vis ? 'success' : 'neutral'}>{vis ? strings.visible : strings.hidden}</Badge>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
        {calcs.length > 0 ? (
          <Table caption={strings.debugCalcs}>
            <THead>
              <Tr>
                <Th>Calc</Th>
                <Th>Value</Th>
              </Tr>
            </THead>
            <TBody>
              {calcs.map(([id, v]) => (
                <Tr key={id}>
                  <Td className="font-mono text-xs">{definition.questions[id]?.question_key ?? id}</Td>
                  <Td>{formatCalc(definition.questions[id], v)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </div>
    </details>
  )
}
