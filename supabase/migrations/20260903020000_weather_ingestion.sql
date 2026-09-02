-- Weather ingestion metadata and an idempotent, service-only season refresh.
--
-- This is a forward-only migration. Existing daily_weather rows remain valid;
-- old rows receive conservative defaults (sample_count = 0 and an empty
-- source_metadata object) and are therefore visible as historical/incomplete
-- until a provider run refreshes them.

alter table public.daily_weather
  add column if not exists sample_count integer not null default 0,
  add column if not exists expected_sample_count integer not null default 24,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.daily_weather
    add constraint daily_weather_sample_count_check
    check (sample_count between 0 and expected_sample_count);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.daily_weather
    add constraint daily_weather_expected_sample_count_check
    check (expected_sample_count between 1 and 24);
exception
  when duplicate_object then null;
end;
$$;

alter table public.weather_import_runs
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create or replace function public.recalculate_crop_season_summary(
  p_crop_season_id uuid,
  p_as_of_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_heading_date date;
  v_harvest_date date;
  v_weather_location_id uuid;
  v_start_date date;
  v_through_date date;
  v_latest_valid_date date;
  v_as_of_date date := coalesce(
    p_as_of_date,
    (pg_catalog.now() at time zone 'Asia/Tokyo')::date
  );
  v_offset smallint;
  v_start_temp numeric(8, 2);
  v_target_temp numeric(8, 2);
  v_end_temp numeric(8, 2);
  v_accumulated numeric(8, 2) := 0;
  v_valid_days integer := 0;
  v_missing_days integer := 0;
  v_expected_days integer := 0;
  v_recent_count integer := 0;
  v_recent_average numeric;
  v_estimated_days integer;
  v_maturity public.maturity_status;
  v_data_status public.data_status;
begin
  if p_crop_season_id is null then
    return;
  end if;

  -- Serialise two correction runs for the same season. The weather UPSERT is
  -- deterministic as well, so a retry after a network timeout is safe.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_crop_season_id::text, 0)
  );

  select
    crop_seasons.heading_date,
    crop_seasons.harvest_date
    into v_heading_date, v_harvest_date
  from public.crop_seasons
  where crop_seasons.id = p_crop_season_id
  for update;

  if not found then
    return;
  end if;

  select season_weather_bindings.weather_location_id
    into v_weather_location_id
  from public.season_weather_bindings
  where season_weather_bindings.crop_season_id = p_crop_season_id
    and season_weather_bindings.is_active
  order by season_weather_bindings.created_at desc, season_weather_bindings.id desc
  limit 1;

  select
    season_rule_snapshots.accumulation_start_offset_days,
    season_rule_snapshots.harvest_start_temp_c,
    season_rule_snapshots.harvest_target_temp_c,
    season_rule_snapshots.harvest_end_temp_c
    into v_offset, v_start_temp, v_target_temp, v_end_temp
  from public.season_rule_snapshots
  where season_rule_snapshots.crop_season_id = p_crop_season_id;

  if v_heading_date is null
     or v_weather_location_id is null
     or v_offset is null
     or v_start_temp is null
     or v_target_temp is null
     or v_end_temp is null then
    insert into public.crop_season_summaries (
      crop_season_id,
      accumulated_temp_c,
      accumulated_through,
      valid_day_count,
      missing_day_count,
      maturity_status,
      data_status,
      estimated_days_to_start,
      calculated_at,
      error_message
    ) values (
      p_crop_season_id,
      0,
      null,
      0,
      0,
      case when v_harvest_date is null then 'NOT_CONFIGURED' else 'HARVESTED' end,
      'PENDING',
      null,
      pg_catalog.now(),
      null
    )
    on conflict (crop_season_id) do update set
      accumulated_temp_c = excluded.accumulated_temp_c,
      accumulated_through = excluded.accumulated_through,
      valid_day_count = excluded.valid_day_count,
      missing_day_count = excluded.missing_day_count,
      maturity_status = excluded.maturity_status,
      data_status = excluded.data_status,
      estimated_days_to_start = excluded.estimated_days_to_start,
      calculated_at = excluded.calculated_at,
      error_message = null;
    return;
  end if;

  v_start_date := v_heading_date + v_offset;

  select max(daily_weather.observed_date)
    into v_through_date
  from public.daily_weather
  where daily_weather.weather_location_id = v_weather_location_id
    and daily_weather.observed_date <= v_as_of_date;

  if v_through_date is not null and v_through_date >= v_start_date then
    v_expected_days := v_through_date - v_start_date + 1;
    select
      coalesce(sum(daily_weather.mean_temp_c), 0),
      count(*) filter (where daily_weather.mean_temp_c is not null),
      max(daily_weather.observed_date) filter (where daily_weather.mean_temp_c is not null)
      into v_accumulated, v_valid_days, v_latest_valid_date
    from public.daily_weather
    where daily_weather.weather_location_id = v_weather_location_id
      and daily_weather.observed_date between v_start_date and v_through_date;
    v_missing_days := greatest(0, v_expected_days - v_valid_days);
  else
    v_accumulated := 0;
    v_valid_days := 0;
    v_missing_days := 0;
    v_expected_days := 0;
    v_latest_valid_date := null;
  end if;

  -- Keep the status ordering aligned with src/domain/data-status.ts:
  -- errors, pending, stale, then an incomplete range.
  if v_expected_days = 0 then
    v_data_status := 'PENDING';
  elsif v_latest_valid_date is not null
    and v_as_of_date - v_latest_valid_date >= 2 then
    v_data_status := 'STALE';
  elsif v_missing_days > 0 then
    v_data_status := 'INCOMPLETE';
  else
    v_data_status := 'COMPLETE';
  end if;

  if v_harvest_date is not null then
    v_maturity := 'HARVESTED';
  elsif v_as_of_date < v_start_date then
    v_maturity := 'BEFORE_HEADING';
  elsif v_start_temp <= 0 then
    v_maturity := case when v_accumulated <= v_end_temp then 'HARVEST_READY' else 'OVERDUE' end;
  elsif v_accumulated / v_start_temp < 0.7 then
    v_maturity := 'GROWING';
  elsif v_accumulated / v_start_temp < 0.9 then
    v_maturity := 'GROWING_LATE';
  elsif v_accumulated < v_start_temp then
    v_maturity := 'HARVEST_SOON';
  elsif v_accumulated <= v_end_temp then
    v_maturity := 'HARVEST_READY';
  else
    v_maturity := 'OVERDUE';
  end if;

  select
    count(*)::integer,
    avg(daily_weather.mean_temp_c)
    into v_recent_count, v_recent_average
  from public.daily_weather
  where daily_weather.weather_location_id = v_weather_location_id
    and daily_weather.observed_date between v_as_of_date - 6 and v_as_of_date
    and daily_weather.mean_temp_c is not null;

  if v_recent_count >= 5 and v_recent_average > 0 then
    v_estimated_days := greatest(
      0,
      pg_catalog.ceil((v_start_temp - v_accumulated) / v_recent_average)
    )::integer;
  else
    v_estimated_days := null;
  end if;

  insert into public.crop_season_summaries (
    crop_season_id,
    accumulated_temp_c,
    accumulated_through,
    valid_day_count,
    missing_day_count,
    maturity_status,
    data_status,
    estimated_days_to_start,
    calculated_at,
    error_message
  ) values (
    p_crop_season_id,
    v_accumulated,
    v_through_date,
    v_valid_days,
    v_missing_days,
    v_maturity,
    v_data_status,
    v_estimated_days,
    pg_catalog.now(),
    null
  )
  on conflict (crop_season_id) do update set
    accumulated_temp_c = excluded.accumulated_temp_c,
    accumulated_through = excluded.accumulated_through,
    valid_day_count = excluded.valid_day_count,
    missing_day_count = excluded.missing_day_count,
    maturity_status = excluded.maturity_status,
    data_status = excluded.data_status,
    estimated_days_to_start = excluded.estimated_days_to_start,
    calculated_at = excluded.calculated_at,
    error_message = null;
end;
$$;

revoke all on function public.recalculate_crop_season_summary(uuid, date)
  from public, anon, authenticated;
grant execute on function public.recalculate_crop_season_summary(uuid, date)
  to service_role;

-- The function is intentionally not granted to authenticated/anon. Weather
-- writes and recalculation are trusted job operations only.
