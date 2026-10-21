-- Invariant (docs/01 section 11, AGENTS.md rule 2): anon has zero table
-- privileges in public and can execute exactly resolve_public_survey and
-- get_public_definition.
begin;

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

-- Behavioral check as the anon role itself.
select tests.as_anon();
do $$
begin
  assert tests.err('select 1 from public.surveys limit 1') like '%permission denied%', 'anon read surveys';
  assert tests.err('select 1 from public.responses limit 1') like '%permission denied%', 'anon read responses';
  assert tests.err('insert into public.abuse_reports (slug_text, reason) values (''x'', ''other'')') like '%permission denied%',
    'anon insert abuse_reports';
  assert tests.err('select public.is_member(gen_random_uuid())') like '%permission denied%', 'anon execute is_member';
  assert tests.err('select public.submit_response(''{}''::jsonb)') like '%permission denied%', 'anon execute submit_response';
  assert (select count(*) from public.resolve_public_survey('no-such-survey')) = 0, 'unknown key resolves to nothing';
  assert (select count(*) from public.get_public_definition(gen_random_uuid(), 'no-such-survey')) = 0,
    'unknown key has no definition';
end $$;

rollback;
