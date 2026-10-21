-- 0001: extensions, enums, default privilege revokes, shared helpers.
-- Spec: docs/01-data-model.md sections 1 and 15.
--
-- Supabase installs extension objects in the `extensions` schema. Every
-- function here pins `search_path = public, pg_temp`, so pgcrypto and pg_trgm
-- objects are always schema qualified (`extensions.gen_random_bytes`).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;   -- gen_random_bytes, digest, crypt
create extension if not exists pg_trgm  with schema extensions;   -- duplicate contact detection (doc 04)
create extension if not exists pg_cron with schema pg_catalog;    -- pure SQL housekeeping only (0016)

-- Declaration order is the role order, so `role >= 'editor'` works.
create type workspace_role     as enum ('viewer', 'editor', 'admin', 'owner');
create type profile_status     as enum ('pending', 'active', 'disabled', 'deleted');  -- disabled = deactivated by a platform admin (doc 05)
create type survey_state       as enum ('draft', 'open', 'closed', 'scheduled');
create type version_status     as enum ('draft', 'published');
create type response_status    as enum ('partial', 'complete');
create type lead_status        as enum ('new', 'contacted', 'qualified', 'customer', 'lost');
create type pixel_type         as enum ('ga4', 'meta', 'gtm', 'custom_script');      -- doc 02
create type pixel_consent_mode as enum ('banner', 'notice', 'in_form');              -- R7

-- ---------------------------------------------------------------------------
-- Privileges. Invariant (asserted by supabase/tests after 0017): anon holds no
-- table privilege in public and may execute exactly two functions,
-- resolve_public_survey and get_public_definition.
--
-- Supabase grants execute on new public functions to anon and authenticated
-- through per-schema default privileges, and Postgres grants execute to PUBLIC
-- globally. A per-schema revoke cannot remove a global default, so both forms
-- run. Every function is then granted explicitly to the roles that need it.
-- ---------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- updated_at maintenance for every table that has the column.
create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- n random bytes as URL-safe base64 without padding. Used for invite tokens,
-- respondent tokens, share tokens and resume secrets. Column defaults call it,
-- so authenticated (inserting invites, tokens, shares) needs execute.
create or replace function gen_token(n int) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if n is null or n < 8 or n > 64 then
    raise exception 'gen_token: n must be between 8 and 64';
  end if;
  return translate(encode(extensions.gen_random_bytes(n), 'base64'), E'+/=\n', '-_');
end $$;
grant execute on function gen_token(int) to authenticated, service_role;

-- Transaction-local guard flags. Internal security definer functions raise a
-- flag with set_config('survey.<flag>', 'on', true) to pass a guard trigger.
-- Clients cannot set custom GUCs through PostgREST.
create or replace function flag_on(p_name text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting(p_name, true), '') = 'on';
$$;

-- True for the service role and for direct SQL sessions (no JWT at all), the
-- only callers allowed past guards without a flag. Anon never reaches a guard:
-- it has no table privileges.
create or replace function is_trusted_caller() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select auth.uid() is null
      or coalesce(auth.role(), '') = 'service_role';
$$;

create or replace function is_service_role() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

grant execute on function flag_on(text), is_trusted_caller(), is_service_role() to authenticated, service_role;

-- sha256 hex, used for definition hashes, label hashes, resume secrets.
create or replace function sha256_hex(p_text text) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select encode(extensions.digest(convert_to(coalesce(p_text, ''), 'UTF8'), 'sha256'), 'hex');
$$;
grant execute on function sha256_hex(text) to authenticated, service_role;
