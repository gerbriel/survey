import { PublicFooter } from '@/components/public/PublicFooter'
import { NotFoundScreen } from '@/components/public/StateScreens'

/** Unknown key and draft survey: one identical 404 (doc 02 section 3). */
export default function SurveyNotFound() {
  return <NotFoundScreen footer={<PublicFooter newTab={false} />} />
}
