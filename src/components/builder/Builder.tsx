'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { diffDefinitions, lintDefinition, type QuestionType, type SurveyDefinition, type Theme } from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { cx } from '@/components/ui/cx'
import {
  loadDraftAction,
  publishAction,
  saveDraftAction,
  saveTemplateAction,
  takeLockAction,
} from '@/lib/builder/actions'
import { AUTOSAVE_DELAY_MS, initSaveState, isReadOnly, needsSave, saveReducer, statusLabel, type LockHolder } from '@/lib/builder/autosave'
import { loadDefinition } from '@/lib/builder/defaults'
import { canRedo, canUndo, initHistory, pushHistory, redo, undo, type History } from '@/lib/builder/history'
import { addQuestion, pageOf } from '@/lib/builder/ops'
import type { LockInfo } from '@/lib/builder/types'
import { Canvas } from './Canvas'
import { EndingPanel } from './EndingPanel'
import { TextArea } from './fields'
import { applyImport } from './importBuild'
import { ImportTextDialog } from './ImportTextDialog'
import { newQuestion } from './model'
import { PagePanel } from './PagePanel'
import { Palette } from './Palette'
import { PreviewPane } from './PreviewPane'
import { PublishDialog, type PublishPhase } from './PublishDialog'
import { QuestionPanel } from './QuestionPanel'
import { SurveyPanel } from './SurveyPanel'
import type { Selection } from './types'

export interface BuilderProps {
  surveyId: string
  workspaceId: string
  /** e.g. /w/acme/surveys/{id}, for links and the lock release beacon. */
  basePath: string
  versionId: string
  revision: number
  definition: SurveyDefinition
  publishedDefinition: SurveyDefinition | null
  publishedKeys: string[]
  completeCount: number
  stateLabel: string
  canEdit: boolean
  workspaceTheme: Theme
  logoUrl?: string
  contactFields: { key: string; label: string }[]
  pixelConsentMode: 'banner' | 'notice' | 'in_form'
  loadsPixels: boolean
}

type HistAction = { type: 'push'; next: SurveyDefinition; key?: string; now: number } | { type: 'undo' } | { type: 'redo' } | { type: 'reset'; def: SurveyDefinition }

function histReducer(h: History<SurveyDefinition>, a: HistAction): History<SurveyDefinition> {
  switch (a.type) {
    case 'push':
      return pushHistory(h, a.next, { key: a.key, now: a.now })
    case 'undo':
      return undo(h)
    case 'redo':
      return redo(h)
    case 'reset':
      return initHistory(a.def)
  }
}

const IDLE_LOCK_MS = 15 * 60 * 1000
const HEARTBEAT_MS = 60 * 1000

function holderFrom(l: LockInfo): LockHolder {
  return { userId: l.lockedBy, name: l.lockedByName, lockedAt: l.lockedAt }
}

