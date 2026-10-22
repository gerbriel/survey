# 04. CRM, analytics, reports, exports, privacy

Builds on `00-decisions.md`. Table shapes for `contacts`, `contact_notes`, `events`, `responses`, and `answers` come from `01-data-model.md` and are not redefined here. Anything extra this doc needs is listed under "Schema additions requested"; doc 01 is now the source of truth for those names (00 R11).

Hard rule carried from 00: the app never sends email. Every "follow-up" feature below records intent and state. A member does the actual outreach outside the product.

## 1. Contacts as a lightweight CRM

### 1.1 Contact list

Route: `/w/{workspace}/contacts`. A server-paginated table (50 rows, keyset on `updated_at, id`).

Default columns: name, email, phone, company, lead status, owner, tags, response count, last response at. Members can add any custom field as a column.

Filters (AND): lead_status, owner (incl. unassigned, me), tags (any/all/none), source, responded or not to survey X, custom field (per-type operators), created_at and last_response_at ranges, follow_up_at (overdue, this week, unset), and free text across email, name, company, phone.

Merged contacts and tombstones are hidden from every list.

**Saved views** store filters, columns, and sort, personal or shared. Three built-in shared views: "All contacts", "My leads" (owner = me, status not in customer/lost), "Follow-up due" (follow_up_at <= today).

```ts
type ContactViewFilters = {
  lead_status?: LeadStatus[];
  owner?: { ids?: string[]; unassigned?: boolean; me?: boolean };
  tags?: { mode: 'any' | 'all' | 'none'; values: string[] };
  responded?: { survey_id: string; has: boolean; complete_only: boolean }[];
  custom?: { key: string; op: string; value?: unknown }[];
  q?: string;
};
```

The list query is one SQL function `search_contacts(workspace_id, filters jsonb, cursor, limit)` (SECURITY INVOKER, so RLS applies), which builds a parameterized WHERE clause.

### 1.2 Pipeline and kanban

`lead_status` is a plain enum field, fixed in v1. Every change writes `activity_log` `{from, to}` and sets `lead_status_changed_at`.

Optional kanban (`/contacts?view=board`): one column per status, drag to change status, same filters as the list, 200 cards per column then a "show in list" link.

### 1.3 Contact detail page and cross-survey timeline

Route: `/w/{workspace}/contacts/{id}`. If `{id}` is a merged contact, the page follows `merged_into` to the survivor and redirects (old bookmarks keep working).

Header with core fields, status, owner, follow-up; side column for tags, custom fields, notes; main column for the timeline. The timeline is the headline feature: every response this person gave across every survey in the workspace, newest first, interleaved with CRM events.

Timeline item types:

- `response`: survey, version, status, date, identity source badge, first 3 answers inline (expandable).
- `note` from `contact_notes`; `status_change`, `owner_change`, `merge`, `token_issued`, `imported` from `activity_log`.

```sql
-- timeline page, keyset paginated on (at, id)
select 'response' as kind, r.id, coalesce(r.submitted_at, r.started_at) as at,
       jsonb_build_object('survey_id', r.survey_id, 'version_id', r.survey_version_id,
                          'status', r.status, 'identity_source', r.metadata->>'identity_source') as data
from responses r
where r.contact_id = $1
union all
select 'note', n.id, n.created_at, jsonb_build_object('author', n.author, 'body', n.body)
from contact_notes n where n.contact_id = $1
union all
select 'activity:' || a.action, a.id, a.created_at, a.diff
from activity_log a where a.entity = 'contact:' || $1::text
order by at desc, id desc
limit 30;
```

Answers for visible responses load in a second query, labeled from each version's `questions` snapshot.

### 1.4 Tags, notes, custom fields, owner, follow-up

- **Tags**: lowercased, trimmed, max 40 chars, workspace autocomplete, bulk add/remove.
- **Notes**: markdown-lite, edited by the author, deleted by author or admin. Included in the GDPR export.
- **Custom fields**: values in `contacts.custom` by `key`, validated by `set_contact_custom()` against the workspace registry `contact_field_defs` (key, label, type `text|number|date|select|multiselect|boolean|url`, options, position, archived). Archiving hides but keeps data; labels change, keys never do.
- **Owner**: `owner_id`, a workspace member. Contacts become unassigned when the member leaves.
- **Follow-up**: `follow_up_at` date plus `follow_up_note`. A reminder in "Follow-up due" and on the dashboard. Nothing is sent.

### 1.5 CSV import

