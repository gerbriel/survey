-- Migration 0021 (workspace image library): a non-member and a viewer cannot
-- register, an editor can, path validation refuses absolute URLs, dot
-- segments and paths outside {workspace_id}/images/{id}.{ext}, labels and
-- soft delete are editor only and logged, a deleted image leaves the list,
-- Storage RLS lets an editor (not a viewer) write under images/, and the anon
-- invariant still holds.
begin;

select tests.new_user('owner');
select tests.new_user('editor1');
select tests.new_user('viewer1');
select tests.new_user('outsider');
select tests.new_workspace('acme', tests.id('owner'));
select tests.new_workspace('other', tests.id('outsider'));
select tests.add_member(tests.id('acme'), tests.id('editor1'), 'editor');
select tests.add_member(tests.id('acme'), tests.id('viewer1'), 'viewer');

select tests.put('img1', gen_random_uuid());
select tests.put('img2', gen_random_uuid());

-- Storage objects the route would have uploaded (postgres, bypassing RLS).
reset role;
select tests.clear_claims();
insert into storage.objects (bucket_id, name, metadata) values
  ('public-assets', tests.id('acme') || '/images/' || tests.id('img1') || '.png', '{"size": 1000, "mimetype": "image/png"}'),
  ('public-assets', tests.id('acme') || '/images/' || tests.id('img2') || '.webp', '{"size": 2000, "mimetype": "image/webp"}'),
  ('public-assets', tests.id('other') || '/images/' || tests.id('img2') || '.webp', '{"size": 2000, "mimetype": "image/webp"}');
-- Hostile object names, so the constraint (not the existence check) is what refuses them.
insert into storage.objects (bucket_id, name) values
  ('public-assets', 'https://evil.example/x.png'),
  ('public-assets', tests.id('acme') || '/images/../logo.png'),
  ('public-assets', '/' || tests.id('acme') || '/images/' || tests.id('img1') || '.png');

-- A non-member cannot register into acme.
select tests.as_user('outsider');
do $$ begin
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/png', 1000)$q$,
    tests.id('acme'), tests.id('img1'), tests.id('acme') || '/images/' || tests.id('img1') || '.png')) = 'not_authorized',
    'non-member cannot register';
  assert tests.err(format('select * from public.list_workspace_images(%L)', tests.id('acme'))) = 'not_authorized',
    'non-member cannot list';
  assert (select count(*) from public.workspace_images where workspace_id = tests.id('acme')) = 0, 'non-member reads nothing';
end $$;

-- A viewer cannot register.
select tests.as_user('viewer1');
do $$ begin
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/png', 1000)$q$,
    tests.id('acme'), tests.id('img1'), tests.id('acme') || '/images/' || tests.id('img1') || '.png')) = 'not_authorized',
    'viewer cannot register';
end $$;

-- Clients have no direct write path.
select tests.as_user('editor1');
do $$ begin
  assert tests.err(format($q$insert into public.workspace_images (workspace_id, path, bytes, mime)
                             values (%L, 'x/images/y.png', 10, 'image/png')$q$, tests.id('acme')))
         like '%permission denied%', 'no direct insert for members';
end $$;

-- Path validation.
do $$
declare v_ws uuid := tests.id('acme'); v_id uuid := tests.id('img1');
begin
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, '//evil.example/x.png', 'header', 'image/png', 1000)$q$, v_ws, v_id))
         is not null, 'protocol relative refused';
  -- Even when an object with that name exists, the check constraint refuses it.
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, 'https://evil.example/x.png', 'header', 'image/png', 1000)$q$, v_ws, v_id))
         like '%violates check constraint%', 'absolute URL object name refused by the constraint';
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/png', 1000)$q$, v_ws, v_id, v_ws || '/images/../logo.png'))
         like '%violates check constraint%', 'dot segment refused';
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/png', 1000)$q$, v_ws, v_id, '/' || v_ws || '/images/' || v_id || '.png'))
         like '%violates check constraint%', 'leading slash refused';
  -- Another workspace's folder, or a name that is not {id}.{ext}.
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/webp', 2000)$q$, v_ws, tests.id('img2'), tests.id('other') || '/images/' || tests.id('img2') || '.webp'))
         like '%workspace_images_upload_path%', 'path in another workspace refused';
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/webp', 2000)$q$, v_ws, v_id, v_ws || '/images/' || tests.id('img2') || '.webp'))
         like '%workspace_images_upload_path%', 'path must carry the image id';
  -- An object that does not exist.
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/png', 1000)$q$, v_ws, v_id, v_ws || '/images/' || gen_random_uuid() || '.png'))
         = 'not_found', 'missing object refused';
  -- Type and size checks.
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/svg+xml', 1000)$q$, v_ws, v_id, v_ws || '/images/' || v_id || '.png'))
         like '%violates check constraint%', 'svg refused';
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'header', 'image/png', 3000000)$q$, v_ws, v_id, v_ws || '/images/' || v_id || '.png'))
         like '%violates check constraint%', 'over 2 MB refused';
  assert tests.err(format($q$select public.register_workspace_image(%L, %L, %L, 'banner', 'image/png', 1000)$q$, v_ws, v_id, v_ws || '/images/' || v_id || '.png'))
         like '%violates check constraint%', 'unknown kind refused';
