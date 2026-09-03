-- Reproducible verification for the regional/weather master migration.
--
-- Run after `./node_modules/.bin/supabase db reset` with:
--   docker exec -i supabase_db_karidoki-navi psql -U postgres -d postgres \
--     -X -v ON_ERROR_STOP=1 -f - < supabase/tests/regional_rules.sql

\set ON_ERROR_STOP on

begin;

-- The five varieties remain selectable even though no unverified harvest rule
-- was inserted.  Region and station master rows are complete and unique.
do $$
declare
  variety_count integer;
  region_count integer;
  station_count integer;
  rule_count integer;
begin
  select count(*)
    into variety_count
  from public.rice_varieties
  where name = any (array['コシヒカリ', 'あきさかり', 'あきろまん', 'ヒノヒカリ', '恋の予感']);
  if variety_count <> 5 then
    raise exception 'expected five pilot varieties, got %', variety_count;
  end if;

  select count(*)
    into region_count
  from public.rule_regions
  where code = any (array[
    'JP',
    '34',
    '34204',
    '34204-kui',
    'hiroshima-altitude-highland-500-plus',
    'hiroshima-altitude-northern-300-500',
    'hiroshima-altitude-central-150-300',
    'hiroshima-altitude-southern-under-150'
  ]);
  if region_count <> 8 then
    raise exception 'expected eight regional master rows, got %', region_count;
  end if;

  select count(*)
    into station_count
  from public.weather_locations
  where provider = 'JMA_AMEDAS'::public.weather_provider
    and external_id = any (array['67316', '67386']);
  if station_count <> 2 then
    raise exception 'expected two JMA station rows, got %', station_count;
  end if;

  select count(*)
    into rule_count
  from public.variety_rules
  where variety_id in (
    select id
    from public.rice_varieties
    where name = any (array['コシヒカリ', 'あきさかり', 'あきろまん', 'ヒノヒカリ', '恋の予感'])
  );
  if rule_count <> 0 then
    raise exception 'unverified variety rules were inserted: %', rule_count;
  end if;

  if has_table_privilege('authenticated', 'public.account_variety_rules', 'insert')
     or has_table_privilege('authenticated', 'public.account_variety_rules', 'update')
     or has_table_privilege('authenticated', 'public.account_variety_rules', 'delete') then
    raise exception 'account custom rules must be mutated through scoped RPCs';
  end if;

  if has_function_privilege(
       'anon',
       'public.save_account_variety_rule(uuid,uuid,numeric,numeric,numeric,smallint,text,date,uuid,uuid,date)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.list_account_variety_rules(uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.delete_account_variety_rule(uuid,uuid)',
       'execute'
     ) then
    raise exception 'anonymous role must not execute account custom rule RPCs';
  end if;
end;
$$;

-- Exercise the same column projection under the Data API role: generated
-- coordinates must be selectable without exposing the PostGIS implementation.
set local role authenticated;
do $$
declare
  visible_count integer;
begin
  select count(*)
    into visible_count
  from public.weather_locations
  where provider = 'JMA_AMEDAS'::public.weather_provider
    and external_id in ('67316', '67386')
    and latitude is not null
    and longitude is not null;
  if visible_count <> 2 then
    raise exception 'generated coordinates are not visible to authenticated SELECT';
  end if;
end;
$$;
reset role;

-- A repeated master UPSERT updates the existing row rather than creating a
-- duplicate.  This also exercises the generated coordinate columns through a
-- real SELECT of the values consumed by the weather function.
update public.weather_locations
set name = '一時名称'
where provider = 'JMA_AMEDAS'::public.weather_provider
  and external_id = '67316';

insert into public.weather_locations (
  provider,
  external_id,
  name,
  location,
  elevation_m,
  is_active,
  metadata
)
select
  provider,
  external_id,
  '世羅',
  location,
  elevation_m,
  true,
  metadata
from public.weather_locations
where provider = 'JMA_AMEDAS'::public.weather_provider
  and external_id = '67316'
