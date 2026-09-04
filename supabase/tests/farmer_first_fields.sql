-- Integration verification for the farmer-first, no-map field workflow.

\set ON_ERROR_STOP on

begin;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.register_simple_field_with_season(text,text,text,smallint,uuid,date,date)',
    'execute'
  ) then
    raise exception 'anon must not execute simple field registration';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'authenticated', 'authenticated', 'simple-owner@example.com', 'not-used',
    pg_catalog.now(), '{}'::jsonb, '{"display_name":"Simple owner"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'authenticated', 'authenticated', 'simple-other@example.com', 'not-used',
    pg_catalog.now(), '{}'::jsonb, '{"display_name":"Simple other"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.account_variety_rules (
  account_id,
  variety_id,
  region_id,
  harvest_start_temp_c,
  harvest_target_temp_c,
  harvest_end_temp_c,
  accumulation_start_offset_days,
  source_note,
  effective_from,
  effective_to
)
select
  account_members.account_id,
  rice_varieties.id,
  rule_regions.id,
  900,
  1000,
  1100,
  1,
  '久井町の確認済み管理値（simple integration test）',
  '2020-01-01'::date,
  '2100-12-31'::date
from public.account_members
cross join public.rice_varieties
cross join public.rule_regions
where account_members.user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and rice_varieties.name = 'コシヒカリ'
  and rule_regions.code = '34204-kui';

select set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
set local role authenticated;

create temporary table simple_result (
  field_id uuid,
  crop_season_id uuid,
  size_class text,
  was_replayed boolean
) on commit drop;
grant insert, select on simple_result to authenticated;

insert into simple_result
select *
from public.register_simple_field_with_season(
  'simple-registration-1',
  '家の前',
  'MEDIUM',
  2026::smallint,
  (select id from public.rice_varieties where name = 'コシヒカリ'),
  '2026-05-18'::date,
  '2026-08-05'::date
);

do $$
declare
  v_result simple_result%rowtype;
  v_field record;
  v_season record;
  v_station text;
  v_offset smallint;
  v_overview_count integer;
begin
  select * into v_result from simple_result;
  if v_result.field_id is null or v_result.crop_season_id is null
     or v_result.size_class <> 'MEDIUM' or v_result.was_replayed then
    raise exception 'simple registration result was invalid';
  end if;

  select geom, area_m2, size_class, parcel_source
    into v_field
  from public.fields
  where id = v_result.field_id;
  if v_field.geom is not null or v_field.area_m2 is not null
     or v_field.size_class <> 'MEDIUM' or v_field.parcel_source is not null then
    raise exception 'simple field retained geographic data or wrong size';
  end if;

  select planting_date, heading_date
    into v_season
  from public.crop_seasons
  where id = v_result.crop_season_id;
  if v_season.planting_date <> '2026-05-18'::date
     or v_season.heading_date <> '2026-08-05'::date then
    raise exception 'simple season dates were not stored';
  end if;

  select locations.external_id
    into v_station
  from public.season_weather_bindings as bindings
  join public.weather_locations as locations on locations.id = bindings.weather_location_id
  where bindings.crop_season_id = v_result.crop_season_id
    and bindings.is_active;
  if v_station <> '67316' then
    raise exception 'simple season was not bound to Sera AMeDAS: %', v_station;
  end if;

  select accumulation_start_offset_days
    into v_offset
  from public.season_rule_snapshots
  where crop_season_id = v_result.crop_season_id;
  if v_offset <> 0 then
    raise exception 'simple season must accumulate from heading date: %', v_offset;
  end if;

  select count(*)
    into v_overview_count
  from public.get_field_overview(2026::smallint)
  where field_id = v_result.field_id
    and field_size_class = 'MEDIUM'
    and planting_date = '2026-05-18'::date;
  if v_overview_count <> 1 then
    raise exception 'owner overview did not return simple field';
  end if;
end;
$$;

do $$
declare
  v_first simple_result%rowtype;
  v_replay record;
  v_count integer;
begin
  select * into v_first from simple_result;
  select * into v_replay
  from public.register_simple_field_with_season(
    'simple-registration-1', '家の前', 'MEDIUM', 2026::smallint,
    (select id from public.rice_varieties where name = 'コシヒカリ'),
    '2026-05-18'::date, '2026-08-05'::date
  );
  if not v_replay.was_replayed or v_replay.field_id <> v_first.field_id then
    raise exception 'simple registration was not idempotent';
  end if;
  select count(*) into v_count from public.fields where name = '家の前';
  if v_count <> 1 then
    raise exception 'simple replay created duplicate fields';
  end if;

  begin
    perform public.register_simple_field_with_season(
      'simple-invalid-date', '日付不正', 'SMALL', 2026::smallint,
      (select id from public.rice_varieties where name = 'コシヒカリ'),
      '2026-08-06'::date, '2026-08-05'::date
    );
    raise exception 'heading before planting was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.register_simple_field_with_season(
      'simple-missing-date', '日付なし', 'SMALL', 2026::smallint,
      (select id from public.rice_varieties where name = 'コシヒカリ'),
      null, '2026-08-05'::date
    );
    raise exception 'missing planting date was accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;

do $$
declare r record;
begin
  select * into r from public.register_simple_field_with_season(
    'optional-heading', '出穂日あとで', 'SMALL', 2026::smallint,
    (select id from public.rice_varieties where name = 'コシヒカリ'),
    '2026-05-18'::date, null);
  perform public.update_season_heading(r.crop_season_id, '2026-08-05');
  if not exists(select 1 from public.crop_seasons where id = r.crop_season_id and heading_date = '2026-08-05') then
    raise exception 'heading update not persisted';
  end if;
  begin
    perform public.update_season_heading(r.crop_season_id, '2026-05-01');
    raise exception 'invalid heading accepted';
  exception when sqlstate '22023' then null; end;
  perform public.register_harvest(r.crop_season_id, '2026-09-03', null);
  begin
    perform public.update_season_heading(r.crop_season_id, '2026-08-06');
    raise exception 'harvested heading changed';
  exception when sqlstate '22023' then null; end;
end;
$$;

select set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.get_field_overview(2026::smallint);
  if v_count <> 0 then
    raise exception 'another account could see simple fields';
  end if;
  begin
    perform public.update_season_heading((select crop_season_id from simple_result), '2026-08-06');
    raise exception 'another account could update heading';
  exception when insufficient_privilege then null; end;
end;
$$;

rollback;
