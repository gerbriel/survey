'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { safeMigrateDefinition, type AnswerValue, type FileRef, type SurveyDefinition } from '@/lib/survey'
import {
  SurveyRenderer,
  SurveyShell,
  ThemeProvider,
  type AutosaveSnapshot,
  type EndingInfo,
  type PendingUpload,
  type PublicDefinition,
  type RendererEvent,
  type SubmitMeta,
  type SubmitOutcome,
  type UploadsApi,
} from '@/components/survey/renderer'
import { Button } from '@/components/ui/Button'
import { ConsentBanner } from '@/components/public/ConsentBanner'
import { useNonce } from '@/components/public/NonceContext'
import { ClosedStateScreen, NotFoundScreen, ScheduledScreen } from '@/components/public/StateScreens'
import { useTurnstile } from '@/components/public/TurnstileWidget'
import {
  consentStorageKey,
  firePixelEvent,
  initialConsent,
  PIXEL_FLUSH_MS,
  Pixels,
  pixelEventPlan,
  setTrackingConsent,
  type PixelConsentMode,
  type PixelEventKind,
  type ResolvedPixel,
  type StoredConsent,
} from '@/components/public/pixels'
import {
  fileIdsFromAnswers,
  hiddenFromSearch,
  type ClientMeta,
  type ErrorCode,
  type ResumeResponse,
  type SubmitRequest,
  type SubmitResponse,
  type UploadResponse,
} from '@/components/public/protocol'
import { redirectDelaySeconds, safeRedirectUrl } from '@/components/public/redirect'
import {
  browserStore,
  clearAfterComplete,
  keys,
  loadOrCreate,
  loadResumeToken,
  purgeLegacyAnswers,
  randomHex,
  readValue,
  saveResumeToken,
  takeUrlTokens,
  writeValue,
  type StoreLike,
} from '@/components/public/resumeStore'
import { deviceKind, EventQueue, postJson, uploadToSignedUrl, uuid, type BeaconEvent } from '@/components/public/transport'

/**
 * Client half of the public survey page. Owns everything the renderer
 * leaves to its caller (doc 03 section 5, doc 02 sections 5 to 11):
 * resume, autosave transport with backoff, submit, Turnstile, uploads,
 * first-party events, pixels and consent, and the thank-you redirect.
 *
 * Boot order on mount: read and strip `?r=` and `?t=` from the address bar,
 * resume from the server, then render the renderer. S3 (R16): no answers
 * are kept in browser storage; the server copy is the only one.
 * Pixels can only mount after boot, so neither token reaches a pixel URL.
 */

export type SurveyClientProps = {
  surveyKey: string
  surveyId: string
  versionId: string
  workspaceId: string | null
  workspaceName: string
  definition: unknown
  serverSeed: string
  title: string
  closedMessage: string | null
  logoUrl?: string
  assetBase: string | null
  fontClassName: string
  pixels: ResolvedPixel[]
  consentMode: PixelConsentMode
  turnstileSiteKey?: string
  maxFiles: number
  publicOrigin: string
  footer: ReactNode
}

type Boot = {
  definition: PublicDefinition
  versionId: string
  seed: string
  initialAnswers?: Record<string, unknown>
  initialPageId?: string
  hidden: Record<string, string>
  meta: ClientMeta
  respondentToken: string | null
  respondentHash: string
  startedAt: string
}

type Screen = { kind: 'survey' } | { kind: 'closed' } | { kind: 'scheduled' } | { kind: 'not_found' }

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  invalid_request: 'Something went wrong. Please refresh and try again.',
  captcha_failed: 'Please confirm you are human, then submit again.',
  token_invalid: 'This personal link is not valid.',
  token_used: 'You have already responded with this link.',
  server_error: 'We could not save your response. Please keep this page open and try again.',
}

