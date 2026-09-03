-- Reproducible local verification for the weather ingestion database path.
--
-- Run after `supabase db reset` with:
--   docker exec -i supabase_db_karidoki-navi psql -U postgres -d postgres \
--     -X -v ON_ERROR_STOP=1 -f - < supabase/tests/weather_ingestion.sql
--
-- The transaction is rolled back.  The Edge Function's network fetch is
-- exercised separately; this script covers its service-role UPSERT contract
-- and the summary RPC that follows it.

\set ON_ERROR_STOP on

begin;

create temporary table weather_test_ids (
  station_id uuid not null,
  season_id uuid not null,
  import_run_id uuid not null
) on commit drop;
grant all on weather_test_ids to service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.daily_weather', 'insert')
     or has_table_privilege('authenticated', 'public.daily_weather', 'update')
     or has_table_privilege('authenticated', 'public.daily_weather', 'delete') then
    raise exception 'authenticated must not write daily_weather directly';
  end if;
  if has_table_privilege('authenticated', 'public.weather_import_runs', 'select') then
    raise exception 'authenticated must not read weather_import_runs';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.recalculate_crop_season_summary(uuid,date)',
       'execute'
     ) then
    raise exception 'authenticated must not execute weather summary RPC';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.recalculate_crop_season_summary(uuid,date)',
       'execute'
     ) then
    raise exception 'service_role must execute weather summary RPC';
  end if;
end;
$$;

-- Remove only a prior interrupted copy of this test fixture.  Normally the
-- final rollback makes these statements no-ops on the next run.
delete from public.fields
where account_id in (
  select id
  from public.accounts
  where created_by = '44444444-4444-4444-8444-444444444444'::uuid
);
delete from public.accounts
where created_by = '44444444-4444-4444-8444-444444444444'::uuid;
delete from auth.users
where id = '44444444-4444-4444-8444-444444444444'::uuid;

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
values (
  '44444444-4444-4444-8444-444444444444'::uuid,
  'authenticated',
  'authenticated',
  'weather-ingestion-test@example.com',
  'not-used',
  pg_catalog.now(),
  '{}'::jsonb,
  '{"display_name":"Weather ingestion test"}'::jsonb,
  pg_catalog.now(),
  pg_catalog.now()
);

insert into public.weather_locations (
  provider,
  external_id,
  name,
  location,
  elevation_m,
  is_active,
  metadata
)
values (
  'JMA_AMEDAS'::public.weather_provider,
  '99990',
  '天気取込テスト地点',
  extensions.st_setsrid(
    extensions.st_makepoint(133.05::double precision, 34.5833333333::double precision),
    4326
  ),
  350,
  true,
  '{"test_fixture":true}'::jsonb
);

select id as station_id
from public.weather_locations
where provider = 'JMA_AMEDAS'::public.weather_provider
  and external_id = '99990';
\gset

select id as account_id
from public.accounts
where created_by = '44444444-4444-4444-8444-444444444444'::uuid;
\gset

insert into public.fields (account_id, name, geom, area_m2, parcel_source)
values (
  :'account_id'::uuid,
  'Weather ingestion test field',
  extensions.st_geomfromtext(
    'MULTIPOLYGON(((133.049 34.582,133.051 34.582,133.051 34.584,133.049 34.584,133.049 34.582)))',
    4326
  ),
  1,
  'MANUAL'
);

select id as field_id
from public.fields
where account_id = :'account_id'::uuid
  and name = 'Weather ingestion test field';
\gset

insert into public.crop_seasons (field_id, year, variety_id, heading_date)
values (
  :'field_id'::uuid,
  2026,
  (select id from public.rice_varieties where name = 'コシヒカリ' and is_active limit 1),
  '2026-09-01'
);

select id as season_id
from public.crop_seasons
where field_id = :'field_id'::uuid
  and year = 2026;
\gset

insert into public.season_rule_snapshots (
  crop_season_id,
  harvest_start_temp_c,
  harvest_target_temp_c,
  harvest_end_temp_c,
  accumulation_start_offset_days,
  source_title,
  source_publisher,
  is_custom
)
values (
  :'season_id'::uuid,
  100,
  110,
  120,
  1,
  'Weather ingestion test rule',
  'local test',
  true
);

