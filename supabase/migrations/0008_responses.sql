-- 0008: responses, answers, response_files, storage_deletions and its
-- trigger, submission_idempotency, rate_limit_events, storage buckets and
-- storage.objects policies. Spec: docs/01-data-model.md section 6; docs/02 sections 5, 6.

create table responses (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  survey_id           uuid not null references surveys(id) on delete cascade,
  survey_version_id   uuid not null references survey_versions(id),
  status              response_status not null default 'partial',
  contact_id          uuid references contacts(id) on delete set null,
  respondent_token_id uuid references respondent_tokens(id) on delete set null,
  identity_source     text check (identity_source in ('token','identity_answer','hidden_field')),
  respondent_hash     text,                 -- the per-tab rid from doc 04
  resume_token_hash   text unique,          -- sha256 hex of the resume secret; nulled on complete or after 30 days
  last_question_key   text,
  score               numeric,              -- computed in submit_response (R9)
  score_max           numeric,
  started_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  metadata            jsonb not null default '{}',
  ip                  inet,                 -- only when workspaces.store_ip
  raw                 jsonb not null default '{}',
  anonymized_at       timestamptz,
  updated_at          timestamptz not null default now(),
  check ((status = 'complete') = (submitted_at is not null))
);
create index responses_survey_inbox on responses (survey_id, submitted_at desc) where status = 'complete';
create index responses_version on responses (survey_version_id);
create index responses_contact on responses (contact_id) where contact_id is not null;
create index responses_ws_age on responses (workspace_id, coalesce(submitted_at, started_at));  -- retention
create index responses_rid on responses (survey_id, respondent_hash) where respondent_hash is not null;
create index responses_token on responses (respondent_token_id) where respondent_token_id is not null;
create trigger responses_touch before update on responses
  for each row execute function touch_updated_at();

create table answers (
  id                bigint generated always as identity primary key,
  response_id       uuid not null references responses(id) on delete cascade,
  workspace_id      uuid not null,
  survey_id         uuid not null,
  survey_version_id uuid not null,
  question_key      text not null,
  value_text        text,
  value_number      numeric,
  value_date        date,
  value_json        jsonb,   -- multi-choice option ids, matrix, ranking, file ids
  unique (response_id, question_key)
);
create index answers_report on answers (survey_id, question_key);

create table response_files (       -- doc 02 "pending_uploads"; one table for pending and attached
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  survey_id     uuid not null references surveys(id) on delete cascade,
  question_key  text not null,
  response_id   uuid references responses(id) on delete cascade,  -- null until attached
  status        text not null default 'pending' check (status in ('pending','attached')),
  object_path   text not null unique,  -- {workspace_id}/{survey_id}/pending/{id}/{safe_name}, moved after attach
  declared_size bigint not null,
  declared_mime text not null,
  original_name text not null,
  size_bytes    bigint,                -- verified from storage.objects at attach
  mime_type     text,
  created_at    timestamptz not null default now(),
  attached_at   timestamptz,
  moved_at      timestamptz,
  check ((status = 'attached') = (response_id is not null))
);
create index response_files_pending on response_files (created_at) where status = 'pending';
create index response_files_response on response_files (response_id) where response_id is not null;

create table storage_deletions (    -- doc 02; outbox for Storage API deletes
  id           bigint generated always as identity primary key,
  bucket       text not null,
  path         text not null,
  workspace_id uuid,                 -- no fk: must outlive workspace deletion
  reason       text not null check (reason in ('retention','orphan','erase','survey_delete',
                                     'workspace_delete','export_expired','import_expired','replaced')),
  enqueued_at  timestamptz not null default now(),
  attempts     int not null default 0,
  last_error   text,
  done_at      timestamptz
);
create index storage_deletions_todo on storage_deletions (enqueued_at) where done_at is null;
create index storage_deletions_ws on storage_deletions (workspace_id) where done_at is null;

create table submission_idempotency (   -- doc 02
  key         uuid primary key,          -- client idempotencyKey, one per save/complete attempt
  survey_id   uuid not null references surveys(id) on delete cascade,
  response_id uuid references responses(id) on delete cascade,
  result      jsonb,                     -- stored SubmitResult, returned verbatim on retry
  created_at  timestamptz not null default now()
);
create index submission_idempotency_age on submission_idempotency (created_at);

create unlogged table rate_limit_events (   -- doc 02, sliding window log
  bucket text not null,
  key    text not null,
  at     timestamptz not null default now()
);
create index rate_limit_events_lookup on rate_limit_events (bucket, key, at desc);