on conflict (provider, external_id) do update set
  name = excluded.name,
  location = excluded.location,
  elevation_m = excluded.elevation_m,
  is_active = excluded.is_active,
  metadata = excluded.metadata;

do $$
declare
  row_count integer;
  station_name text;
  station_latitude double precision;
  station_longitude double precision;
  station_elevation numeric;
begin
  select count(*) into row_count
  from public.weather_locations
  where provider = 'JMA_AMEDAS'::public.weather_provider
    and external_id in ('67316', '67386');
  if row_count <> 2 then
    raise exception 'station UPSERT created a duplicate: % rows', row_count;
  end if;

  select name, latitude, longitude, elevation_m
    into station_name, station_latitude, station_longitude, station_elevation
  from public.weather_locations
  where provider = 'JMA_AMEDAS'::public.weather_provider
    and external_id = '67316';
  if station_name <> '世羅'
     or abs(station_latitude - 34.583333333333336) > 0.000000001
     or abs(station_longitude - 133.05) > 0.000000001
     or station_elevation <> 350 then
    raise exception '67316 generated/master values are inconsistent';
  end if;

  select latitude, longitude
    into station_latitude, station_longitude
  from public.weather_locations
  where provider = 'JMA_AMEDAS'::public.weather_provider
    and external_id = '67386';
  if abs(station_latitude - 34.435) > 0.000000001
     or abs(station_longitude - 132.91833333333332) > 0.000000001 then
    raise exception '67386 generated coordinates are inconsistent';
  end if;
end;
$$;

-- Region codes and parent links encode the requested hierarchy.  The
-- specificity rank, rather than the enum name, makes town > municipality >
-- altitude band > prefecture > country deterministic.
do $$
declare
  town_specificity smallint;
  city_specificity smallint;
  altitude_specificity smallint;
  prefecture_specificity smallint;
  country_specificity smallint;
  town_parent_kind public.region_kind;
  city_parent_kind public.region_kind;
  altitude_parent_kind public.region_kind;
begin
  select region.specificity, parent.kind
    into town_specificity, town_parent_kind
  from public.rule_regions as region
  join public.rule_regions as parent on parent.id = region.parent_region_id
  where region.code = '34204-kui';
  select region.specificity, parent.kind
    into city_specificity, city_parent_kind
  from public.rule_regions as region
  join public.rule_regions as parent on parent.id = region.parent_region_id
  where region.code = '34204';
  select region.specificity, parent.kind
    into altitude_specificity, altitude_parent_kind
  from public.rule_regions as region
  join public.rule_regions as parent on parent.id = region.parent_region_id
  where region.code = 'hiroshima-altitude-central-150-300';
  select region.specificity into prefecture_specificity
  from public.rule_regions as region
  where region.code = '34';
  select region.specificity into country_specificity
  from public.rule_regions as region
  where region.code = 'JP';

  if not (
    town_specificity > city_specificity
    and city_specificity > altitude_specificity
    and altitude_specificity > prefecture_specificity
    and prefecture_specificity > country_specificity
    and town_parent_kind = 'MUNICIPALITY'::public.region_kind
    and city_parent_kind = 'PREFECTURE'::public.region_kind
    and altitude_parent_kind = 'PREFECTURE'::public.region_kind
  ) then
    raise exception 'region hierarchy/specificity is not deterministic';
  end if;
end;
$$;

-- Add temporary, clearly synthetic rules only inside this rolled-back test so
-- that the SQL resolver's hierarchy can be verified without shipping values.
do $$
declare
  v_variety_id uuid;
  v_town_id uuid;
  v_city_id uuid;
  v_altitude_id uuid;
  v_prefecture_id uuid;
  selected_code text;