insert into public.season_weather_bindings (
  crop_season_id,
  weather_location_id,
  distance_m,
  selected_by_user
)
values (:'season_id'::uuid, :'station_id'::uuid, 0, true);

-- This is the shape written by update-weather after a successful provider
-- response.  Use service_role explicitly to mirror the Edge Function.
set local role service_role;
insert into public.weather_import_runs (
  provider,
  weather_location_id,
  date_from,
  date_to,
  completed_at,
  succeeded,
  records_received,
  source_revision,
  source_metadata
)
values (
  'JMA_AMEDAS'::public.weather_provider,
  :'station_id'::uuid,
  '2026-09-02',
  '2026-09-02',
  pg_catalog.now(),
  true,
  1,
  'amedas-point-json-v1',
  '{"test_fixture":true,"sample_count":24}'::jsonb
);

select id as import_run_id
from public.weather_import_runs
where weather_location_id = :'station_id'::uuid
  and date_from = '2026-09-02'
order by started_at desc, id desc
limit 1;
\gset

insert into weather_test_ids (station_id, season_id, import_run_id)
values (:'station_id'::uuid, :'season_id'::uuid, :'import_run_id'::uuid);

insert into public.daily_weather (
  weather_location_id,
  observed_date,
  mean_temp_c,
  max_temp_c,
  min_temp_c,
  quality_code,
  provider_revision,
  sample_count,
  expected_sample_count,
  source_metadata,
  raw_import_id
)
values (
  :'station_id'::uuid,
  '2026-09-02',
  26.47,
  33.5,
  20.4,
  'COMPLETE',
  'amedas-point-json-v1',
  24,
  24,
  '{"test_fixture":true}'::jsonb,
  :'import_run_id'::uuid
)
on conflict (weather_location_id, observed_date) do update
set mean_temp_c = excluded.mean_temp_c,
    max_temp_c = excluded.max_temp_c,
    min_temp_c = excluded.min_temp_c,
    quality_code = excluded.quality_code,
    provider_revision = excluded.provider_revision,
    sample_count = excluded.sample_count,
    expected_sample_count = excluded.expected_sample_count,
    source_metadata = excluded.source_metadata,
    raw_import_id = excluded.raw_import_id;

select public.recalculate_crop_season_summary(
  :'season_id'::uuid,
  '2026-09-02'::date
);
reset role;

do $$
declare
  station_geometry_type text;
  station_srid integer;
  daily_count integer;
  daily_samples integer;
  daily_expected integer;
  daily_mean numeric;
  summary_accumulated numeric;
  summary_through date;
  summary_valid_days integer;
  summary_missing_days integer;
  summary_data_status text;
begin
  select
    extensions.st_geometrytype(location),
    extensions.st_srid(location)
    into station_geometry_type, station_srid
  from public.weather_locations
  where id = (select station_id from weather_test_ids);
  if station_geometry_type <> 'ST_Point' or station_srid <> 4326 then
    raise exception 'weather station geometry is not a WGS84 point';
  end if;

  select
    count(*)::integer,
    max(sample_count),
    max(expected_sample_count),
    max(mean_temp_c)
    into daily_count, daily_samples, daily_expected, daily_mean
  from public.daily_weather
  where weather_location_id = (select station_id from weather_test_ids)
    and observed_date = '2026-09-02';
  if daily_count <> 1
     or daily_samples <> 24
     or daily_expected <> 24
     or daily_mean <> 26.47 then
    raise exception 'daily weather UPSERT result is incorrect';
  end if;

  select
    accumulated_temp_c,
    accumulated_through,
    valid_day_count,
    missing_day_count,
    data_status::text
    into
      summary_accumulated,
      summary_through,
      summary_valid_days,
      summary_missing_days,
      summary_data_status
  from public.crop_season_summaries
  where crop_season_id = (select season_id from weather_test_ids);
  if summary_accumulated <> 26.47
     or summary_through <> '2026-09-02'
     or summary_valid_days <> 1
     or summary_missing_days <> 0
     or summary_data_status <> 'COMPLETE' then
    raise exception 'crop season summary recalculation is incorrect';
  end if;
end;
$$;

rollback;
