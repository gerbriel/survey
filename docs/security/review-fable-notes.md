# Security review: Fable's own notes

Read-only observations made 2026-10-21 while the three reviewer agents worked. Merged into 07-security-review.md with their findings.

## F1. Rate limiter trusts the first x-forwarded-for entry (Medium)

`src/lib/public/http.ts` `clientIp()` returns the first comma-separated value of `x-forwarded-for`. The first entry is whatever the client sent; trusted proxies append to the right. On Vercel the platform overwrites this header with the real client IP, so this is safe there, but the stack table in 00 says any Node host works, and a self-hosted or preview deployment behind a different proxy would let a client send `X-Forwarded-For: <random>` on every request and receive a fresh rate limit bucket each time, defeating every IP keyed limit (submit create, upload mint, report abuse, resume).

Fix: prefer a platform-set header first (`x-vercel-forwarded-for` or `x-real-ip` on Vercel), then take the LAST entry of `x-forwarded-for`, and make the header policy a single config value documented in AGENTS.md. `src/app/(public)/r/[token]/actions.ts` derives the IP separately with the same first-entry logic; it should call `clientIp()`.

## F2. Rate limiter fails open on database error (Low, deliberate)

`src/lib/public/ratelimit.ts` logs and allows the request when `rate_limit_hit` fails. Deliberate per the code comment, and defensible because Turnstile is the primary bot gate. Risk: if the database is degraded, submission volume is unbounded exactly when the database is least able to absorb it. Consider failing closed for `submit:create` only, with a clear 503, and keep fail-open for `resume` saves so respondents never lose work.

## Checked and found sound

- No `format()` with `%s` and no string-built dynamic SQL in migrations 0001 to 0017.
- No `dangerouslySetInnerHTML` anywhere under src.
- All three cron routes compare `CRON_SECRET` in constant time and refuse when it is unset.
- Turnstile verification is skipped only when `NODE_ENV` is not production, and the handler refuses requests in production when the secret is missing.
- `RATE_LIMIT_SECRET` throws at startup in production when missing; a fixed dev secret is used otherwise with a warning.
