-- Security and integrity hardening for the public application schema.
--
-- This migration does not alter the PostGIS extension itself.  It narrows
-- caller-controlled work, puts explicit size bounds on application geometry,
-- and keeps the existing SECURITY DEFINER/RLS contracts intact.

-- Application geometries are deliberately bounded before expensive spatial
-- operations can be repeated with untrusted payloads.  The 100,000,000 m2
-- ceiling is 100 km2: far above a normal farm, while excluding a world-sized
-- polygon accidentally submitted as a field or parcel.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'fields_parcel_external_id_length'
      and conrelid = 'public.fields'::pg_catalog.regclass
  ) then
    alter table public.fields
      add constraint fields_parcel_external_id_length
      check (
        parcel_external_id is null
        or pg_catalog.char_length(parcel_external_id) <= 200
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'fields_parcel_dataset_version_length'
      and conrelid = 'public.fields'::pg_catalog.regclass
  ) then
    alter table public.fields
      add constraint fields_parcel_dataset_version_length
      check (
        parcel_dataset_version is null
        or pg_catalog.char_length(parcel_dataset_version) <= 100
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'fields_geometry_points_check'
      and conrelid = 'public.fields'::pg_catalog.regclass
  ) then
    alter table public.fields
      add constraint fields_geometry_points_check
      check (extensions.st_npoints(geom) between 4 and 10000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'fields_geometry_area_check'
      and conrelid = 'public.fields'::pg_catalog.regclass
  ) then
    alter table public.fields
      add constraint fields_geometry_area_check
      check (extensions.st_area(geom::extensions.geography) <= 100000000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'maff_parcels_geometry_points_check'
      and conrelid = 'public.maff_parcels'::pg_catalog.regclass
  ) then
    alter table public.maff_parcels
      add constraint maff_parcels_geometry_points_check
      check (extensions.st_npoints(geom) between 4 and 10000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'maff_parcels_geometry_area_check'
      and conrelid = 'public.maff_parcels'::pg_catalog.regclass
  ) then
    alter table public.maff_parcels
      add constraint maff_parcels_geometry_area_check
      check (extensions.st_area(geom::extensions.geography) <= 100000000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'parcel_candidates_geometry_points_check'
      and conrelid = 'public.parcel_candidates'::pg_catalog.regclass
  ) then
    alter table public.parcel_candidates
      add constraint parcel_candidates_geometry_points_check
      check (extensions.st_npoints(geom) between 4 and 10000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'parcel_candidates_geometry_area_check'
      and conrelid = 'public.parcel_candidates'::pg_catalog.regclass
  ) then
    alter table public.parcel_candidates
      add constraint parcel_candidates_geometry_area_check
      check (extensions.st_area(geom::extensions.geography) <= 100000000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'rule_regions_geometry_contract_check'
      and conrelid = 'public.rule_regions'::pg_catalog.regclass
  ) then
    alter table public.rule_regions
      add constraint rule_regions_geometry_contract_check
      check (
        geom is null
        or (
          extensions.st_srid(geom) = 4326
          and extensions.st_geometrytype(geom) = 'ST_MultiPolygon'
          and extensions.st_isvalid(geom)
          and extensions.st_npoints(geom) <= 100000
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'variety_rules_temperature_bounds_check'
      and conrelid = 'public.variety_rules'::pg_catalog.regclass
  ) then
    alter table public.variety_rules
      add constraint variety_rules_temperature_bounds_check
      check (
        harvest_start_temp_c > 0
        and harvest_end_temp_c <= 10000
        and (danger_temp_c is null or danger_temp_c <= 10000)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'season_rule_snapshots_temperature_bounds_check'
      and conrelid = 'public.season_rule_snapshots'::pg_catalog.regclass
  ) then
    alter table public.season_rule_snapshots
      add constraint season_rule_snapshots_temperature_bounds_check
      check (
        harvest_start_temp_c > 0
        and harvest_end_temp_c <= 10000
        and (danger_temp_c is null or danger_temp_c <= 10000)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'crop_seasons_harvest_temperature_bounds_check'
      and conrelid = 'public.crop_seasons'::pg_catalog.regclass
  ) then
    alter table public.crop_seasons
      add constraint crop_seasons_harvest_temperature_bounds_check
      check (
        harvest_accumulated_temp_c is null
        or harvest_accumulated_temp_c between 0 and 10000
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'weather_import_runs_records_received_check'
      and conrelid = 'public.weather_import_runs'::pg_catalog.regclass
  ) then
    alter table public.weather_import_runs
      add constraint weather_import_runs_records_received_check
      check (records_received between 0 and 1000000);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'weather_import_runs_date_span_check'
      and conrelid = 'public.weather_import_runs'::pg_catalog.regclass
  ) then
    alter table public.weather_import_runs
      add constraint weather_import_runs_date_span_check
      check (date_to <= date_from + 366);
  end if;
