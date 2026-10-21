import Link from 'next/link'

/**
 * Public footer (doc 02 section 9): organization privacy notice always, the
 * workspace notice when set, Report abuse by slug (never the alias), and the
 * plain-text Powered by line behind show_powered_by. Links open in a new tab
 * while a survey is in progress so a click never loses progress.
 */
export function PublicFooter({
  slug,
  workspaceName,
  privacyNoticeUrl,
  showPoweredBy,
  newTab = true,
  showReport = true,
}: {
  slug?: string | null
  workspaceName?: string | null
  privacyNoticeUrl?: string | null
  showPoweredBy?: boolean
  newTab?: boolean
  showReport?: boolean
}) {
  const tab = newTab ? ({ target: '_blank', rel: 'noopener noreferrer' } as const) : {}
  const workspaceUrl = privacyNoticeUrl && /^https:\/\//i.test(privacyNoticeUrl) ? privacyNoticeUrl : null
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center text-sm">
      <nav aria-label="Survey links" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        <Link href="/privacy" prefetch={false} className="underline underline-offset-2" {...tab}>
          Privacy notice
          {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
        </Link>
        {workspaceUrl ? (
          <a href={workspaceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {workspaceName ? `${workspaceName} privacy notice` : 'Workspace privacy notice'}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {showReport && slug ? (
          <Link href={`/report?s=${encodeURIComponent(slug)}`} prefetch={false} className="underline underline-offset-2" {...tab}>
            Report abuse
            {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </Link>
        ) : null}
      </nav>
      {showPoweredBy ? <p className="opacity-80">Powered by Survey</p> : null}
    </div>
  )
}
