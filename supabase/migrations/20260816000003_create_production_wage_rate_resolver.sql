create or replace function public.resolve_production_wage_rate(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_work_date date
)
returns table (
  production_wage_rate_id uuid,
  rate_per_1000_bricks numeric,
  rate_source text,
  production_crew_id uuid
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  matching_rate_count integer;
  matching_assignment_count integer;
  matched_rate public.production_wage_rates%rowtype;
  matched_assignment public.production_crew_assignments%rowtype;
begin
  if p_factory_id is null then
    raise exception 'factory_id is required.'
      using errcode = '22023';
  end if;

  if p_labourer_id is null then
    raise exception 'labourer_id is required.'
      using errcode = '22023';
  end if;

  if p_work_date is null then
    raise exception 'work_date is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.labourers
    where labourers.id = p_labourer_id
      and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.'
      using errcode = 'P2401';
  end if;

  select count(*)
    into matching_rate_count
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.labourer_id = p_labourer_id
      and production_wage_rates.production_crew_id is null
      and production_wage_rates.effective_from <= p_work_date
      and (
        production_wage_rates.effective_to is null
        or production_wage_rates.effective_to >= p_work_date
      );

  if matching_rate_count > 1 then
    raise exception 'Multiple individual production-rate overrides apply to labourer % on %.',
      p_labourer_id,
      p_work_date
      using errcode = 'P2404';
  end if;

  if matching_rate_count = 1 then
    select *
      into matched_rate
      from public.production_wage_rates
      where production_wage_rates.factory_id = p_factory_id
        and production_wage_rates.labourer_id = p_labourer_id
        and production_wage_rates.production_crew_id is null
        and production_wage_rates.effective_from <= p_work_date
        and (
          production_wage_rates.effective_to is null
          or production_wage_rates.effective_to >= p_work_date
        );

    production_wage_rate_id := matched_rate.id;
    rate_per_1000_bricks := matched_rate.rate_per_1000_bricks;
    rate_source := 'individual_override';
    production_crew_id := null;
    return next;
    return;
  end if;

  select count(*)
    into matching_assignment_count
    from public.production_crew_assignments
    where production_crew_assignments.factory_id = p_factory_id
      and production_crew_assignments.labourer_id = p_labourer_id
      and production_crew_assignments.effective_from <= p_work_date
      and (
        production_crew_assignments.effective_to is null
        or production_crew_assignments.effective_to >= p_work_date
      );

  if matching_assignment_count = 0 then
    raise exception 'No production crew assignment applies to labourer % on %.',
      p_labourer_id,
      p_work_date
      using errcode = 'P2402';
  end if;

  if matching_assignment_count > 1 then
    raise exception 'Multiple production crew assignments apply to labourer % on %.',
      p_labourer_id,
      p_work_date
      using errcode = 'P2405';
  end if;

  select *
    into matched_assignment
    from public.production_crew_assignments
    where production_crew_assignments.factory_id = p_factory_id
      and production_crew_assignments.labourer_id = p_labourer_id
      and production_crew_assignments.effective_from <= p_work_date
      and (
        production_crew_assignments.effective_to is null
        or production_crew_assignments.effective_to >= p_work_date
      );

  select count(*)
    into matching_rate_count
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.production_crew_id = matched_assignment.production_crew_id
      and production_wage_rates.labourer_id is null
      and production_wage_rates.effective_from <= p_work_date
      and (
        production_wage_rates.effective_to is null
        or production_wage_rates.effective_to >= p_work_date
      );

  if matching_rate_count = 0 then
    raise exception 'No crew-default production rate applies to crew % on %.',
      matched_assignment.production_crew_id,
      p_work_date
      using errcode = 'P2403';
  end if;

  if matching_rate_count > 1 then
    raise exception 'Multiple crew-default production rates apply to crew % on %.',
      matched_assignment.production_crew_id,
      p_work_date
      using errcode = 'P2406';
  end if;

  select *
    into matched_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.production_crew_id = matched_assignment.production_crew_id
      and production_wage_rates.labourer_id is null
      and production_wage_rates.effective_from <= p_work_date
      and (
        production_wage_rates.effective_to is null
        or production_wage_rates.effective_to >= p_work_date
      );

  production_wage_rate_id := matched_rate.id;
  rate_per_1000_bricks := matched_rate.rate_per_1000_bricks;
  rate_source := 'crew_default';
  production_crew_id := matched_assignment.production_crew_id;
  return next;
end;
$$;

revoke all on function public.resolve_production_wage_rate(uuid, uuid, date) from public;
revoke all on function public.resolve_production_wage_rate(uuid, uuid, date) from anon;
revoke all on function public.resolve_production_wage_rate(uuid, uuid, date) from authenticated;
