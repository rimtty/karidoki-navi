-- Keep the existing registration transaction and ACLs; relax only heading
-- availability. Refuse migration if the expected source contract has drifted.
do $$
declare
  definition text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.register_simple_field_with_season(text,text,text,smallint,uuid,date,date)'::regprocedure
  );
  if pg_catalog.strpos(definition, 'p_planting_date is null or p_heading_date is null') = 0 then
    raise exception 'Unexpected simple registration definition';
  end if;
  definition := pg_catalog.replace(definition,
    'p_planting_date is null or p_heading_date is null', 'p_planting_date is null');
  definition := pg_catalog.replace(definition,
    'p_planting_date and p_heading_date are required', 'p_planting_date is required');
  execute definition;
end;
$$;
