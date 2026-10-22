import { privacyToolsPath } from '@/components/dashboard/nav-links'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * Old URL (before R22). Privacy tools moved under Settings; bookmarks land
 * there with their query. A route handler, not a page, so the redirect runs
 * before the workspace layout's sign-in check; the new page checks the member.
 * Decision: 307 with a relative Location, so the dashboard host is kept as
 * the browser sent it (req.url carries the internal host in dev).
 */
export async function GET(req: Request, { params }: Ctx) {
  const { slug } = await params
  return new Response(null, { status: 307, headers: { Location: privacyToolsPath(slug, '', new URL(req.url).search) } })
}
