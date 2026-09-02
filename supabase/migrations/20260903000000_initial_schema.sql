create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.account_role as enum ('OWNER', 'MEMBER');
create type public.region_kind as enum (
  'COUNTRY',
  'PREFECTURE',
  'MUNICIPALITY',
  'CUSTOM'
);
create type public.rule_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');
create type public.temperature_metric as enum ('MEAN');
create type public.weather_provider as enum ('JMA_AMEDAS', 'WAGRI_GRID');
create type public.season_lifecycle_status as enum (
  'ACTIVE',
  'HARVESTED',
  'ARCHIVED'
);
create type public.maturity_status as enum (
  'NOT_CONFIGURED',
  'BEFORE_HEADING',
  'GROWING',
  'GROWING_LATE',
  'HARVEST_SOON',
  'HARVEST_READY',
  'OVERDUE',
  'HARVESTED'
);
create type public.data_status as enum (
  'PENDING',
  'COMPLETE',
  'INCOMPLETE',
  'STALE',
  'ERROR'
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.account_role not null default 'MEMBER',
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table public.rice_varieties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 100),
  name_kana text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rule_regions (
  id uuid primary key default gen_random_uuid(),
  kind public.region_kind not null,
  code text,
  name text not null,
  geom extensions.geometry(MultiPolygon, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, code)
);

create table public.variety_rules (
  id uuid primary key default gen_random_uuid(),
  variety_id uuid not null references public.rice_varieties(id) on delete restrict,
  region_id uuid not null references public.rule_regions(id) on delete restrict,
  harvest_start_temp_c numeric(8, 2) not null,
  harvest_target_temp_c numeric(8, 2) not null,
  harvest_end_temp_c numeric(8, 2) not null,
  danger_temp_c numeric(8, 2),
  accumulation_start_offset_days smallint not null default 1,
  daily_temperature_metric public.temperature_metric not null default 'MEAN',
  effective_from date not null,
  effective_to date,
  priority integer not null default 0,
  version integer not null default 1,
  source_title text not null,
  source_publisher text not null,
  source_url text,
  published_on date,
  status public.rule_status not null default 'DRAFT',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variety_rules_temperature_order check (
    harvest_start_temp_c <= harvest_target_temp_c
    and harvest_target_temp_c <= harvest_end_temp_c
    and (danger_temp_c is null or danger_temp_c >= harvest_end_temp_c)
  ),
  constraint variety_rules_effective_period check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint variety_rules_start_offset check (
    accumulation_start_offset_days between 0 and 7
  ),
  unique (variety_id, region_id, version)
);

create table public.weather_locations (
  id uuid primary key default gen_random_uuid(),
  provider public.weather_provider not null,
  external_id text not null,
  name text not null,
  location extensions.geometry(Point, 4326) not null,
  elevation_m numeric(8, 2),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

create table public.maff_parcels (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  dataset_year smallint not null,
  prefecture_code text not null,
  municipality_code text,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  source_metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  constraint maff_parcels_valid_geom check (extensions.st_isvalid(geom)),
  unique (dataset_year, prefecture_code, external_id)
);

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  area_m2 numeric(14, 2) not null check (area_m2 > 0),
  parcel_source text check (parcel_source in ('MAFF_PARCEL', 'MANUAL')),
  parcel_external_id text,
  parcel_dataset_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint fields_valid_geom check (extensions.st_isvalid(geom))
);

create table public.crop_seasons (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  year smallint not null check (year between 2000 and 2100),
  variety_id uuid references public.rice_varieties(id) on delete restrict,
  heading_date date,
  harvest_date date,
  harvest_accumulated_temp_c numeric(8, 2),
  lifecycle_status public.season_lifecycle_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_seasons_harvest_after_heading check (
    harvest_date is null or heading_date is null or harvest_date >= heading_date
  ),
  unique (field_id, year)
);

create table public.season_rule_snapshots (
  crop_season_id uuid primary key references public.crop_seasons(id) on delete cascade,
  source_rule_id uuid references public.variety_rules(id) on delete set null,
  rule_version integer,
  harvest_start_temp_c numeric(8, 2) not null,
  harvest_target_temp_c numeric(8, 2) not null,
  harvest_end_temp_c numeric(8, 2) not null,
  danger_temp_c numeric(8, 2),
  accumulation_start_offset_days smallint not null,
  daily_temperature_metric public.temperature_metric not null default 'MEAN',
  source_title text not null,
  source_publisher text,
  source_url text,
  is_custom boolean not null default false,
  applied_at timestamptz not null default now(),
  constraint season_rule_snapshots_temperature_order check (
    harvest_start_temp_c <= harvest_target_temp_c
    and harvest_target_temp_c <= harvest_end_temp_c
    and (danger_temp_c is null or danger_temp_c >= harvest_end_temp_c)
  )
);

