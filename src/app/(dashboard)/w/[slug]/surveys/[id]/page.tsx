import { redirect } from 'next/navigation'

export default async function SurveyIndex({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  redirect(`/w/${encodeURIComponent(slug)}/surveys/${encodeURIComponent(id)}/edit`)
}
