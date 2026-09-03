-- Apply a newly saved account rule to this account's existing unconfigured
-- seasons. Once a season has a snapshot it remains immutable, so later rule
-- edits and deletes cannot rewrite the basis used for that season.

create or replace function public.save_account_variety_rule(
  p_account_id uuid,
  p_variety_id uuid,
  p_harvest_start_temp_c numeric,
  p_harvest_target_temp_c numeric,
  p_harvest_end_temp_c numeric,
  p_accumulation_start_offset_days smallint,
  p_source_note text,
  p_effective_from date,
  p_rule_id uuid default null,
  p_region_id uuid default null,
  p_effective_to date default null
)
returns setof public.account_variety_rules
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_rule public.account_variety_rules;
  v_crop_season_id uuid;
  v_today date := (pg_catalog.now() at time zone 'Asia/Tokyo')::date;
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

  if not exists (
    select 1
    from public.rice_varieties as varieties
    where varieties.id = p_variety_id
      and varieties.is_active
      and (
        varieties.owner_account_id is null
        or varieties.owner_account_id = p_account_id
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'variety must be active and available to this account';
  end if;

  if p_rule_id is null then
    insert into public.account_variety_rules (
      account_id,
      variety_id,
      region_id,
      harvest_start_temp_c,
      harvest_target_temp_c,
      harvest_end_temp_c,
      accumulation_start_offset_days,
      source_note,
      effective_from,
      effective_to
    ) values (
      p_account_id,
      p_variety_id,
      p_region_id,
      p_harvest_start_temp_c,
      p_harvest_target_temp_c,
      p_harvest_end_temp_c,
      p_accumulation_start_offset_days,
      p_source_note,
      p_effective_from,
      p_effective_to
    ) returning * into v_rule;
  else
    update public.account_variety_rules
    set variety_id = p_variety_id,
        region_id = p_region_id,
        harvest_start_temp_c = p_harvest_start_temp_c,
        harvest_target_temp_c = p_harvest_target_temp_c,
        harvest_end_temp_c = p_harvest_end_temp_c,
        accumulation_start_offset_days = p_accumulation_start_offset_days,
        source_note = p_source_note,
        effective_from = p_effective_from,
        effective_to = p_effective_to
    where id = p_rule_id
      and account_id = p_account_id
    returning * into v_rule;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'account rule access is required';
    end if;
  end if;

  -- The current pilot route represents every no-location field as belonging to
  -- Kui. Explicit pilot hierarchy rules therefore match those fields, while a
  -- future geometry-backed custom region must intersect a located field.
  if v_rule.effective_from <= v_today
     and (v_rule.effective_to is null or v_rule.effective_to >= v_today) then
    for v_crop_season_id in
      insert into public.season_rule_snapshots (
        crop_season_id,
        source_rule_id,
        rule_version,
        harvest_start_temp_c,
        harvest_target_temp_c,
        harvest_end_temp_c,
        danger_temp_c,
        accumulation_start_offset_days,
        daily_temperature_metric,
        source_title,
        source_publisher,
        source_url,
        source_note,
        is_custom
      )
      select
        seasons.id,
        null,
        null,
        v_rule.harvest_start_temp_c,
        v_rule.harvest_target_temp_c,
        v_rule.harvest_end_temp_c,
        null,
        v_rule.accumulation_start_offset_days,
        'MEAN'::public.temperature_metric,
        '利用者設定ルール',
        'アカウント設定',
        null,
        v_rule.source_note,
        true
      from public.crop_seasons as seasons
      join public.fields as fields
        on fields.id = seasons.field_id
      left join public.season_rule_snapshots as snapshots
        on snapshots.crop_season_id = seasons.id
      left join public.rule_regions as regions
        on regions.id = v_rule.region_id
      where fields.account_id = v_rule.account_id
        and fields.archived_at is null
        and seasons.variety_id = v_rule.variety_id
        and seasons.lifecycle_status = 'ACTIVE'::public.season_lifecycle_status
        and seasons.harvest_date is null
        and snapshots.crop_season_id is null
        and (
          v_rule.region_id is null
          or regions.code in ('34204-kui', '34204', '34', 'JP')
          or (
            regions.geom is not null
            and fields.geom is not null
            and extensions.st_intersects(
              regions.geom,
              extensions.st_pointonsurface(fields.geom)
            )
          )
        )
      returning crop_season_id
    loop
      perform public.recalculate_crop_season_summary(v_crop_season_id, v_today);
    end loop;
  end if;

  return next v_rule;
  return;
end;
$$;

revoke all on function public.save_account_variety_rule(
  uuid, uuid, numeric, numeric, numeric, smallint, text, date, uuid, uuid, date
) from public, anon, authenticated, service_role;
grant execute on function public.save_account_variety_rule(
  uuid, uuid, numeric, numeric, numeric, smallint, text, date, uuid, uuid, date
) to authenticated, service_role;

-- Repair rows that were already unconfigured before this migration was
-- deployed. This is the same first-assignment behavior as a later rule save;
-- existing snapshots are deliberately excluded.
do $$
declare
  v_crop_season_id uuid;
  v_today date := (pg_catalog.now() at time zone 'Asia/Tokyo')::date;
begin
  for v_crop_season_id in
    insert into public.season_rule_snapshots (
      crop_season_id,
      source_rule_id,
      rule_version,
      harvest_start_temp_c,
      harvest_target_temp_c,
      harvest_end_temp_c,
      danger_temp_c,
      accumulation_start_offset_days,
      daily_temperature_metric,
      source_title,
      source_publisher,
      source_url,
      source_note,
      is_custom
    )
    select
      seasons.id,
      null,
      null,
      matched_rule.harvest_start_temp_c,
      matched_rule.harvest_target_temp_c,
      matched_rule.harvest_end_temp_c,
      null,
      matched_rule.accumulation_start_offset_days,
      'MEAN'::public.temperature_metric,
      '利用者設定ルール',
      'アカウント設定',
      null,
      matched_rule.source_note,
      true
    from public.crop_seasons as seasons
    join public.fields as fields
      on fields.id = seasons.field_id
    cross join lateral (
      select rules.*
      from public.account_variety_rules as rules
      left join public.rule_regions as regions
        on regions.id = rules.region_id
      where rules.account_id = fields.account_id
        and rules.variety_id = seasons.variety_id
        and rules.effective_from <= v_today
        and (rules.effective_to is null or rules.effective_to >= v_today)
        and (
          rules.region_id is null
          or regions.code in ('34204-kui', '34204', '34', 'JP')
          or (
            regions.geom is not null
            and fields.geom is not null
            and extensions.st_intersects(
              regions.geom,
              extensions.st_pointonsurface(fields.geom)
            )
          )
        )
      order by
        coalesce(regions.specificity, 0) desc,
        rules.effective_from desc,
        rules.updated_at desc,
        rules.id
      limit 1
    ) as matched_rule
    left join public.season_rule_snapshots as snapshots
      on snapshots.crop_season_id = seasons.id
    where fields.archived_at is null
      and seasons.variety_id is not null
      and seasons.lifecycle_status = 'ACTIVE'::public.season_lifecycle_status
      and seasons.harvest_date is null
      and snapshots.crop_season_id is null
    returning crop_season_id
  loop
    perform public.recalculate_crop_season_summary(v_crop_season_id, v_today);
  end loop;
end;
$$;