Wizard at `/contacts/import`, editor role and above:

1. **Upload**: CSV up to 10 MB / 50,000 rows (defaults; a platform admin may raise them per workspace through `workspace_limits`), previewed in the browser with Papa Parse.
2. **Map columns** to email, phone, names, company, lead_status, tags (split on `;` or `,`), owner (by member email), a custom field (or create one inline), or ignore. Auto-mapped by header.
3. **Dedupe** on normalized email only. On match: skip, fill empty fields (default), or overwrite. Tags union. In-file duplicates collapse to the first row.
4. **Defaults**: tags for every row (suggested `import-2026-10-21`), status, owner.
5. **Run**: the file goes to Storage, the server processes chunks of 500 via `import_contacts_chunk()`, and `contact_imports` tracks created, updated, skipped, invalid. Invalid rows download as CSV with an `error` column.
6. **Generate links (optional)**: pick a survey with a published version and `max_responses` (default 1). Each contact gets a `respondent_tokens` row (22-char base64url from `gen_random_bytes(16)`), reusing an unused existing token. Result downloads as CSV:

```
email,first_name,last_name,company,survey_link
ana@acme.com,Ana,Lopez,Acme,https://{public-host}/s/k3m9x2p7qa?t=Xk3...
```

Links use the fixed public survey hostname from 00 (R15); there are no custom domains. The workspace distributes them however it wants. There is no limit on contacts or generated links in v1. "Generate links" also works on any list selection or saved view.

### 1.6 Contact export

CSV of the filtered list or a selection, editor and above (viewers can read contacts but not export them): core fields, owner email, tags joined with `;`, source, timestamps, response_count, then one column per custom field. Logged in `activity_log` per section 6. Section 6 streaming rules apply.

## 2. Identity resolution

### 2.1 Priority order

Resolved once inside the submission SQL function (doc 02 owns the handler, this doc owns the rules). First match wins:

1. **Token** (`?t=`): valid, not exhausted `respondent_tokens` row for this survey. `contact_id` comes from the token, following `merged_into` to the survivor. `respondent_token_id` is set. `identity_source = 'token'`.
2. **Identity-key answer**: the survey's marked email question (optionally phone). Normalize, match an existing live contact, else create one. `identity_source = 'identity_answer'`.
3. **Hidden field**, only when the survey setting `trust_hidden_identity` is true (default **false**, 00 R6): `?contact={uuid}` matched to a live contact in this workspace (via merged_into chain), else `?email=` normalized and matched or created. `identity_source = 'hidden_field'`. When the setting is off, these params are captured into `metadata.hidden` like any other hidden field and never link a contact.
4. **Nothing**: `contact_id` null, response is anonymous.

Conflict: token plus a different identity-answer email keeps the response on the token's contact, never overwrites its email, and records the other email in `metadata.alt_email`, which feeds "Possible duplicates".

`identity_source` lives in `responses.metadata`. Hidden-field identity is badged "unverified" since anyone can edit a URL: the response carries the badge, and so does the contact while every response linking it came through a hidden field.

### 2.2 Matching rules

- **Email**: `lower(trim(email))`, stored normalized. Gmail dot and plus variants are not merged automatically, only flagged as possible duplicates. Invalid syntax counts as absent.
- **Phone**: `libphonenumber-js` with the workspace default country, stored E.164 (`+15595551234`). Unparseable phones stay in the answer only. Phone matches only when it is the identity key, no email was given, and exactly one live contact has it; zero creates, two or more leave the response unlinked (households share numbers).
- **Uniqueness**: one live contact per email per workspace (partial unique index); upsert via `on conflict` so concurrent submissions never duplicate.

### 2.3 Auto-create vs anonymous

| Situation | Result |
|---|---|
| Valid token | Existing contact, never creates |
| Identity answer with valid email | Match or create (`source = 'identity_answer'`) |
| `?contact=` or `?email=` with `trust_hidden_identity` off (default) | Captured in metadata only, no link |
| `?contact=` unknown id | Ignored, falls to next rule |
| `?email=` valid, `trust_hidden_identity` on | Match or create (`source = 'hidden_field'`), contact badged unverified |
| Partial response | Never creates a contact. Identity resolves on completion only. |
| Nothing | Anonymous |

Questions may map to contact fields (names, company, phone, custom) through the builder's `contact_field` setting (doc 03). They fill empty fields only, never overwrite.

### 2.4 Possible duplicates

`/contacts/duplicates` lists candidate pairs from `contact_duplicate_candidates(workspace_id)`:

