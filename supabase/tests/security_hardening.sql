-- Integration checks for the public-schema security boundary and bounded RPCs.
--
-- Run after `./node_modules/.bin/supabase db reset --local` with:
--   docker exec -i supabase_db_karidoki-navi psql -U postgres -d postgres \
--     -X -v ON_ERROR_STOP=1 -f - < supabase/tests/security_hardening.sql

\set ON_ERROR_STOP on

begin;

-- Every application relation is protected, and the Data API roles receive no
-- accidental direct write/read route. Views are included in the privilege
-- sweep even though the current pilot has no public views.
do $$
declare
  relation_row record;
  function_row record;
  privilege_name text;
  authenticated_function_allowlist constant text[] := array[
    'can_access_field',
    'can_access_season',
    'delete_account_variety_rule',
    'find_nearest_weather_locations',
    'get_field_detail',
    'get_field_map',
    'get_parcel_candidates',
    'get_parcel_candidates_mvt',
    'is_account_member',
    'list_account_variety_rules',
    'register_field_with_season',
    'register_harvest',
    'resolve_variety_rule_for_regions',
    'save_account_variety_rule'
  ];
begin
  if has_schema_privilege('anon', 'public', 'usage') then
    raise exception 'anon must not use the public application schema';
  end if;

  for relation_row in
    select
      c.oid,
      c.relname,
      c.relkind,
      c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    if relation_row.relkind in ('r', 'p')
       and not relation_row.relrowsecurity then
      raise exception 'public relation lacks RLS: %', relation_row.relname;
    end if;

    foreach privilege_name in array array['select', 'insert', 'update', 'delete', 'truncate']
    loop
      if has_table_privilege('anon', relation_row.oid, privilege_name) then
        raise exception 'anon has % privilege on public.%',
          privilege_name, relation_row.relname;
      end if;
      if has_table_privilege('authenticated', relation_row.oid, privilege_name)
         and privilege_name <> 'select' then
        raise exception 'authenticated has direct % privilege on public.%',
          privilege_name, relation_row.relname;
      end if;
    end loop;
  end loop;

  for function_row in
    select p.oid, p.proname, p.prosecdef, p.proconfig, p.prokind
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    if has_function_privilege('anon', function_row.oid, 'execute') then
      raise exception 'anon can execute public.%', function_row.proname;
    end if;

    if function_row.prosecdef
       and not (
         function_row.proconfig @> array['search_path=""']::text[]
       ) then
      raise exception 'SECURITY DEFINER lacks fixed search_path: %',
        function_row.proname;
    end if;

    if has_function_privilege('authenticated', function_row.oid, 'execute')
       and not function_row.proname = any(authenticated_function_allowlist) then
      raise exception 'unexpected authenticated function grant: %',
        function_row.proname;
    end if;
  end loop;

  if has_function_privilege(
       'authenticated',
       'public.register_field_with_season_unchecked(text,text,jsonb,smallint,uuid,date,text,text,text)'::regprocedure,
       'execute'
     ) then
    raise exception 'unchecked registration implementation is callable by authenticated';
  end if;
  if has_function_privilege(
       'service_role',
       'public.register_field_with_season_unchecked(text,text,jsonb,smallint,uuid,date,text,text,text)'::regprocedure,
       'execute'
     ) then
    raise exception 'unchecked registration implementation is callable by service_role';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.normalize_parcel_candidate_geometry(jsonb)'::regprocedure,
       'execute'
     ) then
    raise exception 'parcel normalizer must remain service-only';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.recalculate_crop_season_summary(uuid,date)'::regprocedure,
       'execute'
     ) then
    raise exception 'weather summary recalculation must remain service-only';
  end if;
end;
$$;

-- Input bounds reject expensive requests before the spatial or JSON query runs.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

do $$
begin
  begin
    perform public.get_field_map(
      2026::smallint,
      132::double precision,
      34::double precision,
      134::double precision,
      35::double precision
    );
    raise exception 'oversized field map bbox was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.get_parcel_candidates(
      2026::smallint,
      132::double precision,
      34::double precision,
      134::double precision,
      35::double precision,
      10,
      null
    );
    raise exception 'oversized parcel bbox was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.get_parcel_candidates_mvt(23, 0, 0, 2026::smallint, 10);
    raise exception 'invalid MVT zoom was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.register_field_with_season(
      'security-size-check',
      'サイズ上限テスト',
      pg_catalog.jsonb_build_object('padding', pg_catalog.repeat('x', 1049000)),
      2026::smallint
    );
    raise exception 'oversized registration geometry was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.resolve_variety_rule_for_regions(
      '00000000-0000-0000-0000-000000000001'::uuid,
      pg_catalog.array_fill(
        '00000000-0000-0000-0000-000000000002'::uuid,
        array[101]
      ),
      null
    );
    raise exception 'oversized region list was accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

-- Registration remains atomic and owner-derived. The harvest trigger permits an
-- exact retry but rejects a rewrite after the first successful state change.
reset role;
insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'authenticated',
    'authenticated',
    'security-owner@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Security owner"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'authenticated',
    'authenticated',
    'security-other@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Security other"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  true
);

