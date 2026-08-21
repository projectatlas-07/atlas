-- Repair legacy Staff salary starts without permitting general history edits.
--
-- The original Staff UI could store a monthly rate on an arbitrary day. Monthly
-- earnings resolve on the first day of each month, so the existing creation RPCs
-- now treat a same-amount, earlier month-start as a boundary correction. They
-- still append every genuine salary change.

create or replace function public.create_staff_category_monthly_salary(
  p_factory_id uuid,
  p_staff_category_id uuid,
  p_monthly_salary numeric,
  p_effective_from date
)
returns public.staff_monthly_salary_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.staff_monthly_salary_rates%rowtype;
  correction_rate public.staff_monthly_salary_rates%rowtype;
  new_rate public.staff_monthly_salary_rates%rowtype;
  worker_to_lock record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_staff_category_id is null or not exists (
    select 1 from public.staff_categories
    where staff_categories.id = p_staff_category_id
      and staff_categories.factory_id = p_factory_id
  ) then
    raise exception 'Staff category does not belong to this factory.' using errcode = '42501';
  end if;

  if p_monthly_salary is null or p_monthly_salary <= 0
    or p_monthly_salary = 'NaN'::numeric then
    raise exception 'monthly_salary must be greater than zero.' using errcode = '22023';
  end if;

  if p_effective_from is null
    or p_effective_from in ('infinity'::date, '-infinity'::date) then
    raise exception 'effective_from must be a finite date.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_category_monthly_salary:' || p_staff_category_id::text)
  );

  select * into previous_rate
  from public.staff_monthly_salary_rates
  where factory_id = p_factory_id
    and staff_category_id = p_staff_category_id
    and staff_worker_id is null
  order by effective_from desc, id desc
  limit 1 for update;

  if found then
    if previous_rate.effective_to is not null then
      raise exception 'Latest category salary must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;

    select * into correction_rate
    from public.staff_monthly_salary_rates
    where factory_id = p_factory_id
      and staff_category_id = p_staff_category_id
      and staff_worker_id is null
    order by effective_from, id
    limit 1 for update;

    if p_effective_from = correction_rate.effective_from then
      if p_monthly_salary <> correction_rate.monthly_salary then
        raise exception 'A category salary already starts on this date with a different amount.'
          using errcode = 'P0001';
      end if;
      return correction_rate;
    end if;

    if p_effective_from < correction_rate.effective_from then
      if p_effective_from <> date_trunc('month', p_effective_from)::date then
        raise exception 'A corrected category salary start must be the first day of a month.'
          using errcode = '22023';
      end if;
      if p_monthly_salary <> correction_rate.monthly_salary then
        raise exception 'A salary boundary correction cannot change the existing monthly salary amount.'
          using errcode = 'P0001';
      end if;

      -- Serialize against every monthly earning materializer this category can
      -- affect. Worker/category identity is immutable, so this set is stable.
      for worker_to_lock in
        select id from public.staff_workers
        where factory_id = p_factory_id
          and staff_category_id = p_staff_category_id
        order by id
      loop
        perform pg_advisory_xact_lock(
          hashtext(p_factory_id::text),
          hashtext('staff_salary_lifecycle:' || worker_to_lock.id::text)
        );
      end loop;

      if exists (
        select 1 from public.staff_monthly_salary_rates as other_rate
        where other_rate.factory_id = p_factory_id
          and other_rate.staff_category_id = p_staff_category_id
          and other_rate.staff_worker_id is null
          and other_rate.id <> correction_rate.id
          and daterange(other_rate.effective_from, other_rate.effective_to, '[]')
            && daterange(p_effective_from, correction_rate.effective_to, '[]')
      ) then
        raise exception 'Corrected category salary start would overlap existing salary history.'
          using errcode = 'P0001';
      end if;

      if exists (
        select 1 from public.staff_monthly_earnings as earning
        where earning.factory_id = p_factory_id
          and earning.staff_category_id_snapshot = p_staff_category_id
          and earning.salary_month >= p_effective_from
          and earning.salary_month < correction_rate.effective_from
          and not (
            earning.salary_source_snapshot = 'STAFF_OVERRIDE'
            or (
              earning.salary_source_snapshot = 'CATEGORY_DEFAULT'
              and earning.salary_configuration_id = correction_rate.id
              and earning.resolved_monthly_salary_snapshot = correction_rate.monthly_salary
            )
          )
      ) then
        raise exception 'Category salary boundary correction would contradict immutable Staff monthly earnings.'
          using errcode = 'P2511';
      end if;

      update public.staff_monthly_salary_rates
      set effective_from = p_effective_from
      where id = correction_rate.id
        and factory_id = p_factory_id
      returning * into correction_rate;

      return correction_rate;
    end if;

    if p_effective_from <= previous_rate.effective_from then
      raise exception 'effective_from must be later than the latest category salary start (%).',
        previous_rate.effective_from using errcode = 'P0001';
    end if;

    update public.staff_monthly_salary_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.staff_monthly_salary_rates (
    factory_id, staff_category_id, staff_worker_id,
    monthly_salary, effective_from, effective_to
  ) values (
    p_factory_id, p_staff_category_id, null,
    p_monthly_salary, p_effective_from, null
  ) returning * into new_rate;

  return new_rate;
