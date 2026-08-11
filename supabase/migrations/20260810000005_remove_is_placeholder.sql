begin;

create or replace function public.calculate_production_wages(
  p_factory_id uuid,
  p_week_start date
)
returns table (
  labourers_calculated integer,
  rows_skipped integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  production_rate public.wage_rates%rowtype;
  matching_rate_count integer;
  production_row record;
  inserted_rows integer;
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'week_start must be a Monday.'
      using errcode = '22023';
  end if;

  if p_week_start + 6 >= business_today then
    raise exception 'Week starting % is not completed yet.', p_week_start
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('calculate_production_wages:' || p_week_start::text)
  );

  select count(*)
    into matching_rate_count
    from public.wage_rates
    where wage_rates.factory_id = p_factory_id
      and wage_rates.applies_to = 'production'
      and wage_rates.effective_from <= p_week_start
      and (wage_rates.effective_to is null or wage_rates.effective_to >= p_week_start);

  if matching_rate_count = 0 then
    raise exception 'No production wage rate applies to week starting %.', p_week_start
      using errcode = 'P0001';
  end if;

  if matching_rate_count > 1 then
    raise exception 'Multiple production wage rates apply to week starting %.', p_week_start
      using errcode = 'P0001';
  end if;

  select *
    into production_rate
    from public.wage_rates
    where wage_rates.factory_id = p_factory_id
      and wage_rates.applies_to = 'production'
      and wage_rates.effective_from <= p_week_start
      and (wage_rates.effective_to is null or wage_rates.effective_to >= p_week_start);

  labourers_calculated := 0;
  rows_skipped := 0;

  for production_row in
    select
      production_entries.labourer_id,
      sum(production_entries.quantity)::integer as quantity
    from public.production_entries
    join public.labourers
      on labourers.id = production_entries.labourer_id
      and labourers.factory_id = production_entries.factory_id
    where production_entries.factory_id = p_factory_id
      and production_entries.production_date >= p_week_start
      and production_entries.production_date <= p_week_start + 6
    group by production_entries.labourer_id
  loop
    insert into public.weekly_earnings (
      factory_id,
      labourer_id,
      week_start,
      quantity_used,
      wage_rate_id,
      rate_used,
      amount
    )
    values (
      p_factory_id,
      production_row.labourer_id,
      p_week_start,
      production_row.quantity,
      production_rate.id,
      production_rate.rate_per_1000_bricks,
      (production_row.quantity::numeric * production_rate.rate_per_1000_bricks) / 1000
    )
    on conflict (factory_id, labourer_id, week_start)
      where labourer_id is not null
      do nothing;

    get diagnostics inserted_rows = row_count;
    if inserted_rows = 1 then
      labourers_calculated := labourers_calculated + 1;
    else
      rows_skipped := rows_skipped + 1;
    end if;
  end loop;

  return next;
end;
$$;

revoke insert, update, delete on public.weekly_earnings from authenticated;
grant select on public.weekly_earnings to authenticated;

revoke all on function public.calculate_production_wages(uuid, date) from public;
revoke all on function public.calculate_production_wages(uuid, date) from anon;
grant execute on function public.calculate_production_wages(uuid, date) to authenticated;

