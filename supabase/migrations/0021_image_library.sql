-- 0021: workspace image library (doc 03 section 8.1). Survey header (cover)
-- images, workspace logos and other images uploaded once and reused from the
-- builder's theme editor.
--
--   workspace_images            one row per uploaded image, soft deleted
--   register_workspace_image    editor and above, after the object exists
--   set_workspace_image_label   editor and above
--   delete_workspace_image      editor and above, soft delete
--   list_workspace_images       every member, live rows only
--
-- Same discipline as 0018 to 0020: SECURITY DEFINER with search_path =
-- public, pg_temp, input checks, explicit grants, RLS for reads, every write
-- through a function, each write logged to activity_log (entity 'image').
--
-- Storage: objects live in public-assets at {workspace_id}/images/{id}.{ext}.
-- The 0008 policy "public-assets member write" already lets an editor insert
-- any non-logo object under the workspace folder, so images/ needs no new
-- policy; supabase/tests/12_image_library.sql pins that. Public read by URL
-- is unchanged.
--
-- The starter headers (public/headers/*.svg) ship with the app and are not
-- rows here. Decision: source 'starter' is kept in the check for a future
-- seeded copy, but register_workspace_image only writes 'upload'.
--
-- Existing data: none. New table only; nothing is updated or deleted.

-- ===========================================================================
-- Table
-- ===========================================================================
create table workspace_images (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         text not null default 'header' check (kind in ('header', 'logo', 'other')),
  -- Object name inside public-assets. D-17 rules, same as logo_path and
  -- ASSET_OBJECT_NAME_RE in src/lib/db/rpc.ts: relative, no scheme, no
  -- leading slash, no `..`, no backslash, no empty segment.
  path         text not null
               check (length(path) <= 500
                      and path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
                      and position('..' in path) = 0
                      and position('//' in path) = 0),
  width        int check (width is null or width between 1 and 20000),
  height       int check (height is null or height between 1 and 20000),
  bytes        bigint not null check (bytes between 1 and 2097152),
  mime         text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  label        text not null default '' check (length(label) <= 120),
  source       text not null default 'upload' check (source in ('upload', 'starter')),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  -- An upload lives exactly at {workspace_id}/images/{id}.{ext}, so a row can
  -- never point into another workspace's folder or at a logo.
  constraint workspace_images_upload_path check (
    source <> 'upload'
    or path ~ ('^' || workspace_id::text || '/images/' || id::text || '\.(png|jpg|webp)$')
  )
);
create index workspace_images_live on workspace_images (workspace_id, created_at desc) where deleted_at is null;

alter table workspace_images enable row level security;
-- Members read (soft deleted rows included, for history); writes only through
-- the functions below, which run as the table owner.
create policy workspace_images_select on workspace_images for select to authenticated
  using (is_member(workspace_id));
revoke all on workspace_images from public, anon, authenticated;
grant select on workspace_images to authenticated;
grant all on workspace_images to service_role;

-- ===========================================================================
-- Functions
-- ===========================================================================

-- Registers an object the caller already uploaded. The object must exist in
-- public-assets under that exact name, so a row never points at nothing.
create or replace function register_workspace_image(
  p_workspace_id uuid,
  p_id           uuid,
  p_path         text,
  p_kind         text,
  p_mime         text,
  p_bytes        bigint,
  p_width        int default null,
  p_height       int default null,
  p_label        text default ''
) returns workspace_images
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r workspace_images;
begin
  if p_workspace_id is null or not is_member(p_workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  if p_id is null or p_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'public-assets' and o.name = p_path) then
    raise exception 'not_found';
  end if;
  insert into workspace_images (id, workspace_id, kind, path, width, height, bytes, mime, label, source, created_by)
  values (p_id, p_workspace_id, coalesce(p_kind, 'header'), p_path, p_width, p_height, p_bytes, p_mime,
          btrim(coalesce(p_label, '')), 'upload', (select id from profiles where id = auth.uid()))
  returning * into r;
  perform write_activity(p_workspace_id, 'image', r.id, 'create',
    jsonb_build_object('path', jsonb_build_array(null, r.path), 'kind', jsonb_build_array(null, r.kind)));
  return r;
end $$;

-- Internal: the image's workspace, locked, after the editor check. Deleted
-- and unknown images are the same not_found.
create or replace function image_for_write(p_image_id uuid) returns workspace_images
language plpgsql security definer set search_path = public, pg_temp as $$
declare r workspace_images;
begin
  select * into r from workspace_images where id = p_image_id and deleted_at is null for update;
  if r.id is null then
    raise exception 'not_found';
  end if;
  if not is_member(r.workspace_id, 'editor') then
    raise exception 'not_authorized';
  end if;
  return r;
end $$;
revoke all on function image_for_write(uuid) from public, anon, authenticated;

create or replace function set_workspace_image_label(p_image_id uuid, p_label text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r       workspace_images := image_for_write(p_image_id);
  v_label text := btrim(coalesce(p_label, ''));
begin
  if v_label = r.label then
    return;
  end if;
  update workspace_images set label = v_label where id = r.id;
  perform write_activity(r.workspace_id, 'image', r.id, 'update',
    jsonb_build_object('label', jsonb_build_array(r.label, v_label)));
end $$;

-- Decision: soft delete only, and the Storage object stays. Published survey
-- versions are frozen and may still reference the path, so removing the file
-- would break a live page. The object goes with the workspace purge.
create or replace function delete_workspace_image(p_image_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r workspace_images := image_for_write(p_image_id);
begin
  update workspace_images set deleted_at = now() where id = r.id;
  perform write_activity(r.workspace_id, 'image', r.id, 'delete',
    jsonb_build_object('path', jsonb_build_array(r.path, null)));
end $$;

-- Live images for a workspace, newest first. Every member.
create or replace function list_workspace_images(p_workspace_id uuid) returns setof workspace_images
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_member(p_workspace_id) then
    raise exception 'not_authorized';
  end if;
  return query
    select * from workspace_images
     where workspace_id = p_workspace_id and deleted_at is null
     order by created_at desc, id;
end $$;

revoke all on function register_workspace_image(uuid, uuid, text, text, text, bigint, int, int, text),
  set_workspace_image_label(uuid, text), delete_workspace_image(uuid), list_workspace_images(uuid)
  from public, anon;
grant execute on function register_workspace_image(uuid, uuid, text, text, text, bigint, int, int, text),
  set_workspace_image_label(uuid, text), delete_workspace_image(uuid), list_workspace_images(uuid)
  to authenticated, service_role;
