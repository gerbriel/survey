import { toCsv } from './csv'

/**
 * Personalized respondent links (doc 04 section 1.5 step 6). The public page
 * lives at PUBLIC_HOST/{slug} (R15; the dashboard only redirects /s/{key}), so
 * links point straight at the public host.
 *
 * Decision: links use `https://{PUBLIC_HOST}/{slug}?t={token}`, not the
 * `/s/{slug}` form in the doc 04 example, which the public host does not serve.
 */
export function publicSurveyLink(
  publicHost: string,
  slug: string,
  token: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const host = publicHost.trim().replace(/\/+$/, '')
  if (!host) throw new Error('PUBLIC_HOST is not set (see .env.example)')
  const protocol = nodeEnv === 'development' ? 'http' : 'https'
  return `${protocol}://${host}/${encodeURIComponent(slug)}?t=${encodeURIComponent(token)}`
}

export type LinkRow = {
  email: string | null
  first_name: string | null
  last_name: string | null
  company: string | null
  link: string
}

export const LINK_CSV_HEADER = ['email', 'first_name', 'last_name', 'company', 'survey_link']

export function linksCsv(rows: LinkRow[]): string {
  return toCsv(
    LINK_CSV_HEADER,
    rows.map((r) => [r.email, r.first_name, r.last_name, r.company, r.link]),
  )
}
