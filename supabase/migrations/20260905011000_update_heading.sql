create function public.update_season_heading(p_season_id uuid, p_heading_date date)
returns void language plpgsql security definer set search_path = ''
set statement_timeout = '5s'
as $$
declare
  season public.crop_seasons;
begin
  select cs.* into season from public.crop_seasons cs
  join public.fields f on f.id = cs.field_id
  join public.account_members m on m.account_id = f.account_id
  where cs.id = p_season_id and m.user_id = auth.uid() and m.role = 'OWNER'
    and f.archived_at is null
  for update of cs;
  if not found then raise exception using errcode = '42501', message = 'Owner required'; end if;
  if season.harvest_date is not null then
    raise exception using errcode = '22023', message = 'Harvested season is immutable';
  end if;
  if p_heading_date is null or p_heading_date < season.planting_date
    or extract(year from p_heading_date) <> season.year then
    raise exception using errcode = '22023', message = 'Invalid heading date';
  end if;
  update public.crop_seasons set heading_date = p_heading_date where id = p_season_id;
  perform public.recalculate_crop_season_summary(p_season_id, (now() at time zone 'Asia/Tokyo')::date - 1);
end;
$$;
revoke all on function public.update_season_heading(uuid,date) from public, anon;
grant execute on function public.update_season_heading(uuid,date) to authenticated;
