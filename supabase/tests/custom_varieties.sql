-- Account-added varieties are private, usable in the owner's fields and rules,
-- and rejected across account boundaries.

\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'variety-owner@example.com', 'not-used',
    pg_catalog.now(), '{}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'variety-other@example.com', 'not-used',
    pg_catalog.now(), '{}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
  );

create temporary table custom_variety_refs (
  owner_account_id uuid,
  other_account_id uuid,
  owner_variety_id uuid,
  other_variety_id uuid,
  owner_season_id uuid,
  region_id uuid
) on commit drop;
grant insert, select, update on custom_variety_refs to authenticated;

insert into custom_variety_refs (owner_account_id, other_account_id, region_id)
select
  owner_account.id,
  other_account.id,
  regions.id
from public.accounts as owner_account
cross join public.accounts as other_account
cross join public.rule_regions as regions
where owner_account.created_by = 'a2000000-0000-4000-8000-000000000001'
  and other_account.created_by = 'a2000000-0000-4000-8000-000000000002'
  and regions.code = '34204-kui';

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_refs custom_variety_refs%rowtype;
  v_variety_id uuid;
begin
  select * into v_refs from custom_variety_refs;
  select id into v_variety_id
  from public.create_account_rice_variety(v_refs.owner_account_id, 'にこまる');
  update custom_variety_refs set owner_variety_id = v_variety_id;
end;
$$;

do $$
declare
  v_refs custom_variety_refs%rowtype;
  v_visible_count integer;
begin
  select * into v_refs from custom_variety_refs;
  select count(*) into v_visible_count
  from public.rice_varieties
  where id = v_refs.owner_variety_id
    and owner_account_id = v_refs.owner_account_id;
  if v_visible_count <> 1 then
    raise exception 'owner cannot see the custom variety';
  end if;

  begin
    perform public.create_account_rice_variety(v_refs.owner_account_id, 'コシヒカリ');
    raise exception 'system variety name was accepted as custom';
  exception
    when unique_violation then null;
  end;
end;
$$;

-- A repeated submission is idempotent for the same account.
do $$
declare
  v_refs custom_variety_refs%rowtype;
  v_returned_id uuid;
begin
  select * into v_refs from custom_variety_refs;
  select id into v_returned_id
  from public.create_account_rice_variety(v_refs.owner_account_id, '  にこまる  ');
  if v_returned_id <> v_refs.owner_variety_id then
    raise exception 'custom variety retry created a different row';
  end if;
end;
$$;

do $$
declare
  v_refs custom_variety_refs%rowtype;
  v_season_id uuid;
begin
  select * into v_refs from custom_variety_refs;
  select crop_season_id into v_season_id
  from public.register_simple_field_with_season(
    'custom-variety-owner-field',
    '追加品種の田んぼ',
    'MEDIUM',
    2026::smallint,
    v_refs.owner_variety_id,
    '2026-05-20'::date,
    '2026-08-01'::date
  );
  update custom_variety_refs set owner_season_id = v_season_id;
end;
$$;

select public.save_account_variety_rule(
  p_account_id => owner_account_id,
  p_variety_id => owner_variety_id,
  p_harvest_start_temp_c => 1000,
  p_harvest_target_temp_c => 1050,
  p_harvest_end_temp_c => 1100,
  p_accumulation_start_offset_days => 0::smallint,
  p_source_note => '追加品種の作業ノート',
  p_effective_from => '2026-01-01'::date,
  p_rule_id => null,
  p_region_id => region_id,
  p_effective_to => null
)
from custom_variety_refs;

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);

do $$
declare
  v_refs custom_variety_refs%rowtype;
begin
  select * into v_refs from custom_variety_refs;
  if exists (
    select 1 from public.rice_varieties where id = v_refs.owner_variety_id
  ) then
    raise exception 'another account can see the owner custom variety';
  end if;

  begin
    perform public.register_simple_field_with_season(
      'custom-variety-cross-account-field',
      '使えない田んぼ',
      'SMALL',
      2026::smallint,
      v_refs.owner_variety_id,
      '2026-05-20'::date,
      '2026-08-01'::date
    );
    raise exception 'another account used the owner custom variety';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.save_account_variety_rule(
      p_account_id => v_refs.other_account_id,
      p_variety_id => v_refs.owner_variety_id,
      p_harvest_start_temp_c => 1000,
      p_harvest_target_temp_c => 1050,
      p_harvest_end_temp_c => 1100,
      p_accumulation_start_offset_days => 0::smallint,
      p_source_note => '許可されない設定',
      p_effective_from => '2026-01-01'::date,
      p_rule_id => null,
      p_region_id => v_refs.region_id,
      p_effective_to => null
    );
    raise exception 'another account created a rule for the owner custom variety';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

-- Different accounts may use the same local variety name without sharing rows.
do $$
declare
  v_refs custom_variety_refs%rowtype;
  v_variety_id uuid;
begin
  select * into v_refs from custom_variety_refs;
  select id into v_variety_id
  from public.create_account_rice_variety(v_refs.other_account_id, 'にこまる');
  update custom_variety_refs set other_variety_id = v_variety_id;
end;
$$;

do $$
declare
  v_refs custom_variety_refs%rowtype;
begin
  select * into v_refs from custom_variety_refs;
  if v_refs.other_variety_id is null
     or v_refs.other_variety_id = v_refs.owner_variety_id then
    raise exception 'accounts did not receive separate custom variety rows';
  end if;

  if has_table_privilege('authenticated', 'public.rice_varieties', 'insert')
     or has_table_privilege('authenticated', 'public.rice_varieties', 'update')
     or has_table_privilege('authenticated', 'public.rice_varieties', 'delete') then
    raise exception 'custom varieties must be mutated through the scoped RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.create_account_rice_variety(uuid,text)',
    'execute'
  ) then
    raise exception 'anonymous role must not create custom varieties';
  end if;
end;
$$;

rollback;

select 'custom_varieties: ok' as result;
