-- Public MAFF reference parcels for map selection.
--
-- The initial schema predates the 2026 import and contains maff_parcels for a
-- future compatibility path.  This migration adds an auditable source ledger
-- and a deliberately small candidate table.  Candidate rows contain only
-- public reference attributes (source id/year, geography codes, land type,
-- and geometry); no owner, account, farmer, or other personal attributes are
-- copied from the source files.

create table public.source_imports (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'MAFF'),
  dataset_name text not null check (char_length(dataset_name) between 1 and 200),
  dataset_year smallint not null check (dataset_year between 2000 and 2100),
  prefecture_code text not null check (prefecture_code ~ '^[0-9]{2}$'),
  source_page_url text not null,
  settlement_boundary_source_url text,
  downloaded_at timestamptz not null,
  source_files jsonb not null default '[]'::jsonb,
  source_manifest_sha256 text,
  source_feature_count bigint check (
    source_feature_count is null or source_feature_count >= 0
  ),
  municipality_feature_count bigint check (
    municipality_feature_count is null or municipality_feature_count >= 0
  ),
  settlement_feature_count bigint check (
    settlement_feature_count is null or settlement_feature_count >= 0
  ),
  candidate_feature_count bigint check (
    candidate_feature_count is null or candidate_feature_count >= 0
  ),
  invalid_geometry_count bigint not null default 0 check (invalid_geometry_count >= 0),
  repaired_geometry_count bigint not null default 0 check (
    repaired_geometry_count >= 0
    and repaired_geometry_count <= invalid_geometry_count
  ),
  status text not null default 'DOWNLOADED' check (
    status in ('DOWNLOADED', 'EXTRACTED', 'READY', 'FAILED')
  ),
  notes text,
  created_at timestamptz not null default now(),
  constraint source_imports_files_array_check check (
    jsonb_typeof(source_files) = 'array'
  ),
  constraint source_imports_manifest_sha256_check check (
    source_manifest_sha256 is null
    or source_manifest_sha256 ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.source_imports is
  'Auditable MAFF source downloads and filter/geometry counts; never contains owner data.';
comment on column public.source_imports.source_files is
  'JSON array of split URL, local filename, retrieval timestamp, bytes, and SHA-256.';

create table public.parcel_candidates (
  id uuid primary key default gen_random_uuid(),
  source_import_id uuid not null references public.source_imports(id) on delete restrict,
  source_year smallint not null check (source_year between 2000 and 2100),
  source_feature_id text not null check (char_length(source_feature_id) between 1 and 80),
  municipality_code text not null check (municipality_code ~ '^[0-9]{5}$'),
  -- This is the public 10-digit MAFF agricultural-settlement key.  For the
  -- pilot, 3420424* is the official 2025-boundary prefix for 久井村/久井町.
  settlement_code text not null check (settlement_code ~ '^[0-9]{10}$'),
  land_type smallint not null check (land_type in (100, 200)),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  geometry_was_repaired boolean not null default false,
  created_at timestamptz not null default now(),
  constraint parcel_candidates_valid_geom check (
    not extensions.st_isempty(geom)
    and extensions.st_isvalid(geom)
  ),
  unique (source_import_id, source_feature_id)
);

comment on table public.parcel_candidates is
  'Owner-independent MAFF parcel references used for authenticated bbox selection.';
comment on column public.parcel_candidates.settlement_code is
  'MAFF public agricultural-settlement key; not a farmer or ownership identifier.';

create index source_imports_dataset_idx
  on public.source_imports (provider, dataset_year, prefecture_code, downloaded_at desc);
create index parcel_candidates_geom_idx
  on public.parcel_candidates using gist (geom);
create index parcel_candidates_source_region_idx
  on public.parcel_candidates (
    source_year,
    municipality_code,
    settlement_code,
    source_feature_id
  );
create index parcel_candidates_source_import_idx
  on public.parcel_candidates (source_import_id);

-- Parse and structurally normalize GeoJSON before a candidate insert.  The
-- importer calls this function from a staging INSERT so all rows go through
-- ST_MakeValid, even when the source geometry appears valid.  The boolean is
-- deliberately based on the pre-repair validity result for audit counts.
create or replace function public.normalize_parcel_candidate_geometry(
  p_geom_geojson jsonb
)
returns table (
  geom extensions.geometry,
  was_repaired boolean
)
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_raw extensions.geometry;
  v_repaired extensions.geometry;
  v_was_repaired boolean;
begin
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
     or not extensions.st_isvalid(v_repaired) then
    raise exception using
      errcode = '22023',
      message = 'parcel geometry could not be normalized to a valid MultiPolygon';
  end if;

  return query select v_repaired, v_was_repaired;
end;
$$;

revoke all on function public.normalize_parcel_candidate_geometry(jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_parcel_candidate_geometry(jsonb)
  to service_role;

-- Authenticated users may use only the bounded RPC below.  Direct table
-- grants stay revoked so a client cannot accidentally request the full source
-- dataset through PostgREST.
alter table public.source_imports enable row level security;
alter table public.parcel_candidates enable row level security;

revoke all on table public.source_imports from public, anon, authenticated;
revoke all on table public.parcel_candidates from public, anon, authenticated;
grant all on table public.source_imports to service_role;
grant all on table public.parcel_candidates to service_role;

create policy parcel_candidates_select_authenticated
on public.parcel_candidates for select
to authenticated
using (true);

create or replace function public.get_parcel_candidates(
  p_source_year smallint default 2026,
  p_min_lng double precision default null,
  p_min_lat double precision default null,
  p_max_lng double precision default null,
  p_max_lat double precision default null,
  p_limit integer default 100,
  p_municipality_code text default null
)
returns table (
  candidate_id uuid,
  source_import_id uuid,
  source_year smallint,
  source_feature_id text,
  municipality_code text,
  settlement_code text,
  land_type smallint,
  area_m2 numeric(14, 2),
  geom_geojson jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bbox extensions.geometry;
  v_municipality_code text;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if p_source_year is null or p_source_year not between 2000 and 2100 then
    raise exception using
      errcode = '22023',
      message = 'p_source_year must be between 2000 and 2100';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 200';
  end if;
  if p_min_lng is null or p_min_lat is null or p_max_lng is null or p_max_lat is null then
    raise exception using
      errcode = '22023',
      message = 'all bbox coordinates are required';
  end if;
  if p_min_lng not between -180 and 180
     or p_max_lng not between -180 and 180
     or p_min_lat not between -90 and 90
     or p_max_lat not between -90 and 90
     or p_min_lng >= p_max_lng
     or p_min_lat >= p_max_lat
     or p_max_lng - p_min_lng > 0.5
     or p_max_lat - p_min_lat > 0.5
     or (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat) > 0.1 then
    raise exception using
      errcode = '22023',
      message = 'bbox is invalid or too large; use a map-sized bbox';
  end if;

  v_municipality_code := nullif(pg_catalog.btrim(p_municipality_code), '');
  if v_municipality_code is not null
     and v_municipality_code !~ '^[0-9]{5}$' then
    raise exception using
      errcode = '22023',
      message = 'p_municipality_code must be five digits';
  end if;

  v_bbox := extensions.st_makeenvelope(
    p_min_lng,
    p_min_lat,
    p_max_lng,
    p_max_lat,
    4326
  );

  return query
  select
    candidates.id,
    candidates.source_import_id,
    candidates.source_year,
    candidates.source_feature_id,
    candidates.municipality_code,
    candidates.settlement_code,
    candidates.land_type,
    extensions.st_area(candidates.geom::extensions.geography)::numeric(14, 2),
    extensions.st_asgeojson(candidates.geom, 6, 0)::jsonb
  from public.parcel_candidates as candidates
  where candidates.source_year = p_source_year
    and (v_municipality_code is null or candidates.municipality_code = v_municipality_code)
    and candidates.geom OPERATOR(extensions.&&) v_bbox
    and extensions.st_intersects(candidates.geom, v_bbox)
  order by candidates.source_feature_id
  limit p_limit;
end;
$$;

revoke all on function public.get_parcel_candidates(
  smallint,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  text
) from public, anon;
grant execute on function public.get_parcel_candidates(
  smallint,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  text
) to authenticated, service_role;

-- Optional vector-tile path for map rendering. It has the same authenticated
-- boundary and a separate hard cap; tile properties remain public geography
-- metadata only. GeoJSON selection above remains the registration path.
create or replace function public.get_parcel_candidates_mvt(
  p_z integer,
  p_x integer,
  p_y integer,
  p_source_year smallint default 2026,
  p_limit integer default 10000
)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tile_count bigint;
  v_bounds extensions.geometry;
  v_bounds_4326 extensions.geometry;
  v_tile bytea;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;
  if p_z is null or p_z not between 0 and 22 then
    raise exception using
      errcode = '22023',
      message = 'p_z must be between 0 and 22';
  end if;
  v_tile_count := 1::bigint << p_z;
  if p_x is null or p_y is null
     or p_x < 0 or p_y < 0
     or p_x >= v_tile_count or p_y >= v_tile_count then
    raise exception using
      errcode = '22023',
      message = 'tile coordinates are outside the requested zoom';
  end if;
  if p_source_year is null or p_source_year not between 2000 and 2100 then
    raise exception using
      errcode = '22023',
      message = 'p_source_year must be between 2000 and 2100';
  end if;
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 10000';
  end if;

  v_bounds := extensions.st_tileenvelope(p_z, p_x, p_y);
  v_bounds_4326 := extensions.st_transform(v_bounds, 4326);

  with tile as (
    select
      candidates.source_feature_id,
      candidates.source_year,
      candidates.municipality_code,
      candidates.settlement_code,
      candidates.land_type,
      extensions.st_asmvtgeom(
        extensions.st_transform(candidates.geom, 3857),
        v_bounds,
        4096,
        64,
        true
      ) as geom
    from public.parcel_candidates as candidates
    where candidates.source_year = p_source_year
      and candidates.geom OPERATOR(extensions.&&) v_bounds_4326
    order by candidates.source_feature_id
    limit p_limit
  )
  select coalesce(
    extensions.st_asmvt(tile, 'parcels', 4096, 'geom'),
    ''::bytea
  )
    into v_tile
  from tile;

  -- An empty tile produces no row from the aggregate query above. Normalize
  -- that case to an empty bytea so clients never receive SQL NULL.
  return coalesce(v_tile, ''::bytea);
end;
$$;

revoke all on function public.get_parcel_candidates_mvt(
  integer,
  integer,
  integer,
  smallint,
  integer
) from public, anon;
grant execute on function public.get_parcel_candidates_mvt(
  integer,
  integer,
  integer,
  smallint,
  integer
) to authenticated, service_role;
