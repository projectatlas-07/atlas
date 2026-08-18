create or replace function public.calculate_transport_weekly_wages(
  p_factory_id uuid,
  p_week_start date
)
returns table (
  workers_calculated integer,
  detail_rows_created integer,
  rows_skipped integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  daily_entry record;
  worker_row record;
  matching_rate_count integer;
  daily_attendance_count integer;
  existing_earning_count integer;
  created_earning_id uuid;
  weekly_amount numeric;
  inserted_detail_count integer;
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

  if p_week_start is null
    or not isfinite(p_week_start)
    or extract(isodow from p_week_start) <> 1 then
    raise exception 'week_start must be a finite Monday.'
      using errcode = '22023';
  end if;

  if p_week_start + 6 >= business_today then
    raise exception 'Week starting % is not completed yet.', p_week_start
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('calculate_transport_weekly_wages:' || p_week_start::text)
  );

  select count(*)::integer
    into existing_earning_count
  from public.transport_weekly_earnings
  where transport_weekly_earnings.factory_id = p_factory_id
    and transport_weekly_earnings.week_start = p_week_start;

  if existing_earning_count > 0 then
    workers_calculated := 0;
    detail_rows_created := 0;
    rows_skipped := existing_earning_count;
    return next;
    return;
  end if;

  perform transport_daily_entries.id
  from public.transport_daily_entries
  where transport_daily_entries.factory_id = p_factory_id
    and transport_daily_entries.work_date >= p_week_start
    and transport_daily_entries.work_date <= p_week_start + 6
  for share;

  for daily_entry in
    select
      transport_daily_entries.id,
      transport_daily_entries.transport_crew_id,
      transport_daily_entries.work_date
    from public.transport_daily_entries
    where transport_daily_entries.factory_id = p_factory_id
      and transport_daily_entries.work_date >= p_week_start
      and transport_daily_entries.work_date <= p_week_start + 6
    order by transport_daily_entries.work_date,
      transport_daily_entries.transport_crew_id,
      transport_daily_entries.id
  loop
    select count(*)::integer
      into daily_attendance_count
    from public.transport_daily_attendance
    where transport_daily_attendance.factory_id = p_factory_id
      and transport_daily_attendance.transport_daily_entry_id = daily_entry.id;

    if daily_attendance_count = 0 then
      raise exception 'Transport daily entry % for crew % on % has zero attendance.',
        daily_entry.id, daily_entry.transport_crew_id, daily_entry.work_date
        using errcode = 'P2601';
    end if;

    select count(*)::integer
      into matching_rate_count
    from public.transport_crew_wage_rates
    where transport_crew_wage_rates.factory_id = p_factory_id
      and transport_crew_wage_rates.transport_crew_id = daily_entry.transport_crew_id
      and transport_crew_wage_rates.effective_from <= daily_entry.work_date
      and (
        transport_crew_wage_rates.effective_to is null
        or transport_crew_wage_rates.effective_to >= daily_entry.work_date
      );

    if matching_rate_count = 0 then
      raise exception 'No transport crew wage rate applies to crew % on %.',
        daily_entry.transport_crew_id, daily_entry.work_date
        using errcode = 'P2602';
    end if;

    if matching_rate_count > 1 then
      raise exception 'Multiple transport crew wage rates apply to crew % on %.',
        daily_entry.transport_crew_id, daily_entry.work_date
        using errcode = 'P2603';
    end if;
  end loop;

  workers_calculated := 0;
  detail_rows_created := 0;
  rows_skipped := 0;

  for worker_row in
    select distinct transport_daily_attendance.transport_worker_id
    from public.transport_daily_attendance
    join public.transport_daily_entries
      on transport_daily_entries.id =
        transport_daily_attendance.transport_daily_entry_id
      and transport_daily_entries.factory_id =
        transport_daily_attendance.factory_id
    where transport_daily_attendance.factory_id = p_factory_id
      and transport_daily_entries.work_date >= p_week_start
      and transport_daily_entries.work_date <= p_week_start + 6
    order by transport_daily_attendance.transport_worker_id
  loop
    select sum(
      (
        transport_daily_entries.paya_quantity
        * transport_crew_wage_rates.rate_per_paya
      ) / attendance_totals.attendance_count
    )
      into weekly_amount
    from public.transport_daily_attendance
    join public.transport_daily_entries
      on transport_daily_entries.id =
        transport_daily_attendance.transport_daily_entry_id
      and transport_daily_entries.factory_id =
        transport_daily_attendance.factory_id
    cross join lateral (
      select count(*)::numeric as attendance_count
      from public.transport_daily_attendance as counted_attendance
      where counted_attendance.factory_id = p_factory_id
        and counted_attendance.transport_daily_entry_id =
          transport_daily_entries.id
    ) as attendance_totals
    join public.transport_crew_wage_rates
      on transport_crew_wage_rates.factory_id = p_factory_id
      and transport_crew_wage_rates.transport_crew_id =
        transport_daily_entries.transport_crew_id
      and transport_crew_wage_rates.effective_from <=
        transport_daily_entries.work_date
      and (
        transport_crew_wage_rates.effective_to is null
        or transport_crew_wage_rates.effective_to >=
          transport_daily_entries.work_date
      )
    where transport_daily_attendance.factory_id = p_factory_id
      and transport_daily_attendance.transport_worker_id =
        worker_row.transport_worker_id
      and transport_daily_entries.work_date >= p_week_start
      and transport_daily_entries.work_date <= p_week_start + 6;

    insert into public.transport_weekly_earnings (
      factory_id,
      transport_worker_id,
      week_start,
      total_amount
    ) values (
      p_factory_id,
      worker_row.transport_worker_id,
      p_week_start,
      weekly_amount
    )
    returning id into created_earning_id;

    insert into public.transport_weekly_earning_details (
      factory_id,
      transport_weekly_earning_id,
      transport_worker_id,
      week_start,
      transport_daily_entry_id,
      transport_crew_id,
      work_date,
      transport_crew_wage_rate_id,
      rate_per_paya_snapshot,
      paya_quantity_snapshot,
      attendance_count_snapshot,
      daily_crew_pool_snapshot,
      worker_daily_share_snapshot
    )
    select
      p_factory_id,
      created_earning_id,
      worker_row.transport_worker_id,
      p_week_start,
      transport_daily_entries.id,
      transport_daily_entries.transport_crew_id,
      transport_daily_entries.work_date,
      transport_crew_wage_rates.id,
      transport_crew_wage_rates.rate_per_paya,
      transport_daily_entries.paya_quantity,
      attendance_totals.attendance_count,
      transport_daily_entries.paya_quantity
        * transport_crew_wage_rates.rate_per_paya,
      (
        transport_daily_entries.paya_quantity
        * transport_crew_wage_rates.rate_per_paya
      ) / attendance_totals.attendance_count
    from public.transport_daily_attendance
    join public.transport_daily_entries
      on transport_daily_entries.id =
        transport_daily_attendance.transport_daily_entry_id
      and transport_daily_entries.factory_id =
        transport_daily_attendance.factory_id
    cross join lateral (
      select count(*)::integer as attendance_count
      from public.transport_daily_attendance as counted_attendance
      where counted_attendance.factory_id = p_factory_id
        and counted_attendance.transport_daily_entry_id =
          transport_daily_entries.id
    ) as attendance_totals
    join public.transport_crew_wage_rates
      on transport_crew_wage_rates.factory_id = p_factory_id
      and transport_crew_wage_rates.transport_crew_id =
        transport_daily_entries.transport_crew_id
      and transport_crew_wage_rates.effective_from <=
        transport_daily_entries.work_date
      and (
        transport_crew_wage_rates.effective_to is null
        or transport_crew_wage_rates.effective_to >=
          transport_daily_entries.work_date
      )
    where transport_daily_attendance.factory_id = p_factory_id
      and transport_daily_attendance.transport_worker_id =
        worker_row.transport_worker_id
      and transport_daily_entries.work_date >= p_week_start
      and transport_daily_entries.work_date <= p_week_start + 6
    order by transport_daily_entries.work_date,
      transport_daily_entries.transport_crew_id,
      transport_daily_entries.id;

    get diagnostics inserted_detail_count = row_count;
    workers_calculated := workers_calculated + 1;
    detail_rows_created := detail_rows_created + inserted_detail_count;
  end loop;

  return next;
end;
$$;

revoke all on function public.calculate_transport_weekly_wages(uuid, date)
  from public;
revoke all on function public.calculate_transport_weekly_wages(uuid, date)
  from anon;
grant execute on function public.calculate_transport_weekly_wages(uuid, date)
  to authenticated;
