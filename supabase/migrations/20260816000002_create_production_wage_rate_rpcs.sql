create or replace function public.create_production_crew_wage_rate(
  p_factory_id uuid,
  p_production_crew_id uuid,
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns public.production_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.production_wage_rates%rowtype;
  new_rate public.production_wage_rates%rowtype;
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

  if p_production_crew_id is null or not exists (
    select 1
    from public.production_crews
    where production_crews.id = p_production_crew_id
      and production_crews.factory_id = p_factory_id
  ) then
    raise exception 'Production crew does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_rate_per_1000_bricks is null
    or p_rate_per_1000_bricks <= 0
    or p_rate_per_1000_bricks = 'NaN'::numeric then
    raise exception 'rate_per_1000_bricks must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_effective_from is null then
    raise exception 'effective_from is required.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('production_crew_wage_rate:' || p_production_crew_id::text)
  );

  select *
    into previous_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.production_crew_id = p_production_crew_id
      and production_wage_rates.labourer_id is null
    order by production_wage_rates.effective_from desc, production_wage_rates.id desc
    limit 1
    for update;

  if found then
    if p_effective_from <= previous_rate.effective_from then
      raise exception 'effective_from must be later than the latest crew rate start (%).',
        previous_rate.effective_from
        using errcode = 'P0001';
    end if;

    if previous_rate.effective_to is not null then
      raise exception 'Latest crew rate must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;

    update public.production_wage_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.production_wage_rates (
    factory_id,
    production_crew_id,
    labourer_id,
    rate_per_1000_bricks,
    effective_from,
    effective_to
  )
  values (
    p_factory_id,
    p_production_crew_id,
    null,
    p_rate_per_1000_bricks,
    p_effective_from,
    null
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

create or replace function public.create_labourer_production_wage_rate_override(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns public.production_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.production_wage_rates%rowtype;
  new_rate public.production_wage_rates%rowtype;
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

  if p_rate_per_1000_bricks is null
    or p_rate_per_1000_bricks <= 0
    or p_rate_per_1000_bricks = 'NaN'::numeric then
    raise exception 'rate_per_1000_bricks must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_effective_from is null then
    raise exception 'effective_from is required.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('labourer_production_wage_rate:' || p_labourer_id::text)
  );

  select *
    into previous_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.labourer_id = p_labourer_id
      and production_wage_rates.production_crew_id is null
    order by production_wage_rates.effective_from desc, production_wage_rates.id desc
    limit 1
    for update;

  if found then
    if p_effective_from <= previous_rate.effective_from then
      raise exception 'effective_from must be later than the latest labourer override start (%).',
        previous_rate.effective_from
        using errcode = 'P0001';
    end if;

    if previous_rate.effective_to is not null then
      raise exception 'Latest labourer override must be open-ended before adding a replacement.'
        using errcode = 'P0001';
    end if;

    update public.production_wage_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.production_wage_rates (
    factory_id,
    production_crew_id,
    labourer_id,
    rate_per_1000_bricks,
    effective_from,
    effective_to
  )
  values (
    p_factory_id,
    null,
    p_labourer_id,
    p_rate_per_1000_bricks,
    p_effective_from,
    null
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

revoke insert, update, delete on public.production_wage_rates from authenticated;
grant select on public.production_wage_rates to authenticated;

revoke all on function public.create_production_crew_wage_rate(uuid, uuid, numeric, date) from public;
revoke all on function public.create_production_crew_wage_rate(uuid, uuid, numeric, date) from anon;
grant execute on function public.create_production_crew_wage_rate(uuid, uuid, numeric, date) to authenticated;

revoke all on function public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date) from public;
revoke all on function public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date) from anon;
grant execute on function public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date) to authenticated;
