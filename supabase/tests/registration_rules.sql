-- Integration verification for account-rule registration snapshots.
--
-- Run after `./node_modules/.bin/supabase db reset --local` with:
--   docker exec -i supabase_db_karidoki-navi psql -U postgres -d postgres \
--     -X -v ON_ERROR_STOP=1 -f - < supabase/tests/registration_rules.sql

\set ON_ERROR_STOP on

begin;

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
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'authenticated',
    'authenticated',
    'registration-rules-owner@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Registration rules owner"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'authenticated',
    'authenticated',
    'registration-rules-other@example.com',
    'not-used',
    pg_catalog.now(),
    '{}'::jsonb,
    '{"display_name":"Registration rules other"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  );

select set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  true
);
set local role authenticated;

create temporary table registration_owner_ref (account_id uuid) on commit drop;
grant insert, select on registration_owner_ref to authenticated;

do $$
declare
  v_account_id uuid;
  v_variety_id uuid;
  v_region_id uuid;
  v_rule_id uuid;
  v_field_id uuid;
  v_season_id uuid;
  v_replayed_field_id uuid;
  v_replayed_season_id uuid;
  v_is_custom boolean;
  v_was_replayed boolean;
  v_snapshot_start numeric;
  v_snapshot_note text;
  v_after_delete_start numeric;
  v_after_delete_note text;
  v_station_id text;
  v_binding_count integer;
  v_field_count integer;
  v_snapshot_count integer;
  v_status public.maturity_status;
