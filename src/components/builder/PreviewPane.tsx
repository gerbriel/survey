'use client'

import { useMemo, useState } from 'react'
import { generateResponseSeed, splitDefinition, type SurveyDefinition } from '@/lib/survey'
import { SurveyRenderer, type SubmitOutcome } from '@/components/survey/renderer'
import { Button } from '@/components/ui/Button'
import { cx } from '@/components/ui/cx'
import { publicAssetUrl } from '@/lib/builder/share'

const noSubmit = async (): Promise<SubmitOutcome> => ({ ok: true })

/**
 * Preview (doc 03 section 5 and 6): the real renderer in preview mode with
 * the browser-safe half of the definition, so it behaves like the live page.
 * Desktop or 390px mobile frame. No pixels (R15), no autosave, no submit.
 */
export function PreviewPane({ definition, logoUrl }: { definition: SurveyDefinition; logoUrl?: string }) {
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [run, setRun] = useState(0)
  const [seed, setSeed] = useState(() => generateResponseSeed())
  const publicDef = useMemo(() => splitDefinition(definition).public_definition, [definition])
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Preview width">
        <Button size="sm" variant={width === 'desktop' ? 'primary' : 'secondary'} aria-pressed={width === 'desktop'} onClick={() => setWidth('desktop')}>
          Desktop
        </Button>
        <Button size="sm" variant={width === 'mobile' ? 'primary' : 'secondary'} aria-pressed={width === 'mobile'} onClick={() => setWidth('mobile')}>
          Mobile
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRun((n) => n + 1)
            setSeed(generateResponseSeed())
          }}
        >
          Restart
        </Button>
      </div>
      <div className={cx('mx-auto w-full overflow-hidden rounded-lg border border-border', width === 'mobile' ? 'max-w-[390px]' : '')}>
        <SurveyRenderer
          key={run}
          definition={publicDef}
          mode="preview"
          seed={seed}
          onSubmit={noSubmit}
          logoUrl={logoUrl}
          resolveAssetUrl={(path) => publicAssetUrl(supabaseUrl, path)}
        />
      </div>
    </div>
  )
}
