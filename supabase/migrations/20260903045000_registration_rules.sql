-- Connect account-defined variety rules to field registration.
--
-- The public variety_rules catalog remains authoritative only when it has an
-- applicable ACTIVE row.  An account rule is a private local decision and is
-- snapshotted separately with its source note, so deleting or editing it can
-- never rewrite an existing crop season's evidence.

alter table public.season_rule_snapshots
  add column if not exists source_note text;

do $$
begin
  alter table public.account_variety_rules
    add constraint account_variety_rules_positive_temperature_check
    check (
      harvest_start_temp_c > 0
      and harvest_end_temp_c <= 10000
    );
exception
  when duplicate_object then null;
end;
$$;

-- Resolve a field registration's rules against the pilot hierarchy.  The
-- initial pilot has no authoritative boundary polygons, so the explicit
-- administrative rows are included for the Mihara/Kui route.  If a trusted
-- adapter later supplies region geometry, intersecting rows are added too;
-- altitude bands remain excluded unless such a trusted match exists.
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
  v_region_ids uuid[] := '{}'::uuid[];
  v_rule_date date := (pg_catalog.now() at time zone 'Asia/Tokyo')::date;
  v_has_rule boolean := false;
  v_custom_rule public.account_variety_rules%rowtype;
  v_official_rule public.variety_rules%rowtype;
  v_weather_location_id uuid;
  v_weather_distance_m numeric(12, 2);
begin
  -- auth.uid() is the only identity source. There is deliberately no
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
  -- same fingerprint. Geometry parsing is intentionally after this check so
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

  -- Prefer an account the user owns, then the earliest membership. The caller
  -- cannot select the account, preserving the original registration contract.
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

  -- Insert-or-lock serializes concurrent requests with the same key. A failed
  -- registration rolls back this row, so clients may safely retry.
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

  -- GeoJSON coordinates are WGS84 by contract. PostGIS may report SRID 0
  -- when no CRS member is present; assign 4326 before the typed column.
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

  -- Never accept an area supplied by the client. Geography area is returned
  -- in square metres and rounded only to the storage precision.
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

  if p_variety_id is not null then
    select coalesce(
      pg_catalog.array_agg(regions.id order by regions.specificity desc, regions.id),
      '{}'::uuid[]
    )
      into v_region_ids
    from public.rule_regions as regions
    where regions.code in ('34204-kui', '34204', '34', 'JP')
       or (
         regions.geom is not null
         and extensions.st_intersects(
           regions.geom,
           extensions.st_pointonsurface(v_geom)
         )
       );

    -- Region-specific account rules outrank the account default.  A region
    -- match is accepted only from the explicit pilot hierarchy or a trusted
    -- region geometry intersection.
    select custom_rules.*
      into v_custom_rule
    from public.account_variety_rules as custom_rules
    left join public.rule_regions as regions
      on regions.id = custom_rules.region_id
    where custom_rules.account_id = v_account_id
      and custom_rules.variety_id = p_variety_id
      and (
        custom_rules.region_id is null
        or custom_rules.region_id = any (v_region_ids)
      )
      and custom_rules.effective_from <= v_rule_date
      and (
        custom_rules.effective_to is null
        or custom_rules.effective_to >= v_rule_date
      )
    order by
      coalesce(regions.specificity, 0) desc,
      custom_rules.effective_from desc,
      custom_rules.updated_at desc,
      custom_rules.id
    limit 1;

    if found then
      v_has_rule := true;

      insert into public.season_rule_snapshots (
        crop_season_id,
        source_rule_id,
        rule_version,
        harvest_start_temp_c,
        harvest_target_temp_c,
        harvest_end_temp_c,
        danger_temp_c,
        accumulation_start_offset_days,
        daily_temperature_metric,
        source_title,
        source_publisher,
        source_url,
        source_note,
        is_custom
      ) values (
        v_crop_season_id,
        null,
        null,
        v_custom_rule.harvest_start_temp_c,
        v_custom_rule.harvest_target_temp_c,
        v_custom_rule.harvest_end_temp_c,
        null,
        v_custom_rule.accumulation_start_offset_days,
        'MEAN'::public.temperature_metric,
        '利用者設定ルール',
        'アカウント設定',
        null,
        v_custom_rule.source_note,
        true
      );
    else
      -- Public rules are resolved only from known hierarchy matches.  No
      -- default value is invented when the public catalog has no row.
      select official_rules.*
        into v_official_rule
      from public.variety_rules as official_rules
      left join public.rule_regions as regions
        on regions.id = official_rules.region_id
      where official_rules.variety_id = p_variety_id
        and official_rules.status = 'ACTIVE'::public.rule_status
        and official_rules.region_id = any (v_region_ids)
        and official_rules.effective_from <= v_rule_date
        and (
          official_rules.effective_to is null
          or official_rules.effective_to >= v_rule_date
        )
      order by
        coalesce(regions.specificity, 0) desc,
        official_rules.priority desc,
        official_rules.effective_from desc,
        official_rules.version desc,
        official_rules.id
      limit 1;

      if found then
        v_has_rule := true;

        insert into public.season_rule_snapshots (
          crop_season_id,
          source_rule_id,
          rule_version,
          harvest_start_temp_c,
          harvest_target_temp_c,
          harvest_end_temp_c,
          danger_temp_c,
          accumulation_start_offset_days,
          daily_temperature_metric,
          source_title,
          source_publisher,
          source_url,
          source_note,
          is_custom
        ) values (
          v_crop_season_id,
          v_official_rule.id,
          v_official_rule.version,
          v_official_rule.harvest_start_temp_c,
          v_official_rule.harvest_target_temp_c,
          v_official_rule.harvest_end_temp_c,
          v_official_rule.danger_temp_c,
          v_official_rule.accumulation_start_offset_days,
          v_official_rule.daily_temperature_metric,
          v_official_rule.source_title,
          v_official_rule.source_publisher,
          v_official_rule.source_url,
          null,
          false
        );
      end if;
    end if;
  end if;

  -- Bind the nearest active JMA station when available.  The point is
  -- server-derived from the already validated field geometry.
  select
    locations.id,
    extensions.st_distance(
      locations.location::extensions.geography,
      v_geom::extensions.geography
    )::numeric(12, 2)
    into v_weather_location_id, v_weather_distance_m
  from public.weather_locations as locations
  where locations.is_active
    and locations.provider = 'JMA_AMEDAS'::public.weather_provider
  order by
    extensions.st_distance(
      locations.location::extensions.geography,
      v_geom::extensions.geography
    ),
    locations.external_id
  limit 1;

  if v_weather_location_id is not null then
    insert into public.season_weather_bindings (
      crop_season_id,
      weather_location_id,
      distance_m,
      is_active,
      selected_by_user
    ) values (
      v_crop_season_id,
      v_weather_location_id,
      v_weather_distance_m,
      true,
      false
    );
  end if;

  -- A missing rule is an explicit NOT_CONFIGURED state, not a guessed
  -- maturity result.  Existing seasons/snapshots are never touched here.
  if not v_has_rule then
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
      v_crop_season_id,
      0,
      null,
      0,
      0,
      'NOT_CONFIGURED'::public.maturity_status,
      'PENDING'::public.data_status,
      null,
      pg_catalog.now(),
      null
    );
  end if;

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

-- Preserve the original RPC's owner-safe surface and idempotency contract.
revoke all on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) to authenticated;
grant execute on function public.register_field_with_season(
  text, text, jsonb, smallint, uuid, date, text, text, text
) to service_role;