- same E.164 phone,
- same lower(first_name || last_name) and same lower(company), both non-empty,
- emails equal after stripping Gmail dots and `+tag`,
- a response's `metadata.alt_email` matches another contact,
- email local part trigram similarity > 0.8 with the same domain (`pg_trgm`).

Each pair shows the reason, both contacts side by side, "Merge" and "Not a duplicate" (persisted in `contact_duplicate_dismissals`). Computed on demand, capped at 500 pairs.

### 2.5 Merge flow

Editor and above, from a duplicate pair or 2 to 5 selected contacts.

1. **Pick survivor**. Default: the oldest contact with the most responses.
2. **Resolve conflicts field by field**: one row per differing core or custom field, survivor preselected. Tags union, notes all kept, lead_status preselects the most advanced (lost only if all are lost).
3. **Confirm** with a summary: "12 responses, 3 notes, 2 links move to Ana Lopez".
4. `merge_contacts(survivor_id, loser_ids[], field_choices jsonb)` runs in one transaction:

```sql
update responses         set contact_id = $survivor where contact_id = any($losers);
update contact_notes     set contact_id = $survivor where contact_id = any($losers);
update respondent_tokens set contact_id = $survivor where contact_id = any($losers);
update contacts set merged_into = $survivor, email = null, updated_at = now()
  where id = any($losers);           -- frees the unique email slot
update contacts set ... /* chosen fields */ where id = $survivor;
insert into contact_aliases (workspace_id, contact_id, alias_email, merged_contact_id)
  select ...;                         -- losers' old emails
insert into activity_log (...) values (..., 'contact.merge', jsonb_build_object('losers', $losers, 'choices', $choices));
```

Loser rows stay with `merged_into` set, so `?contact={loser}` and `/contacts/{loser}` resolve to the survivor. Losers' emails go to `contact_aliases`, which email matching checks second. Tokens were reparented, so distributed links keep working. No undo in v1; the activity_log diff allows manual reconstruction.

## 3. Event emission from the public page

### 3.1 respondent_hash

On first render the client generates a random 128-bit id (`crypto.getRandomValues`, base64url) and keeps it in `sessionStorage` as `rid:{survey_id}`. That is `respondent_hash`. It is never derived from IP, user agent, or any device trait. A new tab is a new visitor; we accept the overcount.

On submit the client sends `rid`; the submission function stores `metadata.rid` and sets `events.response_id` for that rid. That is the only link between events and responses.

### 3.2 Which events fire when

| Event | When | meta |
|---|---|---|
| `view` | survey definition rendered (once per rid) | `{referrer_host, device, utm}` |
| `start` | first interaction with any question (focus or answer), once | `{}` |
| `question_view` | a question enters the viewport for the first time (IntersectionObserver, 50% visible); one-question-per-page layouts fire on show | `{page, position}` |
| `question_answer` | value committed (blur, select, or next), once per question per rid, re-fires only if changed from empty to filled | `{page}` no values ever |
| `page_next` / `page_back` | page navigation | `{from_page, to_page}` |
| `file_upload` | upload finished | `{size_bucket, mime}` |
| `complete` | server confirms submission | emitted server side by the submission function, not the client |
| `abandon` | `pagehide` or `visibilitychange: hidden` after `start` and before `complete` | `{last_question_key, page}` |

Events never carry answer values, emails, or free text. `meta.device` is `mobile | tablet | desktop` only.

These first-party events use no cookies and no third-party scripts, so they do not wait on pixel consent. Third-party pixels follow the workspace `pixel_consent_mode` (`banner`, `notice`, `in_form`, 00 R7, doc 02). The submission function records the outcome in `metadata.pixel_consent` as `{ mode, state }`, with `state` one of `granted`, `denied`, `not_asked` (no pixel would load).

### 3.3 Batching and the beacon endpoint

- The client queue flushes every 5 seconds, on navigation, or at 20 events via `fetch('/api/e', {method: 'POST', keepalive: true})`.
- On `pagehide` or hidden visibility, the queue plus `abandon` goes out with `navigator.sendBeacon('/api/e', blob)`, once per rid. A later `complete` wins.
- The beacon endpoint is served same origin as the public page, on the public hostname (00 R15); the path `/api/e` is illustrative and doc 02 owns the final route. It accepts up to 50 events, checks the survey is open and the version published, drops unknown types, clamps `occurred_at` to 10 minutes of server time, rate limits in Postgres (300 per rid per hour, 10,000 per survey per minute), and bulk inserts with the service role. Always 204. No Turnstile.
- Beacons are unreliable on mobile, so analytics treat any rid with `start`, no `complete`, and 24 hours of age as abandoned.