end;
$$;

-- A harvest is an idempotent state transition.  Repeating the same request is
-- harmless; changing the date or accumulated value after it was recorded is
-- rejected so retries cannot silently rewrite the audit trail.
create or replace function public.prevent_harvest_rewrite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.harvest_date is not null
     and (
       new.harvest_date is distinct from old.harvest_date
       or new.harvest_accumulated_temp_c is distinct from old.harvest_accumulated_temp_c
     ) then
    raise exception using
      errcode = '23514',
      message = 'a recorded harvest cannot be rewritten';
  end if;
  return new;
end;
$$;

drop trigger if exists crop_seasons_prevent_harvest_rewrite
  on public.crop_seasons;
create trigger crop_seasons_prevent_harvest_rewrite
before update on public.crop_seasons
for each row execute function public.prevent_harvest_rewrite();

revoke all on function public.prevent_harvest_rewrite()
  from public, anon, authenticated, service_role;

-- Bound expensive or unbounded API work.  Function-level timeouts are a
-- second line of defence after input checks and do not change transaction
-- atomicity.
alter function public.get_field_detail(uuid, smallint)
  set statement_timeout = '2s';
alter function public.get_parcel_candidates(
  smallint, double precision, double precision, double precision,
  double precision, integer, text
) set statement_timeout = '3s';
alter function public.get_parcel_candidates_mvt(
  integer, integer, integer, smallint, integer
) set statement_timeout = '3s';
alter function public.find_nearest_weather_locations(uuid, integer)
  set statement_timeout = '2s';
alter function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  set statement_timeout = '2s';
alter function public.save_account_variety_rule(
  uuid, uuid, numeric, numeric, numeric, smallint, text, date, uuid, uuid, date
) set statement_timeout = '2s';
alter function public.list_account_variety_rules(uuid, uuid)
  set statement_timeout = '2s';
alter function public.delete_account_variety_rule(uuid, uuid)
  set statement_timeout = '2s';
alter function public.register_harvest(uuid, date, numeric)
  set statement_timeout = '2s';
alter function public.recalculate_crop_season_summary(uuid, date)
  set statement_timeout = '10s';

-- Keep the original registration implementation transactionally intact behind
-- a small authenticated wrapper.  The wrapper rejects oversized JSON/text
-- before PostGIS parses it, then delegates to the already owner-safe,
-- idempotent implementation from 20260903045000.
alter function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) rename to register_field_with_season_unchecked;

alter function public.register_field_with_season_unchecked(
  text, text, jsonb, smallint, uuid, date, text, text, text
) set statement_timeout = '5s';

revoke all on function public.register_field_with_season_unchecked(
  text, text, jsonb, smallint, uuid, date, text, text, text
) from public, anon, authenticated, service_role;

create function public.register_field_with_season(
  p_idempotency_key text,
  p_field_name text,
  p_geom_geojson jsonb,
  p_year smallint,
  p_variety_id uuid default null,
  p_heading_date date default null,
  p_parcel_source text default null,
  p_parcel_external_id text default null,
  p_parcel_dataset_version text default null
)
returns table (
  field_id uuid,
  crop_season_id uuid,
  area_m2 numeric(14, 2),
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_registration record;
begin
  if p_geom_geojson is null
     or pg_catalog.pg_column_size(p_geom_geojson) > 1048576 then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must be at most 1 MiB';
  end if;

  if p_parcel_external_id is not null
     and pg_catalog.char_length(p_parcel_external_id) > 200 then
    raise exception using
      errcode = '22023',
      message = 'p_parcel_external_id must be at most 200 characters';
  end if;
  if p_parcel_dataset_version is not null
     and pg_catalog.char_length(p_parcel_dataset_version) > 100 then
    raise exception using
      errcode = '22023',
      message = 'p_parcel_dataset_version must be at most 100 characters';
  end if;

  select *
    into v_registration
  from public.register_field_with_season_unchecked(
    p_idempotency_key,
    p_field_name,
    p_geom_geojson,
    p_year,
    p_variety_id,
    p_heading_date,
    p_parcel_source,
    p_parcel_external_id,
    p_parcel_dataset_version
  );

  -- The preceding migration's official branch historically shifted the
  -- start/target/end values by one column while constructing the snapshot.
  -- Correct the snapshot from the immutable public source row at this trusted
  -- boundary; custom snapshots are intentionally left untouched.
  update public.season_rule_snapshots as snapshots
  set harvest_start_temp_c = rules.harvest_start_temp_c,
      harvest_target_temp_c = rules.harvest_target_temp_c,
      harvest_end_temp_c = rules.harvest_end_temp_c,
      danger_temp_c = rules.danger_temp_c
  from public.variety_rules as rules
  where snapshots.crop_season_id = v_registration.crop_season_id
    and not snapshots.is_custom
    and snapshots.source_rule_id = rules.id;

  return query
  select
    v_registration.field_id,
    v_registration.crop_season_id,
    v_registration.area_m2,
    v_registration.was_replayed;
end;
$$;

revoke all on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) to authenticated, service_role;

