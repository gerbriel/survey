'use client'

// Dev-only fixture gallery for the survey renderer (Phase 1C). src/proxy.ts
// 404s /dev/* outside `next dev`. No data access: fixtures are in memory and
// uploads are faked in component state.

import { useState } from 'react'
import { splitDefinition, type FileRef, type SurveyDefinition, type Theme } from '@/lib/survey'
import { ALL_TYPES, BRANCHING, PIPING, QUIZ, THEME } from '@/lib/survey/__tests__/fixtures'
import { SurveyRenderer, type RendererEvent, type UploadsApi } from '@/components/survey/renderer'
import { Select } from '@/components/ui/Select'

const pub = (d: SurveyDefinition) => splitDefinition(d).public_definition

// Public halves, split once: the renderer only ever sees public_definition.
const FIXTURES: Record<string, { label: string; definition: SurveyDefinition }> = {
  all_types: { label: 'Every question type', definition: pub(ALL_TYPES) },
  branching: { label: 'Branching and early ending', definition: pub(BRANCHING) },
  quiz: { label: 'Quiz (public half)', definition: pub(QUIZ) },
  piping: { label: 'Piping and calculated', definition: pub(PIPING) },
  one_per_screen: {
    label: 'Branching, one question per screen',
    definition: pub({ ...BRANCHING, settings: { ...BRANCHING.settings, one_question_per_screen: true, show_question_numbers: true } }),
  },
}

const THEMES: Record<string, { label: string; theme: Theme | undefined }> = {
  fixture: { label: 'Fixture theme', theme: undefined },
  forest: {
    label: 'Forest serif, steps, full layout',
    theme: {
      ...THEME,
      colors: { primary: '#1f6f43', text: '#1b1b1b', muted_text: '#4b5563', background: '#eef5ef', surface: '#ffffff', error: '#b42318' },
      font: { heading: 'Merriweather', body: 'Source Serif 4', base_size: 'lg' },
      progress: { style: 'steps', position: 'bottom' },
      corner_radius: 'lg',
      layout: 'full',
      button_text: { next: 'Continue', back: 'Previous', submit: 'Send', start: 'Begin' },
    },
  },
  dark: {
    label: 'Dark, percent progress',
    theme: {
      ...THEME,
      colors: { primary: '#f59e0b', text: '#f3f4f6', muted_text: '#cbd5e1', background: '#0f172a', surface: '#1e293b', error: '#fca5a5' },
      progress: { style: 'percent', position: 'top' },
      corner_radius: 'sm',
    },
  },
  low_contrast: {
    label: 'Low contrast (text flips automatically)',
    theme: {
      ...THEME,
      colors: { primary: '#ffe066', text: '#dddddd', muted_text: '#eeeeee', background: '#ffffff', surface: '#fafafa', error: '#ffaaaa' },
      corner_radius: 'none',
    },
  },
}

const HIDDEN = { source: 'dev-gallery', utm_source: 'gallery', price: '12.5' }

export default function DevRendererPage() {
  const [fixture, setFixture] = useState('branching')
  const [themeKey, setThemeKey] = useState('fixture')
  const [files, setFiles] = useState<Record<string, FileRef[]>>({})
  const [events, setEvents] = useState<string[]>([])
  const definition = (FIXTURES[fixture] ?? FIXTURES.branching)?.definition ?? BRANCHING

  const uploads: UploadsApi = {
    files,
    request: async (key, file) => {
      const ref: FileRef = { path: `preview/${key}/${Date.now()}-${file.name}`, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' }
      setFiles((m) => ({ ...m, [key]: [...(m[key] ?? []), ref] }))
      return ref
    },
    remove: (key, ref) => setFiles((m) => ({ ...m, [key]: (m[key] ?? []).filter((f) => f.path !== ref.path) })),
  }

  const onEvent = (e: RendererEvent) => {
    const detail = 'question_key' in e ? ` ${e.question_key}` : 'meta' in e ? ` ${JSON.stringify(e.meta)}` : ''
    setEvents((list) => [`${e.type}${detail}`, ...list].slice(0, 12))
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex flex-col gap-3 border-b border-border bg-surface p-4 sm:flex-row sm:items-end">
        <h1 className="text-lg font-semibold sm:mr-4">Renderer fixtures</h1>
        <div className="sm:w-72">
          <Select
            id="fixture-picker"
            label="Fixture"
            value={fixture}
            options={Object.entries(FIXTURES).map(([value, f]) => ({ value, label: f.label }))}
            onChange={(e) => {
              setFixture(e.target.value)
              setFiles({})
              setEvents([])
            }}
          />
        </div>
        <div className="sm:w-72">
          <Select
            id="theme-picker"
            label="Theme"
            value={themeKey}
            options={Object.entries(THEMES).map(([value, t]) => ({ value, label: t.label }))}
            onChange={(e) => setThemeKey(e.target.value)}
          />
        </div>
      </div>
      <div className="grid flex-1 lg:grid-cols-[1fr_18rem]">
        <SurveyRenderer
          key={fixture}
          definition={definition}
          mode="preview"
          seed="dev-gallery-seed"
          hidden={HIDDEN}
          theme={THEMES[themeKey]?.theme}
          uploads={uploads}
          onEvent={onEvent}
          onSubmit={async () => ({ ok: true })}
        />
        <aside className="border-l border-border bg-surface p-4 text-sm" aria-label="Renderer events">
          <h2 className="mb-2 font-semibold">Events</h2>
          <ol className="flex flex-col gap-1 font-mono text-xs">
            {events.map((e, i) => (
              <li key={`${i}-${e}`}>{e}</li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  )
}
