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
  production_row record;
  dated_production record;
  resolved_rate record;
  created_weekly_earning_id uuid;
  inserted_rows integer;
  weekly_amount numeric;
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
    created_weekly_earning_id := null;

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
      null,
      null,
      0
    )
    on conflict (factory_id, labourer_id, week_start)
      where labourer_id is not null
      do nothing
    returning id into created_weekly_earning_id;

    get diagnostics inserted_rows = row_count;
    if inserted_rows = 0 then
      rows_skipped := rows_skipped + 1;
      continue;
    end if;

    for dated_production in
      select
        production_entries.production_date as work_date,
        sum(production_entries.quantity)::integer as quantity
      from public.production_entries
      where production_entries.factory_id = p_factory_id
        and production_entries.labourer_id = production_row.labourer_id
        and production_entries.production_date >= p_week_start
        and production_entries.production_date <= p_week_start + 6
      group by production_entries.production_date
      order by production_entries.production_date
    loop
      select *
        into resolved_rate
      from public.resolve_production_wage_rate(
        p_factory_id,
        production_row.labourer_id,
        dated_production.work_date
      );

      if not found then
        raise exception 'Production rate resolver returned no result for labourer % on %.',
          production_row.labourer_id,
          dated_production.work_date
          using errcode = 'P2407';
      end if;

      insert into public.production_weekly_earning_details (
        factory_id,
        weekly_earning_id,
        work_date,
        quantity_used,
        production_wage_rate_id,
        rate_per_1000_bricks,
        rate_source,
        production_crew_id,
        amount
      )
      values (
        p_factory_id,
        created_weekly_earning_id,
        dated_production.work_date,
        dated_production.quantity,
        resolved_rate.production_wage_rate_id,
        resolved_rate.rate_per_1000_bricks,
        resolved_rate.rate_source,
        resolved_rate.production_crew_id,
        (dated_production.quantity::numeric
          * resolved_rate.rate_per_1000_bricks) / 1000
      );
    end loop;

    select sum(details.amount)
      into weekly_amount
    from public.production_weekly_earning_details as details
    where details.factory_id = p_factory_id
      and details.weekly_earning_id = created_weekly_earning_id;

    update public.weekly_earnings
    set amount = weekly_amount
    where weekly_earnings.id = created_weekly_earning_id
      and weekly_earnings.factory_id = p_factory_id;

    labourers_calculated := labourers_calculated + 1;
  end loop;

  return next;
end;
$$;

revoke all on function public.calculate_production_wages(uuid, date) from public;
revoke all on function public.calculate_production_wages(uuid, date) from anon;
grant execute on function public.calculate_production_wages(uuid, date) to authenticated;
