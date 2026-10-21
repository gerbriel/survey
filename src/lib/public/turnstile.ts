import 'server-only'
import { normalizeHost } from '@/lib/hosts'

/**
 * Cloudflare Turnstile server verification (doc 02 section 5.1 step 4, R14).
 * One widget registered for PUBLIC_HOST. Actions: submit, upload, report.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileAction = 'submit' | 'upload' | 'report'

export type TurnstileResult = { ok: true; skipped?: boolean } | { ok: false; reason: string }

type SiteverifyResponse = {
  success?: boolean
  action?: string
  hostname?: string
  'error-codes'?: string[]
}

/** Cloudflare's documented test secrets start with 1x, 2x or 3x followed by zeros. */
export function isTestSecret(secret: string): boolean {
  return /^[123]x0{20,}/.test(secret)
}

let warned = false

export async function verifyTurnstile(opts: {
  token: string | undefined
  ip: string
  action: TurnstileAction
  idempotencyKey?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<TurnstileResult> {
  const env = opts.env ?? process.env
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) {
    if (env.NODE_ENV !== 'production') {
      if (!warned) {
        warned = true
        console.warn(
          '\n[public] ************************************************************\n' +
            '[public] TURNSTILE_SECRET_KEY is not set. Captcha checks are SKIPPED.\n' +
            '[public] This only happens outside production. Set the test keys from .env.example.\n' +
            '[public] ************************************************************\n',
        )
      }
      return { ok: true, skipped: true }
    }
    console.error('[public] TURNSTILE_SECRET_KEY is not set in production; refusing the request.')
    return { ok: false, reason: 'not_configured' }
  }
  if (!opts.token || opts.token.length > 2048) return { ok: false, reason: 'missing_token' }

  const body = new URLSearchParams({ secret, response: opts.token, remoteip: opts.ip })
  if (opts.idempotencyKey) body.set('idempotency_key', opts.idempotencyKey)
  let data: SiteverifyResponse
  try {
    const res = await (opts.fetchImpl ?? fetch)(SITEVERIFY_URL, { method: 'POST', body, cache: 'no-store' })
    data = (await res.json()) as SiteverifyResponse
  } catch (e) {
    console.error('[public] Turnstile siteverify failed', e)
    return { ok: false, reason: 'network' }
  }
  if (!data.success) return { ok: false, reason: (data['error-codes'] ?? ['failed']).join(',') }
  // Decision: Cloudflare test secrets answer with a fixed action and hostname
  // ("test", "example.com"), so the action and hostname checks apply to real
  // secrets only.
  if (!isTestSecret(secret)) {
    if (data.action !== opts.action) return { ok: false, reason: 'action_mismatch' }
    const expected = normalizeHost(env.PUBLIC_HOST)
    if (!expected || normalizeHost(data.hostname) !== expected) return { ok: false, reason: 'hostname_mismatch' }
  }
  return { ok: true }
}
