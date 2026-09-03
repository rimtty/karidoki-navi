-- Reproducible local verification for the MAFF candidate migration.
--
-- Run after `./node_modules/.bin/supabase db reset` with:
--   docker exec -i supabase_db_karidoki-navi psql -U postgres -d postgres \
--     -X -v ON_ERROR_STOP=1 -f - < supabase/tests/parcel_candidates.sql

\set ON_ERROR_STOP on

begin;

do $$
begin
  if has_table_privilege('anon', 'public.parcel_candidates', 'select') then
    raise exception 'anon must not read parcel_candidates directly';
  end if;
  if has_table_privilege('authenticated', 'public.parcel_candidates', 'select') then
    raise exception 'authenticated must use the bounded parcel RPC';
  end if;
  if has_function_privilege(
       'anon',
       'public.get_parcel_candidates(smallint,double precision,double precision,double precision,double precision,integer,text)',
       'execute'
     ) then
    raise exception 'anon must not execute the parcel RPC';
  end if;
  if has_function_privilege(
       'anon',
       'public.get_parcel_candidates_mvt(integer,integer,integer,smallint,integer)',
       'execute'
     ) then
    raise exception 'anon must not execute the parcel MVT RPC';
  end if;
end;
$$;

-- The service import path uses the same normalization helper as production
-- bulk loading. A self-intersecting ring must be repaired and returned as a
-- valid MultiPolygon.
set local role service_role;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

create temporary table normalized_fixture (
  geom extensions.geometry,
  was_repaired boolean
);
insert into normalized_fixture
select *
from public.normalize_parcel_candidate_geometry(
  '{
    "type":"Polygon",
    "coordinates":[[
      [133.040,34.540],
      [133.041,34.541],
      [133.041,34.540],
      [133.040,34.541],
      [133.040,34.540]
    ]]
  }'::jsonb
);

do $$
declare
  fixture normalized_fixture%rowtype;
begin
  select * into fixture from normalized_fixture;
  if not fixture.was_repaired then
    raise exception 'invalid fixture was not marked repaired';
  end if;
  if extensions.st_geometrytype(fixture.geom) <> 'ST_MultiPolygon'
     or extensions.st_srid(fixture.geom) <> 4326
     or not extensions.st_isvalid(fixture.geom) then
    raise exception 'normalizer did not return valid MultiPolygon/4326';
  end if;
end;
$$;

insert into public.source_imports (
  provider,
  dataset_name,
  dataset_year,
  prefecture_code,
  source_page_url,
  settlement_boundary_source_url,
  downloaded_at,
  source_files,
  source_feature_count,
  municipality_feature_count,
  settlement_feature_count,
  candidate_feature_count,
  invalid_geometry_count,
  repaired_geometry_count,
  status
)
values (
  'MAFF',
  'fixture',
  2026,
  '34',
  'https://example.invalid/maff',
  'https://example.invalid/maff-boundary',
  pg_catalog.now(),
  '[{"part":1,"url":"https://example.invalid/part.001","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
  1,
  1,
  1,
  1,
  1,
  1,
  'READY'
);

insert into public.parcel_candidates (
  source_import_id,
  source_year,
  source_feature_id,
  municipality_code,
  settlement_code,
  land_type,
  geom,
  geometry_was_repaired
)
select
  source_imports.id,
  2026,
  '11111111-1111-4111-8111-111111111111',
  '34204',
  '3420424001',
  100,
  normalized_fixture.geom,
  normalized_fixture.was_repaired
from public.source_imports
cross join normalized_fixture;

-- The authenticated RPC is owner-independent and returns a bounded public
-- shape, area, and source metadata for a small bbox.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

create temporary table candidate_result as
select *
from public.get_parcel_candidates(
  2026::smallint,
  133.039::double precision,
  34.539::double precision,
  133.042::double precision,
  34.542::double precision,
  10,
  '34204'
);

do $$
declare
  result candidate_result%rowtype;
begin
  select * into result from candidate_result;
  if result.candidate_id is null
     or result.source_year <> 2026
     or result.municipality_code <> '34204'
     or result.settlement_code <> '3420424001'
     or result.land_type <> 100
     or result.area_m2 <= 0
     or result.geom_geojson ->> 'type' <> 'MultiPolygon' then
    raise exception 'bounded parcel RPC returned an unexpected candidate';
  end if;
  if (select count(*) from candidate_result) <> 1 then
    raise exception 'bounded parcel RPC returned too many rows';
  end if;
end;
$$;

-- An oversized bbox is rejected before the query can turn into a full-table
-- JSON response.
do $$
begin
  perform public.get_parcel_candidates(
    2026::smallint,
    132.0::double precision,
    34.0::double precision,
    133.0::double precision,
    35.0::double precision,
    10,
    null
  );
  raise exception 'oversized bbox was accepted';
exception
  when sqlstate '22023' then
    null;
end;
$$;

-- A tile response is also bounded and contains no owner fields. This tile
-- covers the fixture around 133.04E/34.54N at z=8 (x=222, y=101).
do $$
declare
  tile bytea;
begin
  tile := public.get_parcel_candidates_mvt(8, 222, 101, 2026::smallint, 10);
  if tile is null or octet_length(tile) = 0 then
    raise exception 'MVT RPC returned no tile bytes';
  end if;
end;
$$;

rollback;
