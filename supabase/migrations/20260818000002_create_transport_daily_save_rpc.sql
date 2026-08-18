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

  if exists (
    select 1
    from public.transport_daily_attendance
    where transport_daily_attendance.factory_id = p_factory_id
      and transport_daily_attendance.work_date = p_work_date
      and transport_daily_attendance.transport_crew_id <> p_transport_crew_id
      and transport_daily_attendance.transport_worker_id = any(p_transport_worker_ids)
  ) then
    raise exception 'One or more transport workers already attend another crew on this work date.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from unnest(p_transport_worker_ids) as supplied_workers(worker_id)
    where not exists (
      select 1
      from public.transport_crew_memberships
      where transport_crew_memberships.factory_id = p_factory_id
        and transport_crew_memberships.transport_worker_id = supplied_workers.worker_id
        and transport_crew_memberships.transport_crew_id = p_transport_crew_id
        and transport_crew_memberships.effective_from <= p_work_date
        and (
          transport_crew_memberships.effective_to is null
          or transport_crew_memberships.effective_to >= p_work_date
        )
    )
  ) then
    raise exception 'One or more transport workers are not members of this crew on the work date.'
      using errcode = '23514';
  end if;

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

  if found then
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

  begin
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
  exception
    when unique_violation then
      raise exception 'One or more transport workers already attend another crew on this work date.'
        using errcode = '23505';
  end;

  daily_entry_id := saved_entry.id;
  attendance_count := cardinality(p_transport_worker_ids);
  saved_paya_quantity := saved_entry.paya_quantity;
  return next;
end;
$$;

revoke all on function public.save_transport_daily_entry(
  uuid, uuid, date, numeric, uuid[]
) from public;
revoke all on function public.save_transport_daily_entry(
  uuid, uuid, date, numeric, uuid[]
) from anon;
grant execute on function public.save_transport_daily_entry(
  uuid, uuid, date, numeric, uuid[]
) to authenticated;
