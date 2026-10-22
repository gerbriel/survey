import { privacyToolsPath } from '@/components/dashboard/nav-links'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * Old export URL (before R22). Redirects to the Settings path with the same
 * query; the new route re-checks the member and role. Same 307 and relative
 * Location as the sibling route.ts.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { slug } = await params
  return new Response(null, { status: 307, headers: { Location: privacyToolsPath(slug, 'export', new URL(req.url).search) } })
}