### 3.4 Sampling and retention

No sampling in v1. Raw events live 180 days, then a nightly pg_cron job (7.5, 00 R3) rolls them into `event_daily` and deletes them. Older funnels read the rollup. Events also go with their response and their survey.

## 4. Analytics per survey

`/w/{workspace}/surveys/{id}/results`, viewer and above. All numbers come from SQL functions running as the caller (RLS applies).

### 4.1 Per question type

| Type | Summary |
|---|---|
| single choice, dropdown, yes/no | count and % per option, "other" text listed |
| multi choice | count and % of respondents per option (sums can exceed 100%) |
| number, slider | n, mean, median, min, max, histogram (auto bins) |
| rating, scale | mean, median, distribution bar per value |
| NPS | score, promoters (9-10), passives (7-8), detractors (0-6), distribution 0-10 |
| open text | response count, top 50 words (stopwords removed), latest 20 answers |
| matrix | heat table rows x columns, cell = count and row % |
| ranking | average position per item (lower is better), % ranked first |
| date | earliest, latest, histogram by month |
| file upload | count, list of files |

```sql
-- NPS for one question_key under the current filter set
with s as (
  select a.value_number as v
  from answers a join filtered_responses($survey, $filters) r on r.id = a.response_id
  where a.question_key = $key and a.value_number is not null
)
select count(*)                                   as n,
       count(*) filter (where v >= 9)             as promoters,
       count(*) filter (where v between 7 and 8)  as passives,
       count(*) filter (where v <= 6)             as detractors,
       round(100.0 * (count(*) filter (where v >= 9) - count(*) filter (where v <= 6))
             / nullif(count(*), 0))               as nps
from s;
```

```sql
-- word frequency for open text
select w, count(*) as n
from answers a
join filtered_responses($survey, $filters) r on r.id = a.response_id,
lateral regexp_split_to_table(lower(a.value_text), '[^[:alnum:]'']+') as w
where a.question_key = $key and length(w) > 2
  and w not in (select word from stopwords where lang = 'en')
group by w order by n desc limit 50;
```

`filtered_responses(survey_id, filters jsonb)` applies the 4.3 filters and backs every widget.

### 4.2 Funnel metrics

- **Completion rate**: distinct rids with `complete` / distinct rids with `start`. Also shown: views to starts.
- **Median time to complete**: `percentile_cont(0.5) within group (order by submitted_at - started_at)` over complete responses.
- **Responses over time**: complete responses per day (or week when the range exceeds 90 days), partials as a second series.
- **Device split**: `responses.metadata.device` for complete responses, `events.meta.device` on `view` for the funnel.

Drop-off per question: for each rid that started, find the furthest question it viewed, then count how many stopped there.

```sql
with q as (                     -- question order from the version snapshot
  select question_key, position from version_questions($version)
),
reached as (
  select e.respondent_hash, max(q.position) as last_pos,
         bool_or(e.type = 'complete') as completed
  from events e left join q using (question_key)
  where e.survey_version_id = $version
    and e.occurred_at between $from and $to
    and e.type in ('start', 'question_view', 'complete')
  group by e.respondent_hash
  having bool_or(e.type = 'start')
)
select q.question_key, q.position,
       count(*) filter (where r.last_pos >= q.position)                  as reached,
       count(*) filter (where r.last_pos = q.position and not completed) as dropped_here
from q left join reached r on true
group by q.question_key, q.position
order by q.position;
```

Per page drop-off groups by `meta->>'page'` instead. Branching means not every rid sees every question, so the chart says "reached", not a strict funnel. Funnels are per version; with "all versions" selected it shows the latest with a note.

### 4.3 Filters

- **Date range**: 7d, 30d, 90d, all, custom.
- **Version**: latest published (default), one version, or all.
- **Contact attributes**: lead_status, tags, owner, custom fields. Excludes anonymous responses, and the UI says so.
- **Answer to another question**: "X is any of [options]" or a number range. Any choice widget can switch to cross-tab: rows are its options, columns another question's options, cells count and column %.
- **Identity**: all, token, identified, anonymous. **Status**: complete (default) or include partials.

Event metrics (funnel, drop-off, views) honor date and version only, since non-submitters have no answers or contact. The funnel card says so when such a filter is active.

### 4.4 Cross-version reporting

