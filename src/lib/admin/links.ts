import 'server-only'
import { dashboardOrigin } from '@/lib/auth/paths'

/**
 * Absolute invite link on the dashboard host. Both platform and workspace
 * invites use /invite/{token} (the only invite segment the proxy allows).
 */
export function inviteUrl(token: string): string {
  let origin = ''
  try {
    origin = dashboardOrigin()
  } catch {
    origin = ''
  }
  return `${origin}/invite/${encodeURIComponent(token)}`
}
