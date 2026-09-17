begin;

create or replace function public.set_mud_supply_rate(
  p_factory_id uuid,
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns public.wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_rate public.wage_rates%rowtype;
  next_rate public.wage_rates%rowtype;
  new_rate public.wage_rates%rowtype;
  previous_rate_found boolean;
  next_rate_found boolean;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_rate_per_1000_bricks is null or p_rate_per_1000_bricks <= 0
    or p_rate_per_1000_bricks = 'NaN'::numeric
    or p_rate_per_1000_bricks = 'Infinity'::numeric
    or p_rate_per_1000_bricks = '-Infinity'::numeric then
    raise exception 'Rate per 1,000 bricks must be a positive finite number.' using errcode = '22023';
  end if;
  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'Effective-from date must be a finite calendar date.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_factory_id::text), 2);

  if exists (
    select 1
    from public.wage_rates
    where wage_rates.factory_id = p_factory_id
      and wage_rates.applies_to = 'mud_supply'
      and wage_rates.effective_from = p_effective_from
  ) then
    raise exception 'A Mud rate already starts on %.', p_effective_from
      using errcode = 'P2601';
  end if;

  if exists (
    select 1
    from public.wage_rates as earlier_rate
    join public.wage_rates as later_rate
      on later_rate.factory_id = earlier_rate.factory_id
      and later_rate.applies_to = earlier_rate.applies_to
      and later_rate.id <> earlier_rate.id
      and later_rate.effective_from >= earlier_rate.effective_from
    where earlier_rate.factory_id = p_factory_id
      and earlier_rate.applies_to = 'mud_supply'
      and (
        earlier_rate.effective_to is null
        or earlier_rate.effective_to >= later_rate.effective_from
      )
  ) then
    raise exception 'Existing Mud rate history overlaps and must be corrected before setting a rate.'
      using errcode = 'P2602';
  end if;

  select * into previous_rate
  from public.wage_rates
  where wage_rates.factory_id = p_factory_id
    and wage_rates.applies_to = 'mud_supply'
    and wage_rates.effective_from < p_effective_from
  order by wage_rates.effective_from desc, wage_rates.id desc
  limit 1
  for update;
  previous_rate_found := found;

  select * into next_rate
  from public.wage_rates
  where wage_rates.factory_id = p_factory_id
    and wage_rates.applies_to = 'mud_supply'
    and wage_rates.effective_from > p_effective_from
  order by wage_rates.effective_from, wage_rates.id
  limit 1
  for update;
  next_rate_found := found;

  if previous_rate_found
    and (previous_rate.effective_to is null or previous_rate.effective_to >= p_effective_from) then
    update public.wage_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id
      and factory_id = p_factory_id;
  end if;

  insert into public.wage_rates (
    factory_id,
    applies_to,
    rate_per_1000_bricks,
    effective_from,
    effective_to
  ) values (
    p_factory_id,
    'mud_supply',
    p_rate_per_1000_bricks,
    p_effective_from,
    case when next_rate_found then next_rate.effective_from - 1 else null end
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

revoke all on function public.set_mud_supply_rate(uuid, numeric, date)
  from public, anon, authenticated;
grant execute on function public.set_mud_supply_rate(uuid, numeric, date)
  to authenticated;

comment on function public.set_mud_supply_rate(uuid, numeric, date) is
  'Sets one factory-level effective-dated Mud Supply rate, including safe backdated insertion.';

commit;
