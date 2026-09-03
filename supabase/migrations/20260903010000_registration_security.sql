-- Registration API and least-privilege grants.
--
-- This migration intentionally does not modify the initial migration.  Field
-- registration is exposed through one transaction-safe RPC so that the
-- account is always selected from auth.uid(), and geometry/area are derived
-- on the server.

-- The pilot's initial master names were confirmed by the product owner.  No
-- variety rule values are inferred here; those require an official source for
-- the pilot region before they can be activated.
insert into public.rice_varieties (name)
values
  ('コシヒカリ'),
  ('あきさかり'),
  ('あきろまん'),
  ('ヒノヒカリ'),
  ('恋の予感')
on conflict (name) do update
set is_active = true,
    updated_at = pg_catalog.now();

-- This table is deliberately not exposed through the Data API.  A row is
-- keyed by the authenticated user and request key, not by account_id, so a
-- client cannot replay another user's request or choose another account.
create table public.field_registration_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  field_id uuid,
  crop_season_id uuid,
  area_m2 numeric(14, 2),
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  primary key (user_id, idempotency_key),
  constraint field_registration_requests_key_check check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
  ),
  constraint field_registration_requests_hash_check check (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint field_registration_requests_result_check check (
    (
      completed_at is null
      and field_id is null
      and crop_season_id is null
      and area_m2 is null
    )
    or (
      completed_at is not null
      and field_id is not null
      and crop_season_id is not null
      and area_m2 is not null
      and area_m2 > 0
    )
  )
);

create index field_registration_requests_created_at_idx
  on public.field_registration_requests (created_at desc);

alter table public.field_registration_requests enable row level security;

-- There are intentionally no authenticated/anon policies or table grants for
-- this internal ledger.  The registration RPC runs as its owner and is the
-- only application path that can read or write it.
revoke all on table public.field_registration_requests from public, anon, authenticated;
grant all on table public.field_registration_requests to service_role;

