-- Reproducible local verification for the registration migration.
--
-- Run after `./node_modules/.bin/supabase db reset` with:
--   docker exec -i supabase_db_karidoki-navi psql -U postgres -d postgres \
--     -X -v ON_ERROR_STOP=1 -f - < supabase/tests/registration_security.sql
--
-- The whole test is rolled back, including the temporary auth users and the
-- fields/seasons created through the RPC.

\set ON_ERROR_STOP on

begin;

-- Verify the allow-list grants before switching into an authenticated request.
do $$
begin
  if has_schema_privilege('anon', 'public', 'usage') then
    raise exception 'anon must not have public schema usage';
  end if;

  if has_table_privilege('anon', 'public.fields', 'select') then
    raise exception 'anon must not read fields';
  end if;

  if has_table_privilege('authenticated', 'public.fields', 'insert')
     or has_table_privilege('authenticated', 'public.fields', 'update')
     or has_table_privilege('authenticated', 'public.fields', 'delete')
     or has_table_privilege('authenticated', 'public.fields', 'truncate') then
    raise exception 'authenticated must not write or truncate fields directly';
  end if;

  if has_table_privilege('authenticated', 'public.crop_seasons', 'insert')
     or has_table_privilege('authenticated', 'public.crop_seasons', 'update')
     or has_table_privilege('authenticated', 'public.crop_seasons', 'delete') then
    raise exception 'authenticated must not write crop_seasons directly';
  end if;

  if has_table_privilege('authenticated', 'public.accounts', 'update') then
    raise exception 'authenticated must not update accounts directly';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.field_registration_requests',
       'select'
     ) then
    raise exception 'authenticated must not read idempotency storage';
  end if;

  if has_function_privilege(
       'anon',
       'public.register_field_with_season(text,text,jsonb,smallint,uuid,date,text,text,text)',
       'execute'
     ) then
    raise exception 'anon must not execute registration RPC';
  end if;
end;
$$;

-- The auth trigger creates one account and owner membership for each user.
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
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'registration-test-1@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Registration test 1"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'registration-test-2@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Registration test 2"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

create temporary table registration_input (
  geom_geojson jsonb not null
);
insert into registration_input (geom_geojson)
values (
  '{
    "type":"Polygon",
    "coordinates":[[
      [132.95,34.45],
      [132.951,34.45],
      [132.951,34.451],
      [132.95,34.451],
      [132.95,34.45]
    ]]
  }'::jsonb
);

create temporary table registration_result (
  field_id uuid,
  crop_season_id uuid,
  area_m2 numeric(14, 2),
  was_replayed boolean
);
insert into registration_result
select *
from public.register_field_with_season(
  'registration-test-key',
  'テスト圃場',
  (select geom_geojson from registration_input),
  2026::smallint,
  (select id from public.rice_varieties where name = 'コシヒカリ'),
  '2026-08-01'::date,
  'MANUAL',
  null,
  null
);

do $$
declare
  result registration_result%rowtype;
  expected_area numeric(14, 2);
  owner_account uuid;
  actual_account uuid;
  geometry_type text;
  geometry_srid integer;
begin
  select * into result from registration_result;
  if result.field_id is null or result.crop_season_id is null then
    raise exception 'registration did not return both identifiers';
  end if;
  if result.was_replayed then
    raise exception 'first registration unexpectedly reported replay';
  end if;
  if result.area_m2 <= 0 then
    raise exception 'server area must be positive';
  end if;

  select extensions.st_area(fields.geom::extensions.geography)::numeric(14, 2),
         extensions.st_geometrytype(fields.geom),
         extensions.st_srid(fields.geom)
    into expected_area, geometry_type, geometry_srid
  from public.fields
  where fields.id = result.field_id;
  if result.area_m2 <> expected_area then
    raise exception 'returned area does not match geography area';
  end if;
  if geometry_type <> 'ST_MultiPolygon' or geometry_srid <> 4326 then
    raise exception 'server did not normalize geometry to MultiPolygon/4326';
  end if;

  select account_id into owner_account
  from public.account_members
  where user_id = '11111111-1111-4111-8111-111111111111'
    and role = 'OWNER';
  select account_id into actual_account
  from public.fields
  where id = result.field_id;
  if actual_account <> owner_account then
    raise exception 'field account was not derived from auth.uid()';
  end if;
