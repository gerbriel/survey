'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { clientIp } from '@/lib/public/http'
import { allowPasswordAttempt, isShareToken, loadSharedReport, sealPassword, shareCookieName, shareCookieSecret } from '@/lib/analytics/share'

/**
 * Password unlock for /r/[token] (doc 04 section 5.4). Rate limited to 5
 * attempts per 15 minutes per token and IP (the IP is hashed into the limiter
 * key and never stored). On success an HttpOnly cookie scoped to this path
 * holds the sealed password for 7 days.
 */
export async function unlockSharedReport(token: string, formData: FormData): Promise<void> {
  if (!isShareToken(token)) redirect('/')
  const password = String(formData.get('password') ?? '').slice(0, 200)
  const h = await headers()
  // S9 (R17, F1): the one shared client IP reader, never the first x-forwarded-for entry.
  const ip = clientIp(h)
  if (!(await allowPasswordAttempt(token, ip))) redirect(`/r/${token}?e=rate`)
  const ok = password ? await loadSharedReport(token, password) : null
  if (!ok) redirect(`/r/${token}?e=wrong`)
  ;(await cookies()).set(shareCookieName(token), sealPassword(password, token, shareCookieSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: `/r/${token}`,
    maxAge: 7 * 24 * 3600,
  })
  redirect(`/r/${token}`)
}