-- Every path that removes file rows (retention, erase, survey delete, orphan
-- sweep, cascades) enqueues the object here. The reason comes from the
-- survey.deletion_reason setting raised by the caller, default 'orphan'.
-- purge_workspace enqueues every object by prefix itself, so rows deleted
-- during a workspace purge are skipped here.
create or replace function enqueue_response_file_deletion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := coalesce(nullif(current_setting('survey.deletion_reason', true), ''), 'orphan');
begin
  if v_reason = 'workspace_delete' then
    return old;
  end if;
  insert into storage_deletions (bucket, path, workspace_id, reason)
  values ('response-files', old.object_path, old.workspace_id, v_reason);
  return old;
end $$;
create trigger response_files_enqueue_delete after delete on response_files
  for each row execute function enqueue_response_file_deletion();

-- ---------------------------------------------------------------------------
-- RLS. Writes to responses, answers and files go through service role
-- functions only (submit_response, create_upload).
-- ---------------------------------------------------------------------------
alter table responses              enable row level security;
alter table answers                enable row level security;
alter table response_files         enable row level security;
alter table storage_deletions      enable row level security;
alter table submission_idempotency enable row level security;
alter table rate_limit_events      enable row level security;

create policy responses_select on responses for select to authenticated using (is_member(workspace_id));
create policy responses_delete on responses for delete to authenticated using (is_member(workspace_id, 'admin'));
create policy answers_select on answers for select to authenticated using (is_member(workspace_id));
create policy response_files_select on response_files for select to authenticated using (is_member(workspace_id));
-- storage_deletions, submission_idempotency, rate_limit_events: no policies.

-- ---------------------------------------------------------------------------
-- Storage buckets (also declared in supabase/config.toml for local dev) and
-- storage.objects policies. Paths start with {workspace_id}/.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-assets',  'public-assets',  true,  10485760,
   array['image/png','image/jpeg','image/webp','image/gif']),
  ('response-files', 'response-files', false, 104857600,
   array['image/jpeg','image/png','image/webp','image/heic','application/pdf','text/plain','text/csv',
         'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('exports',        'exports',        false, 104857600,
   array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/json']),
  ('imports',        'imports',        false, 52428800,
   array['text/csv','text/plain'])
on conflict (id) do nothing;

-- First folder of an object name as a workspace id, or null when it is not a uuid.
create or replace function storage_workspace_id(p_name text) returns uuid
language sql immutable set search_path = public, pg_temp as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;
grant execute on function storage_workspace_id(text) to authenticated, service_role;

-- public-assets: public read by URL. Writes need editor; the top-level logo
-- file ({workspace_id}/logo*) needs admin (workspace settings).
create policy "public-assets member write" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets'
              and case when name ~ '^[^/]+/logo[^/]*$' then is_member(storage_workspace_id(name), 'admin')
                       else is_member(storage_workspace_id(name), 'editor') end);
create policy "public-assets member update" on storage.objects for update to authenticated
  using (bucket_id = 'public-assets'
         and case when name ~ '^[^/]+/logo[^/]*$' then is_member(storage_workspace_id(name), 'admin')
                  else is_member(storage_workspace_id(name), 'editor') end)
  with check (bucket_id = 'public-assets'
              and case when name ~ '^[^/]+/logo[^/]*$' then is_member(storage_workspace_id(name), 'admin')
                       else is_member(storage_workspace_id(name), 'editor') end);
create policy "public-assets member delete" on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets'
         and case when name ~ '^[^/]+/logo[^/]*$' then is_member(storage_workspace_id(name), 'admin')
                  else is_member(storage_workspace_id(name), 'editor') end);
create policy "public-assets member read" on storage.objects for select to authenticated
  using (bucket_id = 'public-assets' and is_member(storage_workspace_id(name)));

-- response-files: members read (signed download URLs); uploads use signed
-- upload URLs minted by the route handler, moves by the service role.
create policy "response-files member read" on storage.objects for select to authenticated
  using (bucket_id = 'response-files' and is_member(storage_workspace_id(name)));

-- exports: written by the service role; row-level data, so editor to read (doc 05).
create policy "exports editor read" on storage.objects for select to authenticated
  using (bucket_id = 'exports' and is_member(storage_workspace_id(name), 'editor'));

-- imports: editor upload, service role read.
create policy "imports editor upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and is_member(storage_workspace_id(name), 'editor'));