function sinceLabel(at: string | null): string {
  if (!at) return ''
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : ` since ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

/**
 * The three-pane builder (doc 03 sections 6, 7 and 9). Holds the definition
 * in memory with undo history, autosaves the whole JSON 1.5 seconds after the
 * last change with the expected revision, keeps the draft lock alive with a
 * heartbeat while the user is active, and handles takeover both ways.
 */
export function Builder(props: BuilderProps) {
  const { surveyId, workspaceId, basePath, canEdit } = props
  const router = useRouter()
  const { toast } = useToast()
  const [hist, dispatchHist] = useReducer(histReducer, props.definition, initHistory)
  const [save, dispatchSave] = useReducer(saveReducer, initSaveState(props.revision, { userId: null, name: null, lockedAt: null }))
  const [versionId, setVersionId] = useState(props.versionId)
  const [lockChecked, setLockChecked] = useState(false)
  const [selection, setSelection] = useState<Selection>({ kind: 'survey' })
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [published, setPublished] = useState(props.publishedDefinition)
  const [publishedKeys, setPublishedKeys] = useState(() => new Set(props.publishedKeys))
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishRun, setPublishRun] = useState(0)
  const [phase, setPhase] = useState<PublishPhase>({ kind: 'review' })
  const [takeoverOpen, setTakeoverOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')

  const def = hist.present
  const readOnly = !canEdit || !lockChecked || isReadOnly(save) || phase.kind === 'publishing'

  // Latest values for timers and async callbacks.
  const defRef = useRef(def)
  const saveRef = useRef(save)
  const versionRef = useRef(versionId)
  const heldRef = useRef(false)
  const lastActive = useRef(0)
  const publishing = phase.kind === 'publishing'
  useEffect(() => {
    defRef.current = def
    saveRef.current = save
    versionRef.current = versionId
  })

  const commit = useCallback(
    (next: SurveyDefinition, key?: string) => {
      if (readOnly) return
      dispatchHist({ type: 'push', next, key, now: Date.now() })
      dispatchSave({ type: 'edit' })
    },
    [readOnly],
  )

  const reloadDraft = useCallback(async () => {
    const r = await loadDraftAction(surveyId)
    if (!r.ok) {
      toast(r.message, 'error')
      return null
    }
    const loaded = loadDefinition(r.data.definition, props.workspaceTheme)
    if (!loaded.ok) {
      toast('The saved draft could not be read.', 'error')
      return null
    }
    setVersionId(r.data.versionId)
    dispatchHist({ type: 'reset', def: loaded.definition })
    return r.data
  }, [surveyId, toast, props.workspaceTheme])

  /** After revision_conflict or lock_lost: resume if the lock only expired, else go read only. */
  const handleLost = useCallback(
    async (code: string) => {
      heldRef.current = false
      const r = await takeLockAction(versionRef.current, false)
      if (!r.ok) return
      if (!r.data.ok) {
        dispatchSave({ type: 'locked_elsewhere', holder: holderFrom(r.data) })
        dispatchHist({ type: 'reset', def: defRef.current })
        return
      }
      heldRef.current = true
      if (code === 'lock_lost' && r.data.revision === saveRef.current.revision) {
        dispatchSave({ type: 'resumed', revision: r.data.revision })
        return
      }
      const fresh = await reloadDraft()
      if (fresh) {
        dispatchSave({ type: 'took_lock', revision: fresh.revision })
        toast('Someone else saved this draft. The latest version was loaded.', 'info')
      }
    },
    [reloadDraft, toast],
  )

  const flush = useCallback(async () => {
    const s = saveRef.current
    if (!needsSave(s)) return
    const seq = s.editSeq
    dispatchSave({ type: 'save_start' })
    const r = await saveDraftAction(versionRef.current, s.revision, defRef.current as unknown as { pages: unknown[] })
    if (r.ok) {
      dispatchSave({ type: 'save_ok', revision: r.data, seq })
      return
    }
    dispatchSave({ type: 'save_fail', code: r.code, message: r.message })
    if (r.code === 'revision_conflict' || r.code === 'lock_lost') void handleLost(r.code)
  }, [handleLost])

  // Take the lock when the editor opens (doc 03 section 9).
  useEffect(() => {
    if (!canEdit) return
    let live = true
    void takeLockAction(props.versionId, false).then((r) => {
      if (!live) return
      setLockChecked(true)
      if (!r.ok) {
        dispatchSave({ type: 'locked_elsewhere', holder: { userId: null, name: null, lockedAt: null } })
        toast(r.message, 'error')
        return
      }
      if (r.data.ok) {
        heldRef.current = true
        dispatchSave({ type: 'took_lock', revision: r.data.revision })
      } else dispatchSave({ type: 'locked_elsewhere', holder: holderFrom(r.data) })
    })
    return () => {
      live = false
    }
  }, [canEdit, props.versionId, toast])

  // Debounced autosave.
  useEffect(() => {
    if (!needsSave(save) || publishing) return
    const t = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [save, publishing, flush])

  // Heartbeat: refresh the lock every minute while the user was active in the last 15 minutes.
  useEffect(() => {
    const mark = () => {
      lastActive.current = Date.now()
    }
    window.addEventListener('keydown', mark)
    window.addEventListener('pointerdown', mark)
    const t = window.setInterval(() => {
      if (!heldRef.current || Date.now() - lastActive.current > IDLE_LOCK_MS) return
      void takeLockAction(versionRef.current, false).then((r) => {
        if (r.ok && !r.data.ok) {
          heldRef.current = false
          dispatchSave({ type: 'locked_elsewhere', holder: holderFrom(r.data) })
        }
      })
    }, HEARTBEAT_MS)
    return () => {
      window.removeEventListener('keydown', mark)
      window.removeEventListener('pointerdown', mark)
      window.clearInterval(t)
    }
  }, [])

  // Release the lock on tab close and on unmount (best effort beacon), warn on unsaved changes.
  useEffect(() => {
    const release = () => {
      if (!heldRef.current) return
      heldRef.current = false
      const body = new Blob([JSON.stringify({ versionId: versionRef.current })], { type: 'application/json' })
      navigator.sendBeacon?.(`${basePath}/edit/release`, body)
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const s = saveRef.current
      if (s.editSeq > s.savedSeq && !isReadOnly(s)) e.preventDefault()
    }
    window.addEventListener('pagehide', release)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('pagehide', release)
      window.removeEventListener('beforeunload', beforeUnload)
      release()
    }
  }, [basePath])

  // Undo and redo shortcuts outside text fields (text fields keep native undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTextTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        if (readOnly) return
        dispatchHist({ type: k === 'y' || e.shiftKey ? 'redo' : 'undo' })
        dispatchSave({ type: 'edit' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly])

  const lintOpts = useMemo(
    () => ({ contactFieldKeys: props.contactFields.map((f) => f.key), pixelConsentMode: props.pixelConsentMode, loadsPixels: props.loadsPixels }),
    [props.contactFields, props.pixelConsentMode, props.loadsPixels],
  )
  const lint = useMemo(() => lintDefinition(def, lintOpts), [def, lintOpts])
  const diff = useMemo(() => (published ? diffDefinitions(published, def) : null), [published, def])
  const issueCount = useMemo(() => {
    const out: Record<string, number> = {}
    for (const i of lint.issues) if (i.severity === 'error' && i.question_id) out[i.question_id] = (out[i.question_id] ?? 0) + 1
    return out
  }, [lint])
  const breakingIds = useMemo(() => new Set((diff?.breaking ?? []).flatMap((c) => (c.question_id ? [c.question_id] : []))), [diff])

  function addType(type: QuestionType, pageId?: string, index?: number) {
    let pid = pageId
    let at = index
    if (!pid) {
      if (selection.kind === 'question') {
        const p = pageOf(def, selection.id)
        pid = p?.page.id
        at = p ? p.index + 1 : undefined
      } else if (selection.kind === 'page') pid = selection.id
    }
    const q = newQuestion(type, def)
    commit(addQuestion(def, q, pid, at))
    setSelection({ kind: 'question', id: q.id })
  }

  async function confirmPublish(ack: boolean) {
    setPhase({ kind: 'publishing' })
    const before = defRef.current
    const r = await publishAction({
      surveyId,
      versionId: versionRef.current,
      expectedRevision: saveRef.current.revision,
      definition: before as unknown as { pages: unknown[] },
      acknowledgeBreaking: ack,
    })
    if (r.ok && r.data.status === 'published') {
      setVersionId(r.data.newDraftVersionId)
      versionRef.current = r.data.newDraftVersionId
      heldRef.current = true
      dispatchSave({ type: 'took_lock', revision: r.data.revision })
      dispatchHist({ type: 'reset', def: before })
      setPublished(before)
      setPublishedKeys(new Set(Object.values(before.questions).map((q) => q.question_key)))
      setPhase({ kind: 'done', versionNo: r.data.versionNo })
      router.refresh()
      return
    }
    if (r.ok && r.data.status === 'lint_failed') {
      setPhase({ kind: 'error', message: r.data.issues.filter((i) => i.severity === 'error').map((i) => i.message).slice(0, 3).join(' ') })
      return
    }
    if (r.ok && r.data.status === 'needs_ack') {
      setPhase({ kind: 'error', message: 'This survey has responses. Tick the box to confirm the breaking changes.' })
      return
    }
    if (!r.ok) {
      setPhase({ kind: 'error', message: r.message })
      if (r.code === 'revision_conflict' || r.code === 'lock_lost' || r.code === 'lock_held') void handleLost(r.code === 'lock_held' ? 'revision_conflict' : r.code)
      else {
        // The draft save inside publish may have succeeded; resync the revision.
        const fresh = await loadDraftAction(surveyId)
        if (fresh.ok && fresh.data.versionId === versionRef.current) dispatchSave({ type: 'revision', revision: fresh.data.revision })
      }
    }
  }

  async function takeOver() {
    setTakeoverOpen(false)
    const r = await takeLockAction(versionRef.current, true)
    if (!r.ok) return toast(r.message, 'error')
    heldRef.current = true
    const fresh = await reloadDraft()
    dispatchSave({ type: 'took_lock', revision: fresh?.revision ?? r.data.revision })
    toast('You are now editing this survey.', 'success')
  }

  const holderName = save.holder?.name ?? 'Another editor'
  let banner: string | null = null
  if (!canEdit) banner = 'You can view this survey but not edit it.'
  else if (!lockChecked) banner = 'Checking who is editing...'
  else if (save.status === 'readonly') banner = `${holderName} is editing${sinceLabel(save.holder?.lockedAt ?? null)}. You are viewing a read-only copy.`
  else if (save.status === 'conflict' || save.status === 'lock_lost') banner = `Your editing session was taken over${save.holder?.name ? ` by ${save.holder.name}` : ''}.`

  let panel
  if (selection.kind === 'question' && def.questions[selection.id]) {
    panel = (
      <QuestionPanel
        key={selection.id}
        definition={def}
        id={selection.id}
        commit={commit}
        readOnly={readOnly}
        contactFields={props.contactFields}
        pixelConsentMode={props.pixelConsentMode}
        publishedKeys={publishedKeys}
      />
    )
  } else if (selection.kind === 'page' && def.pages.some((p) => p.id === selection.id)) {
    panel = <PagePanel key={selection.id} definition={def} id={selection.id} commit={commit} readOnly={readOnly} />
  } else if (selection.kind === 'ending' && def.endings.some((e) => e.id === selection.id)) {
    panel = <EndingPanel key={selection.id} definition={def} id={selection.id} commit={commit} readOnly={readOnly} onSelect={setSelection} />
  } else {
    panel = (
      <SurveyPanel
        definition={def}
        commit={commit}
        readOnly={readOnly}
        onSelect={setSelection}
        workspaceTheme={props.workspaceTheme}
        hasWorkspaceLogo={!!props.logoUrl}
        workspaceId={workspaceId}
        surveyId={surveyId}
      />
    )
  }

  const errorCount = lint.issues.filter((i) => i.severity === 'error').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span role="status" className={cx('mr-auto text-sm', save.status === 'error' ? 'text-danger' : 'text-muted')}>
          {canEdit ? statusLabel(save) : 'Read only'}
          {save.status === 'error' && save.error ? `: ${save.error}` : ''}
        </span>
        {save.status === 'error' ? (
          <Button size="sm" variant="secondary" onClick={() => (dispatchSave({ type: 'edit' }), void flush())}>
            Retry save
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={readOnly || !canUndo(hist)} onClick={() => (dispatchHist({ type: 'undo' }), dispatchSave({ type: 'edit' }))}>
          Undo
        </Button>
        <Button size="sm" variant="ghost" disabled={readOnly || !canRedo(hist)} onClick={() => (dispatchHist({ type: 'redo' }), dispatchSave({ type: 'edit' }))}>
          Redo
        </Button>
        <Button size="sm" variant="secondary" aria-pressed={view === 'preview'} onClick={() => setView(view === 'edit' ? 'preview' : 'edit')}>
          {view === 'edit' ? 'Preview' : 'Back to editing'}
        </Button>
        <Button size="sm" variant="secondary" disabled={readOnly} onClick={() => setImportOpen(true)}>
          Import text
        </Button>
        <Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => (setTemplateName(def.settings.title), setTemplateOpen(true))}>
          Save as template
        </Button>
        <Button
          size="sm"
          disabled={readOnly || save.status === 'saving'}
          onClick={() => {
            setPhase({ kind: 'review' })
            setPublishRun((n) => n + 1)
            setPublishOpen(true)
          }}
        >
          Publish{errorCount ? ` (${errorCount} to fix)` : ''}
        </Button>
      </div>
      {banner ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-warning bg-surface-muted px-4 py-2 text-sm">
          <span>{banner}</span>
          {canEdit && lockChecked && isReadOnly(save) ? (
            <Button size="sm" variant="secondary" onClick={() => setTakeoverOpen(true)}>
              Take over
            </Button>
          ) : null}
        </div>
      ) : null}
      {view === 'preview' ? (
        <div className="flex-1 overflow-auto bg-surface-muted p-4">
          <PreviewPane definition={def} logoUrl={props.logoUrl} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_24rem]">
          <aside className="overflow-y-auto border-r border-border p-3 lg:max-h-[calc(100dvh-10rem)]">
            <Palette onAdd={(t) => addType(t)} disabled={readOnly} />
          </aside>
          <main className="overflow-y-auto bg-surface-muted p-4 lg:max-h-[calc(100dvh-10rem)]" aria-label="Survey canvas">
            <Canvas
              definition={def}
              selection={selection}
              onSelect={setSelection}
              commit={commit}
              onAddType={(t, pid, i) => addType(t, pid, i)}
              readOnly={readOnly}
              issueCount={issueCount}
              breakingIds={breakingIds}
            />
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => setSelection({ kind: 'survey' })}>
              Survey settings and theme
            </Button>
          </main>
          <aside className="overflow-y-auto border-l border-border p-4 lg:max-h-[calc(100dvh-10rem)]" aria-label="Settings">
            {panel}
          </aside>
        </div>
      )}
      <PublishDialog
        key={publishRun}
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        issues={lint.issues}
        diff={diff}
        firstPublish={!published}
        hasResponses={props.completeCount > 0}
        phase={phase}
        onConfirm={(ack) => void confirmPublish(ack)}
        settingsHref={`${basePath}/settings`}
        stateLabel={props.stateLabel}
      />
      <Dialog
        open={takeoverOpen}
        onClose={() => setTakeoverOpen(false)}
        title="Take over editing?"
        description={`${holderName} may lose unsaved changes from the last few seconds.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTakeoverOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void takeOver()}>Take over</Button>
          </>
        }
      />
      <ImportTextDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onInsert={(pages) => {
          const target = selection.kind === 'page' ? selection.id : selection.kind === 'question' ? pageOf(def, selection.id)?.page.id : undefined
          const r = applyImport(def, pages, target)
          commit(r.definition)
          setImportOpen(false)
          toast(`Imported ${r.count} question${r.count === 1 ? '' : 's'}.`, 'success')
        }}
      />
      <Dialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="Save as workspace template"
        description="Everyone in this workspace can start a survey from it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!templateName.trim()}
              onClick={async () => {
                const r = await saveTemplateAction(workspaceId, templateName, templateDesc, def as unknown as { pages: unknown[] })
                if (!r.ok) return toast(r.message, 'error')
                setTemplateOpen(false)
                toast('Template saved.', 'success')
              }}
            >
              Save template
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Template name" required maxLength={120} value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          <TextArea label="Description" maxLength={500} value={templateDesc} onChange={(e) => setTemplateDesc(e.target.value)} />
        </div>
      </Dialog>
    </div>
  )
}