create temporary table security_registration_result (
  field_id uuid,
  crop_season_id uuid,
  area_m2 numeric(14, 2),
  was_replayed boolean
);
grant insert, select on security_registration_result to authenticated;

insert into security_registration_result
select *
from public.register_field_with_season(
  'security-harvest-registration',
  'セキュリティ検証圃場',
  '{"type":"Polygon","coordinates":[[[132.949,34.449],[132.951,34.449],[132.951,34.451],[132.949,34.451],[132.949,34.449]]]}'::jsonb,
  2026::smallint,
  null,
  null,
  'MANUAL',
  null,
  null
);

-- A fixture public rule verifies that the registration boundary preserves the
-- source start/target/end/danger columns exactly (and does not shift them).
reset role;
insert into public.variety_rules (
  id,
  variety_id,
  region_id,
  harvest_start_temp_c,
  harvest_target_temp_c,
  harvest_end_temp_c,
  danger_temp_c,
  accumulation_start_offset_days,
  daily_temperature_metric,
  effective_from,
  effective_to,
  priority,
  version,
  source_title,
  source_publisher,
  source_url,
  published_on,
  status,
  notes
)
select
  '12121212-1212-4121-8121-121212121212'::uuid,
  varieties.id,
  regions.id,
  100,
  200,
  300,
  400,
  1,
  'MEAN'::public.temperature_metric,
  '2020-01-01'::date,
  '2100-12-31'::date,
  0,
  1,
  'security fixture',
  'security test',
  'https://example.invalid/security-fixture',
  '2020-01-01'::date,
  'ACTIVE'::public.rule_status,
  'temporary fixture'
from public.rice_varieties as varieties
cross join public.rule_regions as regions
where varieties.name = 'あきさかり'
  and regions.code = 'JP'
  and regions.kind = 'COUNTRY'::public.region_kind;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  true
);
create temporary table official_registration_result (
  field_id uuid,
  crop_season_id uuid,
  area_m2 numeric(14, 2),
  was_replayed boolean
);
grant insert, select on official_registration_result to authenticated;
insert into official_registration_result
select *
from public.register_field_with_season(
  'security-official-snapshot',
  '公式閾値列検証圃場',
  '{"type":"Polygon","coordinates":[[[132.959,34.459],[132.961,34.459],[132.961,34.461],[132.959,34.461],[132.959,34.459]]]}'::jsonb,
  2026::smallint,
  (select id from public.rice_varieties where name = 'あきさかり'),
  null,
  'MANUAL',
  null,
  null
);

do $$
declare
  v_crop_season_id uuid;
  v_source_rule_id uuid;
  v_is_custom boolean;
  v_start numeric;
  v_target numeric;
  v_end numeric;
  v_danger numeric;
begin
  select crop_season_id into v_crop_season_id
  from official_registration_result;
  select
    source_rule_id,
    is_custom,
    harvest_start_temp_c,
    harvest_target_temp_c,
    harvest_end_temp_c,
    danger_temp_c
    into v_source_rule_id, v_is_custom, v_start, v_target, v_end, v_danger
  from public.season_rule_snapshots
  where crop_season_id = v_crop_season_id;
  if v_source_rule_id <> '12121212-1212-4121-8121-121212121212'::uuid
     or v_is_custom
     or v_start <> 100
     or v_target <> 200
     or v_end <> 300
     or v_danger <> 400 then
    raise exception 'official rule snapshot columns/source were not preserved';
  end if;
end;
$$;

do $$
declare
  v_crop_season_id uuid;
  v_harvest_date date;
  v_accumulated numeric(8, 2);
begin
  select crop_season_id into v_crop_season_id
  from security_registration_result;
  if v_crop_season_id is null then
    raise exception 'security registration did not create a crop season';
  end if;

  select harvest_date, harvest_accumulated_temp_c
    into v_harvest_date, v_accumulated
  from public.register_harvest(
    v_crop_season_id,
    '2026-09-03'::date,
    1045.25
  );
  if v_harvest_date <> '2026-09-03'::date or v_accumulated <> 1045.25 then
    raise exception 'first harvest registration returned an unexpected value';
  end if;

  perform public.register_harvest(
    v_crop_season_id,
    '2026-09-03'::date,
    1045.25
  );

  begin
    perform public.register_harvest(
      v_crop_season_id,
      '2026-09-04'::date,
      1046.25
    );
    raise exception 'recorded harvest was silently rewritten';
  exception
    when sqlstate '23514' then null;
  end;
end;
$$;

-- A second identity cannot mutate the owner's season through the RPC.
select set_config(
  'request.jwt.claim.sub',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  true
);
do $$
declare
  v_crop_season_id uuid;
begin
  select crop_season_id into v_crop_season_id
  from security_registration_result;
  begin
    perform public.register_harvest(
      v_crop_season_id,
      '2026-09-05'::date,
      1047.25
    );
    raise exception 'non-owner harvest registration was accepted';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

rollback;

select 'security_hardening: ok' as result;
