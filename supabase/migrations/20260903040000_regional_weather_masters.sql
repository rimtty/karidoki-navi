-- Regional and weather master data for the Mihara/Kui pilot.
--
-- This migration deliberately does not invent harvest accumulated-temperature
-- values.  The Hiroshima prefectural cultivation standard gives altitude
-- bands, suitable varieties, and a blue-grain-rate harvest check, but it does
-- not give start/target/end accumulated daily-mean-temperature values for the
-- five pilot varieties.  Values from another prefecture or a general-purpose
-- source must not be copied into variety_rules for this pilot.

-- The original schema stores a PostGIS point.  Keep that as the single source
-- of truth and expose generated decimal-degree columns for API consumers such
-- as the weather ingestion function.  JMA's master expresses coordinates as
-- degrees and 0.1-minute values; the master UPSERT below stores the converted
-- WGS84 point and these columns always remain in sync with it.
alter table public.weather_locations
  add column if not exists latitude double precision generated always as (
    extensions.st_y(location)
  ) stored,
  add column if not exists longitude double precision generated always as (
    extensions.st_x(location)
  ) stored;

do $$
begin
  alter table public.weather_locations
    add constraint weather_locations_latitude_check
    check (latitude between -90 and 90);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.weather_locations
    add constraint weather_locations_longitude_check
    check (longitude between -180 and 180);
exception
  when duplicate_object then null;
end;
$$;

-- `region_kind` predates a dedicated town/elevation-band enum.  CUSTOM is
-- therefore used for the sub-municipal Kui town and the prefectural altitude
-- bands.  `specificity` is the explicit resolution rank consumed by the SQL
-- resolver (larger means narrower), so CUSTOM does not accidentally outrank
-- a municipality merely because of the enum name.
alter table public.rule_regions
  add column if not exists parent_region_id uuid
    references public.rule_regions(id) on delete restrict,
  add column if not exists specificity smallint not null default 0,
  add column if not exists elevation_min_m numeric(8, 2),
  add column if not exists elevation_max_m numeric(8, 2);

do $$
begin
  alter table public.rule_regions
    add constraint rule_regions_specificity_check
    check (specificity between 0 and 100);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.rule_regions
    add constraint rule_regions_elevation_range_check
    check (
      (elevation_min_m is null or elevation_min_m >= 0)
      and (elevation_max_m is null or elevation_max_m > 0)
      and (
        elevation_min_m is null
        or elevation_max_m is null
        or elevation_min_m < elevation_max_m
      )
    );
exception
  when duplicate_object then null;
end;
$$;

create index if not exists rule_regions_resolution_idx
  on public.rule_regions (specificity desc, parent_region_id);

-- Official thresholds are intentionally absent for the five pilot varieties.
-- This account-scoped table is the safe place for a farmer/administrator to
-- record a locally adopted start/target/end rule without pretending that it
-- is a public Hiroshima master value.  NULL region_id means the account's
-- default for that variety; a region id narrows it to a matched region.
create table if not exists public.account_variety_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  variety_id uuid not null references public.rice_varieties(id) on delete restrict,
  region_id uuid references public.rule_regions(id) on delete restrict,
  harvest_start_temp_c numeric(8, 2) not null,
  harvest_target_temp_c numeric(8, 2) not null,
  harvest_end_temp_c numeric(8, 2) not null,
  accumulation_start_offset_days smallint not null default 1,
  source_note text not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint account_variety_rules_temperature_order check (
    harvest_start_temp_c <= harvest_target_temp_c
    and harvest_target_temp_c <= harvest_end_temp_c
  ),
  constraint account_variety_rules_effective_period check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint account_variety_rules_start_offset check (
    accumulation_start_offset_days between 0 and 7
  ),
  constraint account_variety_rules_source_note check (
    char_length(pg_catalog.btrim(source_note)) between 1 and 2000
  )
);

create index if not exists account_variety_rules_resolution_idx
  on public.account_variety_rules (
    account_id,
    variety_id,
    region_id,
    effective_from desc
  );

create trigger account_variety_rules_set_updated_at
before update on public.account_variety_rules
for each row execute function public.set_updated_at();