end $$;

-- An editor registers two images.
do $$
declare r public.workspace_images;
begin
  r := public.register_workspace_image(tests.id('acme'), tests.id('img1'), tests.id('acme') || '/images/' || tests.id('img1') || '.png',
                                       'header', 'image/png', 1000, 1600, 400, '  Spring header  ');
  assert r.id = tests.id('img1') and r.source = 'upload' and r.label = 'Spring header' and r.created_by = tests.id('editor1'),
    'row registered with the caller and a trimmed label';
  perform public.register_workspace_image(tests.id('acme'), tests.id('img2'), tests.id('acme') || '/images/' || tests.id('img2') || '.webp',
                                          'other', 'image/webp', 2000);
  assert (select count(*) from public.list_workspace_images(tests.id('acme'))) = 2, 'two images listed';
end $$;

-- The viewer reads the list but cannot label or delete.
select tests.as_user('viewer1');
do $$ begin
  assert (select count(*) from public.list_workspace_images(tests.id('acme'))) = 2, 'viewer lists';
  assert tests.err(format($q$select public.set_workspace_image_label(%L, 'x')$q$, tests.id('img1'))) = 'not_authorized', 'viewer cannot label';
  assert tests.err(format('select public.delete_workspace_image(%L)', tests.id('img1'))) = 'not_authorized', 'viewer cannot delete';
end $$;

-- The editor labels and soft deletes; the list hides it, the row stays.
select tests.as_user('editor1');
do $$ begin
  perform public.set_workspace_image_label(tests.id('img2'), 'Team photo');
  assert (select label from public.workspace_images where id = tests.id('img2')) = 'Team photo', 'label set';
  assert tests.err(format($q$select public.set_workspace_image_label(%L, %L)$q$, tests.id('img2'), repeat('x', 121)))
         like '%violates check constraint%', 'label length capped';
  perform public.delete_workspace_image(tests.id('img1'));
  assert (select count(*) from public.list_workspace_images(tests.id('acme'))) = 1, 'deleted image leaves the list';
  assert not exists (select 1 from public.list_workspace_images(tests.id('acme')) where id = tests.id('img1')), 'img1 hidden';
  assert (select deleted_at is not null from public.workspace_images where id = tests.id('img1')), 'soft deleted, row kept';
  assert tests.err(format('select public.delete_workspace_image(%L)', tests.id('img1'))) = 'not_found', 'second delete is not_found';
  assert tests.err(format($q$select public.set_workspace_image_label(%L, 'x')$q$, tests.id('img1'))) = 'not_found', 'deleted image cannot be labeled';
end $$;

reset role;
select tests.clear_claims();
do $$ begin
  assert (select count(*) from public.activity_log where entity = 'image' and workspace_id = tests.id('acme')) = 4,
    'create, create, update, delete logged';
  assert (select actor from public.activity_log where entity = 'image' and action = 'delete') = tests.id('editor1'), 'actor recorded';
end $$;

-- Storage RLS: an editor may upload under images/, a viewer may not.
select tests.as_user('editor1');
do $$ begin
  assert tests.err(format($q$insert into storage.objects (bucket_id, name) values ('public-assets', %L)$q$,
    tests.id('acme') || '/images/' || gen_random_uuid() || '.png')) is null, 'editor uploads under images/';
end $$;
select tests.as_user('viewer1');
do $$ begin
  assert tests.err(format($q$insert into storage.objects (bucket_id, name) values ('public-assets', %L)$q$,
    tests.id('acme') || '/images/' || gen_random_uuid() || '.png')) like '%row-level security%', 'viewer cannot upload';
end $$;

-- Anon: no table access, no function access.
select tests.as_anon();
do $$ begin
  assert tests.err('select 1 from public.workspace_images limit 1') like '%permission denied%', 'anon read workspace_images';
  assert tests.err(format('select * from public.list_workspace_images(%L)', tests.id('acme'))) like '%permission denied%', 'anon list';
end $$;
reset role;
select tests.clear_claims();

-- Anon invariant (same assertion as 01_anon_privileges.sql).
do $$
declare
  v_tables text[];
  v_funcs  text[];
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and ((c.relkind in ('r', 'v', 'm', 'p', 'f')
          and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
      or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')));
  assert v_tables is null, format('anon holds table privileges on: %s', v_tables);

  select array_agg(p.proname::text order by p.proname) into v_funcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert v_funcs = array['get_public_definition', 'resolve_public_survey'],
    format('anon can execute: %s', v_funcs);
end $$;

rollback;