-- The field map previously defaulted to a world-sized bbox, which allowed a
-- caller to force an account-wide geometry/JSON scan.  The default is now a
-- map-sized envelope around the Mihara/Kui pilot; explicit callers are still
-- allowed to request any valid map-sized envelope.
create or replace function public.get_field_map(
  p_year smallint,
  p_min_lng double precision default 132.90,
  p_min_lat double precision default 34.35,
  p_max_lng double precision default 133.20,
  p_max_lat double precision default 34.68
)
returns table (
  field_id uuid,
  field_name text,
  geom_geojson jsonb,
  area_m2 numeric(14, 2),
  season_id uuid,
  season_year smallint,
  variety_id uuid,
  variety_name text,
  heading_date date,
  harvest_date date,
  accumulated_temp_c numeric(8, 2),
  maturity_status public.maturity_status,
  data_status public.data_status,
  accumulated_through date
)
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception using
      errcode = '22023',
      message = 'p_year must be between 2000 and 2100';
  end if;
  if p_min_lng is null or p_min_lat is null
     or p_max_lng is null or p_max_lat is null
     or p_min_lng not between -180 and 180
     or p_max_lng not between -180 and 180
     or p_min_lat not between -90 and 90
     or p_max_lat not between -90 and 90
     or p_min_lng >= p_max_lng
     or p_min_lat >= p_max_lat
     or p_max_lng - p_min_lng > 1.0
     or p_max_lat - p_min_lat > 1.0
     or (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat) > 1.0 then
    raise exception using
      errcode = '22023',
      message = 'bbox is invalid or too large; use a map-sized bbox';
  end if;

  return query
  select
    fields.id,
    fields.name,
    extensions.st_asgeojson(fields.geom)::jsonb,
    fields.area_m2,
    crop_seasons.id,
    crop_seasons.year,
    crop_seasons.variety_id,
    rice_varieties.name,
    crop_seasons.heading_date,
    crop_seasons.harvest_date,
    crop_season_summaries.accumulated_temp_c,
    crop_season_summaries.maturity_status,
    crop_season_summaries.data_status,
    crop_season_summaries.accumulated_through
  from public.fields
  left join public.crop_seasons
    on crop_seasons.field_id = fields.id
   and crop_seasons.year = p_year
  left join public.rice_varieties
    on rice_varieties.id = crop_seasons.variety_id
  left join public.crop_season_summaries
    on crop_season_summaries.crop_season_id = crop_seasons.id
  where public.is_account_member(fields.account_id)
    and fields.archived_at is null
    and extensions.st_intersects(
      fields.geom,
      extensions.st_makeenvelope(
        p_min_lng,
        p_min_lat,
        p_max_lng,
        p_max_lat,
        4326
      )
    )
  order by fields.name, fields.id
  limit 1000;
end;
$$;

