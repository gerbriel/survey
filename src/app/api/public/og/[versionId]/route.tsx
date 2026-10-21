import { ImageResponse } from 'next/og'
import { ogCardForRequest } from '@/lib/public/og'

/**
 * Generated link preview, 1200x630 (doc 02 section 4): survey title plus the
 * workspace logo and name. Used when a survey has no uploaded OG image.
 * The image is immutable per published version; cached for a day so a survey
 * moved back to draft or closed stops showing its card soon after (L7).
 */

export const dynamic = 'force-dynamic'

const SIZE = { width: 1200, height: 630 }

export async function GET(req: Request, ctx: { params: Promise<{ versionId: string }> }): Promise<Response> {
  const { versionId } = await ctx.params
  // L7: state checked by key, rate limited, misses cached for at most 60 seconds.
  const found = await ogCardForRequest(req, versionId)
  if (found.kind === 'rate_limited') {
    return new Response('Too many requests', { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': String(found.retryAfter) } })
  }
  if (found.kind === 'not_found') return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } })
  const card = found.card
  const title = card.title.length > 120 ? `${card.title.slice(0, 117)}...` : card.title
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#ffffff',
          color: '#1c1917',
          borderTop: '16px solid #1d4ed8',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {card.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img only.
            <img src={card.logoUrl} alt="" height={96} style={{ objectFit: 'contain', maxWidth: 320 }} />
          ) : null}
          <div style={{ fontSize: 32, color: '#57534e' }}>{card.workspaceName}</div>
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.15, display: 'flex' }}>{title}</div>
        <div style={{ fontSize: 28, color: '#57534e' }}>Survey</div>
      </div>
    ),
    { ...SIZE, headers: { 'cache-control': 'public, max-age=86400' } },
  )
}
