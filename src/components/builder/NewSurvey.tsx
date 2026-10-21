'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
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
}

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

/** Create from blank, a system or workspace template, or pasted text (doc 03 section 6). */
export function NewSurvey({ workspaceId, base, templates, workspaceTheme }: { workspaceId: string; base: string; templates: TemplateCard[]; workspaceTheme: SurveyDefinition['theme'] | null }) {
  const router = useRouter()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function go(key: string, fn: () => Promise<{ ok: true; data: string } | { ok: false; message: string }>) {
    setBusy(key)
    const r = await fn()
    if (!r.ok) {
      setBusy(null)
      return toast(r.message, 'error')
    }
    router.push(`${base}/${r.data}/edit`)
  }

  const system = templates.filter((t) => t.system)
  const mine = templates.filter((t) => !t.system)

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="blank-h" className="flex flex-col gap-3">
        <h2 id="blank-h" className="text-lg font-semibold">
          Start from scratch
        </h2>
        <div className="max-w-md">
          <Input label="Survey name" hint="Used in the dashboard and as the starting title." maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <Button className="self-start" loading={busy === 'blank'} disabled={!!busy} onClick={() => go('blank', () => createSurveyAction(workspaceId, title))}>
          Create blank survey
        </Button>
      </section>
      {[
        { label: 'Workspace templates', list: mine, empty: 'Save any survey as a template from the builder to see it here.' },
        { label: 'Starter templates', list: system, empty: 'No starter templates are installed.' },
      ].map((g) => (
        <section key={g.label} aria-label={g.label} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{g.label}</h2>
          {g.list.length === 0 ? <p className="text-sm text-muted">{g.empty}</p> : null}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.list.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
                <h3 className="font-medium">{t.name}</h3>
                {t.description ? <p className="text-sm text-muted">{t.description}</p> : null}
                <Button size="sm" variant="secondary" className="mt-auto self-start" loading={busy === t.id} disabled={!!busy} onClick={() => go(t.id, () => createSurveyAction(workspaceId, title, t.id))}>
                  Use template
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section aria-labelledby="import-h" className="flex flex-col gap-3">
        <h2 id="import-h" className="text-lg font-semibold">
          Start from pasted text
        </h2>
        <ImportTextPanel
          insertLabel="Create survey"
          busy={busy === 'import'}
          onInsert={(pages: ImportedQuestion[][]) => {
            const name = title.trim() || 'Imported survey'
            const def = applyImport(blankDefinition(name, workspaceTheme ?? DEFAULT_THEME), pages).definition
            void go('import', () => createFromDefinitionAction(workspaceId, name, def as unknown as { pages: unknown[] }))
          }}
        />
      </section>
    </div>
  )
}