create or replace function public.calculate_mud_supply_wages(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_week_start date
)
returns table (
  weekly_earning_id uuid,
  groups_calculated integer,
  rows_skipped integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  group_is_active boolean;
  mud_rate public.wage_rates%rowtype;
  matching_rate_count integer;
  eligible_quantity integer;
  inserted_rows integer;
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.'
      using errcode = '42501';
  end if;

  select labour_groups.is_active
    into group_is_active
    from public.labour_groups
    where labour_groups.id = p_labour_group_id
      and labour_groups.factory_id = p_factory_id;

  if not found then
    raise exception 'Labour group does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'week_start must be a Monday.'
      using errcode = '22023';
  end if;

  if p_week_start + 6 >= business_today then
    raise exception 'Week starting % is not completed yet.', p_week_start
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('calculate_mud_supply_wages:' || p_week_start::text)
  );

  select earnings.id
    into weekly_earning_id
    from public.weekly_earnings as earnings
    where earnings.factory_id = p_factory_id
      and earnings.week_start = p_week_start
      and earnings.labour_group_id is not null;

  if found then
    groups_calculated := 0;
    rows_skipped := 1;
    return next;
    return;
  end if;

  if not group_is_active then
    raise exception 'Labour group is inactive and cannot be calculated.'
      using errcode = 'P0001';
  end if;

  select count(*)
    into matching_rate_count
    from public.wage_rates
    where wage_rates.factory_id = p_factory_id
      and wage_rates.applies_to = 'mud_supply'
      and wage_rates.effective_from <= p_week_start
      and (wage_rates.effective_to is null or wage_rates.effective_to >= p_week_start);

  if matching_rate_count = 0 then
    raise exception 'No mud_supply wage rate applies to week starting %.', p_week_start
      using errcode = 'P0001';
  end if;

  if matching_rate_count > 1 then
    raise exception 'Multiple mud_supply wage rates apply to week starting %.', p_week_start
      using errcode = 'P0001';
  end if;

  select *
    into mud_rate
    from public.wage_rates
    where wage_rates.factory_id = p_factory_id
      and wage_rates.applies_to = 'mud_supply'
      and wage_rates.effective_from <= p_week_start
      and (wage_rates.effective_to is null or wage_rates.effective_to >= p_week_start);

  select coalesce(sum(production_entries.quantity), 0)::integer
    into eligible_quantity
    from public.production_entries
    join public.labourers
      on labourers.id = production_entries.labourer_id
      and labourers.factory_id = production_entries.factory_id
    where production_entries.factory_id = p_factory_id
      and production_entries.production_date >= p_week_start
      and production_entries.production_date <= p_week_start + 6;

  insert into public.weekly_earnings (
    factory_id,
    labour_group_id,
    week_start,
    quantity_used,
    wage_rate_id,
    rate_used,
    amount
  )
  values (
    p_factory_id,
    p_labour_group_id,
    p_week_start,
    eligible_quantity,
    mud_rate.id,
    mud_rate.rate_per_1000_bricks,
    (eligible_quantity::numeric * mud_rate.rate_per_1000_bricks) / 1000
  )
  on conflict (factory_id, week_start)
    where labour_group_id is not null
    do nothing
  returning id into weekly_earning_id;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    groups_calculated := 1;
    rows_skipped := 0;
  else
    select earnings.id
      into weekly_earning_id
      from public.weekly_earnings as earnings
      where earnings.factory_id = p_factory_id
        and earnings.week_start = p_week_start
        and earnings.labour_group_id is not null;
    groups_calculated := 0;
    rows_skipped := 1;
  end if;

  return next;
end;
$$;

revoke insert, update, delete on public.weekly_earnings from authenticated;
grant select on public.weekly_earnings to authenticated;

revoke all on function public.calculate_mud_supply_wages(uuid, uuid, date) from public;
revoke all on function public.calculate_mud_supply_wages(uuid, uuid, date) from anon;
grant execute on function public.calculate_mud_supply_wages(uuid, uuid, date) to authenticated;

do $$
declare
  dependent_objects text;
begin
  select string_agg(object_name, ', ' order by object_name)
    into dependent_objects
    from (
      select format('function %I.%I(%s)', namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid)) as object_name
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.prokind in ('f', 'p')
        and pg_get_functiondef(procedure.oid) ilike '%is_placeholder%'

      union all

      select format('constraint %I on %s', constraint_record.conname, constraint_record.conrelid::regclass)
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.connamespace = 'public'::regnamespace
        and pg_get_constraintdef(constraint_record.oid) ilike '%is_placeholder%'

      union all

      select format('index %s', index_record.indexrelid::regclass)
      from pg_catalog.pg_index as index_record
      where pg_get_indexdef(index_record.indexrelid) ilike '%is_placeholder%'

      union all

      select format('trigger %I on %s', trigger_record.tgname, trigger_record.tgrelid::regclass)
      from pg_catalog.pg_trigger as trigger_record
      where not trigger_record.tgisinternal
        and pg_get_triggerdef(trigger_record.oid) ilike '%is_placeholder%'

      union all

      select format('policy %I on %I.%I', policies.policyname, policies.schemaname, policies.tablename)
      from pg_catalog.pg_policies as policies
      where policies.schemaname = 'public'
        and (coalesce(policies.qual, '') ilike '%is_placeholder%'
          or coalesce(policies.with_check, '') ilike '%is_placeholder%')

      union all

      select format('view %I.%I', views.schemaname, views.viewname)
      from pg_catalog.pg_views as views
      where views.schemaname = 'public'
        and views.definition ilike '%is_placeholder%'

      union all

      select format('materialized view %I.%I', views.schemaname, views.matviewname)
      from pg_catalog.pg_matviews as views
      where views.schemaname = 'public'
        and views.definition ilike '%is_placeholder%'
    ) as dependencies;

  if dependent_objects is not null then
    raise exception 'Cannot remove labourers.is_placeholder; active database objects still reference it: %.', dependent_objects
      using errcode = 'P0001';
  end if;
end;
$$;

alter table public.labourers
  drop column is_placeholder;

commit;
