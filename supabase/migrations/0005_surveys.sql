-- 0005: surveys, versions, question snapshots, aliases, templates (with the
-- system template seeds), slug generator, guards, survey_effective_state,
-- create_survey, set_survey_alias, draft lock functions, save_draft.
-- Spec: docs/01-data-model.md sections 3, 4, 11, 12; docs/02 section 2;
-- docs/03 sections 2, 6, 9.

-- ---------------------------------------------------------------------------
-- Reserved public path segments. A survey alias can never take one of these.
-- MUST stay in sync with DASHBOARD_SEGMENTS in src/lib/hosts.ts plus the
-- reserved lists in docs/01 section 3 and docs/02 section 2. The test
-- supabase/tests/05_aliases.sql prints the list so a TS test can compare it.
-- ---------------------------------------------------------------------------
create or replace function reserved_public_segments() returns text[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select array[
    -- DASHBOARD_SEGMENTS (src/lib/hosts.ts)
    'w', 'admin', 'login', 'pending', 'invite', 'auth', 'dev',
    -- docs/01 section 3
    'api', 's', 'r', 'f', 'e', 'logout', 'app', 'www', 'static', 'well-known', 'join', 'privacy',
    -- docs/02 section 2 (public host routes and files)
    'report', 'robots', 'favicon'
  ]::text[];
$$;
grant execute on function reserved_public_segments() to authenticated, service_role;

-- 10 characters from [a-z0-9] drawn from gen_random_bytes. Collisions are
-- retried by create_survey on the unique constraint.
create or replace function gen_survey_slug() returns text
language sql volatile security definer set search_path = public, pg_temp as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(b.bytes, i) % 36) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(10) as bytes) b, generate_series(0, 9) i;
$$;
grant execute on function gen_survey_slug() to authenticated, service_role;