end;
$$;

create or replace function public.create_staff_monthly_salary_override(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_monthly_salary numeric,
  p_effective_from date
)
returns public.staff_monthly_salary_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.staff_monthly_salary_rates%rowtype;
  correction_rate public.staff_monthly_salary_rates%rowtype;
  new_rate public.staff_monthly_salary_rates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_staff_worker_id is null or not exists (
    select 1 from public.staff_workers
    where staff_workers.id = p_staff_worker_id
      and staff_workers.factory_id = p_factory_id
  ) then
    raise exception 'Staff worker does not belong to this factory.' using errcode = '42501';
  end if;

  if p_monthly_salary is null or p_monthly_salary <= 0
    or p_monthly_salary = 'NaN'::numeric then
    raise exception 'monthly_salary must be greater than zero.' using errcode = '22023';
  end if;

  if p_effective_from is null
    or p_effective_from in ('infinity'::date, '-infinity'::date) then
    raise exception 'effective_from must be a finite date.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_worker_monthly_salary:' || p_staff_worker_id::text)
  );

  select * into previous_rate
  from public.staff_monthly_salary_rates
  where factory_id = p_factory_id
    and staff_worker_id = p_staff_worker_id
    and staff_category_id is null
  order by effective_from desc, id desc
  limit 1 for update;

  if found then
    if previous_rate.effective_to is not null then
      raise exception 'Latest Staff override must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;

    select * into correction_rate
    from public.staff_monthly_salary_rates
    where factory_id = p_factory_id
      and staff_worker_id = p_staff_worker_id
      and staff_category_id is null
    order by effective_from, id
    limit 1 for update;

    if p_effective_from = correction_rate.effective_from then
      if p_monthly_salary <> correction_rate.monthly_salary then
        raise exception 'A Staff override already starts on this date with a different amount.'
          using errcode = 'P0001';
      end if;
      return correction_rate;
    end if;

    if p_effective_from < correction_rate.effective_from then
      if p_effective_from <> date_trunc('month', p_effective_from)::date then
        raise exception 'A corrected Staff override start must be the first day of a month.'
          using errcode = '22023';
      end if;
      if p_monthly_salary <> correction_rate.monthly_salary then
        raise exception 'A salary boundary correction cannot change the existing monthly salary amount.'
          using errcode = 'P0001';
      end if;

      perform pg_advisory_xact_lock(
        hashtext(p_factory_id::text),
        hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
      );

      if exists (
        select 1 from public.staff_monthly_salary_rates as other_rate
        where other_rate.factory_id = p_factory_id
          and other_rate.staff_worker_id = p_staff_worker_id
          and other_rate.staff_category_id is null
          and other_rate.id <> correction_rate.id
          and daterange(other_rate.effective_from, other_rate.effective_to, '[]')
            && daterange(p_effective_from, correction_rate.effective_to, '[]')
      ) then
        raise exception 'Corrected Staff override start would overlap existing salary history.'
          using errcode = 'P0001';
      end if;

      if exists (
        select 1 from public.staff_monthly_earnings as earning
        where earning.factory_id = p_factory_id
          and earning.staff_worker_id = p_staff_worker_id
          and earning.salary_month >= p_effective_from
          and earning.salary_month < correction_rate.effective_from
          and not (
            earning.salary_source_snapshot = 'STAFF_OVERRIDE'
            and earning.salary_configuration_id = correction_rate.id
            and earning.resolved_monthly_salary_snapshot = correction_rate.monthly_salary
          )
      ) then
        raise exception 'Staff override boundary correction would contradict immutable Staff monthly earnings.'
          using errcode = 'P2511';
      end if;

      update public.staff_monthly_salary_rates
      set effective_from = p_effective_from
      where id = correction_rate.id
        and factory_id = p_factory_id
      returning * into correction_rate;

      return correction_rate;
    end if;

    if p_effective_from <= previous_rate.effective_from then
      raise exception 'effective_from must be later than the latest Staff override start (%).',
        previous_rate.effective_from using errcode = 'P0001';
    end if;

    update public.staff_monthly_salary_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.staff_monthly_salary_rates (
    factory_id, staff_category_id, staff_worker_id,
    monthly_salary, effective_from, effective_to
  ) values (
    p_factory_id, null, p_staff_worker_id,
    p_monthly_salary, p_effective_from, null
  ) returning * into new_rate;

  return new_rate;
end;
$$;

revoke all on function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date) from public;
revoke all on function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date) from anon;
grant execute on function public.create_staff_category_monthly_salary(uuid, uuid, numeric, date) to authenticated;
revoke all on function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date) from public;
revoke all on function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date) from anon;
grant execute on function public.create_staff_monthly_salary_override(uuid, uuid, numeric, date) to authenticated;
