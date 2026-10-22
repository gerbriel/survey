'use client'

import { normalizeCover, type Theme } from '@/lib/survey'
import { contrastRatio } from '@/components/survey/renderer'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SAFE_FONTS } from '@/lib/builder/defaults'
import { NumberField, Section } from './fields'
import { ImageUpload } from './ImageUpload'
import { ImagePicker } from '@/components/dashboard/ImagePicker'

const COLOR_LABELS: Record<keyof Theme['colors'], string> = {
  primary: 'Primary (buttons, selection)',
  text: 'Text',
  muted_text: 'Secondary text',
  background: 'Page background',
  surface: 'Card background',
  error: 'Error',
}

/** Pairs checked against WCAG AA 4.5:1 (doc 03 section 8). */
export function contrastWarnings(t: Theme): string[] {
  const pairs: [string, string, string][] = [
    ['Text on the card', t.colors.text, t.colors.surface],
    ['Secondary text on the card', t.colors.muted_text, t.colors.surface],
    ['Text on the page background', t.colors.text, t.colors.background],
    ['Error text on the card', t.colors.error, t.colors.surface],
  ]
  const out: string[] = []
  for (const [name, fg, bg] of pairs) {
    const r = contrastRatio(fg, bg)
    if (r !== null && r < 4.5) out.push(`${name} has a contrast of ${r.toFixed(1)} to 1, below the 4.5 to 1 minimum. The live page adjusts it to black or white.`)
  }
  return out
}