Answers group by `question_key`. Across versions each widget compares snapshots (type, option ids, matrix rows and columns, scale bounds). Any difference shows a yellow banner, for example "Options changed between v2 and v4: 'Very likely' added in v4". An option's percentage uses only responses from versions that offered it (tooltip explains). If the type changed, the widget refuses to combine and asks for one version.

## 5. Reports

### 5.1 Saved reports

A report belongs to a survey: name, saved filters, ordered widgets. Each widget binds a `question_key` (or funnel metric) to a chart type (`bar`, `stacked_bar`, `pie`, `table`, `histogram`, `nps_gauge`, `heat_table`, `word_list`, `line`, `stat`), with optional cross-tab key and title. Editors edit, viewers read.

### 5.2 Default report

Generated on the fly: completion card, responses over time, then one widget per question of the latest version with its type's default chart. "Customize" materializes it (`is_default = true`); until then new questions appear automatically.

### 5.3 Workspace dashboard

`/w/{workspace}` home, fixed widgets in v1: responses this week vs last, open surveys with 7-day responses and completion rate, new contacts this week by source, leads by status, follow-ups due and overdue, surveys closing within 7 days.

### 5.4 Public share links

`report_shares(report_id, token, expires_at, password_hash nullable, revoked_at)`. Editors create them with optional expiry (default 30 days) and password, then copy the `/r/{token}` link (22-char random token; hostname per 00 R15). Revoke is immediate. No limit on share links per report in v1.

**Why this is a second permission surface.** Everywhere else authorization is RLS on membership. A share viewer has no account, so `/r/{token}` reads with the service role, which bypasses RLS. Every guarantee must be re-established in code with no backstop; a bug leaks across tenants.

**How it stays safe.**

1. The route holds no query logic. It calls one SECURITY DEFINER function `shared_report_payload(token, password)` that validates the share (exists, not revoked, not expired, password via `crypt()`) and derives report, survey, and workspace from the share row, never from request input.
2. It returns pre-aggregated widget data only: counts, percentages, means, NPS, word frequencies, funnel counts. Never rows from `answers`, `responses`, `contacts`, never file URLs, never open text verbatims.
3. Filters are frozen to the report's saved filters, so viewers cannot slice down to an individual. Cells under 3 responses render as "<3".
4. Password attempts are rate limited (5 per 15 minutes per token and IP; the IP is used for the check, not stored). Success sets an HttpOnly cookie scoped to `/r/{token}` with an HMAC of `token + password_hash`, so a password change invalidates it.
5. `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, no tracking pixels. Unknown, revoked, and expired tokens return the same 404.
6. A test asserts the payload contains no keys outside an allow-list.

### 5.5 Results hub and Compare

`/w/{workspace}/results` lists responses across surveys with the 4.3 filters plus status, hidden field or UTM value and a bounded open-text search; its bulk export (editor and above) writes one CSV with a survey column and the union of question_key columns, or one XLSX with a sheet per survey plus Summary and Combined. `/w/{workspace}/compare` (viewer and above) puts two to five surveys side by side, matching questions by question_key, then by normalized label plus type, and refuses to combine questions whose types differ. Differences are against the first survey and are withheld when either side has fewer than 3 answers.

## 6. Exports

Exports run server side in route handlers using the member's session (RLS applies).

- **Row-level exports** (responses CSV/XLSX, contact CSV) require editor or above.
- **Aggregate exports** (report summaries, chart data) are open to viewers.
- **Every export**, aggregate or row-level, writes an `activity_log` entry with the actor, the survey or contact view, the filter used, and the row count.

### 6.1 Responses CSV

One row per response: `response_id, status, started_at, submitted_at, version, contact_id, contact_email, identity_source, token`, then hidden fields and UTM, then one column per `question_key` in latest-version order (older-only keys appended). Optional second header row with labels.

- Multi-select: option labels joined with `; `.
- Matrix: one column per row, `{question_key}.{row_id}`.
- Ranking: items joined in ranked order with ` > `.
- Files: `/f/{file_id}` on the dashboard hostname (00 R15), which requires a signed-in member and redirects to a short-lived signed URL.
- Cells starting with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'` (CSV injection).
- UTF-8 with BOM for Excel.

### 6.2 XLSX

Editor and above. Same Responses sheet plus Summary (4.1 numbers per question) and Questions (key, label, type, versions). `exceljs` streaming writer.

### 6.3 PDF

**v2.** In v1 report pages get a print stylesheet for browser "Print to PDF".

