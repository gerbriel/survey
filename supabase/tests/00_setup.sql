-- Shared test helpers in schema `tests`. Not part of the app schema: created
-- by the test run, wiped by the next `supabase db reset`. Each numbered file
-- runs inside begin ... rollback, so fixtures never persist.
--
-- Simulating callers:
--   select tests.as_user('editor');   -- authenticated with that fixture user's JWT
--   select tests.as_anon();           -- anon
--   select tests.as_service();        -- service_role
--   reset role; select tests.clear_claims();   -- back to postgres, no JWT
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create table if not exists tests.fx (name text primary key, id uuid not null);
grant select, insert, update on tests.fx to anon, authenticated, service_role;

create or replace function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.fx where name = p_name $$;

create or replace function tests.put(p_name text, p_id uuid) returns uuid
language sql as $$
  insert into tests.fx (name, id) values (p_name, p_id)
  on conflict (name) do update set id = excluded.id returning id $$;

create or replace function tests.clear_claims() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;

-- Creates an auth user (the signup trigger creates the profile) and sets status.
create or replace function tests.new_user(p_name text, p_status public.profile_status default 'active',
                                          p_platform_admin boolean default false) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform tests.clear_claims();
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_name || '@test.local', jsonb_build_object('full_name', p_name));
  update public.profiles set status = p_status, is_platform_admin = p_platform_admin where id = v_id;
  return tests.put(p_name, v_id);
end $$;

create or replace function tests.new_workspace(p_name text, p_owner uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  perform tests.clear_claims();
  insert into public.workspaces (name, slug) values (p_name, lower(p_name) || '-' || substr(md5(random()::text), 1, 6))
  returning id into v_id;
  perform set_config('survey.owner_write', 'on', true);
  insert into public.workspace_members (workspace_id, user_id, role) values (v_id, p_owner, 'owner');
  perform set_config('survey.owner_write', 'off', true);
  return tests.put(p_name, v_id);
end $$;

create or replace function tests.add_member(p_workspace uuid, p_user uuid, p_role public.workspace_role) returns void
language sql as $$ insert into public.workspace_members (workspace_id, user_id, role) values (p_workspace, p_user, p_role) $$;

create or replace function tests.as_user(p_name text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', tests.id(p_name), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;

-- Runs a statement and returns the error message, or null when it succeeded.
create or replace function tests.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A published, open copy of the Lead capture system template. Run as postgres.
-- Returns the survey id; fixture names '<name>' (survey) and '<name>_v1' (published version).
create or replace function tests.published_survey(p_name text, p_workspace uuid, p_editor text) returns uuid
language plpgsql as $$
declare
  v_survey  uuid;
  v_version uuid;
  v_def     jsonb;
begin
  perform tests.as_user(p_editor);
  v_survey := public.create_survey(p_workspace, p_name, '00000000-0000-4000-8000-000000000003');
  select current_draft_version_id into v_version from public.surveys where id = v_survey;
  perform public.take_draft_lock(v_version, false);
  select definition into v_def from public.survey_versions where id = v_version;
  perform public.publish_survey_version(v_version, 0, v_def);
  update public.surveys set state = 'open' where id = v_survey;
  perform set_config('role', 'none', true);
  perform tests.clear_claims();
  perform tests.put(p_name || '_v1', v_version);
  return tests.put(p_name, v_survey);
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
