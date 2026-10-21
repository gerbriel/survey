'use client'

import { useState, useTransition } from 'react'
import { Badge, Button, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@/components/ui'
import { parseCsv, toCsv } from '@/lib/crm/csv'
import {
  autoMap,
  chunk,
  CORE_TARGETS,
  LEAD_STATUSES,
  mapRows,
  suggestedImportTag,
  TARGET_LABELS,
  type ImportRow,
  type InvalidRow,
  type Mapping,
  type MappingTarget,
} from '@/lib/crm/import'
import { GenerateLinksDialog, type SurveyOption } from './GenerateLinksDialog'
import { downloadText, STATUS_LABELS, type ActionResult, type FieldDef, type MemberLite } from './types'

/** Decision: the doc 04 defaults; workspace_limits has no import columns yet. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000
const CHUNK = 500

type ChunkResult = {
  created: number
  updated: number
  skipped: number
  invalid: number
  errors: { index: number; error: string }[]
  contactEmails: string[]
}

type Step = 'upload' | 'map' | 'options' | 'run' | 'done'

/**
 * CSV import wizard (doc 04 section 1.5): upload and parse in the browser,
 * map columns, choose dedupe and defaults, preview, run in chunks of 500
 * through import_contacts_chunk, closed with finish_import, summary with
 * invalid rows as CSV, then an optional step that generates personal links
 * for the imported contacts.
 *
 * Decision: the original file is not stored in the imports bucket. Rows go
 * to the server in mapped chunks, so there is nothing to expire later.
 */
export function ImportWizard({
  defaultCountry,
  fieldDefs,
  members,
  surveys,
  today,
  start: startImport,
  runChunk,
  finish,
  generateLinks,
}: {
  defaultCountry: string
  fieldDefs: FieldDef[]
  members: MemberLite[]
  surveys: SurveyOption[]
  /** YYYY-MM-DD from the server, for the suggested default tag. */
  today: string
  start: (
    mapping: { headers: string[]; mapping: Mapping },
    options: { on_match: 'skip' | 'fill' | 'overwrite'; default_tags: string[]; default_status?: (typeof LEAD_STATUSES)[number]; default_owner?: string },
  ) => Promise<ActionResult<string>>
  runChunk: (importId: string, rows: ImportRow[]) => Promise<ActionResult<ChunkResult>>
  /** Closes the import job (finish_import) with the final counts. */
  finish: (importId: string, summary: { created: number; updated: number; skipped: number; invalid: number }) => Promise<ActionResult>
  generateLinks: (emails: string[], surveyId: string, maxResponses: number) => Promise<ActionResult<{ csv: string; count: number; skipped: number }>>
}) {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Mapping>([])
  const [onMatch, setOnMatch] = useState<'skip' | 'fill' | 'overwrite'>('fill')
  const [defaultTags, setDefaultTags] = useState(suggestedImportTag(new Date(`${today}T00:00:00Z`)))
  const [defaultStatus, setDefaultStatus] = useState('')
  const [defaultOwner, setDefaultOwner] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState({ created: 0, updated: 0, skipped: 0, invalid: 0 })
  const [invalidOut, setInvalidOut] = useState<InvalidRow[]>([])
  const [emails, setEmails] = useState<string[]>([])
  const [linksOpen, setLinksOpen] = useState(false)
  const [pending, start] = useTransition()

  const defs = fieldDefs.filter((d) => !d.archived)
  const mapped = step === 'options' || step === 'run' ? mapRows(rows, mapping, { defaultCountry, defs }) : null
  const emailMapped = mapping.includes('email')
  const targetOptions = [
    { value: 'ignore', label: 'Ignore' },
    ...CORE_TARGETS.map((t) => ({ value: t, label: TARGET_LABELS[t] })),
    ...defs.map((d) => ({ value: `custom:${d.key}`, label: `Custom: ${d.label}` })),
  ]

  async function onFile(file: File) {
    setError(null)
    if (file.size > MAX_IMPORT_BYTES) return setError('The file is larger than 10 MB.')
    const parsed = parseCsv(await file.text())
    if (parsed.headers.length === 0) return setError('The file has no header row.')
    if (parsed.rows.length === 0) return setError('The file has no data rows.')
    if (parsed.rows.length > MAX_IMPORT_ROWS) return setError(`The file has more than ${MAX_IMPORT_ROWS} rows.`)
    setFileName(file.name)
    setHeaders(parsed.headers)
    setRows(parsed.rows)
    setMapping(autoMap(parsed.headers, defs))
    setStep('map')
  }

  function run() {
    if (!mapped) return
    start(async () => {
      setError(null)
      setStep('run')
      const s = await startImport(
        { headers, mapping },
        {
          on_match: onMatch,
          default_tags: defaultTags.split(/[;,]/).map((t) => t.trim()).filter(Boolean),
          ...(defaultStatus ? { default_status: defaultStatus as (typeof LEAD_STATUSES)[number] } : {}),
          ...(defaultOwner ? { default_owner: defaultOwner } : {}),
        },
      )
      if (!s.ok) {
        setError(s.message)
        setStep('options')
        return
      }
      const parts = chunk(mapped.valid, CHUNK)
      const totals = { created: 0, updated: 0, skipped: 0, invalid: 0 }
      const bad: InvalidRow[] = [...mapped.invalid]
      const ok: string[] = []
      setProgress({ done: 0, total: mapped.valid.length })
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!
        const r = await runChunk(s.data, part.map((m) => m.row))
        if (!r.ok) {
          for (const m of part) bad.push({ line: m.line, error: r.message, values: rows[m.line - 2] ?? [] })
          totals.invalid += part.length
        } else {
          totals.created += r.data.created
          totals.updated += r.data.updated
          totals.skipped += r.data.skipped
          totals.invalid += r.data.invalid
          const failed = new Set(r.data.errors.map((e) => e.index))
          for (const e of r.data.errors) {
            const m = part[e.index]
            if (m) bad.push({ line: m.line, error: e.error, values: rows[m.line - 2] ?? [] })
          }
          part.forEach((m, idx) => {
            if (!failed.has(idx)) ok.push(m.row.email)
          })
        }
        setProgress({ done: Math.min((i + 1) * CHUNK, mapped.valid.length), total: mapped.valid.length })
      }
      totals.invalid = bad.length
      const closed = await finish(s.data, totals)
      if (!closed.ok) setError(closed.message)
      setSummary(totals)
      setInvalidOut(bad.sort((a, b) => a.line - b.line))
      setEmails(ok)
      setStep('done')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Import steps">
        {(['upload', 'map', 'options', 'run', 'done'] as Step[]).map((s, i) => (
          <li key={s}>
            <Badge tone={s === step ? 'accent' : 'neutral'} aria-current={s === step ? 'step' : undefined}>
              {i + 1}. {{ upload: 'Upload', map: 'Map columns', options: 'Dedupe and preview', run: 'Import', done: 'Summary' }[s]}
            </Badge>
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <section className="flex flex-col gap-2">
          <label htmlFor="csv-file" className="text-sm font-medium">
            CSV file, up to 10 MB and {MAX_IMPORT_ROWS.toLocaleString('en-US')} rows, with a header row
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
          />
        </section>
      ) : null}

      {step === 'map' ? (
        <section className="flex flex-col gap-3">
          <p className="text-sm">
            {fileName}: {rows.length} rows. Email is required; everything else is optional.
          </p>
          <Table caption="Column mapping">
            <THead>
              <Tr>
                <Th>Column</Th>
                <Th>Example</Th>
                <Th>Import as</Th>
              </Tr>
            </THead>
            <TBody>
              {headers.map((h, i) => (
                <Tr key={i}>
                  <Td>{h}</Td>
                  <Td className="text-muted">{rows[0]?.[i] ?? ''}</Td>
                  <Td>
                    <Select
                      label={`Import ${h} as`}
                      className="h-8"
                      value={mapping[i] ?? 'ignore'}
                      onChange={(e) => {
                        const v = e.target.value as MappingTarget
                        setMapping((m) => m.map((x, j) => (j === i ? v : x !== 'ignore' && x === v ? 'ignore' : x)))
                      }}
                      options={targetOptions}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <p className="text-sm text-muted">Need a new custom field? Add it under Custom fields, then reload this page.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('upload')}>
              Back
            </Button>
            <Button disabled={!emailMapped} onClick={() => setStep('options')}>
              Next
            </Button>
          </div>
          {!emailMapped ? <p className="text-sm text-danger">Map one column to Email.</p> : null}
        </section>
      ) : null}

      {step === 'options' && mapped ? (
        <section className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">When an email already exists</legend>
            {(
              [
                ['fill', 'Fill empty fields (recommended)'],
                ['skip', 'Skip the row'],
                ['overwrite', 'Overwrite with the file values'],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input type="radio" name="on_match" checked={onMatch === v} onChange={() => setOnMatch(v)} />
                {l}
              </label>
            ))}
            <p className="text-xs text-muted">Tags are always combined. Duplicates inside the file keep the first row.</p>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Tags for every row" value={defaultTags} onChange={(e) => setDefaultTags(e.target.value)} />
            <Select
              label="Default status"
              value={defaultStatus}
              placeholder="New"
              onChange={(e) => setDefaultStatus(e.target.value)}
              options={LEAD_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
            />
            <Select
              label="Default owner"
              value={defaultOwner}
              placeholder="Unassigned"
              onChange={(e) => setDefaultOwner(e.target.value)}
              options={members.map((m) => ({ value: m.user_id, label: m.display_name }))}
            />
          </div>
          <p className="text-sm" role="status">
            Ready: {mapped.valid.length} rows. Invalid: {mapped.invalid.length}. Duplicates in the file: {mapped.duplicates}.
          </p>
          <Table caption="Preview of the first rows">
            <THead>
              <Tr>
                <Th>Line</Th>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Company</Th>
                <Th>Notes</Th>
              </Tr>
            </THead>
            <TBody>
              {mapped.valid.slice(0, 10).map((m) => (
                <Tr key={m.line}>
                  <Td>{m.line}</Td>
                  <Td>{m.row.email}</Td>
                  <Td>{[m.row.first_name, m.row.last_name].filter(Boolean).join(' ')}</Td>
                  <Td>{m.row.phone ?? ''}</Td>
                  <Td>{m.row.company ?? ''}</Td>
                  <Td className="text-warning">{m.warnings.join('. ')}</Td>
                </Tr>
              ))}
              {mapped.invalid.slice(0, 5).map((m) => (
                <Tr key={`bad-${m.line}`}>
                  <Td>{m.line}</Td>
                  <Td colSpan={5} className="text-danger">
                    {m.error}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('map')}>
              Back
            </Button>
            <Button loading={pending} disabled={mapped.valid.length === 0} onClick={run}>
              Import {mapped.valid.length} contacts
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'run' ? (
        <section className="flex flex-col gap-2" aria-live="polite">
          <p className="text-sm">
            Importing {progress.done} of {progress.total}
          </p>
          <progress className="w-full" value={progress.done} max={Math.max(progress.total, 1)} />
        </section>
      ) : null}

      {step === 'done' ? (
        <section className="flex flex-col gap-3" aria-live="polite">
          <h2 className="text-base font-semibold">Import finished</h2>
          <ul className="text-sm">
            <li>Created: {summary.created}</li>
            <li>Updated: {summary.updated}</li>
            <li>Skipped: {summary.skipped}</li>
            <li>Invalid: {summary.invalid}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            {invalidOut.length ? (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadText(
                    'import-invalid-rows.csv',
                    toCsv(
                      ['line', ...headers, 'error'],
                      invalidOut.map((r) => [r.line, ...headers.map((_, i) => r.values[i] ?? ''), r.error]),
                    ),
                  )
                }
              >
                Download invalid rows
              </Button>
            ) : null}
            <Button disabled={emails.length === 0} onClick={() => setLinksOpen(true)}>
              Generate personal links
            </Button>
          </div>
          <GenerateLinksDialog
            open={linksOpen}
            onClose={() => setLinksOpen(false)}
            surveys={surveys}
            target={`${emails.length} imported contacts`}
            generate={async (surveyId, max) => {
              // Server action bodies are capped at 1 MB, so large imports go in batches.
              let csv = ''
              let count = 0
              let skipped = 0
              for (const part of chunk(emails, 2000)) {
                const r = await generateLinks(part, surveyId, max)
                if (!r.ok) return r
                csv += csv ? r.data.csv.replace(/^\uFEFF?[^\r\n]*\r\n/, '') : r.data.csv
                count += r.data.count
                skipped += r.data.skipped
              }
              return { ok: true, data: { csv, count, skipped } }
            }}
          />
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