create or replace function public.register_field_with_season(
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
as $$
declare
  v_user_id uuid;
  v_account_id uuid;
  v_idempotency_key text;
  v_field_name text;
  v_parcel_source text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_field_id uuid;
  v_existing_crop_season_id uuid;
  v_existing_area_m2 numeric(14, 2);
  v_existing_completed_at timestamptz;
  v_geom extensions.geometry;
  v_geometry_type text;
  v_area_m2 double precision;
  v_field_id uuid;
  v_crop_season_id uuid;
begin
  -- auth.uid() is the only identity source.  There is deliberately no
  -- account_id argument in this function.
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  v_idempotency_key := pg_catalog.btrim(coalesce(p_idempotency_key, ''));
  if pg_catalog.char_length(v_idempotency_key) not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key must contain 1 to 200 characters';
  end if;

  v_field_name := pg_catalog.btrim(coalesce(p_field_name, ''));
  if pg_catalog.char_length(v_field_name) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'p_field_name must contain 1 to 100 characters';
  end if;

  if p_year is null or p_year not between 2000 and 2100 then
    raise exception using
      errcode = '22023',
      message = 'p_year must be between 2000 and 2100';
  end if;

  v_parcel_source := case
    when p_parcel_source is null then null
    else pg_catalog.upper(pg_catalog.btrim(p_parcel_source))
  end;
  if v_parcel_source is not null
     and v_parcel_source not in ('MAFF_PARCEL', 'MANUAL') then
    raise exception using
      errcode = '22023',
      message = 'p_parcel_source must be MAFF_PARCEL or MANUAL';
  end if;

  -- jsonb output is canonical, so equivalent object key ordering produces the
  -- same fingerprint.  Geometry parsing is intentionally after this check so
  -- a completed request can be replayed without redoing validation.
  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'idempotency_key', v_idempotency_key,
          'field_name', v_field_name,
          'geom_geojson', p_geom_geojson,
          'year', p_year,
          'variety_id', p_variety_id,
          'heading_date', p_heading_date,
          'parcel_source', v_parcel_source,
          'parcel_external_id', p_parcel_external_id,
          'parcel_dataset_version', p_parcel_dataset_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- The current account is deterministic for the normal one-account-per-user
  -- MVP: prefer an account the user owns, then the earliest membership.  The
  -- caller cannot select this value.
  select account_members.account_id
    into v_account_id
  from public.account_members
  join public.accounts
    on accounts.id = account_members.account_id
  where account_members.user_id = v_user_id
  order by
    case when account_members.role = 'OWNER' then 0 else 1 end,
    accounts.created_at,
    accounts.id
  limit 1;

  if v_account_id is null then
    raise exception using
      errcode = '42501',
      message = 'an account membership is required';
  end if;

  -- Insert-or-lock serializes concurrent requests with the same key.  A
  -- failed registration rolls back this row, so clients may safely retry.
  insert into public.field_registration_requests (
    user_id,
    idempotency_key,
    request_hash
  )
  values (
    v_user_id,
    v_idempotency_key,
    v_request_hash
  )
  on conflict (user_id, idempotency_key) do nothing;

  select
    registration_requests.request_hash,
    registration_requests.field_id,
    registration_requests.crop_season_id,
    registration_requests.area_m2,
    registration_requests.completed_at
    into
      v_existing_hash,
      v_existing_field_id,
      v_existing_crop_season_id,
      v_existing_area_m2,
      v_existing_completed_at
  from public.field_registration_requests as registration_requests
  where registration_requests.user_id = v_user_id
    and registration_requests.idempotency_key = v_idempotency_key
  for update;

  if v_existing_hash <> v_request_hash then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key was already used for a different request';
  end if;

  if v_existing_completed_at is not null then
    return query
    select
      v_existing_field_id,
      v_existing_crop_season_id,
      v_existing_area_m2,
      true;
    return;
  end if;

  if p_geom_geojson is null
     or pg_catalog.jsonb_typeof(p_geom_geojson) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must be a GeoJSON geometry object';
  end if;

  begin
    v_geom := extensions.st_geomfromgeojson(p_geom_geojson::text);
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must be valid GeoJSON';
  end;

  if v_geom is null
     or extensions.st_isempty(v_geom) then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must contain a non-empty geometry';
  end if;

  v_geometry_type := extensions.st_geometrytype(v_geom);
  if v_geometry_type not in ('ST_Polygon', 'ST_MultiPolygon') then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must be a Polygon or MultiPolygon';
  end if;

  -- GeoJSON coordinates are WGS84 by contract.  PostGIS may report SRID 0
  -- when no CRS member is present; that is accepted and explicitly assigned
  -- 4326 before the geometry reaches the typed column.
  if extensions.st_srid(v_geom) not in (0, 4326) then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must use SRID 4326';
  end if;
  v_geom := extensions.st_setsrid(
    extensions.st_multi(extensions.st_force2d(v_geom)),
    4326
  );

  if not extensions.st_isvalid(v_geom) then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson contains an invalid polygon';
  end if;

  -- Never accept an area supplied by the client.  Geography area is returned
  -- in square metres and is rounded only to the storage precision.
  v_area_m2 := extensions.st_area(v_geom::extensions.geography);
  if v_area_m2 is null or v_area_m2 <= 0 or v_area_m2 <> v_area_m2 then
    raise exception using
      errcode = '22023',
      message = 'p_geom_geojson must have positive area';
  end if;

  if p_variety_id is not null
     and not exists (
       select 1
       from public.rice_varieties
       where id = p_variety_id
         and is_active
     ) then
    raise exception using
      errcode = '22023',
      message = 'p_variety_id must refer to an active rice variety';
  end if;

  insert into public.fields (
    account_id,
    name,
    geom,
    area_m2,
    parcel_source,
    parcel_external_id,
    parcel_dataset_version
  )
  values (
    v_account_id,
    v_field_name,
    v_geom,
    v_area_m2,
    v_parcel_source,
    p_parcel_external_id,
    p_parcel_dataset_version
  )
  returning id into v_field_id;

  insert into public.crop_seasons (
    field_id,
    year,
    variety_id,
    heading_date
  )
  values (
    v_field_id,
    p_year,
    p_variety_id,
    p_heading_date
  )
  returning id into v_crop_season_id;

  update public.field_registration_requests
  set field_id = v_field_id,
      crop_season_id = v_crop_season_id,
      area_m2 = v_area_m2,
      completed_at = pg_catalog.now()
  where user_id = v_user_id
    and idempotency_key = v_idempotency_key;

  return query
  select
    v_field_id,
    v_crop_season_id,
    v_area_m2::numeric(14, 2),
    false;
end;
$$;

revoke all on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) to authenticated;
grant execute on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) to service_role;

