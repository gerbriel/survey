-- 0007: contacts and the lightweight CRM. contacts, contact_aliases,
-- contact_notes, respondent_tokens, contact_field_defs, contact_views (with the
-- built-in views every workspace gets), contact_duplicate_dismissals,
-- contact_imports, set_contact_custom, search_contacts,
-- contact_duplicate_candidates, import_contacts_chunk, owner cleanup trigger.
-- Spec: docs/01-data-model.md section 5; docs/04-crm-analytics-privacy.md sections 1, 2.

create table contacts (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  email                  text check (email is null or email = lower(btrim(email))),
  phone                  text,          -- E.164, parsed with workspaces.default_country
  first_name             text,
  last_name              text,
  company                text,
  lead_status            lead_status not null default 'new',
  lead_status_changed_at timestamptz,                  -- doc 04
  owner_id               uuid references profiles(id) on delete set null,   -- doc 04, a member
  follow_up_at           date,                         -- doc 04
  follow_up_note         text,                         -- doc 04
  tags                   text[] not null default '{}',
  custom                 jsonb not null default '{}',  -- validated against contact_field_defs
  source                 text,          -- 'survey:<survey_id>', 'token', 'manual', 'import'
  status                 text not null default 'active' check (status in ('active', 'deleted')), -- doc 04 tombstone
  merged_into            uuid references contacts(id) on delete set null,
  merged_at              timestamptz,
  deleted_at             timestamptz,
  last_response_at       timestamptz,   -- maintained by submit_response
  response_count         int not null default 0,
  created_by             uuid references profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'deleted') = (deleted_at is not null))
);
create unique index contacts_ws_email_live on contacts (workspace_id, email)
  where email is not null and merged_into is null and status = 'active';
create index contacts_ws_phone   on contacts (workspace_id, phone) where phone is not null;  -- not unique: households
create index contacts_ws_recent  on contacts (workspace_id, last_response_at desc nulls last);
create index contacts_ws_updated on contacts (workspace_id, updated_at desc, id);  -- list keyset
create index contacts_tags       on contacts using gin (tags);
create index contacts_custom     on contacts using gin (custom jsonb_path_ops);
create index contacts_email_trgm on contacts using gin (email extensions.gin_trgm_ops);       -- duplicates
create index contacts_merged     on contacts (merged_into) where merged_into is not null;
create trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();

create table contact_aliases (       -- written only by merge_contacts
  alias_id     uuid primary key,     -- the merged-away contact id
  contact_id   uuid not null references contacts(id) on delete cascade,  -- survivor
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text,                 -- loser's email at merge time
  phone        text,
  merged_by    uuid references profiles(id) on delete set null,
  merged_at    timestamptz not null default now()
);
create index contact_aliases_contact on contact_aliases (contact_id);
create index contact_aliases_email on contact_aliases (workspace_id, email);

