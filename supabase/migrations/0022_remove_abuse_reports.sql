-- 0022: remove abuse reports (R21). The public Report abuse form, its route
-- and the admin queue are gone, so the table and its review function go too.
-- Idempotent: every drop uses if exists.
--
-- Nothing else needs to change:
-- * platform_audit_log.target_type is free text (0002), not an enum or check,
--   so old 'abuse_report' rows stay readable as history.
-- * workspace_activity entity 'report' (0003) means survey reports, not abuse.
-- * 'report' stays in reserved_public_segments (0018) and in the TS reserved
--   alias list, so the two lists stay in sync without touching that function.

drop function if exists admin_set_abuse_report_status(uuid, text);

-- Policies and the partial index go with the table.
drop table if exists abuse_reports;

-- Anon invariant (AGENTS.md rule 2), restated as in 0019 and 0020.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function resolve_public_survey(text)       to anon, authenticated, service_role;
grant execute on function get_public_definition(uuid, text) to anon;