end;
$$;

-- The same user/request and payload is a replay, not a second field/season.
create temporary table replay_result (
  field_id uuid,
  crop_season_id uuid,
  area_m2 numeric(14, 2),
  was_replayed boolean
);
insert into replay_result
select *
from public.register_field_with_season(
  'registration-test-key',
  'テスト圃場',
  (select geom_geojson from registration_input),
  2026::smallint,
  (select id from public.rice_varieties where name = 'コシヒカリ'),
  '2026-08-01'::date,
  'MANUAL',
  null,
  null
);

do $$
declare
  first_result registration_result%rowtype;
  replayed_result replay_result%rowtype;
  field_count integer;
  season_count integer;
begin
  select * into first_result from registration_result;
  select * into replayed_result from replay_result;
  if not replayed_result.was_replayed
     or replayed_result.field_id <> first_result.field_id
     or replayed_result.crop_season_id <> first_result.crop_season_id then
    raise exception 'idempotent replay did not return the original result';
  end if;

  select count(*) into field_count from public.fields;
  select count(*) into season_count from public.crop_seasons;
  if field_count <> 1 or season_count <> 1 then
    raise exception 'idempotent replay created duplicate rows';
  end if;
end;
$$;

-- Reusing a key for another payload is rejected before any second insert.
do $$
begin
  perform public.register_field_with_season(
    'registration-test-key',
    '別の圃場',
    (select geom_geojson from registration_input),
    2026::smallint,
    (select id from public.rice_varieties where name = 'コシヒカリ'),
    '2026-08-01'::date,
    'MANUAL',
    null,
    null
  );
  raise exception 'idempotency hash mismatch was accepted';
exception
  when sqlstate '22023' then
    null;
end;
$$;

-- Invalid geometry is rejected and the failed request leaves no partial field.
do $$
begin
  perform public.register_field_with_season(
    'invalid-geometry-key',
    '不正形状',
    '{"type":"LineString","coordinates":[[132.95,34.45],[132.951,34.45]]}'::jsonb,
    2026::smallint,
    null,
    null,
    'MANUAL',
    null,
    null
  );
  raise exception 'invalid geometry was accepted';
exception
  when sqlstate '22023' then
    null;
end;
$$;

do $$
declare
  field_count integer;
  request_count integer;
begin
  select count(*) into field_count from public.fields;
  if field_count <> 1 then
    raise exception 'invalid geometry left a partial field';
  end if;

  -- The internal ledger is not readable through authenticated grants.
  begin
    perform 1 from public.field_registration_requests;
    raise exception 'idempotency table is directly readable';
  exception
    when insufficient_privilege then
      null;
  end;

  set local role postgres;
  select count(*) into request_count from public.field_registration_requests;
  if request_count <> 1 then
    raise exception 'failed geometry request was persisted';
  end if;
  set local role authenticated;
end;
$$;

-- Direct writes are denied even for a valid authenticated membership.
do $$
begin
  begin
    insert into public.fields (account_id, name, geom, area_m2)
    select account_id, '直接書込', geom, area_m2
    from public.fields
    limit 1;
    raise exception 'authenticated direct field insert was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

-- A second auth method/user identity cannot see the first user's private rows.
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);
do $$
declare
  field_count integer;
  map_count integer;
  detail_count integer;
  first_field_id uuid;
begin
  select id into first_field_id from public.fields limit 1;
  select count(*) into field_count from public.fields;
  select count(*) into map_count
  from public.get_field_map(2026::smallint, 132, 34, 133, 35);
  select count(*) into detail_count
  from public.get_field_detail(first_field_id, 2026::smallint);
  if field_count <> 0 or map_count <> 0 or detail_count <> 0 then
    raise exception 'cross-user field access was not denied';
  end if;
end;
$$;

rollback;

select 'registration_security: ok' as result;
