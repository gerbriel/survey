import { createBrowserClient } from '@/lib/supabase/browser'
import type { ChangeSignal } from './realtime'

/** Subscribes to responses changes for one survey. Returns the unsubscribe. */
export function subscribeToResponses(surveyId: string, onSignal: (p: ChangeSignal) => void): () => void {
  const client = createBrowserClient()
  const channel = client
    .channel(`inbox:${surveyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'responses', filter: `survey_id=eq.${surveyId}` },
      (payload) => onSignal(payload as unknown as ChangeSignal),
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
