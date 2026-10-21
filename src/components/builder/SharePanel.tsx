'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { setAliasAction } from '@/lib/builder/actions'
import { aliasProblem, publicSurveyUrl, RESERVED_ALIASES } from '@/lib/builder/share'
import { DEFAULT_LOGO_SIDE, drawQr, MAX_LOGO_SIDE, PNG_SIZES, qrFileName, qrSvg, type QrLogo } from '@/lib/qr'
import { Check, Section } from './fields'

const ALIAS_ERRORS: Record<string, string> = {
  alias_reserved: 'That word is reserved for the app. Pick another.',
  alias_invalid: 'Use 3 to 60 lowercase letters, digits and single hyphens.',
  alias_taken: 'Another survey uses that link, or held it within the last 30 days.',
  unique_violation: 'Another survey uses that link, or held it within the last 30 days.',
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function loadLogo(url: string): Promise<QrLogo & { image: HTMLImageElement }> {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error('logo fetch failed')
  const blob = await res.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(blob)
  })
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return { dataUrl, width: image.naturalWidth || 1, height: image.naturalHeight || 1, image }
}

/**
 * Share page (doc 02 sections 2 and 8): public link with copy, vanity alias
 * editor, and a QR code generated in the browser with optional workspace
 * logo, SVG and PNG downloads, and the permanent link (slug) toggle.
 */
export function SharePanel({
  surveyId,
  slug,
  alias,
  publicHost,
  logoUrl,
  stateText,
  isPublic,
  canEdit,
}: {
  surveyId: string
  slug: string
  alias: string | null
  publicHost: string
  logoUrl: string | null
  stateText: string
  isPublic: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [aliasInput, setAliasInput] = useState(alias ?? '')
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [permanent, setPermanent] = useState(false)
  const [tagScans, setTagScans] = useState(true)
  const [useLogo, setUseLogo] = useState(!!logoUrl)
  const [logoScale, setLogoScale] = useState(DEFAULT_LOGO_SIDE)
  const [png, setPng] = useState<number>(1024)
  const [logo, setLogo] = useState<(QrLogo & { image: HTMLImageElement }) | null>(null)
  const [logoFailed, setLogoFailed] = useState(false)

  const key = alias && !permanent ? alias : slug
  const linkUrl = publicSurveyUrl(publicHost, alias ?? slug)
  const qrUrl = publicSurveyUrl(publicHost, key, { tagQr: tagScans })
  const activeLogo = useLogo && logo ? logo : null

  useEffect(() => {
    if (!useLogo || !logoUrl || logo) return
    let live = true
    loadLogo(logoUrl)
      .then((l) => live && setLogo(l))
      .catch(() => {
        if (!live) return
        setLogoFailed(true)
        setUseLogo(false)
      })
    return () => {
      live = false
    }
  }, [useLogo, logoUrl, logo])

  const svg = useMemo(() => qrSvg(qrUrl, { px: 320, logo: activeLogo, logoScale }), [qrUrl, activeLogo, logoScale])
  const preview = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  async function saveAlias(next: string | null) {
    const problem = next ? aliasProblem(next, RESERVED_ALIASES) : null
    if (problem) return setAliasError(problem)
    setAliasError(null)
    setSaving(true)
    const r = await setAliasAction(surveyId, next)
    setSaving(false)
    if (!r.ok) return setAliasError(ALIAS_ERRORS[r.code] ?? r.message)
    toast(next ? 'Custom link saved.' : 'Custom link removed. It stays reserved for this survey for 30 days.', 'success')
    router.refresh()
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast('Link copied.', 'success')
    } catch {
      toast('Copy failed. Select the link and copy it by hand.', 'error')
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="Public link">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isPublic ? 'success' : 'neutral'}>{stateText}</Badge>
          {!isPublic ? <span className="text-sm text-muted">The link shows a not found page until the survey is published and opened.</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-surface-muted px-2 py-1 text-sm">{linkUrl}</code>
          <Button size="sm" variant="secondary" onClick={() => copy(linkUrl)}>
            Copy link
          </Button>
        </div>
        {alias ? (
          <p className="text-sm text-muted">
            Permanent link: <code>{publicSurveyUrl(publicHost, slug)}</code>
          </p>
        ) : null}
      </Section>

      <Section title="Custom link">
        <p className="text-sm text-muted">
          A readable name, for example {publicSurveyUrl(publicHost, 'spring-feedback')}. Renaming keeps the old name working for 30 days, then it frees up.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-sm">
            <Input
              label="Custom name"
              value={aliasInput}
              maxLength={60}
              disabled={!canEdit}
              error={aliasError ?? undefined}
              onChange={(e) => setAliasInput(e.target.value.toLowerCase())}
            />
          </div>
          <Button size="md" loading={saving} disabled={!canEdit || !aliasInput.trim() || aliasInput.trim() === alias} onClick={() => saveAlias(aliasInput.trim())}>
            Save
          </Button>
          {alias ? (
            <Button size="md" variant="ghost" disabled={!canEdit || saving} onClick={() => saveAlias(null)}>
              Remove
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="QR code">
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview of a generated SVG */}
          <img src={preview} alt={`QR code for ${qrUrl}`} width={240} height={240} className="h-60 w-60 rounded border border-border bg-white" />
          <div className="flex flex-1 flex-col gap-3">
            <p className="break-all text-sm">
              Encodes <code>{qrUrl}</code>{' '}
              <Button size="sm" variant="ghost" onClick={() => copy(qrUrl)}>
                Copy
              </Button>
            </p>
            {alias ? (
              <Check
                label="Use the permanent link"
                hint="Printed codes with a custom name stop working 30 days after a rename. The permanent link never changes."
                checked={permanent}
                onChange={setPermanent}
              />
            ) : null}
            <Check label="Tag scans" hint="Adds utm_medium=qr so scans show up in analytics." checked={tagScans} onChange={setTagScans} />
            <Check
              label="Put the workspace logo in the center"
              hint={logoUrl ? (logoFailed ? 'The logo could not be loaded.' : 'Uses stronger error correction so the code still scans.') : 'Add a workspace logo in workspace settings to use this.'}
              checked={useLogo}
              disabled={!logoUrl || logoFailed}
              onChange={setUseLogo}
            />
            {activeLogo ? (
              <Input
                label={`Logo size (${Math.round(logoScale * 100)} percent of the width)`}
                type="range"
                min={0.15}
                max={MAX_LOGO_SIDE}
                step={0.01}
                value={logoScale}
                onChange={(e) => setLogoScale(Number(e.target.value))}
              />
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => download(new Blob([qrSvg(qrUrl, { px: 1024, logo: activeLogo, logoScale })], { type: 'image/svg+xml' }), qrFileName(key, 'svg'))}>
                Download SVG
              </Button>
              <div className="w-36">
                <Select label="PNG size" options={PNG_SIZES.map((n) => ({ value: String(n), label: `${n} px` }))} value={String(png)} onChange={(e) => setPng(Number(e.target.value))} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const canvas = document.createElement('canvas')
                  drawQr(canvas, qrUrl, { px: png, logo: activeLogo ? { image: activeLogo.image, width: activeLogo.width, height: activeLogo.height } : null, logoScale })
                  canvas.toBlob((b) => (b ? download(b, qrFileName(key, 'png')) : toast('The PNG could not be created.', 'error')), 'image/png')
                }}
              >
                Download PNG
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}
