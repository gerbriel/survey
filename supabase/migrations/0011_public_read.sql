-- 0011: the anon read path. resolve_public_survey and get_public_definition,
-- the only two functions anon may execute (R1). Spec: docs/01-data-model.md
-- section 11; docs/02 section 4.
--
-- Unknown keys, drafts, archived surveys and deleted workspaces return zero
-- rows, identical to each other, so holding the public Supabase key never
-- enumerates surveys.

create or replace function resolve_public_survey(p_key text)
returns table (
  survey_id          uuid,
  slug               text,
  alias              text,                -- active alias, for the QR and share panel
  matched_by         text,                -- 'slug' | 'alias' | 'retired_alias'
  effective_state    text,                -- 'scheduled' | 'open' | 'closed'
  state_reason       text,                -- 'manual' | 'schedule' | 'cap' | 'admin' | 'workspace_archived' | null
  opens_at           timestamptz,
  closes_at          timestamptz,
  closed_message     text,                -- survey, else workspace default, else null (doc 02 defaults)
  version_id         uuid,                -- latest published, only when effective_state = 'open'
  version_no         int,
  title              text,                -- public title from the published definition
  og_title           text,
  og_description     text,
  og_image_path      text,
  allow_indexing     boolean,
  workspace_name     text,
  logo_path          text,
  show_powered_by    boolean,
  privacy_notice_url text,                -- workspace notice; the org notice is always /privacy
  pixel_consent_mode pixel_consent_mode,
  pixels             jsonb                -- [{id,type,value,parsed}], enabled minus excluded; [] unless open
)
language sql stable security definer set search_path = public, pg_temp as $$
  with k as (
    select lower(btrim(p_key)) as key
    where p_key is not null and length(p_key) between 1 and 100
  ),
  hit as (
    select h.id, h.matched_by
    from (
      select s.id, 'slug'::text as matched_by, 0 as prio from surveys s, k where s.slug = k.key
      union all
      select a.survey_id, case when a.retired_at is null then 'alias' else 'retired_alias' end, 1
      from survey_aliases a, k
      where a.alias = k.key
        and a.survey_id is not null
        and (a.retired_at is null or a.retired_at > now() - interval '30 days')
    ) h
    order by h.prio
    limit 1
  )
  select s.id, s.slug, cur.alias, h.matched_by,
         e.state, e.reason, s.opens_at, s.closes_at,
         coalesce(s.closed_message, w.default_closed_message),
         case when e.state = 'open' then v.id end,
         case when e.state = 'open' then v.version_no end,
         coalesce(v.public_definition #>> '{settings,title}', v.public_definition ->> 'title', s.title),
         s.og_title, s.og_description, s.og_image_path, s.allow_indexing,
         w.name, w.logo_path, w.show_powered_by, w.privacy_notice_url, w.pixel_consent_mode,
         case when e.state = 'open' then coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type,
                                               'value', p.value, 'parsed', p.parsed)
                            order by p.created_at)
           from workspace_pixels p
           where p.workspace_id = s.workspace_id and p.enabled
             and not (p.id = any (s.excluded_pixel_ids))
             and (p.type not in ('custom_script','gtm')
                  or coalesce((select l.raw_script_pixels_allowed from workspace_limits l
                               where l.workspace_id = s.workspace_id), true))), '[]'::jsonb)
         else '[]'::jsonb end
  from hit h
  join surveys s     on s.id = h.id
  join workspaces w  on w.id = s.workspace_id
  join survey_versions v on v.id = s.latest_published_version_id
  cross join lateral survey_effective_state(s, w.archived_at is not null) e
  left join survey_aliases cur on cur.survey_id = s.id and cur.retired_at is null
  where e.state <> 'draft' and w.deleted_at is null;
$$;

-- Any published version of the keyed survey (a partial resumes on the version
-- it started on), while open, or within 15 minutes after a scheduled close.
create or replace function get_public_definition(p_version_id uuid, p_key text)
returns table (version_id uuid, version_no int, public_definition jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.version_no, v.public_definition
  from resolve_public_survey(p_key) r
  join survey_versions v on v.survey_id = r.survey_id
  where v.id = p_version_id
    and v.status = 'published'
    and (r.effective_state = 'open'
         or (r.state_reason = 'schedule' and now() < r.closes_at + interval '15 minutes'));
$$;

revoke all on function resolve_public_survey(text), get_public_definition(uuid, text) from public;
grant execute on function resolve_public_survey(text)       to anon, authenticated, service_role;
grant execute on function get_public_definition(uuid, text) to anon, authenticated, service_role;