begin
  select id into v_variety_id from public.rice_varieties where name = 'コシヒカリ';
  select id into v_town_id from public.rule_regions where code = '34204-kui';
  select id into v_city_id from public.rule_regions where code = '34204';
  select id into v_altitude_id from public.rule_regions where code = 'hiroshima-altitude-central-150-300';
  select id into v_prefecture_id from public.rule_regions where code = '34';

  insert into public.variety_rules (
    variety_id,
    region_id,
    harvest_start_temp_c,
    harvest_target_temp_c,
    harvest_end_temp_c,
    accumulation_start_offset_days,
    effective_from,
    priority,
    version,
    source_title,
    source_publisher,
    status
  )
  values
    (v_variety_id, v_town_id, 800, 850, 900, 1, '2026-01-01', 0, 1, 'test only', 'test', 'ACTIVE'),
    (v_variety_id, v_city_id, 810, 860, 910, 1, '2026-01-01', 0, 1, 'test only', 'test', 'ACTIVE'),
    (v_variety_id, v_altitude_id, 820, 870, 920, 1, '2026-01-01', 0, 1, 'test only', 'test', 'ACTIVE'),
    (v_variety_id, v_prefecture_id, 830, 880, 930, 1, '2026-01-01', 0, 1, 'test only', 'test', 'ACTIVE');

  select region_code
    into selected_code
  from public.resolve_variety_rule_for_regions(
    v_variety_id,
    array[v_town_id, v_city_id, v_altitude_id, v_prefecture_id],
    '2026-08-01'
  );
  if selected_code <> '34204-kui' then
    raise exception 'town rule did not win resolution: %', selected_code;
  end if;

  update public.variety_rules
  set status = 'RETIRED'
  where variety_id = v_variety_id and region_id = v_town_id;
  select region_code
    into selected_code
  from public.resolve_variety_rule_for_regions(
    v_variety_id,
    array[v_town_id, v_city_id, v_altitude_id, v_prefecture_id],
    '2026-08-01'
  );
  if selected_code <> '34204' then
    raise exception 'municipality rule did not win after town retirement: %', selected_code;
  end if;

  update public.variety_rules
  set status = 'RETIRED'
  where variety_id = v_variety_id and region_id = v_city_id;
  select region_code
    into selected_code
  from public.resolve_variety_rule_for_regions(
    v_variety_id,
    array[v_town_id, v_city_id, v_altitude_id, v_prefecture_id],
    '2026-08-01'
  );
  if selected_code <> 'hiroshima-altitude-central-150-300' then
    raise exception 'altitude-band rule did not win after town/city retirement: %', selected_code;
  end if;

  update public.variety_rules
  set status = 'RETIRED'
  where variety_id = v_variety_id and region_id = v_altitude_id;
  select region_code
    into selected_code
  from public.resolve_variety_rule_for_regions(
    v_variety_id,
    array[v_town_id, v_city_id, v_altitude_id, v_prefecture_id],
    '2026-08-01'
  );
  if selected_code <> '34' then
    raise exception 'prefecture rule did not win after narrower retirement: %', selected_code;
  end if;

  update public.variety_rules
  set status = 'RETIRED'
  where variety_id = v_variety_id and region_id = v_prefecture_id;
  if exists (
    select 1
    from public.resolve_variety_rule_for_regions(
      v_variety_id,
      array[v_town_id, v_city_id, v_altitude_id, v_prefecture_id],
      '2026-08-01'
    )
  ) then
    raise exception 'retired rules must leave the variety unconfigured';
  end if;
end;
$$;

-- An overlapping active revision is rejected, while the migration still
-- permits adjacent effective periods and retired history.
do $$
declare
  v_variety_id uuid;
  v_region_id uuid;
begin
  select id into v_variety_id from public.rice_varieties where name = 'あきさかり';
  select id into v_region_id from public.rule_regions where code = '34204-kui';
  insert into public.variety_rules (
    variety_id, region_id, harvest_start_temp_c, harvest_target_temp_c,
    harvest_end_temp_c, accumulation_start_offset_days, effective_from,
    effective_to, version, source_title, source_publisher, status
  ) values (
    v_variety_id, v_region_id, 800, 850, 900, 1, '2026-01-01',
    '2026-12-31', 1, 'test only', 'test', 'ACTIVE'
  );
  begin
    insert into public.variety_rules (
      variety_id, region_id, harvest_start_temp_c, harvest_target_temp_c,
      harvest_end_temp_c, accumulation_start_offset_days, effective_from,
      effective_to, version, source_title, source_publisher, status
    ) values (
      v_variety_id, v_region_id, 801, 851, 901, 1, '2026-06-01',
      '2027-01-31', 2, 'test only', 'test', 'ACTIVE'
    );
    raise exception 'overlapping active variety rule was accepted';
  exception
    when sqlstate '23P01' then null;
  end;
