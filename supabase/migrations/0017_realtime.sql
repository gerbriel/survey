-- 0017: Realtime on responses only (docs/01 section 14), then a final
-- privilege sweep that re-establishes the anon invariant:
-- anon holds no table privilege in public and may execute exactly
-- resolve_public_survey and get_public_definition.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'responses') then
    alter publication supabase_realtime add table public.responses;
  end if;
end $$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function resolve_public_survey(text)       to anon;
grant execute on function get_public_definition(uuid, text) to anon;
