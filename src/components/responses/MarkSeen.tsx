'use client'

import { useEffect } from 'react'
import { unreadStore } from './unreadStore'

/** Clears the session unread marker when a response is opened. */
export function MarkSeen({ surveyId, responseId }: { surveyId: string; responseId: string }) {
  useEffect(() => {
    unreadStore.remove(surveyId, responseId)
  }, [surveyId, responseId])
  return null
}