end;
$$;

-- Set up one owner field around Kui and verify the RPC ranks the two JMA
-- locations by server-derived distance.  A second user cannot use the first
-- user's field id to infer or retrieve station candidates.
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
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'authenticated',
    'authenticated',
    'regional-rules-owner@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Regional rules owner"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'authenticated',
    'authenticated',
    'regional-rules-other@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Regional rules other"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  );

create temporary table rpc_field (field_id uuid) on commit drop;
create temporary table custom_rule_ref (
  account_id uuid,
  variety_id uuid,
  rule_id uuid
) on commit drop;

do $$
declare
  v_account_id uuid;
  v_field_id uuid;
begin
  select id into v_account_id
  from public.accounts
  where created_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  insert into public.fields (
    account_id,
    name,
    geom,
    area_m2,
    parcel_source
  ) values (
    v_account_id,
    '久井RPCテスト圃場',
    extensions.st_multi(
      extensions.st_geomfromtext(
        'POLYGON((132.949 34.449, 132.951 34.449, 132.951 34.451, 132.949 34.451, 132.949 34.449))',
        4326
      )
    ),
    40000,
    'MANUAL'
  ) returning id into v_field_id;
  insert into rpc_field values (v_field_id);
end;
$$;

grant select on rpc_field to authenticated;
grant insert, select on custom_rule_ref to authenticated;

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
set local role authenticated;

-- CRUD for a private account rule goes through the account-scoped RPCs.  The
-- test uses an account-default rule (NULL region) and rolls it back below.
do $$
declare
  v_account_id uuid;
  v_variety_id uuid;
  v_rule_id uuid;
  v_rule_count integer;
  v_target numeric;
  v_source_note text;
begin
  select id
    into v_account_id
  from public.accounts
  where created_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select id
    into v_variety_id
  from public.rice_varieties
  where name = 'コシヒカリ';

  select id
    into v_rule_id
  from public.save_account_variety_rule(
    p_account_id => v_account_id,
    p_variety_id => v_variety_id,
    p_harvest_start_temp_c => 900,
    p_harvest_target_temp_c => 1000,
    p_harvest_end_temp_c => 1100,
    p_accumulation_start_offset_days => 1::smallint,
    p_source_note => '久井町で採用する管理者入力値（テスト）',
    p_effective_from => '2026-01-01'::date,
    p_rule_id => null,
    p_region_id => null,
    p_effective_to => '2026-12-31'::date
  );
  if v_rule_id is null then
    raise exception 'account custom rule was not created';
  end if;
  insert into custom_rule_ref(account_id, variety_id, rule_id)
  values (v_account_id, v_variety_id, v_rule_id);

  select count(*)
    into v_rule_count
  from public.list_account_variety_rules(v_account_id, v_variety_id);
  if v_rule_count <> 1 then
    raise exception 'account custom rule list returned % rows', v_rule_count;
  end if;

  select harvest_target_temp_c, source_note
    into v_target, v_source_note
  from public.save_account_variety_rule(
    p_account_id => v_account_id,
    p_variety_id => v_variety_id,
    p_harvest_start_temp_c => 910,
    p_harvest_target_temp_c => 1010,
    p_harvest_end_temp_c => 1110,
    p_accumulation_start_offset_days => 2::smallint,
    p_source_note => '更新した管理者入力値（テスト）',
    p_effective_from => '2026-01-01'::date,
    p_rule_id => v_rule_id,
    p_region_id => null,
    p_effective_to => '2026-12-31'::date
  );
  if v_target <> 1010 or v_source_note <> '更新した管理者入力値（テスト）' then
    raise exception 'account custom rule was not updated';
  end if;

  begin
    perform public.save_account_variety_rule(
      p_account_id => v_account_id,
      p_variety_id => v_variety_id,
      p_harvest_start_temp_c => 920,
      p_harvest_target_temp_c => 1020,
      p_harvest_end_temp_c => 1120,
      p_accumulation_start_offset_days => 1::smallint,
      p_source_note => '期間競合テスト',
      p_effective_from => '2026-06-01'::date,
      p_rule_id => null,
      p_region_id => null,
      p_effective_to => '2027-01-31'::date
    );
    raise exception 'overlapping account custom rule was accepted';
  exception
    when sqlstate '23P01' then null;
  end;

  select count(*)
    into v_rule_count
  from public.list_account_variety_rules(v_account_id, v_variety_id);
  if v_rule_count <> 1 then
    raise exception 'updated account custom rule is not listed';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
       'anon',
       'public.find_nearest_weather_locations(uuid,integer)',
       'execute'
     ) then
    raise exception 'anonymous role must not execute owner-safe station RPC';
  end if;