### 6.4 Streaming and large exports

- Up to 5,000 responses: streamed directly (`ReadableStream`, keyset pages of 1,000).
- Above that (XLSX above 2,000): an `export_jobs` row; the route (maxDuration 300s) writes to the private `exports` bucket, saving a cursor so the next poll resumes if time runs out. The UI polls, then downloads via a 1-hour signed URL. Files expire after 7 days. No queue.

## 7. Privacy controls

### 7.1 Workspace privacy settings

`/w/{workspace}/settings/privacy`, admin and owner:

| Setting | Default | Notes |
|---|---|---|
| Store respondent IP | off | Into `metadata.ip`. Turning off does not purge; "Remove stored IPs" does. |
| Response retention | keep forever | Or N days (30 to 3650). Previews how many the next run deletes. |
| Event retention | 180 days | Fixed in v1, shown for transparency. |
| Consent default text | "I agree that {workspace name} may store my answers to this survey and contact me about it." | Pre-fills the builder's consent block. |
| Pixel consent mode | banner | Workspace enum `pixel_consent_mode`: `banner`, `notice`, `in_form` (00 R7). Doc 02 owns behavior; shown here with the other privacy settings. |

Changes write `activity_log`.

### 7.2 Respondent deletion

`/settings/privacy/respondents`, admin and owner:

1. **Find** by email (contacts, aliases, and email answers on anonymous responses), token, contact, or response id.
2. **Review**: N responses across M surveys, notes, tokens, files.
3. **Choose** *hard delete* (responses, answers, events, files, notes, tokens, aliases, contact row) or *anonymize* (keep responses for aggregates, strip identity per 7.4, tombstone the contact).
4. **Confirm** by typing the email or `DELETE`.
5. `erase_respondent(target, mode)` runs in one transaction and returns Storage paths for the route to delete. `activity_log` records actor, mode, counts, and a sha256 of the email, not the email.

The tombstone follows Fresno Skillshare migration 00004 (`../barter-fresno/supabase/migrations/00004_account_deletion.sql`): erase the person, keep shared history. The contact row stays with `status = 'deleted'` and personal fields nulled, so anonymized responses keep a valid `contact_id` without identifying anyone. Tombstones are hidden, skipped by resolution, and their tokens are deleted.

### 7.3 GDPR export for one respondent

Same finder, "Export data" button, editor and above (deletion stays admin and owner). Respondent self-export through a link is out of scope for v1: with no email provider there is no way to verify the requester. A workspace editor runs the export on the respondent's behalf. Produces a JSON file:

```json
{
  "exported_at": "2026-10-21T18:00:00Z",
  "workspace": "Acme",
  "contact": { "email": "...", "phone": "...", "first_name": "...", "custom": {}, "tags": [], "lead_status": "qualified" },
  "notes": [ { "created_at": "...", "body": "..." } ],
  "responses": [
    { "survey": "Spring feedback", "version": 3, "submitted_at": "...", "metadata": {},
      "answers": [ { "question_key": "q_nps", "label": "How likely...", "value": 9 } ] }
  ],
  "files": [ { "question_key": "q_cv", "name": "cv.pdf", "url": "signed, 7 days" } ]
}
```

The editor downloads it and delivers it themselves. Logged.

### 7.4 What "anonymize" means, field by field

| Data | Anonymize action |
|---|---|
| contacts.email, phone, first_name, last_name, company | null |
| contacts.custom, tags | `{}`, `{}` |
| contacts.lead_status, owner_id, follow_up_* | lead_status set to `lost`; owner_id and follow_up fields null |
| contacts.status | `deleted` (tombstone) |
| contact_notes | deleted |
| contact_aliases | deleted |
| respondent_tokens | deleted |
| responses.metadata | drop `ip`, `user_agent`, `email`, `contact`, `alt_email`, `rid`, every hidden field; keep `device`, `utm_*`, `identity_source`, `pixel_consent` |
| responses.raw | replaced with the redacted answer set |
| answers to identity-key, email, phone, any question with a `contact_field` mapping, and any question flagged `pii` in the builder | deleted |
| answers to open text questions | deleted (free text can identify) |
| other answers (choice, rating, NPS, number, matrix, ranking, date) | kept |
| file uploads | files deleted from Storage, answers deleted |
| events | `response_id` set null, `respondent_hash` set null |
| activity_log | kept; diffs for this contact rewritten to `{"redacted": true}` |

### 7.5 Retention job

