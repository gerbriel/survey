'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { createFromDefinitionAction, createSurveyAction } from '@/lib/builder/actions'
import { DEFAULT_THEME, rich } from '@/lib/builder/defaults'
import type { ImportedQuestion } from '@/lib/builder/importText'
import type { SurveyDefinition } from '@/lib/survey'
import { applyImport } from './importBuild'
import { ImportTextPanel } from './ImportTextDialog'

export interface TemplateCard {
  id: string
  name: string
  description: string | null
  system: boolean
  questionCount: number
}

/** Decision: the title field starts filled so one click creates a survey; the builder lets you rename it. */
export const DEFAULT_TITLE = 'Untitled survey'

function blankDefinition(title: string, theme: SurveyDefinition['theme']): SurveyDefinition {
  return {
    schema_version: 1,
    settings: { title, show_progress: true, show_question_numbers: false, allow_back: true, one_question_per_screen: false, autosave_partial: true, trust_hidden_identity: false },
    theme,
    pages: [{ id: 'p_start001', question_ids: [] }],
    questions: {},
    logic: [],
    endings: [{ id: 'e_default1', message: rich('Thank you for your response.'), show_score: false, show_summary: false }],
    closed_message: rich('This survey is no longer accepting responses.'),
    identity: {},
    pixel_exclusions: [],
  }
}

/**
 * Create from blank or a template (the primary choices, equal cards), or from
 * pasted text under "Other ways to start" (doc 03 section 6). Create buttons
 * are disabled only while a create is in flight.
 */
export function NewSurvey({ workspaceId, base, templates, workspaceTheme }: { workspaceId: string; base: string; templates: TemplateCard[]; workspaceTheme: SurveyDefinition['theme'] | null }) {
  const router = useRouter()
  const { toast } = useToast()
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [busy, setBusy] = useState<string | null>(null)
  const name = title.trim() || DEFAULT_TITLE

  async function go(key: string, fn: () => Promise<{ ok: true; data: string } | { ok: false; message: string }>) {
    setBusy(key)
    const r = await fn()
    if (!r.ok) {
      setBusy(null)
      return toast(r.message, 'error')
    }
    router.push(`${base}/${r.data}/edit`)
  }

  // Workspace templates first, then the starter set, each by name (the query already sorts by name).
  const ordered = [...templates.filter((t) => !t.system), ...templates.filter((t) => t.system)]
  const cards: Array<{ key: string; title: string; description: string; meta: string; badge: string | null; create: () => void }> = [
    {
      key: 'blank',
      title: 'Blank survey',
      description: 'One empty page. Add questions, logic and endings in the builder.',
      meta: 'No questions yet',
      badge: null,
      create: () => void go('blank', () => createSurveyAction(workspaceId, name)),
    },
    ...ordered.map((t) => ({
      key: t.id,
      title: t.name,
      description: t.description ?? 'A ready made survey you can change in the builder.',
      meta: `${t.questionCount} question${t.questionCount === 1 ? '' : 's'}`,
      badge: t.system ? 'Starter' : 'Workspace',
      create: () => void go(t.id, () => createSurveyAction(workspaceId, name, t.id)),
    })),
  ]

  return (
    <div className="flex flex-col gap-8">
      <div className="max-w-md">
        <Input label="Survey name" hint="Shown in the dashboard and as the starting title. You can change it later." maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <section aria-labelledby="start-h" className="flex flex-col gap-3">
        <h2 id="start-h" className="text-lg font-semibold">
          Start from blank or a template
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="start-cards">
          {cards.map((c) => (
            <li key={c.key} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{c.title}</h3>
                {c.badge ? <Badge>{c.badge}</Badge> : null}
              </div>
              <p className="text-sm text-muted">{c.description}</p>
              <p className="text-xs text-muted">{c.meta}</p>
              <Button size="sm" className="mt-auto self-start" loading={busy === c.key} disabled={busy !== null} onClick={c.create} aria-label={`Create from ${c.title}`}>
                {busy === c.key ? 'Creating' : 'Create'}
              </Button>
            </li>
          ))}
        </ul>
        {templates.length === 0 ? <p className="text-sm text-muted">No templates yet. Save any survey as a template from the builder to see it here.</p> : null}
      </section>
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-base font-semibold">Other ways to start</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">Paste a list of questions, one per line, and we turn it into a survey you can edit.</p>
          <ImportTextPanel
            insertLabel="Create survey"
            busy={busy === 'import'}
            onInsert={(pages: ImportedQuestion[][]) => {
              // Keeps the old default: an untouched name becomes "Imported survey".
              const importName = name === DEFAULT_TITLE ? 'Imported survey' : name
              const def = applyImport(blankDefinition(importName, workspaceTheme ?? DEFAULT_THEME), pages).definition
              void go('import', () => createFromDefinitionAction(workspaceId, importName, def as unknown as { pages: unknown[] }))
            }}
          />
        </div>
      </details>
    </div>
  )
}
