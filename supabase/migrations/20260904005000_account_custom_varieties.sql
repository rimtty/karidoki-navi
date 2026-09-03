-- Account-private rice varieties.
--
-- The initial five rows remain shared system masters (owner_account_id is
-- null). Farmers may add varieties used by their own organization without
-- exposing those names to other accounts.

alter table public.rice_varieties
  add column if not exists owner_account_id uuid
    references public.accounts(id) on delete cascade;

alter table public.rice_varieties
  drop constraint if exists rice_varieties_name_key;

create unique index if not exists rice_varieties_system_name_unique_idx
  on public.rice_varieties (pg_catalog.lower(name))
  where owner_account_id is null;

create unique index if not exists rice_varieties_account_name_unique_idx
  on public.rice_varieties (owner_account_id, pg_catalog.lower(name))
  where owner_account_id is not null;

drop policy if exists rice_varieties_select_authenticated
  on public.rice_varieties;
create policy rice_varieties_select_authenticated
on public.rice_varieties for select
to authenticated
using (
  is_active
  and (
    owner_account_id is null
    or public.is_account_member(owner_account_id)
  )
);

create or replace function public.create_account_rice_variety(
  p_account_id uuid,
  p_name text
)
returns setof public.rice_varieties
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_name text;
  v_variety public.rice_varieties;
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

  v_name := pg_catalog.regexp_replace(
    pg_catalog.btrim(coalesce(p_name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if pg_catalog.char_length(v_name) not between 1 and 30
     or v_name ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '22023',
      message = 'p_name must be between 1 and 30 readable characters';
  end if;

  if exists (
    select 1
    from public.rice_varieties
    where owner_account_id is null
      and pg_catalog.lower(name) = pg_catalog.lower(v_name)
  ) then
    raise exception using
      errcode = '23505',
      message = 'the system variety already exists';
  end if;

  -- A retry returns the account's existing row instead of making a duplicate.
  select varieties.*
    into v_variety
  from public.rice_varieties as varieties
  where varieties.owner_account_id = p_account_id
    and pg_catalog.lower(varieties.name) = pg_catalog.lower(v_name)
  limit 1;

  if found then
    if not v_variety.is_active then
      update public.rice_varieties
      set is_active = true,
          updated_at = pg_catalog.now()
      where id = v_variety.id
      returning * into v_variety;
    end if;
    return next v_variety;
    return;
  end if;

  insert into public.rice_varieties (name, owner_account_id)
  values (v_name, p_account_id)
  returning * into v_variety;

  return next v_variety;
  return;
end;
$$;

revoke all on function public.create_account_rice_variety(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_account_rice_variety(uuid, text)
  to authenticated, service_role;

create or replace function public.enforce_crop_season_variety_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field_account_id uuid;
  v_variety_account_id uuid;
begin
  if new.variety_id is null then
    return new;
  end if;

  select fields.account_id
    into v_field_account_id
  from public.fields as fields
  where fields.id = new.field_id;

  select varieties.owner_account_id
    into v_variety_account_id
  from public.rice_varieties as varieties
  where varieties.id = new.variety_id;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'variety does not exist';
  end if;

  if v_variety_account_id is not null
     and v_variety_account_id <> v_field_account_id then
    raise exception using
      errcode = '42501',
      message = 'custom variety belongs to another account';
  end if;

  return new;
end;
$$;

drop trigger if exists crop_seasons_enforce_variety_account
  on public.crop_seasons;
create trigger crop_seasons_enforce_variety_account
before insert or update of field_id, variety_id on public.crop_seasons
for each row execute function public.enforce_crop_season_variety_account();

revoke all on function public.enforce_crop_season_variety_account()
  from public, anon, authenticated;
grant execute on function public.enforce_crop_season_variety_account()
  to service_role;
