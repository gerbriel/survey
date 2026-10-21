-- seed.sql: loaded by `supabase db reset` after every migration. Idempotent:
-- every statement can run any number of times.
--
-- What lives where
--   * System survey templates: migration 0005 (fixed ids, on conflict do
--     nothing) so production gets them from `supabase db push` too.
--   * Stopwords: migration 0009, same reason.
--   * Built-in contact views: created for every new workspace by the
--     workspaces_builtin_views trigger (0007), which admin_create_workspace
--     fires. The backfill below covers any workspace created before it.
--   * The platform settings singleton: migration 0002.
--
-- First platform admin
--   Seed cannot create auth.users rows, so the first admin is promoted by
--   hand after their first sign-in (Google or email). Their profile starts
--   'pending'. Run this once in the SQL editor (or psql) as postgres, with the
--   owner's email in place of ${PLATFORM_ADMIN_EMAIL}:
--
--     update public.profiles p
--        set status = 'active', is_platform_admin = true
--       from auth.users u
--      where u.id = p.id and lower(u.email) = lower('${PLATFORM_ADMIN_EMAIL}');
--
--   The profile guard allows it because a direct SQL session has no JWT
--   (is_trusted_caller). From then on that admin issues platform invites and
--   creates workspaces in /admin.
--
--   The CLI runs this file without psql, so no meta-commands and no
--   variable substitution happen here; the statement above stays a comment.

-- Platform settings singleton (also inserted by 0002).
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

-- Backfill built-in contact views for any existing workspace.
select public.create_builtin_contact_views(id) from public.workspaces;