const UPLOAD_MESSAGES: Partial<Record<ErrorCode, string>> = {
  file_size: 'This file is too large.',
  file_type: 'This file type is not allowed.',
  file_count: 'This response already has the maximum number of files.',
  captcha_failed: 'Please confirm you are human, then try again.',
  survey_closed: 'This survey is no longer accepting responses.',
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

/** Coarse size for analytics; never the file name. */
function sizeBucket(bytes: number): string {
  if (bytes < 1024 * 1024) return 'lt_1mb'
  if (bytes < 10 * 1024 * 1024) return '1_10mb'
  return 'gt_10mb'
}

function pageForKey(def: SurveyDefinition, questionKey: string | null | undefined): string | undefined {
  if (!questionKey) return undefined
  const q = Object.values(def.questions).find((x) => x.question_key === questionKey)
  if (!q) return undefined
  return def.pages.find((p) => p.question_ids.includes(q.id))?.id
}

function clientMeta(hidden: Record<string, string>, mode: PixelConsentMode, granted: boolean): ClientMeta {
  const meta: ClientMeta = { device: deviceKind(), pixel_consent: { mode, granted } }
  for (const k of UTM_KEYS) if (hidden[k]) meta[k] = hidden[k].slice(0, 255)
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).host
      if (host && host !== location.host) meta.referrer_host = host.slice(0, 255)
    }
    if (navigator.language) meta.locale = navigator.language.slice(0, 35)
  } catch {
    // ignore
  }
  return meta
}

