-- Atlas Security 12D1.5D2A: freeze finalized Transport source inputs.
-- PREPARED ONLY: apply to Test only after review; no historical data rewrites.
-- 12D1.5D + correction credits in 12D1.5E are ONE RELEASE UNIT.
-- Never promote source freezing alone to Main.
--
-- All three RPCs share the factory-only bigint transaction advisory key:
-- hashtextextended('atlas:transport_source_accounting:' || factory_uuid, 0).
-- This is a new logical namespace, distinct from existing operation-specific
-- two-int locks and existing bigint provisioning/supplier lock namespaces.
-- Acquire it before all existing operation advisory/row locks; preserve those.
-- Sequential verification does NOT prove concurrent deadlock freedom or hosted
-- RPC snapshot behavior. Simultaneous-session verification remains outstanding.
-- CREATE OR REPLACE preserves existing function ownership and role ACLs.
begin;

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

  -- Lock order: factory Transport source accounting -> existing operation lock
  -- -> existing row locks. The bigint namespace is separate from two-int keys.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'atlas:transport_source_accounting:' || p_factory_id::text, 0
    )
  );

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

create or replace function public.save_transport_daily_entry(
  p_factory_id uuid,
  p_transport_crew_id uuid,
  p_work_date date,
  p_paya_quantity numeric,
  p_transport_worker_ids uuid[]
)
returns table (
  daily_entry_id uuid,
  attendance_count integer,
  saved_paya_quantity numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_entry public.transport_daily_entries%rowtype;
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

  if p_transport_crew_id is null or not exists (
    select 1
    from public.transport_crews
    where transport_crews.id = p_transport_crew_id
      and transport_crews.factory_id = p_factory_id
  ) then
    raise exception 'Transport crew does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_work_date is null or not isfinite(p_work_date) then
    raise exception 'work_date must be a finite calendar date.'
      using errcode = '22023';
  end if;

  if p_paya_quantity is null
    or p_paya_quantity <= 0
    or p_paya_quantity = 'NaN'::numeric then
    raise exception 'paya_quantity must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_transport_worker_ids is null
    or cardinality(p_transport_worker_ids) = 0 then
    raise exception 'At least one transport worker is required.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_transport_worker_ids) as supplied_workers(worker_id)
    where supplied_workers.worker_id is null
  ) then
    raise exception 'Transport worker IDs cannot contain NULL.'
      using errcode = '22023';
  end if;

  if cardinality(p_transport_worker_ids) <> (
    select count(distinct supplied_workers.worker_id)
    from unnest(p_transport_worker_ids) as supplied_workers(worker_id)
  ) then
    raise exception 'Transport worker IDs cannot contain duplicates.'
      using errcode = '22023';
  end if;

  -- Lock order: factory Transport source accounting -> existing operation lock
  -- -> existing row locks. The bigint namespace is separate from two-int keys.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'atlas:transport_source_accounting:' || p_factory_id::text, 0
    )
  );

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext(
      'transport_daily_entry:'
      || p_transport_crew_id::text
      || ':'
      || p_work_date::text
    )
  );

  select *
    into saved_entry
  from public.transport_daily_entries
  where transport_daily_entries.factory_id = p_factory_id
    and transport_daily_entries.transport_crew_id = p_transport_crew_id
    and transport_daily_entries.work_date = p_work_date
  for update;

  if exists (
    select 1
    from unnest(p_transport_worker_ids) as supplied_workers(worker_id)
    where not exists (
      select 1
      from public.transport_workers
      where transport_workers.id = supplied_workers.worker_id
        and transport_workers.factory_id = p_factory_id
    )
  ) then
    raise exception 'One or more transport workers do not belong to this factory.'
      using errcode = '42501';
  end if;

  perform 1
  from public.transport_workers
  where transport_workers.factory_id = p_factory_id
    and transport_workers.id = any(p_transport_worker_ids)
  for share;

  perform 1
  from public.transport_crew_assignments
  where transport_crew_assignments.factory_id = p_factory_id
    and transport_crew_assignments.transport_crew_id = p_transport_crew_id
    and transport_crew_assignments.transport_worker_id = any(p_transport_worker_ids)
  for key share;

  if exists (
    select 1
    from unnest(p_transport_worker_ids) as supplied_workers(worker_id)
    where not (
      exists (
        select 1
        from public.transport_workers
        where transport_workers.id = supplied_workers.worker_id
          and transport_workers.factory_id = p_factory_id
          and transport_workers.is_active = true
      )
      and exists (
        select 1
        from public.transport_crew_assignments
        where transport_crew_assignments.factory_id = p_factory_id
          and transport_crew_assignments.transport_worker_id = supplied_workers.worker_id
          and transport_crew_assignments.transport_crew_id = p_transport_crew_id
      )
    )
    and not (
      saved_entry.id is not null
      and exists (
        select 1
        from public.transport_daily_attendance
        where transport_daily_attendance.factory_id = p_factory_id
          and transport_daily_attendance.transport_daily_entry_id = saved_entry.id
          and transport_daily_attendance.transport_worker_id = supplied_workers.worker_id
      )
    )
  ) then
    raise exception 'One or more transport workers are inactive or not assigned to this crew.'
      using errcode = '23514';
  end if;

  -- Any worker header freezes the whole factory/Monday-start week.
  -- Keep original input/worker validations above; reject before any source write.
  if exists (
    select 1
    from public.transport_weekly_earnings
    where transport_weekly_earnings.factory_id = p_factory_id
      and transport_weekly_earnings.week_start =
        p_work_date - (extract(isodow from p_work_date)::integer - 1)
  ) then
    raise exception 'ATLAS_TRANSPORT_WEEK_FINALIZED'
      using errcode = 'P2621';
  end if;

  if saved_entry.id is not null then
    update public.transport_daily_entries
    set paya_quantity = p_paya_quantity
    where transport_daily_entries.id = saved_entry.id
      and transport_daily_entries.factory_id = p_factory_id
    returning * into saved_entry;

    delete from public.transport_daily_attendance
    where transport_daily_attendance.transport_daily_entry_id = saved_entry.id
      and transport_daily_attendance.factory_id = p_factory_id;
  else
    insert into public.transport_daily_entries (
      factory_id,
      transport_crew_id,
      work_date,
      paya_quantity
    )
    values (
      p_factory_id,
      p_transport_crew_id,
      p_work_date,
      p_paya_quantity
    )
    returning * into saved_entry;
  end if;

  insert into public.transport_daily_attendance (
    factory_id,
    transport_daily_entry_id,
    transport_crew_id,
    transport_worker_id,
    work_date
  )
  select
    p_factory_id,
    saved_entry.id,
    p_transport_crew_id,
    supplied_workers.worker_id,
    p_work_date
  from unnest(p_transport_worker_ids) as supplied_workers(worker_id);

  daily_entry_id := saved_entry.id;
  attendance_count := cardinality(p_transport_worker_ids);
  saved_paya_quantity := saved_entry.paya_quantity;
  return next;