/** Theme editor (doc 03 section 8): colors with contrast check, safe fonts, logo, cover, background, progress. Button text lives in survey settings. */
export function ThemeEditor({
  theme: t,
  onChange,
  onReset,
  hasWorkspaceLogo,
  workspaceId,
  surveyId,
  imageUploadUrl,
  disabled,
}: {
  theme: Theme
  onChange: (t: Theme, key?: string) => void
  onReset: () => void
  hasWorkspaceLogo: boolean
  workspaceId: string
  surveyId: string
  /** Workspace image library upload route, for the picker's Upload now tab. */
  imageUploadUrl?: string | null
  disabled?: boolean
}) {
  // Either cover shape reads as the current one (doc 03 section 8.1).
  const cover = normalizeCover(t.cover_image) ?? undefined
  const warnings = contrastWarnings(t)
  const fonts = SAFE_FONTS.map((f) => ({ value: f, label: f === 'system-ui' ? 'System default' : f }))
  return (
    <div className="flex flex-col gap-4">
      <Section title="Colors">
        {(Object.keys(COLOR_LABELS) as (keyof Theme['colors'])[]).map((c) => (
          <Input
            key={c}
            type="color"
            label={COLOR_LABELS[c]}
            value={t.colors[c]}
            disabled={disabled}
            onChange={(e) => onChange({ ...t, colors: { ...t.colors, [c]: e.target.value } }, `theme:color:${c}`)}
          />
        ))}
        {warnings.length ? (
          <ul role="status" className="flex flex-col gap-1 rounded-md border border-warning p-2 text-xs">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Text colors meet the 4.5 to 1 contrast minimum.</p>
        )}
      </Section>
      <Section title="Fonts">
        <Select label="Headings" options={fonts} value={t.font.heading} disabled={disabled} onChange={(e) => onChange({ ...t, font: { ...t.font, heading: e.target.value as Theme['font']['heading'] } })} />
        <Select label="Body" options={fonts} value={t.font.body} disabled={disabled} onChange={(e) => onChange({ ...t, font: { ...t.font, body: e.target.value as Theme['font']['body'] } })} />
        <Select
          label="Text size"
          options={[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ]}
          value={t.font.base_size}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, font: { ...t.font, base_size: e.target.value as Theme['font']['base_size'] } })}
        />
      </Section>
      <Section title="Logo">
        <Select
          label="Logo"
          hint={hasWorkspaceLogo ? 'The workspace logo stays in sync when it changes.' : 'The workspace has no logo yet. An admin can add one in workspace settings.'}
          options={[
            { value: 'workspace', label: 'Workspace logo' },
            { value: 'custom', label: 'Custom image' },
            { value: 'none', label: 'No logo' },
          ]}
          value={t.logo.source}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, logo: { ...t.logo, source: e.target.value as Theme['logo']['source'] } })}
        />
        {t.logo.source === 'custom' ? (
          <ImageUpload label="Upload a logo" workspaceId={workspaceId} surveyId={surveyId} name="logo" disabled={disabled} onUploaded={(path) => onChange({ ...t, logo: { ...t.logo, custom_path: path } })} />
        ) : null}
        <Select
          label="Position"
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
          ]}
          value={t.logo.position}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, logo: { ...t.logo, position: e.target.value as 'left' | 'center' } })}
        />
        <Select
          label="Size"
          options={[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ]}
          value={t.logo.size}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, logo: { ...t.logo, size: e.target.value as 'sm' | 'md' | 'lg' } })}
        />
      </Section>
      <Section title="Header image">
        <ImagePicker
          value={cover}
          workspaceId={workspaceId}
          uploadUrl={imageUploadUrl ?? null}
          disabled={disabled}
          onChange={(source) => {
            if (!source) {
              const { cover_image: _c, ...rest } = t
              void _c
              onChange(rest as Theme)
              return
            }
            onChange({ ...t, cover_image: { source, height: cover?.height ?? 'short', focal_y: cover?.focal_y ?? 0.5 } })
          }}
        />
        {cover ? (
          <>
            <Select
              label="Header height"
              options={[
                { value: 'short', label: 'Short' },
                { value: 'tall', label: 'Tall' },
              ]}
              value={cover.height}
              disabled={disabled}
              onChange={(e) => onChange({ ...t, cover_image: { ...cover, height: e.target.value as 'short' | 'tall' } })}
            />
            <NumberField
              label="Focus point from top (0 to 1)"
              min={0}
              max={1}
              step={0.1}
              value={cover.focal_y}
              disabled={disabled}
              onChange={(v) => onChange({ ...t, cover_image: { ...cover, focal_y: Math.min(1, Math.max(0, v ?? 0.5)) } }, 'theme:cover:focal')}
            />
          </>
        ) : null}
      </Section>
      <Section title="Background">
        <Select
          label="Background"
          options={[
            { value: 'color', label: 'Color' },
            { value: 'image', label: 'Image' },
          ]}
          value={t.background.kind}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, background: e.target.value === 'image' && t.background.kind !== 'image' ? { kind: 'image', path: '', overlay_opacity: 0.3 } : { kind: 'color' } })}
        />
        {t.background.kind === 'image' ? (
          <>
            <ImageUpload label="Upload a background image" workspaceId={workspaceId} surveyId={surveyId} name="background" disabled={disabled} onUploaded={(path) => onChange({ ...t, background: { kind: 'image', path, overlay_opacity: t.background.kind === 'image' ? t.background.overlay_opacity : 0.3 } })} />
            <NumberField
              label="Overlay darkness (0 to 1)"
              min={0}
              max={1}
              step={0.1}
              value={t.background.overlay_opacity}
              disabled={disabled}
              onChange={(v) => t.background.kind === 'image' && onChange({ ...t, background: { ...t.background, overlay_opacity: Math.min(1, Math.max(0, v ?? 0)) } })}
            />
          </>
        ) : null}
      </Section>
      <Section title="Layout">
        <Select
          label="Progress indicator"
          options={[
            { value: 'bar', label: 'Bar' },
            { value: 'steps', label: 'Steps' },
            { value: 'percent', label: 'Percent' },
            { value: 'none', label: 'None' },
          ]}
          value={t.progress.style}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, progress: { ...t.progress, style: e.target.value as Theme['progress']['style'] } })}
        />
        <Select
          label="Progress position"
          options={[
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' },
          ]}
          value={t.progress.position}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, progress: { ...t.progress, position: e.target.value as 'top' | 'bottom' } })}
        />
        <Select
          label="Corners"
          options={[
            { value: 'none', label: 'Square' },
            { value: 'sm', label: 'Slightly rounded' },
            { value: 'md', label: 'Rounded' },
            { value: 'lg', label: 'Very rounded' },
          ]}
          value={t.corner_radius}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, corner_radius: e.target.value as Theme['corner_radius'] })}
        />
        <Select
          label="Page style"
          options={[
            { value: 'card', label: 'Card on a background' },
            { value: 'full', label: 'Full width' },
          ]}
          value={t.layout}
          disabled={disabled}
          onChange={(e) => onChange({ ...t, layout: e.target.value as 'card' | 'full' })}
        />
      </Section>
      {!disabled ? (
        <Button variant="secondary" className="self-start" onClick={onReset}>
          Reset to workspace theme
        </Button>
      ) : null}
    </div>
  )
}