end;
$$;

create temporary table nearest_locations (
  weather_location_id uuid,
  provider public.weather_provider,
  external_id text,
  name text,
  latitude double precision,
  longitude double precision,
  elevation_m numeric(8, 2),
  distance_m numeric(12, 2),
  metadata jsonb
) on commit drop;
insert into nearest_locations
select *
from public.find_nearest_weather_locations((select field_id from rpc_field), 2);

do $$
declare
  first_station text;
  second_station text;
  first_distance numeric;
  second_distance numeric;
  returned_count integer;
begin
  select count(*) into returned_count from nearest_locations;
  if returned_count <> 2 then
    raise exception 'expected two station candidates, got %', returned_count;
  end if;
  select external_id, distance_m
    into first_station, first_distance
  from nearest_locations
  order by distance_m, external_id
  limit 1;
  select external_id, distance_m
    into second_station, second_distance
  from nearest_locations
  order by distance_m desc, external_id desc
  limit 1;
  if first_station <> '67386'
     or second_station <> '67316'
     or first_distance is null
     or second_distance is null
     or first_distance >= second_distance then
    raise exception 'station distance ordering is incorrect: % % then % %',
      first_station, first_distance, second_station, second_distance;
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  true
);
do $$
declare
  unauthorized_count integer;
begin
  select count(*)
    into unauthorized_count
  from public.find_nearest_weather_locations((select field_id from rpc_field), 2);
  if unauthorized_count <> 0 then
    raise exception 'other owner received private field station candidates';
  end if;
end;
$$;

do $$
declare
  v_account_id uuid;
  v_variety_id uuid;
  v_rule_id uuid;
  v_visible_count integer;
begin
  select account_id, variety_id, rule_id
    into v_account_id, v_variety_id, v_rule_id
  from custom_rule_ref;

  select count(*)
    into v_visible_count
  from public.account_variety_rules
  where account_id = v_account_id
    and id = v_rule_id;
  if v_visible_count <> 0 then
    raise exception 'RLS leaked another account custom rule';
  end if;

  begin
    perform public.list_account_variety_rules(v_account_id, v_variety_id);
    raise exception 'other account was allowed to list custom rules';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.delete_account_variety_rule(v_account_id, v_rule_id);
    raise exception 'other account was allowed to delete custom rule';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
do $$
declare
  v_account_id uuid;
  v_rule_id uuid;
begin
  select account_id, rule_id
    into v_account_id, v_rule_id
  from custom_rule_ref;
  if not public.delete_account_variety_rule(v_account_id, v_rule_id) then
    raise exception 'account custom rule was not deleted';
  end if;
  if exists (
    select 1
    from public.list_account_variety_rules(v_account_id, null)
    where id = v_rule_id
  ) then
    raise exception 'deleted account custom rule remains visible';
  end if;
end;
$$;

rollback;

select 'regional_rules: ok' as result;
