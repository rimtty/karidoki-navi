-- A rule saved after field registration must repair only this account's
-- unconfigured seasons. Existing snapshots remain immutable.

\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'backfill-owner@example.com', 'not-used',
    pg_catalog.now(), '{}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'backfill-other@example.com', 'not-used',
    pg_catalog.now(), '{}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
  );

create temporary table backfill_refs (
  owner_account_id uuid,
  owner_season_id uuid,
  other_season_id uuid,
  variety_id uuid,
  region_id uuid,
  rule_id uuid
) on commit drop;
grant insert, select, update on backfill_refs to authenticated;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
set local role authenticated;

insert into backfill_refs (other_season_id, variety_id, region_id)
select
  registration.crop_season_id,
  varieties.id,
  regions.id
from public.rice_varieties as varieties
cross join public.rule_regions as regions
cross join lateral public.register_simple_field_with_season(
  'backfill-other-field',
  '別利用者の田んぼ',
  'SMALL',
  2026::smallint,
  varieties.id,
  '2026-05-20'::date,
  '2026-08-01'::date
) as registration
where varieties.name = 'コシヒカリ'
  and regions.code = '34204-kui';

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

update backfill_refs
set owner_account_id = accounts.id
from public.accounts as accounts
where accounts.created_by = 'a1000000-0000-4000-8000-000000000001';

do $$
declare
  v_refs backfill_refs%rowtype;
  v_season_id uuid;
begin
  select * into v_refs from backfill_refs;
  select crop_season_id into v_season_id
  from public.register_simple_field_with_season(
    'backfill-owner-field',
    '目安を後から設定する田んぼ',
    'LARGE',
    2026::smallint,
    v_refs.variety_id,
    '2026-05-20'::date,
    '2026-08-01'::date
  );
  update backfill_refs set owner_season_id = v_season_id;
end;
$$;

do $$
declare
  v_refs backfill_refs%rowtype;
  v_status public.maturity_status;
begin
  select * into v_refs from backfill_refs;
  if exists (
    select 1 from public.season_rule_snapshots
    where crop_season_id in (v_refs.owner_season_id, v_refs.other_season_id)
  ) then
    raise exception 'a field unexpectedly had a snapshot before rule save';
  end if;

  select maturity_status into v_status
  from public.crop_season_summaries
  where crop_season_id = v_refs.owner_season_id;
  if v_status <> 'NOT_CONFIGURED'::public.maturity_status then
    raise exception 'owner season did not begin unconfigured: %', v_status;
  end if;
end;
$$;

do $$
declare
  v_refs backfill_refs%rowtype;
  v_rule_id uuid;
begin
  select * into v_refs from backfill_refs;
  select id into v_rule_id
  from public.save_account_variety_rule(
    p_account_id => v_refs.owner_account_id,
    p_variety_id => v_refs.variety_id,
    p_harvest_start_temp_c => 1000,
    p_harvest_target_temp_c => 1050,
    p_harvest_end_temp_c => 1100,
    p_accumulation_start_offset_days => 0::smallint,
    p_source_note => '後から登録した久井町の作業ノート',
    p_effective_from => '2026-01-01'::date,
    p_rule_id => null,
    p_region_id => v_refs.region_id,
    p_effective_to => null
  );
  update backfill_refs set rule_id = v_rule_id;
end;
$$;

do $$
declare
  v_refs backfill_refs%rowtype;
  v_snapshot record;
  v_status public.maturity_status;
begin
  select * into v_refs from backfill_refs;

  select harvest_start_temp_c, harvest_target_temp_c, harvest_end_temp_c,
         accumulation_start_offset_days, source_note, is_custom
    into v_snapshot
  from public.season_rule_snapshots
  where crop_season_id = v_refs.owner_season_id;
  if v_snapshot.harvest_start_temp_c <> 1000
     or v_snapshot.harvest_target_temp_c <> 1050
     or v_snapshot.harvest_end_temp_c <> 1100
     or v_snapshot.accumulation_start_offset_days <> 0
     or v_snapshot.source_note <> '後から登録した久井町の作業ノート'
     or v_snapshot.is_custom is distinct from true then
    raise exception 'owner missing snapshot was not backfilled: %', v_snapshot;
  end if;

  select maturity_status into v_status
  from public.crop_season_summaries
  where crop_season_id = v_refs.owner_season_id;
  if v_status = 'NOT_CONFIGURED'::public.maturity_status then
    raise exception 'owner summary remained unconfigured after backfill';
  end if;

  if exists (
    select 1 from public.season_rule_snapshots
    where crop_season_id = v_refs.other_season_id
  ) then
    raise exception 'rule backfill crossed the account boundary';
  end if;
end;
$$;

-- Editing the account rule may fill future missing seasons, but it must not
-- rewrite the snapshot already assigned above.
select public.save_account_variety_rule(
  p_account_id => owner_account_id,
  p_variety_id => variety_id,
  p_harvest_start_temp_c => 900,
  p_harvest_target_temp_c => 950,
  p_harvest_end_temp_c => 1000,
  p_accumulation_start_offset_days => 0::smallint,
  p_source_note => '変更後の作業ノート',
  p_effective_from => '2026-01-01'::date,
  p_rule_id => rule_id,
  p_region_id => region_id,
  p_effective_to => null
)
from backfill_refs;

do $$
declare
  v_refs backfill_refs%rowtype;
  v_start numeric;
  v_note text;
begin
  select * into v_refs from backfill_refs;
  select harvest_start_temp_c, source_note
    into v_start, v_note
  from public.season_rule_snapshots
  where crop_season_id = v_refs.owner_season_id;
  if v_start <> 1000 or v_note <> '後から登録した久井町の作業ノート' then
    raise exception 'editing the rule rewrote an existing snapshot: %/%', v_start, v_note;
  end if;
end;
$$;

rollback;

select 'rule_backfill: ok' as result;