**Decision: Vercel Cron calls `/api/cron/retention` daily at 03:00 UTC** with `CRON_SECRET`. Storage files must be deleted through the Storage API (deleting `storage.objects` rows orphans the files); pg_cron would need `pg_net` calling back into the app anyway.

The route loops per workspace with retention set:

1. `retention_batch(workspace_id, 1000)` deletes up to 1,000 responses older than `retention_days` (by `coalesce(submitted_at, started_at)`), cascading answers and events, and returns file paths.
2. The route deletes the files and repeats until empty or 250s pass.
3. Deletes export files older than 7 days and import CSVs older than 30.
4. Logs counts per workspace.

Pure SQL housekeeping runs on pg_cron instead (00 R3): the nightly `event_daily` rollup and deletion of raw events older than 180 days, rate limit and idempotency pruning, and activity log pruning. Nothing on pg_cron touches Storage.

Response retention never deletes contacts; those are CRM records.

## 8. Lead management boundary

A survey tool with a lightweight CRM for tracking who answered what, not a sales platform. Out of scope:

- No email of any kind: no sequences, drips, newsletters, reminders, or send buttons. A `mailto:` link is the limit.
- No SMS, calling, dialer, or call logging.
- No deals, opportunities, revenue, pipeline value, forecasting, or quotes.
- No calendar, meeting booking, or scheduling.
- No tasks or to-do system beyond the single `follow_up_at` date per contact.
- No lead scoring engine, enrichment, or third-party data lookups.
- No custom pipeline stages in v1 (fixed lead_status enum).
- No two-way CRM sync (HubSpot, Salesforce) in v1. CSV export is the integration.
- No company/account objects; `company` is a text field.

## 9. Schema additions requested

Doc 01 is now the source of truth for these names and types (00 R11); this section is the record of what it absorbed.

For `01-data-model.md` to add (shapes from the brief left untouched):

```sql
-- contacts
alter table contacts add column owner_id uuid references auth.users(id);
alter table contacts add column status text not null default 'active'
  check (status in ('active', 'deleted'));               -- tombstone
alter table contacts add column follow_up_at date;
alter table contacts add column follow_up_note text;
alter table contacts add column lead_status_changed_at timestamptz;
alter table contacts add column last_response_at timestamptz;  -- maintained by submission fn
create unique index contacts_ws_email_live on contacts (workspace_id, email)
  where email is not null and merged_into is null and status = 'active';
create index contacts_ws_phone on contacts (workspace_id, phone) where phone is not null;
create index contacts_tags on contacts using gin (tags);
create index contacts_custom on contacts using gin (custom jsonb_path_ops);

create table contact_field_defs (id uuid pk, workspace_id uuid, key text, label text,
  type text check (type in ('text','number','date','select','multiselect','boolean','url')),
  options jsonb, position int, archived boolean default false, unique (workspace_id, key));
create table contact_views (id uuid pk, workspace_id uuid, name text, filters jsonb,
  columns text[], sort jsonb, shared boolean default false, builtin boolean default false,
  created_by uuid);
create table contact_aliases (id uuid pk, workspace_id uuid, contact_id uuid,
  alias_email text, merged_contact_id uuid, created_at timestamptz);
create table contact_duplicate_dismissals (workspace_id uuid, contact_a uuid, contact_b uuid,
  dismissed_by uuid, created_at timestamptz, primary key (workspace_id, contact_a, contact_b));
create table contact_imports (id uuid pk, workspace_id uuid, created_by uuid, storage_path text,
  mapping jsonb, options jsonb, status text, created int, updated int, skipped int, invalid int,
  token_survey_id uuid null, created_at timestamptz, finished_at timestamptz);

-- events
create index events_rid on events (survey_id, respondent_hash);
create index events_version_time on events (survey_version_id, occurred_at);
create table event_daily (survey_version_id uuid, day date, type text, question_key text,
  count int, distinct_rids int, primary key (survey_version_id, day, type, question_key));

-- reports
create table reports (id uuid pk, workspace_id uuid, survey_id uuid, name text,
  is_default boolean default false, filters jsonb, created_by uuid, updated_at timestamptz);
create table report_widgets (id uuid pk, report_id uuid, position int, question_key text null,
  metric text null, chart_type text, cross_tab_key text null, options jsonb);
alter table report_shares add column created_by uuid, add column view_count int default 0,
  add column last_viewed_at timestamptz, add column created_at timestamptz default now();

-- exports
create table export_jobs (id uuid pk, workspace_id uuid, survey_id uuid null, kind text,
  format text, filters jsonb, status text, cursor jsonb, storage_path text, row_count int,
  created_by uuid, created_at timestamptz, finished_at timestamptz);

-- workspace settings
-- workspaces (or workspace_settings): store_ip boolean default false,
--   retention_days int null, consent_default_text text, default_country text default 'US'
--   (pixel_consent_mode enum is 00 R7, owned by doc 02/05)
-- surveys: trust_hidden_identity boolean not null default false
--   (00 R6; replaces the earlier create_contacts_from_url proposal)

create table stopwords (lang text, word text, primary key (lang, word));
```

