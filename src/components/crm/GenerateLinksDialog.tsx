'use client'

import { useState, useTransition } from 'react'
import { Button, Dialog, Input, Select } from '@/components/ui'
import { downloadText, type ActionResult } from './types'

export type SurveyOption = { id: string; title: string; state: string }

/**
 * Pick a published survey and download personalized links as CSV
 * (doc 04 section 1.5 step 6). Works for a selection, a view, or an import.
 */
export function GenerateLinksDialog({
  open,
  onClose,
  surveys,
  target,
  generate,
}: {
  open: boolean
  onClose: () => void
  surveys: SurveyOption[]
  /** What the links are for, shown in the description. */
  target: string
  generate: (surveyId: string, maxResponses: number) => Promise<ActionResult<{ csv: string; count: number; skipped: number }>>
}) {
  const openSurveys = surveys.filter((s) => s.state === 'open')
  const [surveyId, setSurveyId] = useState(openSurveys[0]?.id ?? surveys[0]?.id ?? '')
  const [max, setMax] = useState('1')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Generate personal links"
      description={`One link per contact for ${target}. Each link ties the response to the contact.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={pending}
            disabled={!surveyId}
            onClick={() =>
              start(async () => {
                setMsg(null)
                const r = await generate(surveyId, Number.parseInt(max, 10) || 1)
                if (!r.ok) {
                  setMsg({ tone: 'error', text: r.message })
                  return
                }
                downloadText(`survey-links-${new Date().toISOString().slice(0, 10)}.csv`, r.data.csv)
                setMsg({
                  tone: 'ok',
                  text: `Downloaded ${r.data.count} links.${r.data.skipped ? ` ${r.data.skipped} contacts were skipped (revoked or expired link, or no longer live).` : ''}`,
                })
              })
            }
          >
            Generate and download
          </Button>
        </>
      }
    >
      {surveys.length === 0 ? (
        <p className="text-sm text-muted">No survey has a published version yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Survey"
            value={surveyId}
            onChange={(e) => setSurveyId(e.target.value)}
            options={surveys.map((s) => ({ value: s.id, label: s.state === 'open' ? s.title : `${s.title} (${s.state})` }))}
            hint="Links only collect responses while the survey is open."
          />
          <Input
            label="Responses allowed per link"
            type="number"
            min={1}
            max={1000}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
          {msg ? (
            <p role={msg.tone === 'error' ? 'alert' : 'status'} className={msg.tone === 'error' ? 'text-sm text-danger' : 'text-sm text-success'}>
              {msg.text}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
