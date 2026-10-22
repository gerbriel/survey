import { SectionTabs } from '@/components/dashboard/SectionTabs'
import { resultsTabs } from '@/components/dashboard/nav-links'

/**
 * Results area (R22): one tab bar over Responses (/results), Compare
 * (/compare) and Contacts (/contacts). The route group keeps those URLs
 * unchanged. Each page still renders its own PageHeader and checks its own
 * role; all three are viewer and above, so every member sees every tab.
 *
 * Decision: the bar sits above the page header at the widest page width
 * (max-w-7xl) with the same side padding as the pages, so it lines up with
 * Responses and Compare; narrower Contacts subpages center under it.
 */
export default async function ResultsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <SectionTabs links={resultsTabs(slug)} label="Results sections" className="mb-0" />
      </div>
      {children}
    </>
  )
}