create table public.season_weather_bindings (
  id uuid primary key default gen_random_uuid(),
  crop_season_id uuid not null references public.crop_seasons(id) on delete cascade,
  weather_location_id uuid not null references public.weather_locations(id) on delete restrict,
  distance_m numeric(12, 2) check (distance_m is null or distance_m >= 0),
  is_active boolean not null default true,
  selected_by_user boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.weather_import_runs (
  id uuid primary key default gen_random_uuid(),
  provider public.weather_provider not null,
  weather_location_id uuid references public.weather_locations(id) on delete set null,
  date_from date not null,
  date_to date not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  succeeded boolean,
  records_received integer not null default 0,
  error_code text,
  error_message text,
  source_revision text,
  constraint weather_import_runs_date_order check (date_to >= date_from)
);

create table public.daily_weather (
  id uuid primary key default gen_random_uuid(),
  weather_location_id uuid not null references public.weather_locations(id) on delete cascade,
  observed_date date not null,
  mean_temp_c numeric(5, 2),
  max_temp_c numeric(5, 2),
  min_temp_c numeric(5, 2),
  quality_code text,
  provider_revision text,
  raw_import_id uuid references public.weather_import_runs(id) on delete set null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_weather_temperature_order check (
    min_temp_c is null or max_temp_c is null or min_temp_c <= max_temp_c
  ),
  unique (weather_location_id, observed_date)
);

create table public.crop_season_summaries (
  crop_season_id uuid primary key references public.crop_seasons(id) on delete cascade,
  accumulated_temp_c numeric(8, 2) not null default 0,
  accumulated_through date,
  valid_day_count integer not null default 0 check (valid_day_count >= 0),
  missing_day_count integer not null default 0 check (missing_day_count >= 0),
  maturity_status public.maturity_status not null default 'NOT_CONFIGURED',
  data_status public.data_status not null default 'PENDING',
  estimated_days_to_start integer check (
    estimated_days_to_start is null or estimated_days_to_start >= 0
  ),
  calculated_at timestamptz not null default now(),
  error_message text
);

create index account_members_user_id_idx
  on public.account_members (user_id);
create index rule_regions_geom_idx
  on public.rule_regions using gist (geom);
create index variety_rules_resolution_idx
  on public.variety_rules (
    variety_id,
    status,
    effective_from,
    effective_to,
    priority desc
  );
create index weather_locations_location_idx
  on public.weather_locations using gist (location);
create index maff_parcels_geom_idx
  on public.maff_parcels using gist (geom);
create index maff_parcels_region_idx
  on public.maff_parcels (dataset_year, prefecture_code, municipality_code);
create index fields_geom_idx
  on public.fields using gist (geom);
create index fields_account_active_idx
  on public.fields (account_id, archived_at);
create index crop_seasons_field_year_idx
  on public.crop_seasons (field_id, year desc);
create unique index season_weather_bindings_one_active_idx
  on public.season_weather_bindings (crop_season_id)
  where is_active;
create index daily_weather_location_date_idx
  on public.daily_weather (weather_location_id, observed_date);
create index weather_import_runs_location_started_idx
  on public.weather_import_runs (weather_location_id, started_at desc);
create index crop_season_summaries_status_idx
  on public.crop_season_summaries (maturity_status, calculated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();
create trigger rice_varieties_set_updated_at
before update on public.rice_varieties
for each row execute function public.set_updated_at();
create trigger rule_regions_set_updated_at
before update on public.rule_regions
for each row execute function public.set_updated_at();
create trigger variety_rules_set_updated_at
before update on public.variety_rules
for each row execute function public.set_updated_at();
create trigger weather_locations_set_updated_at
before update on public.weather_locations
for each row execute function public.set_updated_at();
create trigger fields_set_updated_at
before update on public.fields
for each row execute function public.set_updated_at();
create trigger crop_seasons_set_updated_at
before update on public.crop_seasons
for each row execute function public.set_updated_at();
create trigger daily_weather_set_updated_at
before update on public.daily_weather
for each row execute function public.set_updated_at();

create or replace function public.is_account_member(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_members
    where account_id = target_account_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_access_field(target_field_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fields
    join public.account_members
      on account_members.account_id = fields.account_id
    where fields.id = target_field_id
      and account_members.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_access_season(target_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.crop_seasons
    where crop_seasons.id = target_season_id
      and public.can_access_field(crop_seasons.field_id)
  );
$$;

revoke all on function public.is_account_member(uuid) from public;
revoke all on function public.can_access_field(uuid) from public;
revoke all on function public.can_access_season(uuid) from public;
grant execute on function public.is_account_member(uuid) to authenticated;
grant execute on function public.can_access_field(uuid) to authenticated;
grant execute on function public.can_access_season(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_account_id uuid;
  account_name text;
begin
  account_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(new.email, '利用者'), '@', 1)
  );

  insert into public.accounts (name, created_by)
  values (account_name, new.id)
  returning id into new_account_id;

  insert into public.account_members (account_id, user_id, role)
  values (new_account_id, new.id, 'OWNER');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.rice_varieties enable row level security;
alter table public.rule_regions enable row level security;
alter table public.variety_rules enable row level security;
alter table public.weather_locations enable row level security;
alter table public.maff_parcels enable row level security;
alter table public.fields enable row level security;
alter table public.crop_seasons enable row level security;
alter table public.season_rule_snapshots enable row level security;
alter table public.season_weather_bindings enable row level security;
alter table public.weather_import_runs enable row level security;
alter table public.daily_weather enable row level security;
alter table public.crop_season_summaries enable row level security;

create policy accounts_select_member
on public.accounts for select
to authenticated
using (public.is_account_member(id));

create policy accounts_update_owner
on public.accounts for update
to authenticated
using (
  exists (
    select 1
    from public.account_members
    where account_members.account_id = accounts.id
      and account_members.user_id = (select auth.uid())
      and account_members.role = 'OWNER'
  )
)
with check (
  exists (
    select 1
    from public.account_members
    where account_members.account_id = accounts.id
      and account_members.user_id = (select auth.uid())
      and account_members.role = 'OWNER'
  )
);

create policy account_members_select_self
on public.account_members for select
to authenticated
using (user_id = (select auth.uid()));

create policy rice_varieties_select_authenticated
on public.rice_varieties for select
to authenticated
using (is_active);

create policy rule_regions_select_authenticated
on public.rule_regions for select
to authenticated
using (true);

create policy variety_rules_select_active
on public.variety_rules for select
to authenticated
using (status = 'ACTIVE');

create policy weather_locations_select_active
on public.weather_locations for select
to authenticated
using (is_active);

create policy fields_select_member
on public.fields for select
to authenticated
using (public.is_account_member(account_id));
create policy fields_insert_member
on public.fields for insert
to authenticated
with check (public.is_account_member(account_id));
create policy fields_update_member
on public.fields for update
to authenticated
using (public.is_account_member(account_id))
with check (public.is_account_member(account_id));
create policy fields_delete_member
on public.fields for delete
to authenticated
using (public.is_account_member(account_id));

create policy crop_seasons_select_member
on public.crop_seasons for select
to authenticated
using (public.can_access_field(field_id));
create policy crop_seasons_insert_member
on public.crop_seasons for insert
to authenticated
with check (public.can_access_field(field_id));
create policy crop_seasons_update_member
on public.crop_seasons for update
to authenticated
using (public.can_access_field(field_id))
with check (public.can_access_field(field_id));
create policy crop_seasons_delete_member
on public.crop_seasons for delete
to authenticated
using (public.can_access_field(field_id));

create policy season_rule_snapshots_select_member
on public.season_rule_snapshots for select
to authenticated
using (public.can_access_season(crop_season_id));
create policy season_rule_snapshots_insert_member
on public.season_rule_snapshots for insert
to authenticated
with check (public.can_access_season(crop_season_id));
create policy season_rule_snapshots_update_member
on public.season_rule_snapshots for update
to authenticated
using (public.can_access_season(crop_season_id))
with check (public.can_access_season(crop_season_id));

create policy season_weather_bindings_select_member
on public.season_weather_bindings for select
to authenticated
using (public.can_access_season(crop_season_id));
create policy season_weather_bindings_insert_member
on public.season_weather_bindings for insert
to authenticated
with check (public.can_access_season(crop_season_id));
create policy season_weather_bindings_update_member
on public.season_weather_bindings for update
to authenticated
using (public.can_access_season(crop_season_id))
with check (public.can_access_season(crop_season_id));

create policy daily_weather_select_authenticated
on public.daily_weather for select
to authenticated
using (true);

create policy crop_season_summaries_select_member
on public.crop_season_summaries for select
to authenticated
using (public.can_access_season(crop_season_id));

grant usage on schema public to authenticated, service_role;
grant select on public.rice_varieties to authenticated;
grant select on public.rule_regions to authenticated;
grant select on public.variety_rules to authenticated;
grant select on public.weather_locations to authenticated;
grant select on public.daily_weather to authenticated;
grant select, update on public.accounts to authenticated;
grant select on public.account_members to authenticated;
grant select, insert, update, delete on public.fields to authenticated;
grant select, insert, update, delete on public.crop_seasons to authenticated;
grant select, insert, update on public.season_rule_snapshots to authenticated;
grant select, insert, update on public.season_weather_bindings to authenticated;
grant select on public.crop_season_summaries to authenticated;

revoke all on public.maff_parcels from anon, authenticated;
revoke all on public.weather_import_runs from anon, authenticated;
revoke all on all tables in schema public from anon;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
