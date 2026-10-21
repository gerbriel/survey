'use client'

import { useState } from 'react'
import type { DiffResult, LintIssue } from '@/lib/survey'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Check } from './fields'

export type PublishPhase =
  | { kind: 'review' }
  | { kind: 'publishing' }
  | { kind: 'done'; versionNo: number | null }
  | { kind: 'error'; message: string }

/**
 * Publish confirm (doc 03 section 7): lint errors block, warnings show,
 * changes are grouped Safe, Noted (logic) and Breaking. Breaking changes on a
 * survey with responses need the "I understand" tick; with zero responses
 * they are shown as info only.
 */
export function PublishDialog({
  open,
  onClose,
  issues,
  diff,
  firstPublish,
  hasResponses,
  phase,
  onConfirm,
  settingsHref,
  stateLabel,
}: {
  open: boolean
  onClose: () => void
  issues: LintIssue[]
  diff: DiffResult | null
  firstPublish: boolean
  hasResponses: boolean
  phase: PublishPhase
  onConfirm: (acknowledgeBreaking: boolean) => void
  settingsHref: string
  stateLabel: string
}) {
  const [ack, setAck] = useState(false)
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const breaking = diff?.breaking ?? []
  const needsAck = hasResponses && breaking.length > 0
  const blocked = errors.length > 0 || (needsAck && !ack) || phase.kind === 'publishing'

  if (phase.kind === 'done') {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Published"
        description={phase.versionNo ? `Version ${phase.versionNo} is live for new respondents.` : 'The new version is live for new respondents.'}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Keep editing
            </Button>
            <a href={settingsHref} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">
              Open state settings
            </a>
          </>
        }
      >
        <p className="text-sm">
          Publishing does not change whether the survey accepts responses. Its state is <strong>{stateLabel}</strong>. Open, close or schedule it from the settings
          tab. A new draft is ready for further edits.
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={firstPublish ? 'Publish survey' : 'Publish changes'}
      description={errors.length ? 'Fix these problems before publishing.' : 'Review what changes for respondents and reports.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(ack)} disabled={blocked} loading={phase.kind === 'publishing'}>
            Publish
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto text-sm">
        {phase.kind === 'error' ? (
          <p role="alert" className="rounded-md border border-danger p-2 text-danger">
            {phase.message}
          </p>
        ) : null}
        {errors.length ? (
          <section aria-label="Problems">
            <h3 className="mb-1 font-semibold">Problems ({errors.length})</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {errors.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {warnings.length ? (
          <section aria-label="Warnings">
            <h3 className="mb-1 font-semibold">Warnings</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {warnings.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {!firstPublish && diff ? (
          <>
            {diff.changes.length === 0 ? <p>No changes since the last published version.</p> : null}
            {breaking.length ? (
              <section aria-label="Breaking changes">
                <h3 className="mb-1 flex items-center gap-2 font-semibold">
                  <Badge tone="warning">Breaking</Badge> Reports will split for these questions
                </h3>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {breaking.map((c, n) => (
                    <li key={n}>{c.message}</li>
                  ))}
                </ul>
                {needsAck ? (
                  <div className="mt-2">
                    <Check label="I understand reports will split for these questions" checked={ack} onChange={setAck} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">The survey has no responses yet, so nothing splits.</p>
                )}
              </section>
            ) : null}
            {diff.noted.length ? (
              <section aria-label="Logic changes">
                <h3 className="mb-1 font-semibold">Changes who sees what</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {diff.noted.map((c, n) => (
                    <li key={n}>{c.message}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {diff.safe.length ? (
              <section aria-label="Safe changes">
                <h3 className="mb-1 font-semibold">Safe changes</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {diff.safe.map((c, n) => (
                    <li key={n}>{c.message}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        {firstPublish && !errors.length ? <p>This is the first published version. After publishing, open the survey from its settings to accept responses.</p> : null}
      </div>
    </Dialog>
  )
}
