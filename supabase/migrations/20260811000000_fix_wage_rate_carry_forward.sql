begin;

-- Repair only the identifiable legacy bug shape: a rate was capped on the
-- Sunday of its own starting week even though it should carry forward.
with ordered_rates as (
  select
    wage_rates.id,
    wage_rates.factory_id,
    wage_rates.applies_to,
    wage_rates.effective_from,
    wage_rates.effective_to,
    lead(wage_rates.effective_from) over (
      partition by wage_rates.factory_id, wage_rates.applies_to
      order by wage_rates.effective_from, wage_rates.id
    ) as next_effective_from
  from public.wage_rates
)
update public.wage_rates
set effective_to = case
  when ordered_rates.next_effective_from is null then null
  else ordered_rates.next_effective_from - 1
end
from ordered_rates
where wage_rates.id = ordered_rates.id
  and ordered_rates.effective_to = ordered_rates.effective_from + 6
  and (
    ordered_rates.next_effective_from is null
    or ordered_rates.next_effective_from > ordered_rates.effective_to + 1
  )
  and not exists (
    select 1
    from public.wage_rates as overlapping_rate
    where overlapping_rate.factory_id = ordered_rates.factory_id
      and overlapping_rate.applies_to = ordered_rates.applies_to
      and overlapping_rate.id <> ordered_rates.id
      and overlapping_rate.effective_from <= ordered_rates.effective_to
      and (
        overlapping_rate.effective_to is null
        or overlapping_rate.effective_to >= ordered_rates.effective_from
      )
  );

create or replace function public.create_wage_rate(
  p_factory_id uuid,
  p_applies_to text,
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
  new_rate public.wage_rates%rowtype;
  has_previous_rate boolean := false;
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

  if p_applies_to is null or p_applies_to not in ('production', 'mud_supply') then
    raise exception 'applies_to must be production or mud_supply.'
      using errcode = '22023';
  end if;

  if p_rate_per_1000_bricks is null
    or p_rate_per_1000_bricks <= 0
    or p_rate_per_1000_bricks = 'NaN'::numeric then
    raise exception 'rate_per_1000_bricks must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_effective_from is null or extract(isodow from p_effective_from) <> 1 then
    raise exception 'effective_from must be a Monday.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    case p_applies_to
      when 'production' then 1
      when 'mud_supply' then 2
    end
  );

  select *
    into previous_rate
    from public.wage_rates
    where wage_rates.factory_id = p_factory_id
      and wage_rates.applies_to = p_applies_to
    order by wage_rates.effective_from desc
    limit 1
    for update;

  has_previous_rate := found;

  if has_previous_rate and p_effective_from <= previous_rate.effective_from then
    raise exception 'effective_from must be later than the latest % wage rate (%).',
      p_applies_to,
      previous_rate.effective_from
      using errcode = 'P0001';
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
      and earlier_rate.applies_to = p_applies_to
      and (
        earlier_rate.effective_to is null
        or earlier_rate.effective_to >= later_rate.effective_from
      )
  ) then
    raise exception 'Existing % wage-rate history overlaps and must be corrected before adding a rate.', p_applies_to
      using errcode = 'P0001';
  end if;

  if has_previous_rate then
    update public.wage_rates
    set effective_to = p_effective_from - 1
    where id = previous_rate.id;
  end if;

  insert into public.wage_rates (
    factory_id,
    applies_to,
    rate_per_1000_bricks,
    effective_from,
    effective_to
  )
  values (
    p_factory_id,
    p_applies_to,
    p_rate_per_1000_bricks,
    p_effective_from,
    null
  )
  returning * into new_rate;

  return new_rate;
end;
$$;

revoke insert, update, delete on public.wage_rates from authenticated;
grant select on public.wage_rates to authenticated;

revoke all on function public.create_wage_rate(uuid, text, numeric, date) from public;
revoke all on function public.create_wage_rate(uuid, text, numeric, date) from anon;
grant execute on function public.create_wage_rate(uuid, text, numeric, date) to authenticated;

commit;