create table contact_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  author       uuid references profiles(id) on delete set null,
  body         text not null check (length(body) between 1 and 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index contact_notes_contact on contact_notes (contact_id, created_at desc);
create trigger contact_notes_touch before update on contact_notes
  for each row execute function touch_updated_at();

create table respondent_tokens (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  survey_id     uuid not null references surveys(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  token         text not null unique default gen_token(16),   -- 22 char base64url, appears in ?t=
  max_responses int not null default 1 check (max_responses >= 1),
  used_count    int not null default 0,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (survey_id, contact_id)
);
create index respondent_tokens_contact on respondent_tokens (contact_id);

create table contact_field_defs (    -- doc 04
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),   -- never changes
  label        text not null,
  type         text not null check (type in ('text','number','date','select','multiselect','boolean','url')),
  options      jsonb,                -- for select and multiselect
  position     int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

create table contact_views (         -- doc 04 saved views
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  filters      jsonb not null default '{}',   -- ContactViewFilters (doc 04)
  columns      text[] not null default '{}',
  sort         jsonb not null default '{}',
  shared       boolean not null default false,
  builtin      boolean not null default false,
  created_by   uuid references profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index contact_views_ws on contact_views (workspace_id);
create trigger contact_views_touch before update on contact_views
  for each row execute function touch_updated_at();

create table contact_duplicate_dismissals (   -- doc 04 "Not a duplicate"
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_a    uuid not null references contacts(id) on delete cascade,
  contact_b    uuid not null references contacts(id) on delete cascade,
  dismissed_by uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, contact_a, contact_b),
  check (contact_a < contact_b)
);

create table contact_imports (       -- doc 04 CSV import
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  storage_path    text,              -- imports/{workspace_id}/{id}.csv, nulled after 30 days
  mapping         jsonb not null default '{}',
  options         jsonb not null default '{}',
  status          text not null default 'pending'
                  check (status in ('pending','running','done','failed')),
  created         int not null default 0,
  updated         int not null default 0,
  skipped         int not null default 0,
  invalid         int not null default 0,
  token_survey_id uuid references surveys(id) on delete set null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index contact_imports_ws on contact_imports (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Custom field validation (doc 04 section 1.4). Returns the normalized object
-- or raises invalid_custom_field. Select options may be strings or objects
-- with `value` or `id`.
-- ---------------------------------------------------------------------------
create or replace function validate_contact_custom(p_workspace_id uuid, p_custom jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_key  text;
  v_val  jsonb;
  d      contact_field_defs;
  v_opts text[];
  v_ok   boolean;
begin
  if p_custom is null then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p_custom) <> 'object' then
    raise exception 'invalid_custom_field: custom must be an object';
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_custom) loop
    select * into d from contact_field_defs where workspace_id = p_workspace_id and key = v_key;
    if d.id is null then
      raise exception 'invalid_custom_field: unknown field %', v_key;
    end if;
    if v_val = 'null'::jsonb then
      continue;
    end if;
    select array_agg(coalesce(o ->> 'value', o ->> 'id', o #>> '{}')) into v_opts
      from jsonb_array_elements(case when jsonb_typeof(d.options) = 'array' then d.options else '[]'::jsonb end) o;
    v_ok := case d.type
      when 'text'        then jsonb_typeof(v_val) = 'string' and length(v_val #>> '{}') <= 1000
      when 'number'      then jsonb_typeof(v_val) = 'number'
      when 'date'        then jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      when 'boolean'     then jsonb_typeof(v_val) = 'boolean'
      when 'url'         then jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~* '^https?://' and length(v_val #>> '{}') <= 2000
      when 'select'      then jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') = any (coalesce(v_opts, '{}'))
      when 'multiselect' then jsonb_typeof(v_val) = 'array'
                              and not exists (select 1 from jsonb_array_elements(v_val) e
                                              where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (coalesce(v_opts, '{}'))))
      else false end;
    if not coalesce(v_ok, false) then
      raise exception 'invalid_custom_field: % expects %', v_key, d.type;
    end if;
    if d.type = 'date' then
      perform (v_val #>> '{}')::date;   -- rejects 2026-02-31
    end if;
  end loop;
  return jsonb_strip_nulls(p_custom);
end $$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function guard_contact() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client boolean := not (is_trusted_caller() or flag_on('survey.internal'));
begin
  new.email := nullif(lower(btrim(new.email)), '');
  new.tags := coalesce((select array_agg(distinct t order by t)
                          from (select left(lower(btrim(x)), 40) as t from unnest(new.tags) x) s
                         where t <> ''), '{}');
  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'active'; new.deleted_at := null; new.merged_into := null; new.merged_at := null;
      new.response_count := 0; new.last_response_at := null; new.created_by := auth.uid();
      new.custom := validate_contact_custom(new.workspace_id, new.custom);
    end if;
    if new.lead_status <> 'new' then
      new.lead_status_changed_at := now();
    end if;
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.id <> old.id then
    raise exception 'workspace_id and id are immutable';
  end if;
  if v_client then
    if old.status = 'deleted' or old.merged_into is not null then
      raise exception 'Tombstoned and merged contacts are read only';
    end if;
    if new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at
       or new.merged_into is distinct from old.merged_into or new.merged_at is distinct from old.merged_at
       or new.response_count is distinct from old.response_count
       or new.last_response_at is distinct from old.last_response_at
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'These contact columns are maintained by the system';
    end if;
    if new.custom is distinct from old.custom then
      new.custom := validate_contact_custom(new.workspace_id, new.custom);
    end if;
  end if;
  if new.lead_status is distinct from old.lead_status then
    new.lead_status_changed_at := now();
  end if;
  return new;
end $$;
create trigger contacts_guard before insert or update on contacts
  for each row execute function guard_contact();
create trigger contacts_activity after insert or update or delete on contacts
  for each row execute function log_activity();
create trigger contact_notes_activity after insert or update or delete on contact_notes
  for each row execute function log_activity();
create trigger contact_field_defs_activity after insert or update on contact_field_defs
  for each row execute function log_activity();

create or replace function guard_respondent_token() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_trusted_caller() or flag_on('survey.internal') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.used_count := 0;
    new.revoked_at := null;
    new.created_by := auth.uid();
    return new;
  end if;
  if new.workspace_id <> old.workspace_id or new.survey_id <> old.survey_id or new.contact_id <> old.contact_id
     or new.token <> old.token or new.used_count <> old.used_count
     or new.created_by is distinct from old.created_by then
    raise exception 'Only revoked_at, max_responses and expires_at can change on a token';
  end if;
  return new;
end $$;
create trigger respondent_tokens_guard before insert or update on respondent_tokens
  for each row execute function guard_respondent_token();

create or replace function guard_contact_view() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_trusted_caller() or flag_on('survey.internal') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.builtin := false;
    new.created_by := auth.uid();
    return new;
  end if;
  if new.builtin is distinct from old.builtin or new.workspace_id <> old.workspace_id
     or new.created_by is distinct from old.created_by then
    raise exception 'builtin, workspace_id and created_by are immutable';
  end if;
  return new;
end $$;
create trigger contact_views_guard before insert or update on contact_views
  for each row execute function guard_contact_view();

-- When a member leaves a workspace their contacts there become unassigned.
create or replace function unassign_contacts_on_member_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text := coalesce(current_setting('survey.internal', true), '');
begin
  if flag_on('survey.purge') then
    return old;
  end if;
  perform set_config('survey.internal', 'on', true);
  update contacts set owner_id = null where workspace_id = old.workspace_id and owner_id = old.user_id;
  perform set_config('survey.internal', v_prev, true);
  return old;
end $$;
create trigger workspace_members_unassign_contacts after delete on workspace_members
  for each row execute function unassign_contacts_on_member_delete();

-- Built-in shared views (doc 04 section 1.1), created for every new workspace,
-- which means every admin_create_workspace call.
create or replace function create_builtin_contact_views(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text := coalesce(current_setting('survey.internal', true), '');
begin
  perform set_config('survey.internal', 'on', true);
  insert into contact_views (workspace_id, name, filters, sort, shared, builtin)
  select p_workspace_id, v.name, v.filters, v.sort, true, true
  from (values
    ('All contacts',  '{}'::jsonb,                                                            '{"field": "updated_at", "dir": "desc"}'::jsonb),
    ('My leads',      '{"owner": {"me": true}, "lead_status": ["new", "contacted", "qualified"]}', '{"field": "updated_at", "dir": "desc"}'),
    ('Follow-up due', '{"follow_up": "due"}',                                                  '{"field": "follow_up_at", "dir": "asc"}')
  ) v(name, filters, sort)
  where not exists (select 1 from contact_views c where c.workspace_id = p_workspace_id and c.builtin and c.name = v.name);
  perform set_config('survey.internal', v_prev, true);   -- restore the caller's flag
end $$;
create or replace function workspaces_builtin_views() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform create_builtin_contact_views(new.id);
  return null;
end $$;
create trigger workspaces_builtin_views after insert on workspaces
  for each row execute function workspaces_builtin_views();

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
create or replace function set_contact_custom(p_contact_id uuid, p_values jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c     contacts;
  v_new jsonb;
begin
  select * into c from contacts where id = p_contact_id for update;
  if c.id is null or not is_member(c.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if c.status = 'deleted' or c.merged_into is not null then
    raise exception 'contact_read_only';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'invalid_custom_field: values must be an object';
  end if;
  v_new := validate_contact_custom(c.workspace_id, jsonb_strip_nulls(c.custom || p_values));
  perform set_config('survey.internal', 'on', true);
  update contacts set custom = v_new where id = p_contact_id;
  perform set_config('survey.internal', 'off', true);
  return v_new;
end $$;

-- Contact list query (doc 04 section 1.1). SECURITY INVOKER, so RLS applies.
-- Filters (all optional, AND): lead_status[], owner {ids[], unassigned, me},
-- tags {mode any|all|none, values[]}, responded [{survey_id, has, complete_only}],
-- custom [{key, op eq|neq|contains|gt|gte|lt|lte|is_set|is_not_set, value}], q,
-- source, follow_up overdue|due|this_week|unset, created_from, created_to,
-- last_response_from, last_response_to. Keyset cursor {updated_at, id}.
create or replace function search_contacts(p_workspace_id uuid, p_filters jsonb default '{}',
                                           p_cursor jsonb default null, p_limit int default 50)
returns setof contacts language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  f      jsonb := coalesce(p_filters, '{}'::jsonb);
  v_tags text[] := array(select lower(btrim(jsonb_array_elements_text(coalesce(f #> '{tags,values}', '[]')))));
  v_q    text := nullif(lower(btrim(f ->> 'q')), '');
begin
  return query
  select c.*
  from contacts c
  where c.workspace_id = p_workspace_id
    and c.merged_into is null and c.status = 'active'
    and (f -> 'lead_status' is null
         or c.lead_status::text in (select jsonb_array_elements_text(f -> 'lead_status')))
    and (f -> 'owner' is null
         or (coalesce((f #>> '{owner,me}')::boolean, false) and c.owner_id = auth.uid())
         or (coalesce((f #>> '{owner,unassigned}')::boolean, false) and c.owner_id is null)
         or c.owner_id::text in (select jsonb_array_elements_text(coalesce(f #> '{owner,ids}', '[]'))))
    and (f -> 'tags' is null or cardinality(v_tags) = 0
         or case coalesce(f #>> '{tags,mode}', 'any')
              when 'all'  then c.tags @> v_tags
              when 'none' then not (c.tags && v_tags)
              else c.tags && v_tags end)
    and (f -> 'responded' is null or not exists (
           select 1 from jsonb_array_elements(f -> 'responded') r
           where exists (select 1 from responses x
                         where x.contact_id = c.id and x.survey_id = (r ->> 'survey_id')::uuid
                           and (not coalesce((r ->> 'complete_only')::boolean, true) or x.status = 'complete'))
                 <> coalesce((r ->> 'has')::boolean, true)))
    and (f -> 'custom' is null or not exists (
           select 1 from jsonb_array_elements(f -> 'custom') cf
           where not coalesce(case cf ->> 'op'
             when 'is_set'     then c.custom ? (cf ->> 'key')
             when 'is_not_set' then not (c.custom ? (cf ->> 'key'))
             when 'eq'         then c.custom -> (cf ->> 'key') = cf -> 'value'
             when 'neq'        then c.custom -> (cf ->> 'key') is distinct from cf -> 'value'
             when 'contains'   then case jsonb_typeof(c.custom -> (cf ->> 'key'))
                                      when 'array' then c.custom -> (cf ->> 'key') @> jsonb_build_array(cf -> 'value')
                                      else position(lower(cf ->> 'value') in lower(c.custom ->> (cf ->> 'key'))) > 0 end
             when 'gt'  then case when jsonb_typeof(cf -> 'value') = 'number'
                                  then (c.custom ->> (cf ->> 'key'))::numeric > (cf ->> 'value')::numeric
                                  else c.custom ->> (cf ->> 'key') > cf ->> 'value' end
             when 'gte' then case when jsonb_typeof(cf -> 'value') = 'number'
                                  then (c.custom ->> (cf ->> 'key'))::numeric >= (cf ->> 'value')::numeric
                                  else c.custom ->> (cf ->> 'key') >= cf ->> 'value' end
             when 'lt'  then case when jsonb_typeof(cf -> 'value') = 'number'
                                  then (c.custom ->> (cf ->> 'key'))::numeric < (cf ->> 'value')::numeric
                                  else c.custom ->> (cf ->> 'key') < cf ->> 'value' end
             when 'lte' then case when jsonb_typeof(cf -> 'value') = 'number'
                                  then (c.custom ->> (cf ->> 'key'))::numeric <= (cf ->> 'value')::numeric
                                  else c.custom ->> (cf ->> 'key') <= cf ->> 'value' end
             else false end, false)))
    and (f ->> 'source' is null or c.source = f ->> 'source')
    and (f ->> 'follow_up' is null or case f ->> 'follow_up'
           when 'overdue'   then c.follow_up_at < current_date
           when 'due'       then c.follow_up_at <= current_date
           when 'this_week' then c.follow_up_at between current_date and current_date + 7
           when 'unset'     then c.follow_up_at is null
           else true end)
    and (f ->> 'created_from' is null or c.created_at >= (f ->> 'created_from')::timestamptz)
    and (f ->> 'created_to' is null or c.created_at < (f ->> 'created_to')::timestamptz)
    and (f ->> 'last_response_from' is null or c.last_response_at >= (f ->> 'last_response_from')::timestamptz)
    and (f ->> 'last_response_to' is null or c.last_response_at < (f ->> 'last_response_to')::timestamptz)
    and (v_q is null
         or position(v_q in coalesce(c.email, '')) > 0
         or position(v_q in lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))) > 0
         or position(v_q in lower(coalesce(c.company, ''))) > 0
         or position(v_q in coalesce(c.phone, '')) > 0)
    and (p_cursor is null
         or (c.updated_at, c.id) < ((p_cursor ->> 'updated_at')::timestamptz, (p_cursor ->> 'id')::uuid))
  order by c.updated_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- Candidate duplicate pairs (doc 04 section 2.4), capped at 500. SECURITY
-- INVOKER: RLS on contacts and responses applies.
create or replace function contact_duplicate_candidates(p_workspace_id uuid)
returns table (contact_a uuid, contact_b uuid, reason text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return query
  with live as (
    select c.id, c.email, c.phone,
           lower(coalesce(c.first_name, '') || coalesce(c.last_name, '')) as name_key,
           lower(btrim(coalesce(c.company, ''))) as company_key,
           split_part(c.email, '@', 1) as local_part,
           split_part(c.email, '@', 2) as domain,
           case when split_part(c.email, '@', 2) in ('gmail.com', 'googlemail.com')
                then replace(split_part(split_part(c.email, '@', 1), '+', 1), '.', '') || '@gmail.com'
                else split_part(split_part(c.email, '@', 1), '+', 1) || '@' || split_part(c.email, '@', 2) end as email_key
    from contacts c
    where c.workspace_id = p_workspace_id and c.merged_into is null and c.status = 'active'
  ), pairs as (
    select a.id as x, b.id as y, 'same_phone'::text as why
      from live a join live b on a.phone = b.phone and a.id < b.id
    union all
    select a.id, b.id, 'same_name_company'
      from live a join live b on a.name_key = b.name_key and a.company_key = b.company_key and a.id < b.id
     where a.name_key <> '' and a.company_key <> ''
    union all
    select a.id, b.id, 'email_variant'
      from live a join live b on a.email_key = b.email_key and a.id < b.id
     where a.email is not null and b.email is not null and a.email <> b.email
    union all
    select least(a.id, b.id), greatest(a.id, b.id), 'alt_email'
      from responses r
      join live a on a.id = r.contact_id
      join live b on b.email = r.metadata ->> 'alt_email' and b.id <> a.id
     where r.workspace_id = p_workspace_id and r.metadata ? 'alt_email'
    union all
    select a.id, b.id, 'similar_email'
      from live a join live b on a.domain = b.domain and a.id < b.id
     where a.email is not null and b.email is not null and a.email <> b.email
       and extensions.similarity(a.local_part, b.local_part) > 0.8
  )
  select distinct on (p.x, p.y) p.x, p.y, p.why
  from pairs p
  where not exists (select 1 from contact_duplicate_dismissals d
                    where d.workspace_id = p_workspace_id and d.contact_a = p.x and d.contact_b = p.y)
  order by p.x, p.y, p.why
  limit 500;
end $$;

-- CSV import chunk (doc 04 section 1.5). p_rows: array of objects with email,
-- phone, first_name, last_name, company, lead_status, tags[], owner_email,
-- custom{}. contact_imports.options: {on_match: skip|fill|overwrite (default
-- fill), default_tags[], default_status, default_owner, max_responses}.
-- Returns {created, updated, skipped, invalid, errors[{index, error}],
-- tokens[{index, contact_id, token}]} (tokens only when token_survey_id is set).
create or replace function import_contacts_chunk(p_import_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  imp       contact_imports;
  v_opts    jsonb;
  v_mode    text;
  v_row     jsonb;
  v_idx     int := -1;
  v_email   text;
  v_status  lead_status;
  v_owner   uuid;
  v_tags    text[];
  v_custom  jsonb;
  v_contact contacts;
  v_id      uuid;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_invalid int := 0;
  v_errors  jsonb := '[]';
  v_tokens  jsonb := '[]';
  v_token   text;
begin
  select * into imp from contact_imports where id = p_import_id for update;
  if imp.id is null or not is_member(imp.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if imp.status not in ('pending', 'running') then
    raise exception 'import_finished';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid_rows: expected an array of at most 500 rows';
  end if;
  v_opts := imp.options;
  v_mode := coalesce(v_opts ->> 'on_match', 'fill');
  perform set_config('survey.internal', 'on', true);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      v_email := nullif(lower(btrim(v_row ->> 'email')), '');
      if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'invalid email';
      end if;
      v_status := coalesce(nullif(v_row ->> 'lead_status', ''), v_opts ->> 'default_status', 'new')::lead_status;
      v_owner := null;
      if nullif(v_row ->> 'owner_email', '') is not null then
        select m.user_id into v_owner from workspace_members m join auth.users u on u.id = m.user_id
         where m.workspace_id = imp.workspace_id and lower(u.email) = lower(btrim(v_row ->> 'owner_email'));
      end if;
      v_owner := coalesce(v_owner, (v_opts ->> 'default_owner')::uuid);
      if v_owner is not null and not exists (select 1 from workspace_members
                                             where workspace_id = imp.workspace_id and user_id = v_owner) then
        v_owner := null;
      end if;
      v_tags := array(select jsonb_array_elements_text(coalesce(v_row -> 'tags', '[]')))
             || array(select jsonb_array_elements_text(coalesce(v_opts -> 'default_tags', '[]')));
      v_custom := validate_contact_custom(imp.workspace_id, coalesce(v_row -> 'custom', '{}'));

      select * into v_contact from contacts
       where workspace_id = imp.workspace_id and email = v_email and merged_into is null and status = 'active'
       for update;
      if v_contact.id is null then
        insert into contacts (workspace_id, email, phone, first_name, last_name, company, lead_status,
                              owner_id, tags, custom, source, created_by)
        values (imp.workspace_id, v_email, nullif(v_row ->> 'phone', ''), nullif(v_row ->> 'first_name', ''),
                nullif(v_row ->> 'last_name', ''), nullif(v_row ->> 'company', ''), v_status, v_owner, v_tags,
                v_custom, 'import', auth.uid())
        returning id into v_id;
        v_created := v_created + 1;
      elsif v_mode = 'skip' then
        v_id := v_contact.id;
        v_skipped := v_skipped + 1;
      elsif v_mode = 'overwrite' then
        update contacts set
          phone = coalesce(nullif(v_row ->> 'phone', ''), phone),
          first_name = coalesce(nullif(v_row ->> 'first_name', ''), first_name),
          last_name = coalesce(nullif(v_row ->> 'last_name', ''), last_name),
          company = coalesce(nullif(v_row ->> 'company', ''), company),
          lead_status = case when v_row ? 'lead_status' then v_status else lead_status end,
          owner_id = coalesce(v_owner, owner_id),
          tags = tags || v_tags,
          custom = custom || v_custom
        where id = v_contact.id returning id into v_id;
        v_updated := v_updated + 1;
      else
        update contacts set
          phone = coalesce(phone, nullif(v_row ->> 'phone', '')),
          first_name = coalesce(first_name, nullif(v_row ->> 'first_name', '')),
          last_name = coalesce(last_name, nullif(v_row ->> 'last_name', '')),
          company = coalesce(company, nullif(v_row ->> 'company', '')),
          owner_id = coalesce(owner_id, v_owner),
          tags = tags || v_tags,
          custom = v_custom || custom
        where id = v_contact.id returning id into v_id;
        v_updated := v_updated + 1;
      end if;

      if imp.token_survey_id is not null then
        insert into respondent_tokens (workspace_id, survey_id, contact_id, max_responses, created_by)
        select imp.workspace_id, imp.token_survey_id, v_id,
               greatest(coalesce((v_opts ->> 'max_responses')::int, 1), 1), auth.uid()
        where exists (select 1 from surveys where id = imp.token_survey_id and workspace_id = imp.workspace_id)
        on conflict (survey_id, contact_id) do nothing;
        select token into v_token from respondent_tokens where survey_id = imp.token_survey_id and contact_id = v_id;
        v_tokens := v_tokens || jsonb_build_object('index', v_idx, 'contact_id', v_id, 'token', v_token);
      end if;
    exception when others then
      v_invalid := v_invalid + 1;
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'error', sqlerrm);
    end;
  end loop;

  update contact_imports
     set status = 'running', created = created + v_created, updated = updated + v_updated,
         skipped = skipped + v_skipped, invalid = invalid + v_invalid
   where id = p_import_id;
  perform set_config('survey.internal', 'off', true);
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
                            'invalid', v_invalid, 'errors', v_errors, 'tokens', v_tokens);
end $$;

grant execute on function set_contact_custom(uuid, jsonb), search_contacts(uuid, jsonb, jsonb, int),
  contact_duplicate_candidates(uuid), import_contacts_chunk(uuid, jsonb)
  to authenticated;
grant execute on function validate_contact_custom(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table contacts                     enable row level security;
alter table contact_aliases              enable row level security;
alter table contact_notes                enable row level security;
alter table respondent_tokens            enable row level security;
alter table contact_field_defs           enable row level security;
alter table contact_views                enable row level security;
alter table contact_duplicate_dismissals enable row level security;
alter table contact_imports              enable row level security;

create policy contacts_select on contacts for select to authenticated using (is_member(workspace_id));
create policy contacts_insert on contacts for insert to authenticated with check (is_member(workspace_id, 'editor'));
create policy contacts_update on contacts for update to authenticated
  using (is_member(workspace_id, 'editor')) with check (is_member(workspace_id, 'editor'));

create policy contact_aliases_select on contact_aliases for select to authenticated using (is_member(workspace_id));

create policy contact_notes_select on contact_notes for select to authenticated using (is_member(workspace_id));
create policy contact_notes_insert on contact_notes for insert to authenticated
  with check (is_member(workspace_id, 'editor') and author = auth.uid()
              and exists (select 1 from contacts c where c.id = contact_id and c.workspace_id = contact_notes.workspace_id));
create policy contact_notes_update on contact_notes for update to authenticated
  using (author = auth.uid() and is_member(workspace_id, 'editor'))
  with check (author = auth.uid() and is_member(workspace_id, 'editor'));
create policy contact_notes_delete on contact_notes for delete to authenticated
  using ((author = auth.uid() and is_member(workspace_id, 'editor')) or is_member(workspace_id, 'admin'));

create policy respondent_tokens_select on respondent_tokens for select to authenticated using (is_member(workspace_id, 'editor'));
create policy respondent_tokens_insert on respondent_tokens for insert to authenticated
  with check (is_member(workspace_id, 'editor')
              and exists (select 1 from surveys s where s.id = survey_id and s.workspace_id = respondent_tokens.workspace_id)
              and exists (select 1 from contacts c where c.id = contact_id and c.workspace_id = respondent_tokens.workspace_id
                          and c.status = 'active' and c.merged_into is null));
create policy respondent_tokens_update on respondent_tokens for update to authenticated
  using (is_member(workspace_id, 'editor')) with check (is_member(workspace_id, 'editor'));
create policy respondent_tokens_delete on respondent_tokens for delete to authenticated using (is_member(workspace_id, 'editor'));

create policy contact_field_defs_select on contact_field_defs for select to authenticated using (is_member(workspace_id));
create policy contact_field_defs_insert on contact_field_defs for insert to authenticated with check (is_member(workspace_id, 'editor'));
create policy contact_field_defs_update on contact_field_defs for update to authenticated
  using (is_member(workspace_id, 'editor')) with check (is_member(workspace_id, 'editor'));

create policy contact_views_select on contact_views for select to authenticated
  using (is_member(workspace_id) and (shared or created_by = auth.uid()));
create policy contact_views_insert on contact_views for insert to authenticated
  with check (created_by = auth.uid() and not builtin
              and ((not shared and is_member(workspace_id)) or (shared and is_member(workspace_id, 'editor'))));
create policy contact_views_update on contact_views for update to authenticated
  using ((created_by = auth.uid() and is_member(workspace_id)) or (shared and is_member(workspace_id, 'editor')))
  with check ((created_by = auth.uid() and is_member(workspace_id)) or (shared and is_member(workspace_id, 'editor')));
create policy contact_views_delete on contact_views for delete to authenticated
  using (not builtin and ((created_by = auth.uid() and is_member(workspace_id))
                          or (shared and is_member(workspace_id, 'editor'))));

create policy contact_dismissals_select on contact_duplicate_dismissals for select to authenticated using (is_member(workspace_id));
create policy contact_dismissals_insert on contact_duplicate_dismissals for insert to authenticated
  with check (is_member(workspace_id, 'editor') and dismissed_by = auth.uid()
              and exists (select 1 from contacts c where c.id = contact_a and c.workspace_id = contact_duplicate_dismissals.workspace_id)
              and exists (select 1 from contacts c where c.id = contact_b and c.workspace_id = contact_duplicate_dismissals.workspace_id));
create policy contact_dismissals_delete on contact_duplicate_dismissals for delete to authenticated using (is_member(workspace_id, 'editor'));

create policy contact_imports_select on contact_imports for select to authenticated using (is_member(workspace_id, 'editor'));
create policy contact_imports_insert on contact_imports for insert to authenticated
  with check (is_member(workspace_id, 'editor') and created_by = auth.uid() and status = 'pending'
              and created = 0 and updated = 0 and skipped = 0 and invalid = 0
              and (token_survey_id is null
                   or exists (select 1 from surveys s where s.id = token_survey_id and s.workspace_id = contact_imports.workspace_id)));