create table surveys (
  id                           uuid primary key default gen_random_uuid(),
  workspace_id                 uuid not null references workspaces(id) on delete cascade, -- immutable (guard)
  title                        text not null default 'Untitled survey'
                               check (length(title) between 1 and 200),  -- internal name
  slug                         text not null unique default gen_survey_slug()
                               check (slug ~ '^[a-z0-9]{10}$'),
  -- state (doc 02 section 3)
  state                        survey_state not null default 'draft',
  opens_at                     timestamptz,
  closes_at                    timestamptz,
  closed_message               text check (closed_message is null or length(closed_message) <= 1000),
  response_cap                 int check (response_cap is null or response_cap > 0),  -- null = unlimited
  complete_count               int not null default 0,      -- maintained by submit_response only
  -- identity (section 5, R6)
  identity_question_key        text,                       -- email question used as identity key
  identity_phone_key           text,                       -- optional phone identity
  trust_hidden_identity        boolean not null default false, -- ?email= / ?contact= may create or link
  -- delivery (doc 02)
  excluded_pixel_ids           uuid[] not null default '{}',   -- per-survey pixel opt-outs
  og_title                     text check (og_title is null or length(og_title) <= 120),
  og_description               text check (og_description is null or length(og_description) <= 300),
  og_image_path                text,                       -- public-assets/{workspace_id}/og/{survey_id}.{ext}
  allow_indexing               boolean not null default false, -- robots noindex unless true
  settings                     jsonb not null default '{}',  -- builder-only settings (doc 03)
  -- version pointers
  current_draft_version_id     uuid,                       -- fk added after survey_versions
  latest_published_version_id  uuid,
  archived_at                  timestamptz,
  admin_closed_reason          text,                       -- set by admin_close_survey (doc 05), shown as a banner
  admin_closed_at              timestamptz,
  created_by                   uuid references profiles(id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check (state <> 'scheduled' or opens_at is not null),
  check (opens_at is null or closes_at is null or opens_at < closes_at)
);
create index surveys_ws on surveys (workspace_id, updated_at desc);
create trigger surveys_touch before update on surveys
  for each row execute function touch_updated_at();

create table survey_versions (
  id                      uuid primary key default gen_random_uuid(),
  survey_id               uuid not null references surveys(id) on delete cascade,
  workspace_id            uuid not null references workspaces(id) on delete cascade, -- denormalized for RLS
  version_no              int not null,
  status                  version_status not null default 'draft',
  revision                int not null default 0,      -- R8: bumped on every draft save and lock takeover
  definition              jsonb not null default '{"pages":[]}',  -- full, server only once published
  public_definition       jsonb,                       -- R9: browser-safe half, written at publish
  definition_hash         text,                        -- sha256 of definition, set at publish
  created_from_version_id uuid references survey_versions(id) on delete set null,
  locked_by               uuid references profiles(id) on delete set null,
  locked_at               timestamptz,
  published_at            timestamptz,
  published_by            uuid references profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (survey_id, version_no),
  check ((status = 'published') = (published_at is not null)),
  check ((status = 'published') = (public_definition is not null))
);
create unique index survey_one_draft on survey_versions (survey_id) where status = 'draft';
create index survey_versions_ws on survey_versions (workspace_id);
alter table surveys add foreign key (current_draft_version_id)    references survey_versions(id) on delete set null;
alter table surveys add foreign key (latest_published_version_id) references survey_versions(id) on delete set null;

create table questions (            -- normalized snapshot, written only by publish_survey_version
  id                uuid primary key default gen_random_uuid(),
  survey_version_id uuid not null references survey_versions(id) on delete cascade,
  survey_id         uuid not null references surveys(id) on delete cascade,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  question_key      text not null check (question_key ~ '^q_[a-z0-9]{8}$'),
  page_index        int not null,
  position          int not null,           -- global order within the version
  type              text not null,          -- vocabulary owned by doc 03
  label             text not null,
  label_hash        text not null,          -- detects wording changes across versions
  required          boolean not null default false,
  is_pii            boolean not null default false,  -- builder flag; anonymize deletes these answers
  options           jsonb,                  -- [{id, label}], option ids are stable like question keys (R5)
  config            jsonb not null default '{}',     -- includes contact_field mapping (doc 03)
  unique (survey_version_id, question_key)
);
create index questions_key on questions (survey_id, question_key);

create table survey_aliases (       -- doc 02, simplified by R2: one scope, globally unique
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid references surveys(id) on delete set null,     -- null after survey delete: held, resolves to nothing
  workspace_id uuid references workspaces(id) on delete set null,
  alias        text not null check (
                 alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                 and length(alias) between 3 and 60
                 and alias !~ '^[a-z0-9]{10}$'                -- cannot look like a slug
                 and not (alias = any (reserved_public_segments()))
               ),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  retired_at   timestamptz                                   -- set on rename; held 30 days
);
create unique index survey_aliases_alias      on survey_aliases (alias);  -- global, retired rows included
create unique index survey_aliases_one_active on survey_aliases (survey_id) where retired_at is null;
create index survey_aliases_ws on survey_aliases (workspace_id);

create table survey_templates (     -- R8, doc 03
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,   -- null = system template
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text,
  definition   jsonb not null,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index survey_templates_ws on survey_templates (workspace_id);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- workspace_id, slug, complete_count, the version pointers and the admin close
-- columns are not client writable (functions raise survey.internal).
create or replace function guard_survey() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if not flag_on('survey.purge') then
      raise exception 'Use delete_survey()';
    end if;
    return old;
  end if;
  if not (flag_on('survey.internal') or flag_on('survey.publishing') or is_trusted_caller()) then
    if new.id is distinct from old.id
       or new.workspace_id is distinct from old.workspace_id
       or new.slug is distinct from old.slug
       or new.complete_count is distinct from old.complete_count
       or new.current_draft_version_id is distinct from old.current_draft_version_id
       or new.latest_published_version_id is distinct from old.latest_published_version_id
       or new.admin_closed_at is distinct from old.admin_closed_at
       or new.admin_closed_reason is distinct from old.admin_closed_reason
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'These survey columns are maintained by the system';
    end if;
  end if;
  return new;
end $$;
create trigger surveys_guard before update or delete on surveys
  for each row execute function guard_survey();
create trigger surveys_activity after insert or update on surveys
  for each row execute function log_activity();

-- Published versions are immutable. The one exception is foreign keys nulling
-- published_by, locked_by or created_from_version_id when the referenced row
-- disappears (profile deletion, purge).
create or replace function guard_survey_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fk text[] := array['published_by','locked_by','created_from_version_id','updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' and current_setting('survey.purge', true) is distinct from 'on' then
      raise exception 'Published versions cannot be deleted';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'published' and current_setting('survey.publishing', true) is distinct from 'on' then
      raise exception 'Use publish_survey_version() to publish';
    end if;
    return new;
  end if;
  if old.status = 'published' then
    if (to_jsonb(new) - v_fk) = (to_jsonb(old) - v_fk)
       and (new.published_by is not distinct from old.published_by or new.published_by is null)
       and (new.locked_by is not distinct from old.locked_by or new.locked_by is null)
       and (new.created_from_version_id is not distinct from old.created_from_version_id
            or new.created_from_version_id is null) then
      return new;   -- foreign key set null only
    end if;
    raise exception 'Published version % is immutable', old.id;
  end if;
  if new.status = 'published' and current_setting('survey.publishing', true) is distinct from 'on' then
    raise exception 'Use publish_survey_version() to publish';
  end if;
  if new.survey_id is distinct from old.survey_id or new.workspace_id is distinct from old.workspace_id
     or new.version_no is distinct from old.version_no then
    raise exception 'survey_id, workspace_id and version_no are immutable';
  end if;
  return new;
end $$;
create trigger survey_versions_guard before insert or update or delete on survey_versions
  for each row execute function guard_survey_version();
create trigger survey_versions_touch before update on survey_versions
  for each row execute function touch_updated_at();

create or replace function guard_questions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not flag_on('survey.publishing') then
      raise exception 'questions are written only by publish_survey_version()';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if not flag_on('survey.purge') then
      raise exception 'questions are deleted only with their survey';
    end if;
    return old;
  end if;
  raise exception 'questions are immutable';
end $$;
create trigger questions_guard before insert or update or delete on questions
  for each row execute function guard_questions();

create trigger survey_aliases_activity after insert or update or delete on survey_aliases
  for each row execute function log_activity();
create trigger survey_templates_activity after insert or update or delete on survey_templates
  for each row execute function log_activity();

-- ---------------------------------------------------------------------------
-- Effective state (doc 01 section 11). Not security definer: it only reads its
-- argument. 'draft' means "does not exist" to the public.
-- ---------------------------------------------------------------------------
create or replace function survey_effective_state(s surveys, p_workspace_archived boolean default false)
returns table (state text, reason text)
language sql stable set search_path = public, pg_temp as $$
  select
    case
      when s.archived_at is not null or s.state = 'draft'
           or s.latest_published_version_id is null                     then 'draft'
      when p_workspace_archived or s.admin_closed_at is not null        then 'closed'
      when s.state = 'closed'                                           then 'closed'
      when s.opens_at  is not null and now() <  s.opens_at              then 'scheduled'
      when s.closes_at is not null and now() >= s.closes_at             then 'closed'
      when s.response_cap is not null
           and s.complete_count >= s.response_cap                       then 'closed'
      else 'open' end,
    case
      when p_workspace_archived                                         then 'workspace_archived'
      when s.admin_closed_at is not null                                then 'admin'
      when s.state = 'closed'                                           then 'manual'
      when s.closes_at is not null and now() >= s.closes_at             then 'schedule'
      when s.response_cap is not null
           and s.complete_count >= s.response_cap                       then 'cap'
    end;
$$;
grant execute on function survey_effective_state(surveys, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Definition helpers
-- ---------------------------------------------------------------------------

-- Number of question entries (doc 03: `questions` is a map keyed by question id).
create or replace function definition_question_count(p_definition jsonb) returns int
language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p_definition -> 'questions')
           when 'object' then (select count(*)::int from jsonb_object_keys(p_definition -> 'questions'))
           when 'array'  then jsonb_array_length(p_definition -> 'questions')
           else 0 end;
$$;
grant execute on function definition_question_count(jsonb) to authenticated, service_role;

-- New empty draft in the doc 03 SurveyDefinition shape.
create or replace function empty_survey_definition(p_title text, p_theme jsonb) returns jsonb
language sql volatile set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'schema_version', 1,
    'settings', jsonb_build_object(
      'title', coalesce(p_title, 'Untitled survey'),
      'show_progress', true, 'show_question_numbers', false, 'allow_back', true,
      'one_question_per_screen', false, 'autosave_partial', true, 'trust_hidden_identity', false),
    'theme', coalesce(p_theme, '{}'::jsonb),
    'pages', jsonb_build_array(jsonb_build_object('id', 'p_' || substr(gen_survey_slug(), 1, 8), 'question_ids', '[]'::jsonb)),
    'questions', '{}'::jsonb,
    'logic', '[]'::jsonb,
    'endings', jsonb_build_array(jsonb_build_object(
      'id', 'e_default', 'message', jsonb_build_object('format', 'md-lite', 'text', 'Thank you for your response.'),
      'show_score', false, 'show_summary', false)),
    'closed_message', jsonb_build_object('format', 'md-lite', 'text', 'This survey is no longer accepting responses.'),
    'identity', '{}'::jsonb,
    'pixel_exclusions', '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- Survey functions
-- ---------------------------------------------------------------------------
create or replace function create_survey(p_workspace_id uuid, p_title text, p_template_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_title   text := left(coalesce(nullif(btrim(p_title), ''), 'Untitled survey'), 200);
  v_theme   jsonb;
  v_def     jsonb;
  v_survey  uuid;
  v_version uuid;
  v_try     int := 0;
begin
  if not is_member(p_workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  select default_theme into v_theme from workspaces where id = p_workspace_id;
  if p_template_id is not null then
    select definition into v_def from survey_templates
     where id = p_template_id and (workspace_id is null or workspace_id = p_workspace_id);
    if v_def is null then
      raise exception 'template_not_found';
    end if;
    if coalesce(v_def -> 'theme', '{}'::jsonb) = '{}'::jsonb then
      v_def := v_def || jsonb_build_object('theme', coalesce(v_theme, '{}'::jsonb));
    end if;
    if nullif(btrim(p_title), '') is not null then
      v_def := jsonb_set(v_def, '{settings,title}', to_jsonb(v_title), true);
    end if;
  else
    v_def := empty_survey_definition(v_title, v_theme);
  end if;

  loop
    begin
      insert into surveys (workspace_id, title, created_by)
      values (p_workspace_id, v_title, auth.uid())
      returning id into v_survey;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  insert into survey_versions (survey_id, workspace_id, version_no, definition)
  values (v_survey, p_workspace_id, 1, v_def)
  returning id into v_version;

  perform set_config('survey.internal', 'on', true);
  update surveys set current_draft_version_id = v_version where id = v_survey;
  perform set_config('survey.internal', 'off', true);

  if p_template_id is not null then
    perform write_activity(p_workspace_id, 'survey', v_survey, 'create_from_template',
                           jsonb_build_object('template_id', p_template_id));
  end if;
  return v_survey;
end $$;

-- A survey has at most one active alias. null clears (retires) it. Re-taking
-- the survey's own retired alias un-retires it. Retired aliases are held
-- (unique index covers them) until pg_cron prunes them after 30 days.
create or replace function set_survey_alias(p_survey_id uuid, p_alias text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ws       uuid;
  v_alias    text := nullif(lower(btrim(p_alias)), '');
  v_current  survey_aliases;
  v_existing survey_aliases;
begin
  select workspace_id into v_ws from surveys where id = p_survey_id for update;
  if v_ws is null or not is_member(v_ws, 'editor') then
    raise exception 'not_authorized';
  end if;
  if v_alias is not null then
    if v_alias = any (reserved_public_segments()) then
      raise exception 'alias_reserved';
    end if;
    if not (v_alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(v_alias) between 3 and 60
            and v_alias !~ '^[a-z0-9]{10}$') then
      raise exception 'alias_invalid';
    end if;
  end if;

  select * into v_current from survey_aliases where survey_id = p_survey_id and retired_at is null for update;
  if v_alias is not distinct from v_current.alias then
    return;
  end if;
  if v_alias is not null then
    select * into v_existing from survey_aliases where alias = v_alias for update;
    if v_existing.id is not null and v_existing.survey_id is distinct from p_survey_id then
      raise exception 'alias_taken';
    end if;
  end if;

  if v_current.id is not null then
    update survey_aliases set retired_at = now() where id = v_current.id;
  end if;
  if v_alias is null then
    return;
  end if;
  if v_existing.id is not null then
    update survey_aliases set retired_at = null where id = v_existing.id;
  else
    insert into survey_aliases (survey_id, workspace_id, alias, created_by)
    values (p_survey_id, v_ws, v_alias, auth.uid());
  end if;
end $$;

create or replace function take_draft_lock(p_version_id uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  v      survey_versions;
  v_prev uuid;
begin
  select * into v from survey_versions where id = p_version_id for update;
  if v.id is null or not is_member(v.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if v.status <> 'draft' then
    raise exception 'not_draft';
  end if;
  if v.locked_by is null or v.locked_by = v_uid or v.locked_at < now() - interval '15 minutes' then
    update survey_versions set locked_by = v_uid, locked_at = now() where id = p_version_id
    returning * into v;
  elsif coalesce(p_force, false) then
    v_prev := v.locked_by;
    update survey_versions set locked_by = v_uid, locked_at = now(), revision = revision + 1
     where id = p_version_id returning * into v;
    perform write_activity(v.workspace_id, 'survey', v.survey_id, 'lock_takeover',
      jsonb_build_object('version_id', p_version_id, 'previous', v_prev, 'new', v_uid));
  else
    return jsonb_build_object('ok', false, 'locked_by', v.locked_by, 'locked_at', v.locked_at, 'revision', v.revision);
  end if;
  return jsonb_build_object('ok', true, 'locked_by', v.locked_by, 'locked_at', v.locked_at, 'revision', v.revision);
end $$;

create or replace function release_draft_lock(p_version_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update survey_versions set locked_by = null, locked_at = null
   where id = p_version_id and status = 'draft' and locked_by = auth.uid();
end $$;

create or replace function save_draft(p_version_id uuid, p_expected_revision int, p_definition jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v     survey_versions;
  l     record;
  v_rev int;
begin
  select * into v from survey_versions where id = p_version_id;
  if v.id is null or not is_member(v.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if v.status <> 'draft' then
    raise exception 'not_draft';
  end if;
  if v.locked_by is distinct from v_uid or v.locked_at < now() - interval '15 minutes' then
    raise exception 'lock_lost';
  end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object'
     or jsonb_typeof(p_definition -> 'pages') is distinct from 'array' then
    raise exception 'invalid_definition';
  end if;
  select * into l from effective_limits(v.workspace_id);
  if octet_length(p_definition::text) > l.max_definition_bytes then
    raise exception 'definition_too_large';
  end if;
  if definition_question_count(p_definition) > l.max_questions then
    raise exception 'too_many_questions';
  end if;

  update survey_versions
     set definition = p_definition, revision = revision + 1, locked_at = now()
   where id = p_version_id and revision = p_expected_revision and status = 'draft'
  returning revision into v_rev;
  if v_rev is null then
    raise exception 'revision_conflict';
  end if;

  -- Coalesced draft edit log: at most one row per editor per survey per 10 minutes.
  if not exists (select 1 from activity_log
                 where workspace_id = v.workspace_id and entity = 'survey' and entity_id = v.survey_id
                   and action = 'draft_edited' and actor = v_uid
                   and created_at > now() - interval '10 minutes') then
    perform write_activity(v.workspace_id, 'survey', v.survey_id, 'draft_edited',
                           jsonb_build_object('version_id', p_version_id));
  end if;
  return v_rev;
end $$;

grant execute on function create_survey(uuid, text, uuid), set_survey_alias(uuid, text),
  take_draft_lock(uuid, boolean), release_draft_lock(uuid), save_draft(uuid, int, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table surveys          enable row level security;
alter table survey_versions  enable row level security;
alter table questions        enable row level security;
alter table survey_aliases   enable row level security;
alter table survey_templates enable row level security;

create policy surveys_select on surveys for select to authenticated using (is_member(workspace_id));
create policy surveys_update on surveys for update to authenticated
  using (is_member(workspace_id, 'editor')) with check (is_member(workspace_id, 'editor'));

create policy survey_versions_select on survey_versions for select to authenticated using (is_member(workspace_id));
create policy questions_select on questions for select to authenticated using (is_member(workspace_id));
create policy survey_aliases_select on survey_aliases for select to authenticated
  using (workspace_id is not null and is_member(workspace_id));

create policy survey_templates_select on survey_templates for select to authenticated
  using ((workspace_id is null and is_active_profile()) or (workspace_id is not null and is_member(workspace_id)));
create policy survey_templates_insert on survey_templates for insert to authenticated
  with check ((workspace_id is null and is_platform_admin())
              or (workspace_id is not null and is_member(workspace_id, 'editor')));
create policy survey_templates_update on survey_templates for update to authenticated
  using ((workspace_id is null and is_platform_admin())
         or (workspace_id is not null and is_member(workspace_id, 'editor')))
  with check ((workspace_id is null and is_platform_admin())
              or (workspace_id is not null and is_member(workspace_id, 'editor')));
create policy survey_templates_delete on survey_templates for delete to authenticated
  using ((workspace_id is null and is_platform_admin())
         or (workspace_id is not null and is_member(workspace_id, 'editor')));

-- ---------------------------------------------------------------------------
-- System templates (doc 03 section 6 starter set). Fixed ids so the insert is
-- idempotent. Question ids equal their question_key. Themes are filled from
-- the workspace default by create_survey.
-- ---------------------------------------------------------------------------
create function pg_temp.rt(p text) returns jsonb language sql as $$
  select jsonb_build_object('format', 'md-lite', 'text', p) $$;
create function pg_temp.q(p_key text, p_type text, p_label text, p_required boolean, p_settings jsonb default '{}',
                          p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_key, 'question_key', p_key, 'type', p_type, 'label', pg_temp.rt(p_label),
                            'required', p_required, 'settings', p_settings) || p_extra $$;
create function pg_temp.opts(variadic p_labels text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', 'o_' || i, 'label', p_labels[i]) order by i)
  from generate_subscripts(p_labels, 1) i $$;
create function pg_temp.def(p_title text, p_questions jsonb[], p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'schema_version', 1,
    'settings', jsonb_build_object('title', p_title, 'show_progress', true, 'show_question_numbers', false,
                                   'allow_back', true, 'one_question_per_screen', false,
                                   'autosave_partial', true, 'trust_hidden_identity', false),
    'theme', '{}'::jsonb,
    'pages', jsonb_build_array(jsonb_build_object('id', 'p_main0001',
               'question_ids', (select jsonb_agg(x ->> 'id' order by o) from unnest(p_questions) with ordinality u(x, o)))),
    'questions', (select jsonb_object_agg(x ->> 'id', x) from unnest(p_questions) x),
    'logic', '[]'::jsonb,
    'endings', jsonb_build_array(jsonb_build_object('id', 'e_default', 'message', pg_temp.rt('Thank you for your response.'),
                                                    'show_score', false, 'show_summary', false)),
    'closed_message', pg_temp.rt('This survey is no longer accepting responses.'),
    'identity', '{}'::jsonb,
    'pixel_exclusions', '[]'::jsonb) || p_extra $$;

insert into survey_templates (id, workspace_id, name, description, definition) values
('00000000-0000-4000-8000-000000000001', null, 'Customer satisfaction',
 'CSAT rating plus Net Promoter Score and an open follow-up.',
 pg_temp.def('Customer satisfaction', array[
   pg_temp.q('q_csat0001', 'rating', 'Overall, how satisfied are you with our service?', true,
             '{"points": 5, "display": "stars", "min_label": "Very unsatisfied", "max_label": "Very satisfied"}'),
   pg_temp.q('q_csat0002', 'nps', 'How likely are you to recommend us to a friend or colleague?', true,
             '{"min_label": "Not at all likely", "max_label": "Extremely likely"}'),
   pg_temp.q('q_csat0003', 'long_text', 'What is the main reason for your score?', false, '{"rows": 4}')])),
('00000000-0000-4000-8000-000000000002', null, 'Event feedback',
 'Rate an event, the most valuable sessions, and suggestions.',
 pg_temp.def('Event feedback', array[
   pg_temp.q('q_evfb0001', 'rating', 'How would you rate the event overall?', true, '{"points": 5, "display": "stars"}'),
   pg_temp.q('q_evfb0002', 'multiple_choice', 'Which parts of the event were most valuable?', false,
             jsonb_build_object('options', pg_temp.opts('Keynote', 'Workshops', 'Networking', 'Panel discussions'),
                                'randomize', false)),
   pg_temp.q('q_evfb0003', 'yes_no', 'Would you attend again?', true, '{"yes_label": "Yes", "no_label": "No"}'),
   pg_temp.q('q_evfb0004', 'long_text', 'Any suggestions for next time?', false, '{"rows": 4}')])),
('00000000-0000-4000-8000-000000000003', null, 'Lead capture form',
 'Name, work email (identity key), company, phone and interest.',
 pg_temp.def('Get in touch', array[
   pg_temp.q('q_lead0001', 'short_text', 'First name', true, '{}', '{"contact_field": {"kind": "core", "field": "first_name"}, "pii": true}'),
   pg_temp.q('q_lead0002', 'short_text', 'Last name', true, '{}', '{"contact_field": {"kind": "core", "field": "last_name"}, "pii": true}'),
   pg_temp.q('q_lead0003', 'email', 'Work email', true, '{}', '{"pii": true}'),
   pg_temp.q('q_lead0004', 'short_text', 'Company', false, '{}', '{"contact_field": {"kind": "core", "field": "company"}}'),
   pg_temp.q('q_lead0005', 'phone', 'Phone', false, '{"default_country": "US"}', '{"contact_field": {"kind": "core", "field": "phone"}, "pii": true}'),
   pg_temp.q('q_lead0006', 'dropdown', 'What are you interested in?', false,
             jsonb_build_object('options', pg_temp.opts('A demo', 'Pricing information', 'Partnership', 'Something else'),
                                'randomize', false, 'searchable', false)),
   pg_temp.q('q_lead0007', 'long_text', 'Anything else we should know?', false, '{"rows": 4}')],
   '{"identity": {"email_question_id": "q_lead0003"}}')),
('00000000-0000-4000-8000-000000000004', null, 'Employee pulse',
 'A short Likert matrix on tools, recognition and priorities.',
 pg_temp.def('Employee pulse', array[
   pg_temp.q('q_puls0001', 'matrix', 'How much do you agree with each statement?', true, jsonb_build_object(
     'rows', jsonb_build_array(
        jsonb_build_object('id', 'r_1', 'label', 'I have the tools I need to do my job'),
        jsonb_build_object('id', 'r_2', 'label', 'I feel recognized for my work'),
        jsonb_build_object('id', 'r_3', 'label', 'I understand our team priorities'),
        jsonb_build_object('id', 'r_4', 'label', 'I would recommend this team as a great place to work')),
     'columns', jsonb_build_array(
        jsonb_build_object('id', 'c_1', 'label', 'Strongly disagree'),
        jsonb_build_object('id', 'c_2', 'label', 'Disagree'),
        jsonb_build_object('id', 'c_3', 'label', 'Neutral'),
        jsonb_build_object('id', 'c_4', 'label', 'Agree'),
        jsonb_build_object('id', 'c_5', 'label', 'Strongly agree')),
     'randomize_rows', false, 'all_rows_required', false)),
   pg_temp.q('q_puls0002', 'long_text', 'What is one thing that would improve your week?', false, '{"rows": 3}')])),
('00000000-0000-4000-8000-000000000005', null, 'Product knowledge quiz',
 'Scored quiz with a pass ending. Scores and correct answers stay server side.',
 pg_temp.def('Product knowledge quiz', array[
   pg_temp.q('q_quiz0001', 'single_choice', 'Which plan includes priority support?', true, jsonb_build_object(
     'options', jsonb_build_array(
        jsonb_build_object('id', 'o_1', 'label', 'Starter', 'score', 0),
        jsonb_build_object('id', 'o_2', 'label', 'Team', 'score', 0),
        jsonb_build_object('id', 'o_3', 'label', 'Enterprise', 'score', 1)),
     'randomize', false, 'correct_option_id', 'o_3')),
   pg_temp.q('q_quiz0002', 'single_choice', 'How often are backups taken?', true, jsonb_build_object(
     'options', jsonb_build_array(
        jsonb_build_object('id', 'o_1', 'label', 'Hourly', 'score', 0),
        jsonb_build_object('id', 'o_2', 'label', 'Daily', 'score', 1),
        jsonb_build_object('id', 'o_3', 'label', 'Weekly', 'score', 0)),
     'randomize', false, 'correct_option_id', 'o_2')),
   pg_temp.q('q_quiz0003', 'yes_no', 'Can customers export their own data?', true,
             '{"yes_label": "Yes", "no_label": "No", "yes_score": 1, "no_score": 0}'),
   pg_temp.q('q_quiz0004', 'calculated', 'Quiz score', false, jsonb_build_object(
     'formula', jsonb_build_object('fn', 'score', 'ids', jsonb_build_array('q_quiz0001', 'q_quiz0002', 'q_quiz0003')),
     'formula_source', 'score({{q:q_quiz0001}}, {{q:q_quiz0002}}, {{q:q_quiz0003}})',
     'visible', false, 'decimals', 0))],
   jsonb_build_object(
     'settings', jsonb_build_object('title', 'Product knowledge quiz', 'show_progress', true, 'show_question_numbers', true,
                                    'allow_back', true, 'one_question_per_screen', false, 'autosave_partial', true,
                                    'trust_hidden_identity', false,
                                    'quiz', jsonb_build_object('score_calc_id', 'q_quiz0004', 'show_correct_answers', false)),
     'logic', jsonb_build_array(jsonb_build_object('id', 'l_pass0001', 'kind', 'set_ending', 'ending_id', 'e_pass',
        'when', jsonb_build_object('field', jsonb_build_object('kind', 'calc', 'id', 'q_quiz0004'), 'op', 'gte', 'value', 2),
        'order', 0)),
     'endings', jsonb_build_array(
        jsonb_build_object('id', 'e_default', 'message', pg_temp.rt('Thanks for taking the quiz. You scored {{calc:q_quiz0004}}.'),
                           'show_score', true, 'show_summary', false),
        jsonb_build_object('id', 'e_pass', 'title', pg_temp.rt('You passed'),
                           'message', pg_temp.rt('Great work. You scored {{calc:q_quiz0004}}.'),
                           'show_score', true, 'show_summary', false))))),
('00000000-0000-4000-8000-000000000006', null, 'Event registration',
 'Attendee details, day selection, accommodations and consent.',
 pg_temp.def('Event registration', array[
   pg_temp.q('q_regi0001', 'short_text', 'First name', true, '{}', '{"contact_field": {"kind": "core", "field": "first_name"}, "pii": true}'),
   pg_temp.q('q_regi0002', 'short_text', 'Last name', true, '{}', '{"contact_field": {"kind": "core", "field": "last_name"}, "pii": true}'),
   pg_temp.q('q_regi0003', 'email', 'Email', true, '{}', '{"pii": true}'),
   pg_temp.q('q_regi0004', 'short_text', 'Organization', false, '{}', '{"contact_field": {"kind": "core", "field": "company"}}'),
   pg_temp.q('q_regi0005', 'single_choice', 'Which day will you attend?', true,
             jsonb_build_object('options', pg_temp.opts('Day 1', 'Day 2', 'Both days'), 'randomize', false)),
   pg_temp.q('q_regi0006', 'long_text', 'Do you need any accessibility accommodations or have dietary requirements?', false,
             '{"rows": 3}', '{"pii": true}'),
   pg_temp.q('q_regi0007', 'consent', 'I agree to the event terms.', true,
             '{"text_source": "workspace", "gates_tracking": false}')],
   '{"identity": {"email_question_id": "q_regi0003"}}'))
on conflict (id) do nothing;
