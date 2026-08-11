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
      and not labourers.is_placeholder
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
