-- Owner-scoped harvest registration for the field detail action.
--
-- Authenticated clients have no direct table write grants.  This function is
-- the narrow, transaction-safe write path and derives the owner from
-- auth.uid(), never from a client-provided account id.
create or replace function public.register_harvest(
  p_crop_season_id uuid,
  p_harvest_date date,
  p_harvest_accumulated_temp_c numeric default null
)
returns table (
  crop_season_id uuid,
  harvest_date date,
  harvest_accumulated_temp_c numeric(8, 2),
  lifecycle_status public.season_lifecycle_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_crop_season_id uuid;
  v_harvest_date date;
  v_harvest_accumulated_temp_c numeric(8, 2);
  v_lifecycle_status public.season_lifecycle_status;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if p_crop_season_id is null or p_harvest_date is null then
    raise exception using
      errcode = '22023',
      message = 'crop season and harvest date are required';
  end if;

  if p_harvest_accumulated_temp_c is not null
     and p_harvest_accumulated_temp_c < 0 then
    raise exception using
      errcode = '22023',
      message = 'harvest accumulated temperature must be non-negative';
  end if;

  -- Only an account owner may record a harvest.  The account is resolved
  -- through the season's field and the current JWT subject.
  select crop_seasons.id
    into v_crop_season_id
  from public.crop_seasons
  join public.fields
    on fields.id = crop_seasons.field_id
  join public.account_members
    on account_members.account_id = fields.account_id
   and account_members.user_id = v_user_id
   and account_members.role = 'OWNER'
  where crop_seasons.id = p_crop_season_id
    and fields.archived_at is null;

  if v_crop_season_id is null then
    raise exception using
      errcode = '42501',
      message = 'the crop season owner is not authorized';
  end if;

  update public.crop_seasons
  set harvest_date = p_harvest_date,
      harvest_accumulated_temp_c = p_harvest_accumulated_temp_c,
      lifecycle_status = 'HARVESTED',
      updated_at = pg_catalog.now()
  where crop_seasons.id = v_crop_season_id
  returning
    crop_seasons.id,
    crop_seasons.harvest_date,
    crop_seasons.harvest_accumulated_temp_c,
    crop_seasons.lifecycle_status
  into
    v_crop_season_id,
    v_harvest_date,
    v_harvest_accumulated_temp_c,
    v_lifecycle_status;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'crop season was not found';
  end if;

  return query
  select
    v_crop_season_id,
    v_harvest_date,
    v_harvest_accumulated_temp_c,
    v_lifecycle_status;
end;
$$;

revoke all on function public.register_harvest(uuid, date, numeric)
  from public, anon, authenticated;
grant execute on function public.register_harvest(uuid, date, numeric)
  to authenticated;
grant execute on function public.register_harvest(uuid, date, numeric)
  to service_role;
