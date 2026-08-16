create or replace function public.assign_labourer_to_production_crew(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_production_crew_id uuid,
  p_effective_from date
)
returns public.production_crew_assignments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  latest_assignment public.production_crew_assignments%rowtype;
  new_assignment public.production_crew_assignments%rowtype;
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

  if p_labourer_id is null or not exists (
    select 1
    from public.labourers
    where labourers.id = p_labourer_id
      and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_production_crew_id is null or not exists (
    select 1
    from public.production_crews
    where production_crews.id = p_production_crew_id
      and production_crews.factory_id = p_factory_id
  ) then
    raise exception 'Production crew does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'effective_from must be a finite calendar date.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('production_crew_assignment:' || p_labourer_id::text)
  );

  select *
    into latest_assignment
  from public.production_crew_assignments
  where production_crew_assignments.factory_id = p_factory_id
    and production_crew_assignments.labourer_id = p_labourer_id
  order by production_crew_assignments.effective_from desc,
    production_crew_assignments.id desc
  limit 1
  for update;

  if found then
    if p_effective_from <= latest_assignment.effective_from then
      raise exception 'effective_from must be later than the latest assignment start (%).',
        latest_assignment.effective_from
        using errcode = 'P0001';
    end if;

    if latest_assignment.effective_to is null then
      if latest_assignment.production_crew_id = p_production_crew_id then
        raise exception 'Labourer already has an open assignment to this production crew.'
          using errcode = 'P0001';
      end if;

      update public.production_crew_assignments
      set effective_to = p_effective_from - 1
      where id = latest_assignment.id;
    elsif p_effective_from <= latest_assignment.effective_to then
      raise exception 'effective_from must be later than the latest assignment end (%).',
        latest_assignment.effective_to
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.production_crew_assignments (
    factory_id,
    labourer_id,
    production_crew_id,
    effective_from,
    effective_to
  )
  values (
    p_factory_id,
    p_labourer_id,
    p_production_crew_id,
    p_effective_from,
    null
  )
  returning * into new_assignment;

  return new_assignment;
end;
$$;

create or replace function public.end_labourer_production_crew_assignment(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_effective_to date
)
returns public.production_crew_assignments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  open_assignment public.production_crew_assignments%rowtype;
  ended_assignment public.production_crew_assignments%rowtype;
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

  if p_labourer_id is null or not exists (
    select 1
    from public.labourers
    where labourers.id = p_labourer_id
      and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_effective_to is null or not isfinite(p_effective_to) then
    raise exception 'effective_to must be a finite calendar date.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('production_crew_assignment:' || p_labourer_id::text)
  );

  select *
    into open_assignment
  from public.production_crew_assignments
  where production_crew_assignments.factory_id = p_factory_id
    and production_crew_assignments.labourer_id = p_labourer_id
    and production_crew_assignments.effective_to is null
  order by production_crew_assignments.effective_from desc,
    production_crew_assignments.id desc
  limit 1
  for update;

  if not found then
    raise exception 'Labourer has no open production crew assignment to end.'
      using errcode = 'P0001';
  end if;

  if p_effective_to < open_assignment.effective_from then
    raise exception 'effective_to cannot be before the open assignment start (%).',
      open_assignment.effective_from
      using errcode = 'P0001';
  end if;

  update public.production_crew_assignments
  set effective_to = p_effective_to
  where id = open_assignment.id
  returning * into ended_assignment;

  return ended_assignment;
end;
$$;

revoke insert, update, delete on public.production_crew_assignments from authenticated;
grant select on public.production_crew_assignments to authenticated;

drop policy if exists "Authenticated users can insert their factory production crew assignments"
  on public.production_crew_assignments;

drop policy if exists "Authenticated users can update their factory production crew assignments"
  on public.production_crew_assignments;

revoke all on function public.assign_labourer_to_production_crew(uuid, uuid, uuid, date) from public;
revoke all on function public.assign_labourer_to_production_crew(uuid, uuid, uuid, date) from anon;
grant execute on function public.assign_labourer_to_production_crew(uuid, uuid, uuid, date) to authenticated;

revoke all on function public.end_labourer_production_crew_assignment(uuid, uuid, date) from public;
revoke all on function public.end_labourer_production_crew_assignment(uuid, uuid, date) from anon;
grant execute on function public.end_labourer_production_crew_assignment(uuid, uuid, date) to authenticated;
