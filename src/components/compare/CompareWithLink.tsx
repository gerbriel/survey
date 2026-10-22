import Link from 'next/link'

/** "Compare with..." for a survey page header: opens Compare with this survey preselected as the baseline. */
export function CompareWithLink({ slug, surveyId, className = 'text-accent underline' }: { slug: string; surveyId: string; className?: string }) {
  return (
    <Link className={className} href={`/w/${encodeURIComponent(slug)}/compare?surveys=${encodeURIComponent(surveyId)}`}>
      Compare with...
    </Link>
  )
}