-- These read RPCs expose only fields the map/detail clients need and never
-- expose account_id.  SECURITY INVOKER keeps the original RLS policies in
-- force; the explicit membership predicate makes the ownership boundary
-- visible in the query as well.
create or replace function public.get_field_map(
  p_year smallint,
  p_min_lng double precision default -180,
  p_min_lat double precision default -90,
  p_max_lng double precision default 180,
  p_max_lat double precision default 90
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
language sql
stable
security invoker
set search_path = ''
as $$
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
    and p_min_lng <= p_max_lng
    and p_min_lat <= p_max_lat
    and p_min_lng between -180 and 180
    and p_max_lng between -180 and 180
    and p_min_lat between -90 and 90
    and p_max_lat between -90 and 90
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
  order by fields.name, fields.id;
$$;

revoke all on function public.get_field_map(
  smallint, double precision, double precision, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.get_field_map(
  smallint, double precision, double precision, double precision, double precision
) to authenticated;
grant execute on function public.get_field_map(
  smallint, double precision, double precision, double precision, double precision
) to service_role;

create or replace function public.get_field_detail(
  p_field_id uuid,
  p_year smallint default null
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
as $$
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

revoke all on function public.get_field_detail(uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.get_field_detail(uuid, smallint)
  to authenticated;
grant execute on function public.get_field_detail(uuid, smallint)
  to service_role;

-- Existing authenticated table grants are rebuilt as an explicit allow-list.
-- This also removes PostgreSQL 17's MAINTAIN/TRUNCATE/REFERENCES/TRIGGER bits
-- that can otherwise remain after revoking only INSERT/UPDATE/DELETE.  All
-- registration-side writes (including snapshots and weather bindings, which
-- must not be client-forged) belong behind trusted server jobs/RPCs.  RLS
-- policies remain enabled and unchanged.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.accounts to authenticated;
grant select on public.account_members to authenticated;
grant select on public.rice_varieties to authenticated;
grant select on public.rule_regions to authenticated;
grant select on public.variety_rules to authenticated;
grant select on public.weather_locations to authenticated;
grant select on public.daily_weather to authenticated;
grant select on public.fields to authenticated;
grant select on public.crop_seasons to authenticated;
grant select on public.season_rule_snapshots to authenticated;
grant select on public.season_weather_bindings to authenticated;
grant select on public.crop_season_summaries to authenticated;

-- No authenticated table has a direct write grant.  Account display-name
-- editing, when added, should use a similarly scoped owner RPC.
revoke all on all sequences in schema public from anon, authenticated;

-- PUBLIC retains no schema-level route to the application tables.  The API
-- roles that are intentionally supported receive explicit schema usage.
revoke usage on schema public from public;
revoke usage on schema public from anon;
grant usage on schema public to authenticated, service_role;

-- Internal trigger helpers must not be callable through the Data API.  The
-- auth trigger owner and the trusted service role retain only the privileges
-- needed for trigger execution; RLS helper functions remain executable by
-- authenticated because the existing policies call them.
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin, service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;