revoke all on function public.get_field_map(
  smallint, double precision, double precision, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.get_field_map(
  smallint, double precision, double precision, double precision, double precision
) to authenticated, service_role;

-- Bound the service/import normalizer before ST_MakeValid can expand a
-- malicious or corrupt source geometry.
create or replace function public.normalize_parcel_candidate_geometry(
  p_geom_geojson jsonb
)
returns table (
  geom extensions.geometry,
  was_repaired boolean
)
language plpgsql
stable
strict
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_raw extensions.geometry;
  v_repaired extensions.geometry;
  v_was_repaired boolean;
begin
  if pg_catalog.pg_column_size(p_geom_geojson) > 1048576 then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry must be at most 1 MiB';
  end if;
  if pg_catalog.jsonb_typeof(p_geom_geojson) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry must be a GeoJSON geometry object';
  end if;

  begin
    v_raw := extensions.st_setsrid(
      extensions.st_force2d(
        extensions.st_geomfromgeojson(p_geom_geojson::text)
      ),
      4326
    );
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry is not valid GeoJSON';
  end;

  if v_raw is null or extensions.st_isempty(v_raw) then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry must not be empty';
  end if;
  if extensions.st_npoints(v_raw) > 10000 then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry has too many points';
  end if;

  v_was_repaired := not extensions.st_isvalid(v_raw);
  v_repaired := extensions.st_multi(
    extensions.st_collectionextract(
      extensions.st_makevalid(v_raw),
      3
    )
  );

  if v_repaired is null
     or extensions.st_isempty(v_repaired)
     or extensions.st_geometrytype(v_repaired) <> 'ST_MultiPolygon'
     or not extensions.st_isvalid(v_repaired)
     or extensions.st_npoints(v_repaired) > 10000 then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry could not be normalized within size limits';
  end if;

  return query select v_repaired, v_was_repaired;
end;
$$;

revoke all on function public.normalize_parcel_candidate_geometry(jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_parcel_candidate_geometry(jsonb)
  to service_role;

-- Region lists are internal metadata, not an unbounded array transport.
create or replace function public.resolve_variety_rule_for_regions(
  p_variety_id uuid,
  p_region_ids uuid[],
  p_as_of_date date default null
)
returns table (
  rule_id uuid,
  variety_id uuid,
  region_id uuid,
  region_kind public.region_kind,
  region_code text,
  region_name text,
  region_specificity smallint,
  harvest_start_temp_c numeric(8, 2),
  harvest_target_temp_c numeric(8, 2),
  harvest_end_temp_c numeric(8, 2),
  danger_temp_c numeric(8, 2),
  accumulation_start_offset_days smallint,
  daily_temperature_metric public.temperature_metric,
  effective_from date,
  effective_to date,
  priority integer,
  version integer,
  source_title text,
  source_publisher text,
  source_url text,
  published_on date,
  status public.rule_status,
  notes text
)
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if coalesce(pg_catalog.cardinality(p_region_ids), 0) > 100 then
    raise exception using
      errcode = '22023',
      message = 'p_region_ids must contain at most 100 regions';
  end if;

  return query
  select
    rules.id,
    rules.variety_id,
    rules.region_id,
    regions.kind,
    regions.code,
    regions.name,
    regions.specificity,
    rules.harvest_start_temp_c,
    rules.harvest_target_temp_c,
    rules.harvest_end_temp_c,
    rules.danger_temp_c,
    rules.accumulation_start_offset_days,
    rules.daily_temperature_metric,
    rules.effective_from,
    rules.effective_to,
    rules.priority,
    rules.version,
    rules.source_title,
    rules.source_publisher,
    rules.source_url,
    rules.published_on,
    rules.status,
    rules.notes
  from public.variety_rules as rules
  join public.rule_regions as regions
    on regions.id = rules.region_id
  where rules.variety_id = p_variety_id
    and rules.status = 'ACTIVE'::public.rule_status
    and p_region_ids is not null
    and rules.region_id = any (p_region_ids)
    and rules.effective_from <= coalesce(
      p_as_of_date,
      (pg_catalog.now() at time zone 'Asia/Tokyo')::date
    )
    and (
      rules.effective_to is null
      or rules.effective_to >= coalesce(
        p_as_of_date,
        (pg_catalog.now() at time zone 'Asia/Tokyo')::date
      )
    )
  order by
    regions.specificity desc,
    rules.priority desc,
    rules.effective_from desc,
    rules.version desc,
    rules.id
  limit 1;
end;
$$;

revoke all on function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  from public, anon, authenticated;
grant execute on function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  to authenticated, service_role;

-- Re-assert the complete Data API allow-list after all forward-created
-- routines/tables above.  service_role remains the trusted server boundary;
-- it is deliberately not revoked here.  No public/anon routine or direct
-- authenticated write can appear implicitly through PostgreSQL defaults.
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_account_member(uuid) to authenticated;
grant execute on function public.can_access_field(uuid) to authenticated;
grant execute on function public.can_access_season(uuid) to authenticated;
grant execute on function public.get_field_map(
  smallint, double precision, double precision, double precision, double precision
) to authenticated;
grant execute on function public.get_field_detail(uuid, smallint) to authenticated;
grant execute on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) to authenticated;
grant execute on function public.register_harvest(uuid, date, numeric) to authenticated;
grant execute on function public.get_parcel_candidates(
  smallint, double precision, double precision, double precision,
  double precision, integer, text
) to authenticated;
grant execute on function public.get_parcel_candidates_mvt(
  integer, integer, integer, smallint, integer
) to authenticated;
grant execute on function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  to authenticated;
grant execute on function public.save_account_variety_rule(
  uuid, uuid, numeric, numeric, numeric, smallint, text, date, uuid, uuid, date
) to authenticated;
grant execute on function public.list_account_variety_rules(uuid, uuid)
  to authenticated;
grant execute on function public.delete_account_variety_rule(uuid, uuid)
  to authenticated;
grant execute on function public.find_nearest_weather_locations(uuid, integer)
  to authenticated;

grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.set_updated_at() to service_role;
grant execute on function public.recalculate_crop_season_summary(uuid, date)
  to service_role;
grant execute on function public.normalize_parcel_candidate_geometry(jsonb)
  to service_role;
grant execute on function public.prevent_account_variety_rule_overlap()
  to service_role;
grant execute on function public.prevent_variety_rule_active_overlap()
  to service_role;