begin
  select id
    into v_account_id
  from public.accounts
  where created_by = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  select id
    into v_variety_id
  from public.rice_varieties
  where name = 'コシヒカリ';
  select id
    into v_region_id
  from public.rule_regions
  where code = '34204-kui';
  insert into registration_owner_ref values (v_account_id);

  -- A region-specific user rule is valid for the pilot registration route.
  select id
    into v_rule_id
  from public.save_account_variety_rule(
    p_account_id => v_account_id,
    p_variety_id => v_variety_id,
    p_harvest_start_temp_c => 900,
    p_harvest_target_temp_c => 1000,
    p_harvest_end_temp_c => 1100,
    p_accumulation_start_offset_days => 1::smallint,
    p_source_note => '久井町の管理者採用値（integration test）',
    p_effective_from => '2020-01-01'::date,
    p_rule_id => null,
    p_region_id => v_region_id,
    p_effective_to => '2100-12-31'::date
  );

  -- The database repeats the client-side safety bounds.  No invalid rule is
  -- allowed to reach the private master even when an RPC caller bypasses the
  -- web form.
  begin
    perform public.save_account_variety_rule(
      p_account_id => v_account_id,
      p_variety_id => v_variety_id,
      p_harvest_start_temp_c => -1,
      p_harvest_target_temp_c => 0,
      p_harvest_end_temp_c => 1,
      p_accumulation_start_offset_days => 1::smallint,
      p_source_note => '不正値テスト',
      p_effective_from => '2020-01-01'::date,
      p_rule_id => null,
      p_region_id => null,
      p_effective_to => '2100-12-31'::date
    );
    raise exception 'non-positive account rule temperature was accepted';
  exception
    when sqlstate '23514' then null;
  end;

  begin
    perform public.save_account_variety_rule(
      p_account_id => v_account_id,
      p_variety_id => v_variety_id,
      p_harvest_start_temp_c => 10000,
      p_harvest_target_temp_c => 10000,
      p_harvest_end_temp_c => 10001,
      p_accumulation_start_offset_days => 1::smallint,
      p_source_note => '上限超過テスト',
      p_effective_from => '2020-01-01'::date,
      p_rule_id => null,
      p_region_id => null,
      p_effective_to => '2100-12-31'::date
    );
    raise exception 'over-limit account rule temperature was accepted';
  exception
    when sqlstate '23514' then null;
  end;

  begin
    perform public.save_account_variety_rule(
      p_account_id => v_account_id,
      p_variety_id => v_variety_id,
      p_harvest_start_temp_c => 900,
      p_harvest_target_temp_c => 1000,
      p_harvest_end_temp_c => 1100,
      p_accumulation_start_offset_days => 1::smallint,
      p_source_note => '  ',
      p_effective_from => '2020-01-01'::date,
      p_rule_id => null,
      p_region_id => null,
      p_effective_to => '2100-12-31'::date
    );
    raise exception 'blank account rule source note was accepted';
  exception
    when sqlstate '23514' then null;
  end;

  select field_id, crop_season_id
    into v_field_id, v_season_id
  from public.register_field_with_season(
    'registration-custom-1',
    'カスタムルール圃場',
    '{"type":"Polygon","coordinates":[[[132.949,34.449],[132.951,34.449],[132.951,34.451],[132.949,34.451],[132.949,34.449]]]}'::jsonb,
    2026::smallint,
    v_variety_id,
    '2026-08-01'::date,
    'MANUAL',
    null,
    null
  );

  select is_custom, harvest_start_temp_c, source_note
    into v_is_custom, v_snapshot_start, v_snapshot_note
  from public.season_rule_snapshots
  where crop_season_id = v_season_id;
  if v_is_custom is distinct from true
     or v_snapshot_start <> 900
     or v_snapshot_note <> '久井町の管理者採用値（integration test）' then
    raise exception 'custom snapshot was not fixed with source metadata';
  end if;

  select external_id, count(*) over ()
    into v_station_id, v_binding_count
  from public.season_weather_bindings as bindings
  join public.weather_locations as locations
    on locations.id = bindings.weather_location_id
  where bindings.crop_season_id = v_season_id
    and bindings.is_active
  order by bindings.created_at, bindings.id
  limit 1;
  if v_binding_count <> 1 or v_station_id <> '67386' then
    raise exception 'nearest JMA station was not automatically bound: %/%',
      v_station_id, v_binding_count;
  end if;

  select count(*)
    into v_field_count
  from public.fields
  where account_id = v_account_id;
  if v_field_count <> 1 then
    raise exception 'unexpected field count before replay: %', v_field_count;
  end if;

  select field_id, crop_season_id, was_replayed
    into v_replayed_field_id, v_replayed_season_id, v_was_replayed
  from public.register_field_with_season(
    'registration-custom-1',
    'カスタムルール圃場',
    '{"type":"Polygon","coordinates":[[[132.949,34.449],[132.951,34.449],[132.951,34.451],[132.949,34.451],[132.949,34.449]]]}'::jsonb,
    2026::smallint,
    v_variety_id,
    '2026-08-01'::date,
    'MANUAL',
    null,
    null
  );
  if not v_was_replayed
     or v_replayed_field_id <> v_field_id
     or v_replayed_season_id <> v_season_id then
    raise exception 'same-key registration did not replay the original result';
  end if;
  select count(*)
    into v_field_count
  from public.fields
  where account_id = v_account_id;
  if v_field_count <> 1 then
    raise exception 'same-key replay created a duplicate field: %', v_field_count;
  end if;

  -- Removing the account rule must not rewrite the already applied snapshot.
  if not public.delete_account_variety_rule(v_account_id, v_rule_id) then
    raise exception 'custom rule delete failed';
  end if;
  select harvest_start_temp_c, source_note
    into v_after_delete_start, v_after_delete_note
  from public.season_rule_snapshots
  where crop_season_id = v_season_id;
  if v_after_delete_start <> v_snapshot_start
     or v_after_delete_note <> v_snapshot_note then
    raise exception 'deleting a custom rule changed an existing snapshot';
  end if;

  -- A new registration after deletion has no official value to fall back to.
  select crop_season_id
    into v_replayed_season_id
  from public.register_field_with_season(
    'registration-after-delete-1',
    '未設定ルール圃場',
    '{"type":"Polygon","coordinates":[[[132.949,34.452],[132.951,34.452],[132.951,34.454],[132.949,34.454],[132.949,34.452]]]}'::jsonb,
    2026::smallint,
    v_variety_id,
    '2026-08-01'::date,
    'MANUAL',
    null,
    null
  );

  select count(*)
    into v_snapshot_count
  from public.season_rule_snapshots
  where crop_season_id = v_replayed_season_id;
  if v_snapshot_count <> 0 then
    raise exception 'new registration unexpectedly received a rule snapshot';
  end if;

  select maturity_status
    into v_status
  from public.crop_season_summaries
  where crop_season_id = v_replayed_season_id;
  if v_status <> 'NOT_CONFIGURED'::public.maturity_status then
    raise exception 'new registration did not remain NOT_CONFIGURED: %', v_status;
  end if;
end;
$$;

-- A different authenticated account cannot invoke the owner's registration
-- or access the owner's private rule rows.
select set_config(
  'request.jwt.claim.sub',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  true
);
do $$
declare
  v_account_id uuid;
  v_variety_id uuid;
  v_rule_count integer;
begin
  select account_id
    into v_account_id
  from registration_owner_ref;
  select id
    into v_variety_id
  from public.rice_varieties
  where name = 'コシヒカリ';
  select count(*)
    into v_rule_count
  from public.account_variety_rules
  where account_id = v_account_id;
  if v_rule_count <> 0 then
    raise exception 'RLS leaked private custom rules to another account';
  end if;
  begin
    perform public.list_account_variety_rules(v_account_id, v_variety_id);
    raise exception 'other account was allowed to list private rules';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

rollback;

select 'registration_rules: ok' as result;
