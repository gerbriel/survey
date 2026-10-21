import Link from 'next/link'
import { pageCount, pageHref, type LogFilters } from './activity-view'

/** Previous and next links for a paginated log. */
export function LogPager({ path, filters, page, total, pageSize }: { path: string; filters: LogFilters; page: number; total: number; pageSize: number }) {
  const pages = pageCount(total, pageSize)
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4 text-sm">
      {page > 1 ? (
        <Link href={pageHref(path, filters, page - 1)} className="text-accent underline underline-offset-2">
          Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted">
        Page {Math.min(page, pages)} of {pages} ({total.toLocaleString('en-US')} entries)
      </span>
      {page < pages ? (
        <Link href={pageHref(path, filters, page + 1)} className="text-accent underline underline-offset-2">
          Older
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