export function SurveyClient(props: SurveyClientProps) {
  const {
    surveyKey,
    surveyId,
    versionId,
    workspaceName,
    serverSeed,
    pixels,
    consentMode,
    maxFiles,
    title,
    closedMessage,
    logoUrl,
    assetBase,
    fontClassName,
    footer,
  } = props
  const nonce = useNonce()
  const migrated = useMemo(() => safeMigrateDefinition(props.definition), [props.definition])
  const { widget, getToken } = useTurnstile(props.turnstileSiteKey)

  const [boot, setBoot] = useState<Boot | null>(null)
  const [screen, setScreen] = useState<Screen>({ kind: 'survey' })
  const [files, setFiles] = useState<Record<string, FileRef[]>>({})
  const [pending, setPending] = useState<Record<string, PendingUpload[]>>({})
  const [banner, setBanner] = useState<'opt_in' | 'notice' | null>(null)
  const [granted, setGranted] = useState(false)
  const [googleDefault, setGoogleDefault] = useState<'granted' | 'denied'>('denied')
  const [resumeLink, setResumeLink] = useState<string | null>(null)
  const [showResumeLink, setShowResumeLink] = useState(false)
  const [redirect, setRedirect] = useState<{ url: string; seconds: number } | null>(null)

  const store = useRef<StoreLike | null>(null)
  const resumeToken = useRef<string | null>(null)
  const completeKey = useRef<string | null>(null)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const backoffUntil = useRef(0)
  const started = useRef(false)
  const completed = useRef(false)
  const currentPage = useRef<string | null>(null)
  const latest = useRef<AutosaveSnapshot | null>(null)
  const dirty = useRef(false)
  const grantedRef = useRef(false)
  const pixelsLoaded = useRef(false)
  const filesRef = useRef<Record<string, FileRef[]>>({})
  const honeypot = useRef<HTMLInputElement>(null)
  const bootRef = useRef<Boot | null>(null)
  const queue = useRef<EventQueue | null>(null)

  // S3 (R16): consent is stored per survey, so one workspace's script cannot
  // reuse another survey's stored choice by sharing a workspace key.
  const consentScope = surveyId

  // ---------------------------------------------------------------- events
  const pushEvent = useCallback(
    (e: { type: BeaconEvent['type']; question_key?: string; meta?: BeaconEvent['meta'] }) => {
      if (!queue.current) return
      const ev: BeaconEvent = { type: e.type, occurred_at: new Date().toISOString() }
      if (e.question_key) ev.question_key = e.question_key
      if (e.meta && Object.keys(e.meta).length > 0) ev.meta = e.meta
      queue.current.push(ev)
    },
    [],
  )

  /** 1-based page number for event meta (Phase 2E's beacon takes numbers, not page ids). */
  const pageNo = (pageId: string | null | undefined): number | undefined => {
    if (!pageId) return undefined
    const i = bootRef.current?.definition.pages.findIndex((p) => p.id === pageId) ?? -1
    return i >= 0 ? i + 1 : undefined
  }

  const eventMeta = (m: Record<string, number | undefined>): Record<string, number> =>
    Object.fromEntries(Object.entries(m).filter((kv): kv is [string, number] => typeof kv[1] === 'number'))

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      await Promise.resolve()
      if (!migrated.ok) return
      const s = browserStore()
      store.current = s
      // S3 (R16): drop answer mirrors and seeds earlier builds left on this origin.
      purgeLegacyAnswers(s)
      // Strip r and t before anything else can read the URL (doc 02 section 5.3).
      const tokens = takeUrlTokens(window.location.href)
      if (tokens.cleanUrl) window.history.replaceState(window.history.state, '', tokens.cleanUrl)
      const hidden = hiddenFromSearch(window.location.search)
      const respondentHash = loadOrCreate(s, keys.respondent(surveyId), () => randomHex(16), (v) => /^[a-f0-9]{32}$/.test(v))

      let def: SurveyDefinition = migrated.definition
      let ver = versionId
      // S3 (R16): the seed is not stored in the browser; a resumed partial brings its own.
      let seed = serverSeed
      let initialAnswers: Record<string, unknown> | undefined
      let initialPageId: string | undefined
      let startedAt = new Date().toISOString()

      let token = tokens.resumeToken ?? loadResumeToken(s, surveyId)
      if (token) {
        const r = await postJson<ResumeResponse>('/api/public/resume', { key: surveyKey, surveyId, resumeToken: token })
        if (cancelled) return
        if (r.data && r.data.ok) {
          const data = r.data
          if (data.definition !== undefined) {
            const m = safeMigrateDefinition(data.definition)
            if (m.ok) {
              def = m.definition
              ver = data.versionId
            }
          }
          if (ver === data.versionId) {
            initialAnswers = data.answers
            filesRef.current = data.files
            setFiles(data.files)
            initialPageId = pageForKey(def, data.lastQuestionKey)
            startedAt = data.startedAt
            if (data.seed) seed = data.seed
            saveResumeToken(s, surveyId, token)
            resumeToken.current = token
            setResumeLink(`${props.publicOrigin}/${surveyKey}?r=${token}`)
          } else {
            token = null
          }
        } else if (r.data && !r.data.ok && (r.data.code === 'survey_closed' || r.data.code === 'cap_reached')) {
          setScreen({ kind: 'closed' })
        } else if (r.data && !r.data.ok && r.data.code === 'not_open_yet') {
          setScreen({ kind: 'scheduled' })
        } else if (r.status === 404) {
          saveResumeToken(s, surveyId, null)
          token = null
        }
      }

      const stored = readValue(s, consentStorageKey(consentScope)) as StoredConsent
      const c = initialConsent(consentMode, pixels.length, stored === 'granted' || stored === 'denied' || stored === 'dismissed' ? stored : null)
      grantedRef.current = c.granted
      setBanner(c.banner)
      setGranted(c.granted)
      setGoogleDefault(c.googleDefault)

      const next: Boot = {
        definition: def,
        versionId: ver,
        seed,
        initialAnswers,
        initialPageId,
        hidden,
        meta: clientMeta(hidden, consentMode, c.granted),
        respondentToken: tokens.respondentToken,
        respondentHash,
        startedAt,
      }
      bootRef.current = next
      queue.current = new EventQueue({ survey_id: surveyId, survey_version_id: ver, rid: respondentHash })
      setBoot(next)
      const utm = Object.fromEntries(Object.entries(next.meta).filter(([k]) => k.startsWith('utm_'))) as Record<string, string>
      const viewMeta: NonNullable<BeaconEvent['meta']> = { device: next.meta.device ?? 'desktop' }
      if (next.meta.referrer_host) viewMeta.referrer_host = next.meta.referrer_host
      if (Object.keys(utm).length > 0) viewMeta.utm = utm
      pushEvent({ type: 'view', meta: viewMeta })
    }
    void run()
    return () => {
      cancelled = true
    }
    // Boot runs once per mount; props of a server render do not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pixelEvent = useCallback(
    (kind: PixelEventKind, step?: number, waitMs = 0): Promise<void> => {
      if (!grantedRef.current || pixels.length === 0) return Promise.resolve()
      return firePixelEvent(pixelEventPlan(kind, { surveyId, surveyKey, step }), pixels, waitMs)
    },
    [pixels, surveyId, surveyKey],
  )

  // Page loaded event once the tags had a moment to start.
  const pixelsActive = boot !== null && granted && pixels.length > 0
  useEffect(() => {
    if (!pixelsActive || pixelsLoaded.current) return
    pixelsLoaded.current = true
    const t = setTimeout(() => void pixelEvent('view'), 1000)
    return () => clearTimeout(t)
  }, [pixelsActive, pixelEvent])

  // Flush events and save on hide; record abandon on page exit.
  useEffect(() => {
    if (!boot) return
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      queue.current?.flush()
      const snap = latest.current
      const token = resumeToken.current
      if (snap && dirty.current && token && !completed.current) {
        dirty.current = false
        const body = buildRequest('save', snap.answers, { pageId: snap.page_id, seed: snap.seed })
        try {
          navigator.sendBeacon('/api/public/submit', new Blob([JSON.stringify(body)], { type: 'application/json' }))
        } catch {
          // the next autosave or the submit carries the answers
        }
      }
    }
    const onPageHide = () => {
      if (started.current && !completed.current) {
        pushEvent({ type: 'abandon', meta: eventMeta({ page: pageNo(currentPage.current) }) })
      }
      queue.current?.flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
    // buildRequest reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, pushEvent])

  // ---------------------------------------------------------------- transport
  function buildRequest(
    action: 'save' | 'complete',
    answers: Record<string, unknown>,
    extra: { pageId?: string; seed?: string; idempotencyKey?: string; turnstileToken?: string },
  ): SubmitRequest {
    const b = bootRef.current as Boot
    const body: SubmitRequest = {
      action,
      key: surveyKey,
      surveyId,
      versionId: b.versionId,
      idempotencyKey: extra.idempotencyKey ?? uuid(),
      respondentHash: b.respondentHash,
      answers,
      hidden: b.hidden,
      uploadIds: fileIdsFromAnswers(answers),
      startedAt: b.startedAt,
      seed: extra.seed ?? b.seed,
      meta: { ...b.meta, pixel_consent: { mode: consentMode, granted: grantedRef.current } },
      website: honeypot.current?.value ?? '',
    }
    if (extra.pageId) body.pageId = extra.pageId
    if (resumeToken.current) body.resumeToken = resumeToken.current
    if (b.respondentToken) body.respondentToken = b.respondentToken
    if (extra.turnstileToken) body.turnstileToken = extra.turnstileToken
    return body
  }

  function rememberToken(token: string | undefined) {
    if (!token || resumeToken.current) return
    resumeToken.current = token
    saveResumeToken(store.current, surveyId, token)
    setResumeLink(`${props.publicOrigin}/${surveyKey}?r=${token}`)
  }

  async function doSave(snap: AutosaveSnapshot): Promise<void> {
    if (completed.current || Date.now() < backoffUntil.current) return
    const turnstileToken = resumeToken.current ? undefined : await getToken('submit')
    const body = buildRequest('save', snap.answers, { pageId: snap.page_id, seed: snap.seed, turnstileToken })
    const r = await postJson<SubmitResponse>('/api/public/submit', body)
    const data = r.data
    if (data && data.ok) {
      rememberToken(data.resumeToken)
      if (latest.current === snap) dirty.current = false
    } else if (data && !data.ok && data.code === 'rate_limited') {
      // Autosave backs off silently (doc 02 section 5.4).
      backoffUntil.current = Date.now() + (data.retryAfter ?? 60) * 1000
    }
  }

  function onAutosave(snap: AutosaveSnapshot): Promise<void> {
    latest.current = snap
    dirty.current = true
    // S3 (R16): answers go to the server only, never to browser storage.
    const next = saveChain.current.then(() => doSave(snap)).catch(() => undefined)
    saveChain.current = next
    return next
  }

  async function onSubmit(cleaned: Record<string, AnswerValue>, _visible: string[], meta: SubmitMeta): Promise<SubmitOutcome> {
    // A first autosave in flight creates the response; wait so complete resumes it.
    await saveChain.current
    const key = completeKey.current ?? uuid()
    completeKey.current = key
    const turnstileToken = await getToken('submit')
    const body = buildRequest('complete', cleaned, { pageId: meta.page_id, seed: meta.seed, idempotencyKey: key, turnstileToken })
    const r = await postJson<SubmitResponse>('/api/public/submit', body)
    const data = r.data
    if (r.networkError || !data) return { ok: false, message: MESSAGES.server_error }
    if (data.ok) {
      completed.current = true
      clearAfterComplete(store.current, surveyId)
      queue.current?.flush()
      setResumeLink(null)
      await pixelEvent('complete', undefined, PIXEL_FLUSH_MS)
      return { ok: true, score: data.score ?? null, ending_id: data.endingId ?? undefined }
    }
    // The server stored this key's result (or refused before storing): a retry needs a new key,
    // except after a server error, where the retry must reuse it (doc 02 section 5.4).
    if (data.code !== 'server_error') completeKey.current = null
    switch (data.code) {
      case 'survey_closed':
      case 'cap_reached':
        setScreen({ kind: 'closed' })
        return { ok: false, message: 'This survey is no longer accepting responses.' }
      case 'not_open_yet':
        setScreen({ kind: 'scheduled' })
        return { ok: false, message: 'This survey is not open yet.' }
      case 'not_found':
        setScreen({ kind: 'not_found' })
        return { ok: false, message: MESSAGES.invalid_request }
      case 'validation_failed':
        return { ok: false, fieldErrors: data.fieldErrors ?? {} }
      case 'rate_limited':
        return { ok: false, message: `Too many attempts. Try again in ${data.retryAfter ?? 60} seconds.` }
      default:
        return { ok: false, message: MESSAGES[data.code] ?? MESSAGES.server_error }
    }
  }

  function onEvent(e: RendererEvent) {
    if (e.type === 'complete') return // submit_response records completion
    if (e.type === 'start') {
      started.current = true
      void pixelEvent('start')
    }
    let meta: Record<string, number> | undefined
    switch (e.type) {
      case 'page_next':
      case 'page_back':
        currentPage.current = e.meta.to_page
        meta = eventMeta({ from_page: pageNo(e.meta.from_page), to_page: pageNo(e.meta.to_page) })
        if (e.type === 'page_next') void pixelEvent('step', pageNo(e.meta.to_page))
        break
      case 'question_view':
        meta = eventMeta({ page: pageNo(e.meta.page), position: e.meta.position })
        break
      case 'question_answer':
        meta = eventMeta({ page: pageNo(e.meta.page) })
        break
    }
    pushEvent({ type: e.type, question_key: 'question_key' in e ? e.question_key : undefined, meta })
  }

  function onEnding(info: EndingInfo) {
    const url = safeRedirectUrl(info.redirect_url, {
      hidden: bootRef.current?.hidden,
      passParams: info.ending.redirect_pass_params === true,
    })
    if (!url) return
    const seconds = redirectDelaySeconds(info.redirect_delay_seconds)
    setRedirect({ url, seconds })
    const tick = setInterval(() => setRedirect((r) => (r && r.seconds > 0 ? { ...r, seconds: r.seconds - 1 } : r)), 1000)
    setTimeout(() => clearInterval(tick), seconds * 1000 + 100)
    // With a zero delay the message still flashes for the pixel flush.
    setTimeout(() => window.location.assign(url), Math.max(seconds * 1000, 600))
  }

  function applyConsent(next: boolean) {
    const wasLoaded = grantedRef.current
    grantedRef.current = next
    if (next) setGranted(true)
    // Withdrawal never unloads scripts; it stops custom events and resets Consent Mode.
    if (wasLoaded || pixelsLoaded.current) setTrackingConsent(next)
  }

  function onTrackingConsent(isGranted: boolean) {
    if (consentMode !== 'in_form' || pixels.length === 0) return
    applyConsent(isGranted)
  }

  // ---------------------------------------------------------------- uploads
  function setPendingFor(qk: string, update: (list: PendingUpload[]) => PendingUpload[]) {
    setPending((prev) => ({ ...prev, [qk]: update(prev[qk] ?? []) }))
  }

  function failPending(qk: string, id: string, message: string) {
    setPendingFor(qk, (l) => l.map((p) => (p.id === id ? { ...p, error: message, progress: undefined } : p)))
    setTimeout(() => setPendingFor(qk, (l) => l.filter((p) => p.id !== id)), 8000)
  }

  async function requestUpload(qk: string, file: File): Promise<FileRef | null> {
    const b = bootRef.current
    if (!b) return null
    const id = uuid()
    setPendingFor(qk, (l) => [...l, { id, name: file.name, progress: 0 }])
    const total = Object.values(filesRef.current).reduce((n, l) => n + l.length, 0)
    if (total >= maxFiles) {
      failPending(qk, id, `You can upload at most ${maxFiles} files to one response.`)
      return null
    }
    const turnstileToken = resumeToken.current ? undefined : await getToken('upload')
    const r = await postJson<UploadResponse>('/api/public/upload', {
      key: surveyKey,
      surveyId,
      versionId: b.versionId,
      questionKey: qk,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      // S10: the client-declared count; the server also counts with a resume token.
      fileCount: total,
      resumeToken: resumeToken.current ?? undefined,
      turnstileToken,
    })
    const data = r.data
    if (!data || !data.ok) {
      const code = data && !data.ok ? data.code : 'server_error'
      const msg =
        code === 'rate_limited'
          ? `Too many uploads. Try again in ${(data && !data.ok && data.retryAfter) || 60} seconds.`
          : (UPLOAD_MESSAGES[code] ?? 'Upload failed. Please try again.')
      failPending(qk, id, msg)
      return null
    }
    const ok = await uploadToSignedUrl(data.signedUrl, file, (pct) =>
      setPendingFor(qk, (l) => l.map((p) => (p.id === id ? { ...p, progress: pct } : p))),
    )
    if (!ok) {
      failPending(qk, id, 'Upload failed. Please try again.')
      return null
    }
    const ref: FileRef = { path: data.path, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' }
    filesRef.current = { ...filesRef.current, [qk]: [...(filesRef.current[qk] ?? []), ref] }
    setFiles(filesRef.current)
    setPendingFor(qk, (l) => l.filter((p) => p.id !== id))
    pushEvent({ type: 'file_upload', question_key: qk, meta: { mime: ref.mime.slice(0, 100), size_bucket: sizeBucket(ref.size) } })
    return ref
  }

  function removeUpload(qk: string, ref: FileRef) {
    // The orphan sweep deletes unattached objects after 24 hours.
    filesRef.current = { ...filesRef.current, [qk]: (filesRef.current[qk] ?? []).filter((f) => f.path !== ref.path) }
    setFiles(filesRef.current)
  }

  const uploads: UploadsApi = { request: requestUpload, remove: removeUpload, files, pending }

  // ---------------------------------------------------------------- consent banner
  function decide(choice: 'granted' | 'denied' | 'dismissed') {
    writeValue(store.current, consentStorageKey(consentScope), choice)
    setBanner(null)
    if (choice === 'granted') applyConsent(true)
  }

  // ---------------------------------------------------------------- render
  if (screen.kind === 'not_found') return <NotFoundScreen footer={footer} />
  if (screen.kind === 'closed') return <ClosedStateScreen title={title} message={closedMessage} logoUrl={logoUrl} footer={footer} />
  if (screen.kind === 'scheduled') return <ScheduledScreen title={title} opensAt={null} logoUrl={logoUrl} footer={footer} />

  const resolveAssetUrl = (path: string) =>
    assetBase && !path.includes('..') ? `${assetBase}/${path.replace(/^\/+/, '').replace(/^public-assets\//, '')}` : null

  const footerSlot = (
    <div className="flex flex-col gap-3">
      {widget}
      {redirect ? (
        <p role="status" className="text-center">
          {redirect.seconds > 0 ? `Taking you onward in ${redirect.seconds} seconds.` : 'Taking you onward.'}{' '}
          <a href={redirect.url} className="underline underline-offset-2">
            Continue now
          </a>
        </p>
      ) : null}
      {resumeLink && !redirect ? (
        <div className="flex flex-col items-center gap-2">
          {showResumeLink ? (
            <label className="flex w-full max-w-md flex-col gap-1 text-sm">
              <span>Copy this private link to finish on any device within 30 days. Anyone with it can see your answers.</span>
              <input
                readOnly
                value={resumeLink}
                onFocus={(e) => e.currentTarget.select()}
                className="h-11 w-full rounded-md border border-border bg-surface px-3 text-fg"
              />
            </label>
          ) : (
            <Button variant="ghost" className="min-h-11" onClick={() => setShowResumeLink(true)}>
              Save and continue later
            </Button>
          )}
        </div>
      ) : null}
      {footer}
    </div>
  )

  let body: ReactNode
  if (!migrated.ok || !boot) {
    body = migrated.ok ? (
      <ThemeProvider theme={migrated.definition.theme} fontClassName={fontClassName}>
        <SurveyShell theme={migrated.definition.theme} title={migrated.definition.settings.title || title} logoUrl={logoUrl} resolveAssetUrl={resolveAssetUrl} footer={footer}>
          <p aria-busy="true" className="text-[var(--sv-muted)]">
            Loading survey
          </p>
        </SurveyShell>
      </ThemeProvider>
    ) : (
      // The renderer shows its own "could not be loaded" message.
      <SurveyRenderer definition={props.definition as PublicDefinition} mode="live" seed={serverSeed} onSubmit={async () => ({ ok: false })} />
    )
  } else {
    body = (
      <SurveyRenderer
        key={boot.versionId}
        definition={boot.definition}
        mode="live"
        seed={boot.seed}
        initialAnswers={boot.initialAnswers}
        initialPageId={boot.initialPageId}
        hidden={boot.hidden}
        onAutosave={onAutosave}
        onSubmit={onSubmit}
        onEvent={onEvent}
        onEnding={onEnding}
        onTrackingConsent={onTrackingConsent}
        uploads={uploads}
        logoUrl={logoUrl}
        resolveAssetUrl={resolveAssetUrl}
        fontClassName={fontClassName}
        footer={footerSlot}
      />
    )
  }

  return (
    <>
      {body}
      {/* Honeypot (doc 02 section 5.1): visually hidden, skipped by keyboard and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {banner && boot ? (
        <ConsentBanner
          kind={banner}
          workspaceName={workspaceName}
          onAccept={() => decide('granted')}
          onDecline={() => decide('denied')}
          onDismiss={() => decide('dismissed')}
        />
      ) : null}
      {pixelsActive ? <Pixels pixels={pixels} googleDefault={googleDefault} nonce={nonce} /> : null}
    </>
  )
}
