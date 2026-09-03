-- Farmer-first field registration without map or parcel selection.
--
-- Geographic data remains supported for existing records, while the normal
-- farmer flow stores only a human-readable size class. New simple seasons are
-- bound to the Sera AMeDAS station (67316) for the Kui pilot and accumulate
-- from the registered heading date itself.

alter table public.fields
  add column if not exists size_class text;

update public.fields
set size_class = case
  when area_m2 is null then 'MEDIUM'
  when area_m2 < 1000 then 'SMALL'
  when area_m2 < 3000 then 'MEDIUM'
  else 'LARGE'
end
where size_class is null;

alter table public.fields
  alter column size_class set default 'MEDIUM',
  alter column size_class set not null,
  alter column geom drop not null,
  alter column area_m2 drop not null;

do $$
begin
  alter table public.fields
    add constraint fields_size_class_check
    check (size_class in ('SMALL', 'MEDIUM', 'LARGE'));
exception
  when duplicate_object then null;
end;
$$;

alter table public.crop_seasons
  add column if not exists planting_date date;

do $$
begin
  alter table public.crop_seasons
    add constraint crop_seasons_heading_after_planting_check
    check (
      planting_date is null
      or heading_date is null
      or heading_date >= planting_date
    );
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.register_simple_field_with_season(
  p_idempotency_key text,
  p_field_name text,
  p_size_class text,
  p_year smallint,
  p_variety_id uuid,
  p_planting_date date default null,
  p_heading_date date default null
)
returns table (
  field_id uuid,
  crop_season_id uuid,
  size_class text,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_size_class text;
  v_registration record;
  v_reference_geometry jsonb := pg_catalog.jsonb_build_object(
    'type', 'Polygon',
    'coordinates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_array(133.04995, 34.58328),
        pg_catalog.jsonb_build_array(133.05005, 34.58328),
        pg_catalog.jsonb_build_array(133.05005, 34.58338),
        pg_catalog.jsonb_build_array(133.04995, 34.58338),
        pg_catalog.jsonb_build_array(133.04995, 34.58328)
      )
    )
  );
begin
  v_size_class := pg_catalog.upper(pg_catalog.btrim(coalesce(p_size_class, '')));
  if v_size_class not in ('SMALL', 'MEDIUM', 'LARGE') then
    raise exception using
      errcode = '22023',
      message = 'p_size_class must be SMALL, MEDIUM, or LARGE';
  end if;

  if p_planting_date is null or p_heading_date is null then
    raise exception using
      errcode = '22023',
      message = 'p_planting_date and p_heading_date are required';
  end if;

  if p_heading_date < p_planting_date then
    raise exception using
      errcode = '22023',
      message = 'p_heading_date must not be before p_planting_date';
  end if;

  select *
    into v_registration
  from public.register_field_with_season(
    p_idempotency_key,
    p_field_name,
    v_reference_geometry,
    p_year,
    p_variety_id,
    p_heading_date,
    'MANUAL',
    'NO_LOCATION:' || v_size_class,
    'PLANTING_DATE:' || coalesce(p_planting_date::text, 'NONE')
  );

  update public.fields
  set geom = null,
      area_m2 = null,
      size_class = v_size_class,
      parcel_source = null,
      parcel_external_id = null,
      parcel_dataset_version = null,
      updated_at = pg_catalog.now()
  where id = v_registration.field_id;

  update public.crop_seasons
  set planting_date = p_planting_date,
      updated_at = pg_catalog.now()
  where id = v_registration.crop_season_id;

  -- The farmer flow always starts with the heading date itself. Existing
  -- map-based registrations retain their immutable snapshot behavior.
  update public.season_rule_snapshots as snapshots
  set accumulation_start_offset_days = 0
  where snapshots.crop_season_id = v_registration.crop_season_id;

  return query
  select
    v_registration.field_id,
    v_registration.crop_season_id,
    v_size_class,
    v_registration.was_replayed;
end;
$$;

revoke all on function public.register_simple_field_with_season(
  text, text, text, smallint, uuid, date, date
) from public, anon, authenticated;
grant execute on function public.register_simple_field_with_season(
  text, text, text, smallint, uuid, date, date
) to authenticated, service_role;

create or replace function public.get_field_overview(
  p_year smallint
)
returns table (
  field_id uuid,
  field_name text,
  field_size_class text,
  season_id uuid,
  season_year smallint,
  variety_id uuid,
  variety_name text,
  planting_date date,
  heading_date date,
  harvest_date date,
  accumulated_temp_c numeric(8, 2),
  maturity_status public.maturity_status,
  data_status public.data_status,
  accumulated_through date,
  missing_day_count integer,
  estimated_days_to_start integer
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

  return query
  select
    fields.id,
    fields.name,
    fields.size_class,
    crop_seasons.id,
    crop_seasons.year,
    crop_seasons.variety_id,
    rice_varieties.name,
    crop_seasons.planting_date,
    crop_seasons.heading_date,
    crop_seasons.harvest_date,
    crop_season_summaries.accumulated_temp_c,
    crop_season_summaries.maturity_status,
    crop_season_summaries.data_status,
    crop_season_summaries.accumulated_through,
    crop_season_summaries.missing_day_count,
    crop_season_summaries.estimated_days_to_start
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
  order by fields.name, fields.id
  limit 1000;
end;
$$;

revoke all on function public.get_field_overview(smallint)
  from public, anon, authenticated;
grant execute on function public.get_field_overview(smallint)
  to authenticated, service_role;

create or replace function public.get_field_detail_simple(
  p_field_id uuid,
  p_year smallint default null
)
returns table (
  field_id uuid,
  field_name text,
  field_size_class text,
  season_id uuid,
  season_year smallint,
  variety_id uuid,
  variety_name text,
  planting_date date,
  heading_date date,
  harvest_date date,
  harvest_accumulated_temp_c numeric(8, 2),
  lifecycle_status public.season_lifecycle_status,
  accumulated_temp_c numeric(8, 2),
  maturity_status public.maturity_status,
  data_status public.data_status,
  accumulated_through date,
  valid_day_count integer,
  missing_day_count integer,
  estimated_days_to_start integer
)
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '2s'
as $$
  select
    fields.id,
    fields.name,
    fields.size_class,
    crop_seasons.id,
    crop_seasons.year,
    crop_seasons.variety_id,
    rice_varieties.name,
    crop_seasons.planting_date,
    crop_seasons.heading_date,
    crop_seasons.harvest_date,
    crop_seasons.harvest_accumulated_temp_c,
    crop_seasons.lifecycle_status,
    crop_season_summaries.accumulated_temp_c,
    crop_season_summaries.maturity_status,
    crop_season_summaries.data_status,
    crop_season_summaries.accumulated_through,
    crop_season_summaries.valid_day_count,
    crop_season_summaries.missing_day_count,
    crop_season_summaries.estimated_days_to_start
  from public.fields
  left join public.crop_seasons
    on crop_seasons.field_id = fields.id
   and (p_year is null or crop_seasons.year = p_year)
  left join public.rice_varieties
    on rice_varieties.id = crop_seasons.variety_id
  left join public.crop_season_summaries
    on crop_season_summaries.crop_season_id = crop_seasons.id
  where fields.id = p_field_id
    and public.is_account_member(fields.account_id)
    and fields.archived_at is null
  order by crop_seasons.year desc nulls last;
$$;

revoke all on function public.get_field_detail_simple(uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.get_field_detail_simple(uuid, smallint)
  to authenticated, service_role;
