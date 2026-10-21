-- 0015: jobs that touch Storage, run from Vercel Cron with the service role
-- (R3): retention_batch, storage_sweep_batch, complete_storage_deletions,
-- workspace_purge_due, purge_workspace; plus platform_storage_usage for
-- platform admins. Spec: docs/01-data-model.md sections 2, 6, 12, 13.

create or replace function retention_batch(p_workspace_id uuid, p_limit int default 1000)
returns table (deletion_id bigint, bucket text, path text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_days int;
  v_ids  uuid[];
begin
  if not is_service_role() then
    raise exception 'not_authorized';
  end if;
  select w.retention_days into v_days from workspaces w where w.id = p_workspace_id;
  if v_days is not null then
    v_ids := array(select r.id from responses r
                    where r.workspace_id = p_workspace_id
                      and coalesce(r.submitted_at, r.started_at) < now() - make_interval(days => v_days)
                    order by coalesce(r.submitted_at, r.started_at)
                    limit least(greatest(coalesce(p_limit, 1000), 1), 5000));
    perform set_config('survey.deletion_reason', 'retention', true);
    delete from events e where e.response_id = any (v_ids);
    delete from responses r where r.id = any (v_ids);      -- answers and file rows cascade, files enqueue
    perform set_config('survey.deletion_reason', '', true);
  end if;
  return query
    select d.id, d.bucket, d.path from storage_deletions d
     where d.workspace_id = p_workspace_id and d.done_at is null and d.attempts < 10
     order by d.id limit 1000;
end $$;

-- Strip a leading bucket name from a stored path ("imports/{ws}/x.csv" becomes "{ws}/x.csv").
create or replace function storage_object_name(p_bucket text, p_path text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when p_path like p_bucket || '/%' then substr(p_path, length(p_bucket) + 2) else p_path end;
$$;

-- Deletes pending uploads older than 24 hours, enqueues export files older
-- than 7 days and import CSVs older than 30 days (nulling storage_path), then
-- returns undone deletions across all workspaces.
create or replace function storage_sweep_batch(p_limit int default 500)
returns table (deletion_id bigint, bucket text, path text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_n     int;
begin
  if not is_service_role() then
    raise exception 'not_authorized';
  end if;
  perform set_config('survey.deletion_reason', 'orphan', true);
  delete from response_files f
   where f.id in (select x.id from response_files x
                   where x.status = 'pending' and x.created_at < now() - interval '24 hours'
                   order by x.created_at limit v_limit);
  perform set_config('survey.deletion_reason', '', true);

  with sel as (
    select x.id, x.workspace_id, x.storage_path from export_jobs x
     where x.storage_path is not null and coalesce(x.finished_at, x.created_at) < now() - interval '7 days'
     limit v_limit for update
  ), ins as (
    insert into storage_deletions (bucket, path, workspace_id, reason)
    select 'exports', storage_object_name('exports', sel.storage_path), sel.workspace_id, 'export_expired' from sel
  ), upd as (
    update export_jobs j set storage_path = null from sel where j.id = sel.id
  )
  select count(*) into v_n from sel;

  with sel as (
    select x.id, x.workspace_id, x.storage_path from contact_imports x
     where x.storage_path is not null and x.created_at < now() - interval '30 days'
     limit v_limit for update
  ), ins as (
    insert into storage_deletions (bucket, path, workspace_id, reason)
    select 'imports', storage_object_name('imports', sel.storage_path), sel.workspace_id, 'import_expired' from sel
  ), upd as (
    update contact_imports j set storage_path = null from sel where j.id = sel.id
  )
  select count(*) into v_n from sel;

  return query
    select d.id, d.bucket, d.path from storage_deletions d
     where d.done_at is null and d.attempts < 10
     order by d.id limit v_limit;
end $$;

-- p_failed: [{"id": 123, "error": "..."}]
create or replace function complete_storage_deletions(p_done bigint[], p_failed jsonb default '[]') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_service_role() then
    raise exception 'not_authorized';
  end if;
  update storage_deletions set done_at = now() where id = any (coalesce(p_done, '{}')) and done_at is null;
  update storage_deletions d
     set attempts = d.attempts + 1, last_error = left(f ->> 'error', 1000)
    from jsonb_array_elements(case when jsonb_typeof(p_failed) = 'array' then p_failed else '[]'::jsonb end) f
   where d.id = (f ->> 'id')::bigint and d.done_at is null;
end $$;

create or replace function workspace_purge_due(p_limit int default 10) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id from workspaces w
  where is_service_role() and w.deleted_at is not null and w.deleted_at <= now() - interval '30 days'
  order by w.deleted_at
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- Hard delete after the 30 day restore window. Writes the platform audit row,
-- holds the slug and every alias for 30 more days, enqueues every Storage
-- object under {workspace_id}/, then deletes the row (everything cascades).
create or replace function purge_workspace(p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w        workspaces;
  v_counts jsonb;
begin
  if not is_service_role() then
    raise exception 'not_authorized';
  end if;
  select * into w from workspaces where id = p_workspace_id for update;
  if w.id is null or w.deleted_at is null or w.deleted_at > now() - interval '30 days' then
    raise exception 'not_due';
  end if;
  v_counts := jsonb_build_object(
    'surveys',   (select count(*) from surveys where workspace_id = w.id),
    'responses', (select count(*) from responses where workspace_id = w.id),
    'contacts',  (select count(*) from contacts where workspace_id = w.id),
    'bytes',     (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o
                   where o.bucket_id in ('public-assets', 'response-files', 'exports', 'imports')
                     and o.name like w.id::text || '/%'));
  perform write_platform_audit('workspace.purge', 'workspace', w.id, jsonb_build_object(
    'name', w.name, 'slug', w.slug, 'deleted_by', w.deleted_by, 'deleted_at', w.deleted_at,
    'owner', (select user_id from workspace_members where workspace_id = w.id and role = 'owner'),
    'counts', v_counts));

  insert into workspace_slug_history (slug, workspace_id, released_at) values (w.slug, null, now())
    on conflict (slug) do update set workspace_id = null, released_at = now();
  update workspace_slug_history set workspace_id = null where workspace_id = w.id;

  perform set_config('survey.purge', 'on', true);
  update survey_aliases set retired_at = coalesce(retired_at, now()) where workspace_id = w.id;

  insert into storage_deletions (bucket, path, workspace_id, reason)
  select o.bucket_id, o.name, w.id, 'workspace_delete' from storage.objects o
   where o.bucket_id in ('public-assets', 'response-files', 'exports', 'imports')
     and o.name like w.id::text || '/%';

  perform set_config('survey.deletion_reason', 'workspace_delete', true);
  delete from workspaces where id = w.id;
  perform set_config('survey.deletion_reason', '', true);
  perform set_config('survey.purge', 'off', true);
  return v_counts;
end $$;

-- Platform admin: bytes per workspace from storage.objects (no quota in v1).
create or replace function platform_storage_usage()
returns table (workspace_id uuid, name text, slug text, bytes bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  return query
    select w.id, w.name, w.slug,
           coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                     where o.bucket_id in ('public-assets', 'response-files', 'exports', 'imports')
                       and o.name like w.id::text || '/%'), 0)::bigint
    from workspaces w order by 4 desc;
end $$;

grant execute on function retention_batch(uuid, int), storage_sweep_batch(int),
  complete_storage_deletions(bigint[], jsonb), workspace_purge_due(int), purge_workspace(uuid)
  to service_role;
grant execute on function platform_storage_usage() to authenticated;