alter table public.account_variety_rules enable row level security;

create policy account_variety_rules_select_member
on public.account_variety_rules for select
to authenticated
using (public.is_account_member(account_id));

create policy account_variety_rules_insert_member
on public.account_variety_rules for insert
to authenticated
with check (public.is_account_member(account_id));

create policy account_variety_rules_update_member
on public.account_variety_rules for update
to authenticated
using (public.is_account_member(account_id))
with check (public.is_account_member(account_id));

create policy account_variety_rules_delete_member
on public.account_variety_rules for delete
to authenticated
using (public.is_account_member(account_id));

revoke all on public.account_variety_rules from public, anon, authenticated;
grant select on public.account_variety_rules to authenticated;
grant all on public.account_variety_rules to service_role;

-- A custom rule is effective whenever its date range is selected.  Keep
-- adjacent history possible, but reject overlapping ranges for the same
-- account/variety/region (including the NULL account-default region).
create or replace function public.prevent_account_variety_rule_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.account_id::text || ':' || new.variety_id::text || ':' ||
        coalesce(new.region_id::text, 'ACCOUNT_DEFAULT'),
      0
    )
  );

  if exists (
    select 1
    from public.account_variety_rules as existing
    where existing.account_id = new.account_id
      and existing.variety_id = new.variety_id
      and existing.region_id is not distinct from new.region_id
      and existing.id is distinct from new.id
      and daterange(
        existing.effective_from,
        coalesce(existing.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        new.effective_from,
        coalesce(new.effective_to, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception using
      errcode = '23P01',
      message = 'account variety rule effective periods must not overlap';
  end if;

  return new;
end;
$$;

drop trigger if exists account_variety_rules_prevent_overlap
  on public.account_variety_rules;
create trigger account_variety_rules_prevent_overlap
before insert or update on public.account_variety_rules
for each row execute function public.prevent_account_variety_rule_overlap();

revoke all on function public.prevent_account_variety_rule_overlap()
  from public, anon, authenticated;
grant execute on function public.prevent_account_variety_rule_overlap()
  to service_role;

-- Stable region codes are used as the idempotency key.  Region geometry is
-- intentionally left NULL: no authoritative boundary/altitude raster for
-- Kui's town and the four cultivation bands was bundled with the cited
-- source, so callers must provide the region match from their trusted spatial
-- boundary/altitude adapter before applying a rule.
insert into public.rule_regions (
  kind,
  code,
  name,
  specificity,
  parent_region_id,
  elevation_min_m,
  elevation_max_m
)
values (
  'COUNTRY'::public.region_kind,
  'JP',
  '日本全国',
  10,
  null,
  null,
  null
)
on conflict (kind, code) do update set
  name = excluded.name,
  specificity = excluded.specificity,
  parent_region_id = excluded.parent_region_id,
  elevation_min_m = excluded.elevation_min_m,
  elevation_max_m = excluded.elevation_max_m,
  updated_at = pg_catalog.now();

insert into public.rule_regions (
  kind,
  code,
  name,
  specificity,
  parent_region_id,
  elevation_min_m,
  elevation_max_m
)
select
  'PREFECTURE'::public.region_kind,
  '34',
  '広島県',
  20,
  parent.id,
  null,
  null
from public.rule_regions as parent
where parent.kind = 'COUNTRY'::public.region_kind
  and parent.code = 'JP'
on conflict (kind, code) do update set
  name = excluded.name,
  specificity = excluded.specificity,
  parent_region_id = excluded.parent_region_id,
  elevation_min_m = excluded.elevation_min_m,
  elevation_max_m = excluded.elevation_max_m,
  updated_at = pg_catalog.now();

insert into public.rule_regions (
  kind,
  code,
  name,
  specificity,
  parent_region_id,
  elevation_min_m,
  elevation_max_m
)
select
  'MUNICIPALITY'::public.region_kind,
  '34204',
  '三原市',
  40,
  parent.id,
  null,
  null
from public.rule_regions as parent
where parent.kind = 'PREFECTURE'::public.region_kind
  and parent.code = '34'
on conflict (kind, code) do update set
  name = excluded.name,
  specificity = excluded.specificity,
  parent_region_id = excluded.parent_region_id,
  elevation_min_m = excluded.elevation_min_m,
  elevation_max_m = excluded.elevation_max_m,
  updated_at = pg_catalog.now();

insert into public.rule_regions (
  kind,
  code,
  name,
  specificity,
  parent_region_id,
  elevation_min_m,
  elevation_max_m
)
select
  'CUSTOM'::public.region_kind,
  '34204-kui',
  '三原市久井町',
  50,
  parent.id,
  null,
  null
from public.rule_regions as parent
where parent.kind = 'MUNICIPALITY'::public.region_kind
  and parent.code = '34204'
on conflict (kind, code) do update set
  name = excluded.name,
  specificity = excluded.specificity,
  parent_region_id = excluded.parent_region_id,
  elevation_min_m = excluded.elevation_min_m,
  elevation_max_m = excluded.elevation_max_m,
  updated_at = pg_catalog.now();

-- Hiroshima's official cultivation standard (PDF p.2, table 1) defines these
-- four altitude bands.  The bounds are stored as metadata so a future
-- elevation-aware matcher can select the correct band without treating one
-- station's elevation as the field's elevation.
insert into public.rule_regions (
  kind,
  code,
  name,
  specificity,
  parent_region_id,
  elevation_min_m,
  elevation_max_m
)
select
  bands.kind::public.region_kind,
  bands.code,
  bands.name,
  bands.specificity,
  parent.id,
  bands.elevation_min_m,
  bands.elevation_max_m
from (
  values
    ('CUSTOM', 'hiroshima-altitude-highland-500-plus', '広島県高冷地帯（標高500m以上）', 30::smallint, 500::numeric, null::numeric),
    ('CUSTOM', 'hiroshima-altitude-northern-300-500', '広島県北部地帯（標高300m以上500m未満）', 30::smallint, 300::numeric, 500::numeric),
    ('CUSTOM', 'hiroshima-altitude-central-150-300', '広島県中部地帯（標高150m以上300m未満）', 30::smallint, 150::numeric, 300::numeric),
    ('CUSTOM', 'hiroshima-altitude-southern-under-150', '広島県南部地帯（標高150m未満）', 30::smallint, null::numeric, 150::numeric)
) as bands(kind, code, name, specificity, elevation_min_m, elevation_max_m)
cross join lateral (
  select parent.id
  from public.rule_regions as parent
  where parent.kind = 'PREFECTURE'::public.region_kind
    and parent.code = '34'
  limit 1
) as parent
on conflict (kind, code) do update set
  name = excluded.name,
  specificity = excluded.specificity,
  parent_region_id = excluded.parent_region_id,
  elevation_min_m = excluded.elevation_min_m,
  elevation_max_m = excluded.elevation_max_m,
  updated_at = pg_catalog.now();

-- JMA regional observation master, applied 2026-03-24.  The PDF stores
-- latitude/longitude as degrees plus 0.1 minutes; e.g. 34 35.0 ->
-- 34.5833333333 degrees.  Both stations observe temperature, so they are
-- candidates for the harvest accumulation provider.
insert into public.weather_locations (
  provider,
  external_id,
  name,
  location,
  elevation_m,
  is_active,
  metadata
)
values
(
  'JMA_AMEDAS'::public.weather_provider,
  '67316',
  '世羅',
  extensions.st_setsrid(
    extensions.st_makepoint(133.05::double precision, 34.583333333333336::double precision),
    4326
  ),
  350,
  true,
  jsonb_build_object(
    'source', 'JMA_AmeDAS_master',
    'source_url', 'https://www.jma.go.jp/jma/kishou/know/amedas/ame_master.pdf',
    'master_applied_on', '2026-03-24',
    'station_type_code', '四',
    'station_type', '有線ロボット気象計',
    'observed_elements', jsonb_build_array('降水量', '気温', '風向', '風速', '相対湿度'),
    'latitude_degrees', 34.583333333333336,
    'longitude_degrees', 133.05,
    'elevation_unit', 'm',
    'coordinate_unit', 'degree (converted from degree + 0.1 minute)'
  )
),
(
  'JMA_AMEDAS'::public.weather_provider,
  '67386',
  '本郷',
  extensions.st_setsrid(
    extensions.st_makepoint(132.91833333333332::double precision, 34.435::double precision),
    4326
  ),
  331,
  true,
  jsonb_build_object(
    'source', 'JMA_AmeDAS_master',
    'source_url', 'https://www.jma.go.jp/jma/kishou/know/amedas/ame_master.pdf',
    'master_applied_on', '2026-03-24',
    'station_type_code', '官',
    'station_type', '地上気象観測装置',
    'observed_elements', jsonb_build_array('降水量', '気温', '風向', '風速'),
    'excluded_elements', jsonb_build_array('日照時間', '相対湿度', '気圧'),
    'latitude_degrees', 34.435,
    'longitude_degrees', 132.91833333333332,
    'elevation_unit', 'm',
    'coordinate_unit', 'degree (converted from degree + 0.1 minute)'
  )
)
on conflict (provider, external_id) do update set
  name = excluded.name,
  location = excluded.location,
  elevation_m = excluded.elevation_m,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  updated_at = pg_catalog.now();

-- Do not permit two active revisions for the same variety/region to cover an
-- overlapping effective period.  Versioned history remains possible by
-- retiring the old row or by using adjacent, non-overlapping periods.
create or replace function public.prevent_variety_rule_active_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ACTIVE'::public.rule_status then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.variety_id::text || ':' || new.region_id::text,
        0
      )
    );

    if exists (
      select 1
      from public.variety_rules as existing
      where existing.variety_id = new.variety_id
        and existing.region_id = new.region_id
        and existing.status = 'ACTIVE'::public.rule_status
        and existing.id is distinct from new.id
        and daterange(
          existing.effective_from,
          coalesce(existing.effective_to, 'infinity'::date),
          '[]'
        ) && daterange(
          new.effective_from,
          coalesce(new.effective_to, 'infinity'::date),
          '[]'
        )
    ) then
      raise exception using
        errcode = '23P01',
        message = 'active variety rule effective periods must not overlap';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists variety_rules_prevent_active_overlap
  on public.variety_rules;
create trigger variety_rules_prevent_active_overlap
before insert or update on public.variety_rules
for each row execute function public.prevent_variety_rule_active_overlap();

revoke all on function public.prevent_variety_rule_active_overlap() from public, anon, authenticated;
grant execute on function public.prevent_variety_rule_active_overlap() to service_role;

-- Resolve only rules whose region was matched by a trusted spatial/elevation
-- adapter.  An empty/null region list intentionally returns no row; there is
-- no unverified variety-default value in this migration.
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
language sql
stable
security invoker
set search_path = ''
as $$
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
$$;

revoke all on function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  from public, anon, authenticated;
grant execute on function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  to authenticated;
grant execute on function public.resolve_variety_rule_for_regions(uuid, uuid[], date)
  to service_role;

-- Account custom rules are intentionally separate from the public catalog.
-- The RPCs take an account id only as a selector; every operation verifies
-- that the authenticated caller is a member of that account before reading
-- or mutating its private rule rows.
create or replace function public.save_account_variety_rule(
  p_account_id uuid,
  p_variety_id uuid,
  p_harvest_start_temp_c numeric,
  p_harvest_target_temp_c numeric,
  p_harvest_end_temp_c numeric,
  p_accumulation_start_offset_days smallint,
  p_source_note text,
  p_effective_from date,
  p_rule_id uuid default null,
  p_region_id uuid default null,
  p_effective_to date default null
)
returns setof public.account_variety_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.account_variety_rules;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if not public.is_account_member(p_account_id) then
    raise exception using
      errcode = '42501',
      message = 'account access is required';
  end if;

  if p_rule_id is null then
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
    ) values (
      p_account_id,
      p_variety_id,
      p_region_id,
      p_harvest_start_temp_c,
      p_harvest_target_temp_c,
      p_harvest_end_temp_c,
      p_accumulation_start_offset_days,
      p_source_note,
      p_effective_from,
      p_effective_to
    ) returning * into v_rule;
  else
    update public.account_variety_rules
    set variety_id = p_variety_id,
        region_id = p_region_id,
        harvest_start_temp_c = p_harvest_start_temp_c,
        harvest_target_temp_c = p_harvest_target_temp_c,
        harvest_end_temp_c = p_harvest_end_temp_c,
        accumulation_start_offset_days = p_accumulation_start_offset_days,
        source_note = p_source_note,
        effective_from = p_effective_from,
        effective_to = p_effective_to
    where id = p_rule_id
      and account_id = p_account_id
    returning * into v_rule;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'account rule access is required';
    end if;
  end if;

  return next v_rule;
  return;
end;
$$;

create or replace function public.list_account_variety_rules(
  p_account_id uuid,
  p_variety_id uuid default null
)
returns setof public.account_variety_rules
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if not public.is_account_member(p_account_id) then
    raise exception using
      errcode = '42501',
      message = 'account access is required';
  end if;

  return query
  select rules.*
  from public.account_variety_rules as rules
  where rules.account_id = p_account_id
    and (p_variety_id is null or rules.variety_id = p_variety_id)
  order by rules.effective_from desc, rules.updated_at desc, rules.id;
end;
$$;

create or replace function public.delete_account_variety_rule(
  p_account_id uuid,
  p_rule_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if not public.is_account_member(p_account_id) then
    raise exception using
      errcode = '42501',
      message = 'account access is required';
  end if;

  delete from public.account_variety_rules
  where id = p_rule_id
    and account_id = p_account_id;
  return found;
end;
$$;

revoke all on function public.save_account_variety_rule(
  uuid, uuid, numeric, numeric, numeric, smallint, text, date, uuid, uuid, date
) from public, anon, authenticated;
grant execute on function public.save_account_variety_rule(
  uuid, uuid, numeric, numeric, numeric, smallint, text, date, uuid, uuid, date
) to authenticated, service_role;

revoke all on function public.list_account_variety_rules(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_account_variety_rules(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.delete_account_variety_rule(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account_variety_rule(uuid, uuid)
  to authenticated, service_role;

-- A field owner supplies the field id, not arbitrary coordinates.  The point
-- used for ranking is derived server-side from the field geometry, and an
-- unauthorized caller receives no rows.  This keeps private field geometry
-- out of the RPC response while still returning the public weather master.
create or replace function public.find_nearest_weather_locations(
  p_field_id uuid,
  p_limit integer default 5
)
returns table (
  weather_location_id uuid,
  provider public.weather_provider,
  external_id text,
  name text,
  latitude double precision,
  longitude double precision,
  elevation_m numeric(8, 2),
  distance_m numeric(12, 2),
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_field_point extensions.geometry;
  v_user_id uuid;
  v_limit integer;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if p_field_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_field_id is required';
  end if;

  v_limit := coalesce(p_limit, 5);
  if v_limit not between 1 and 20 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 20';
  end if;

  select extensions.st_pointonsurface(fields.geom)
    into v_field_point
  from public.fields
  join public.account_members
    on account_members.account_id = fields.account_id
   and account_members.user_id = v_user_id
   and account_members.role = 'OWNER'::public.account_role
  where fields.id = p_field_id
    and fields.archived_at is null;

  -- Do not reveal whether an arbitrary UUID belongs to another account.
  if v_field_point is null then
    return;
  end if;

  return query
  select
    locations.id,
    locations.provider,
    locations.external_id,
    locations.name,
    locations.latitude,
    locations.longitude,
    locations.elevation_m,
    extensions.st_distance(
      locations.location::extensions.geography,
      v_field_point::extensions.geography
    )::numeric(12, 2),
    locations.metadata
  from public.weather_locations as locations
  where locations.is_active
    and locations.provider = 'JMA_AMEDAS'::public.weather_provider
  order by
    extensions.st_distance(
      locations.location::extensions.geography,
      v_field_point::extensions.geography
    ),
    locations.external_id
  limit v_limit;
end;
$$;

revoke all on function public.find_nearest_weather_locations(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.find_nearest_weather_locations(uuid, integer)
  to authenticated;
grant execute on function public.find_nearest_weather_locations(uuid, integer)
  to service_role;