end;
$$;

create or replace function public.create_transport_crew_wage_rate(
  p_factory_id uuid,
  p_transport_crew_id uuid,
  p_effective_from date,
  p_rate_per_paya numeric
)
returns public.transport_crew_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.transport_crew_wage_rates%rowtype;
  new_rate public.transport_crew_wage_rates%rowtype;
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

  if p_transport_crew_id is null or not exists (
    select 1
    from public.transport_crews
    where transport_crews.id = p_transport_crew_id
      and transport_crews.factory_id = p_factory_id
  ) then
    raise exception 'Transport crew does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_rate_per_paya is null
    or p_rate_per_paya <= 0
    or p_rate_per_paya = 'NaN'::numeric then
    raise exception 'rate_per_paya must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'effective_from must be a finite calendar date.'
      using errcode = '22023';
  end if;

  -- Lock order: factory Transport source accounting -> existing operation lock
  -- -> existing row locks. The bigint namespace is separate from two-int keys.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'atlas:transport_source_accounting:' || p_factory_id::text, 0
    )
  );

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('transport_crew_wage_rate:' || p_transport_crew_id::text)
  );

  select *
    into previous_rate
    from public.transport_crew_wage_rates
    where transport_crew_wage_rates.factory_id = p_factory_id
      and transport_crew_wage_rates.transport_crew_id = p_transport_crew_id
    order by transport_crew_wage_rates.effective_from desc,
      transport_crew_wage_rates.id desc
    limit 1
    for update;

  if found then
    if p_effective_from = previous_rate.effective_from then
      raise exception 'A transport crew wage rate already starts on %.',
        previous_rate.effective_from
        using errcode = 'P0001';
    end if;

    if p_effective_from < previous_rate.effective_from then
      raise exception 'Backdated transport crew wage rates are not allowed; effective_from must be later than the latest rate start (%).',
        previous_rate.effective_from
        using errcode = 'P0001';
    end if;

    if previous_rate.effective_to is not null then
      raise exception 'Latest transport crew wage rate must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;

  end if;

  -- Original rate-order errors take precedence. A new open-ended rate changes
  -- rate identity/value on and after its start, so protect actual saved dates,
  -- not a conservative whole-week cutoff. No source/rate mutations precede this.
  if exists (
    select 1
    from public.transport_weekly_earning_details as detail
    join public.transport_weekly_earnings as earning
      on earning.id = detail.transport_weekly_earning_id
      and earning.factory_id = detail.factory_id
      and earning.transport_worker_id = detail.transport_worker_id
      and earning.week_start = detail.week_start
    where detail.factory_id = p_factory_id
      and detail.transport_crew_id = p_transport_crew_id
      and detail.work_date >= p_effective_from
  ) then
    raise exception 'ATLAS_TRANSPORT_RATE_AFFECTS_FINALIZED_EARNINGS'
      using errcode = 'P2622';
  end if;

  if previous_rate.id is not null then
    update public.transport_crew_wage_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.transport_crew_wage_rates (
    factory_id,
    transport_crew_id,
    rate_per_paya,
    effective_from,
    effective_to
  )
  values (
    p_factory_id,
    p_transport_crew_id,
    p_rate_per_paya,
    p_effective_from,
    null
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

-- Preserve exact-function PUBLIC/anon hardening and authenticated access.
-- Do not revoke or alter service_role grants, ownership or managed defaults.
revoke execute on function public.calculate_transport_weekly_wages(uuid, date)
  from public, anon;
grant execute on function public.calculate_transport_weekly_wages(uuid, date)
  to authenticated;
revoke execute on function public.save_transport_daily_entry(uuid, uuid, date, numeric, uuid[])
  from public, anon;
grant execute on function public.save_transport_daily_entry(uuid, uuid, date, numeric, uuid[])
  to authenticated;
revoke execute on function public.create_transport_crew_wage_rate(uuid, uuid, date, numeric)
  from public, anon;
grant execute on function public.create_transport_crew_wage_rate(uuid, uuid, date, numeric)
  to authenticated;

commit;