Requested of other docs:

- **responses.metadata keys** (doc 01/02 to standardize): `rid`, `identity_source`, `alt_email`, `device`, `user_agent`, `ip`, `utm_*`, `hidden` (object of hidden fields), `pixel_consent` (`{ mode, state }`).
- **Doc 02**: submission function sets `metadata.device` from UA, links events by rid, emits the `complete` event, updates `contacts.last_response_at`, skips tombstoned and merged contacts (following merged_into), checks `contact_aliases`.
- **Doc 03**: question config `contact_field` (mapping target) and `pii: boolean` flag; choice options carry stable option ids for cross-version comparison. Done in doc 03.
- RLS: all new tables use `is_member(workspace_id, 'viewer')` for select, `'editor'` for writes; privacy settings and `erase_respondent` require `'admin'`; row-level exports and the GDPR export require `'editor'`; `report_shares` has no anon policy at all.

## 10. Decisions made here

- **Lead statuses are a fixed enum in v1.** Dashboard and kanban depend on known values.
- **Email is the only hard match key; phone matches only when unique.** Phones are shared within households.
- **Partial responses never create contacts.** Avoids junk contacts from abandoned forms.
- **Token wins over a conflicting identity answer, which is recorded as alt_email.** The token is the only verified join.
- **Hidden-field identity is off by default (`trust_hidden_identity`, 00 R6) and labeled unverified when on.** URLs are editable by anyone.
- **Question-to-contact mapping fills empty fields only.** Respondents cannot overwrite CRM data.
- **Merge is not undoable in v1; aliases keep old links and emails resolving.** Undo would require snapshotting every moved row.
- **respondent_hash is a per-tab random id in sessionStorage.** No fingerprinting, accepts slight overcount.
- **`complete` is emitted server side; abandon inferred after 24h without complete.** Beacons are unreliable.
- **No sampling; raw events 180 days, then daily rollup.** Keeps the events table bounded.
- **Event-based metrics ignore answer and contact filters.** Non-submitters have neither.
- **Default report is virtual until customized.** New questions appear automatically.
- **Shared reports: one SECURITY DEFINER payload function, aggregates only, frozen filters, no verbatims, cells under 3 suppressed.** Service role has no RLS backstop.
- **PDF export is v2; print stylesheet in v1.** Headless Chrome on Vercel is not worth it yet.
- **Direct stream up to 5,000 rows, Storage file plus signed URL above.** Fits Vercel function limits without a queue.
- **File links in exports go through an authenticated app redirect.** Signed URLs expire and leak.
- **Response retention and file cleanup run on Vercel Cron; event rollup and pure SQL pruning run on pg_cron (00 R3).** Storage files must be deleted through the API.
- **Pixel consent is recorded per response as `metadata.pixel_consent` using the workspace `pixel_consent_mode` enum (00 R7).** First-party events do not depend on it.
- **No caps on contacts or share links in v1.** Import file size and row defaults can be raised per workspace through `workspace_limits`.
- **Response retention never deletes contacts.** Contacts are CRM records the workspace manages.
- **Anonymize deletes all open text and PII-flagged answers.** Free text can identify a person.
- **Deletion log stores a hash of the email, not the email.** Proves the request without keeping the data.
- **Row-level exports need editor; aggregate exports are open to viewers; every export is logged with actor, scope, filter, and row count.** Settled with doc 05.
- **No respondent self-export in v1; an editor runs the GDPR export.** No email provider means no way to verify a requester.

## 11. Open questions for the owner

1. Should workspaces be able to define their own lead statuses in v2, or is the fixed five-stage pipeline enough?
2. Should shared reports have an opt-in to show selected open text quotes (verbatims), with a warning?
3. Is a minimum cell size of 3 on shared reports right, or should it be configurable (or also applied inside the app)?
4. Retention: should partial responses have a shorter separate retention (for example 30 days) than complete ones?
