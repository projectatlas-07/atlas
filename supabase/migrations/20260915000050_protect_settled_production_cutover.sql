-- Production Accounting Phase 2C: controlled saves and settled-date protection.
-- Daily uniqueness already exists as production_entries_factory_labourer_date_key.

create or replace function public.assert_production_date_is_unsettled(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_production_date date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  latest_cutoff date;
begin
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('production_account:' || p_labourer_id::text)
  );

  select max(settlements.settled_through)
  into latest_cutoff
  from public.production_earning_settlements as settlements
  where settlements.factory_id = p_factory_id
    and settlements.labourer_id = p_labourer_id;

  if latest_cutoff is not null and p_production_date <= latest_cutoff then
    raise exception 'Production through % is settled and cannot be changed.',
      to_char(latest_cutoff, 'FMDD Mon YYYY')
      using errcode = 'P2520';
  end if;
end;
$$;

revoke all on function public.assert_production_date_is_unsettled(uuid, uuid, date)
  from public, anon, authenticated;

create or replace function public.protect_settled_production_entry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.factory_id <> old.factory_id
    or new.labourer_id <> old.labourer_id
    or new.production_date <> old.production_date
    or new.brick_type_id <> old.brick_type_id
  ) then
    raise exception 'Production record identity and brick type snapshot cannot be changed.'
      using errcode = 'P2523';
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_production_date_is_unsettled(
      new.factory_id, new.labourer_id, new.production_date
    );
    return new;
  end if;

  perform public.assert_production_date_is_unsettled(
    old.factory_id, old.labourer_id, old.production_date
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.protect_settled_production_entry()
  from public, anon, authenticated;

create trigger production_entries_protect_settled_date
before insert or update or delete on public.production_entries
for each row execute function public.protect_settled_production_entry();

create or replace function public.save_production_entry(
  p_factory_id uuid,
  p_entry_id uuid,
  p_labourer_id uuid,
  p_brick_type_id uuid,
  p_production_date date,
  p_quantity integer
)
returns setof public.production_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_entry public.production_entries%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_entry_id is null or p_labourer_id is null or p_brick_type_id is null
    or p_production_date is null or not isfinite(p_production_date) then
    raise exception 'Entry, labourer, brick type, and finite Production date are required.'
      using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Production quantity must be greater than zero.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labourers
    where labourers.id = p_labourer_id and labourers.factory_id = p_factory_id
  ) then
    raise exception 'Labourer does not belong to this factory.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.brick_types
    where brick_types.id = p_brick_type_id and brick_types.factory_id = p_factory_id
  ) then
    raise exception 'Brick type does not belong to this factory.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.production_entries
    where production_entries.id = p_entry_id
      and (
        production_entries.factory_id <> p_factory_id
        or production_entries.labourer_id <> p_labourer_id
        or production_entries.production_date <> p_production_date
      )
  ) then
    raise exception 'Production entry does not belong to this labourer and date.' using errcode = '42501';
  end if;

  perform public.assert_production_date_is_unsettled(
    p_factory_id, p_labourer_id, p_production_date
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values (
    p_entry_id, p_factory_id, p_labourer_id, p_brick_type_id, p_production_date, p_quantity
  )
  on conflict (factory_id, labourer_id, production_date)
  do update set quantity = excluded.quantity
  returning * into saved_entry;

  return next saved_entry;
end;
$$;

revoke insert, update, delete on public.production_entries from authenticated;
revoke all on function public.save_production_entry(uuid, uuid, uuid, uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.save_production_entry(uuid, uuid, uuid, uuid, date, integer)
  to authenticated;

create or replace function public.set_production_labourer_rates(
  p_factory_id uuid,
  p_labourer_ids uuid[],
  p_rate_per_1000_bricks numeric,
  p_effective_from date
)
returns setof public.production_wage_rates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_labourer_id uuid;
  previous_rate public.production_wage_rates%rowtype;
  next_rate public.production_wage_rates%rowtype;
  new_rate public.production_wage_rates%rowtype;
  latest_cutoff date;
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

  if p_labourer_ids is null or cardinality(p_labourer_ids) = 0
    or cardinality(p_labourer_ids) > 500
    or array_position(p_labourer_ids, null) is not null
    or (select count(distinct selected.labourer_id)
        from unnest(p_labourer_ids) as selected(labourer_id))
      <> cardinality(p_labourer_ids) then
    raise exception 'Choose between 1 and 500 distinct labourers.' using errcode = '22023';
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
  if (
    select count(*)
    from public.labourers
    where labourers.factory_id = p_factory_id
      and labourers.id = any(p_labourer_ids)
      and labourers.is_active = true
  ) <> cardinality(p_labourer_ids) then
    raise exception 'Every selected labourer must be active and belong to this factory.' using errcode = '42501';
  end if;

  for selected_labourer_id in
    select selected.labourer_id
    from unnest(p_labourer_ids) as selected(labourer_id)
    order by selected.labourer_id
  loop
    perform pg_advisory_xact_lock(
      hashtext(p_factory_id::text),
      hashtext('production_account:' || selected_labourer_id::text)
    );

    select max(settlements.settled_through)
    into latest_cutoff
    from public.production_earning_settlements as settlements
    where settlements.factory_id = p_factory_id
      and settlements.labourer_id = selected_labourer_id;

    if latest_cutoff is not null and p_effective_from <= latest_cutoff then
      raise exception 'Production through % is settled; rates on or before that date cannot be changed.',
        to_char(latest_cutoff, 'FMDD Mon YYYY')
        using errcode = 'P2521';
    end if;

    if exists (
      select 1
      from public.production_wage_rates
      where production_wage_rates.factory_id = p_factory_id
        and production_wage_rates.labourer_id = selected_labourer_id
        and production_wage_rates.production_crew_id is null
        and production_wage_rates.effective_from = p_effective_from
    ) then
      raise exception 'A Production rate already starts for this labourer on %.', p_effective_from
        using errcode = 'P2408';
    end if;

    select * into previous_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.labourer_id = selected_labourer_id
      and production_wage_rates.production_crew_id is null
      and production_wage_rates.effective_from < p_effective_from
    order by production_wage_rates.effective_from desc, production_wage_rates.id desc
    limit 1
    for update;
    previous_rate_found := found;

    select * into next_rate
    from public.production_wage_rates
    where production_wage_rates.factory_id = p_factory_id
      and production_wage_rates.labourer_id = selected_labourer_id
      and production_wage_rates.production_crew_id is null
      and production_wage_rates.effective_from > p_effective_from
    order by production_wage_rates.effective_from, production_wage_rates.id
    limit 1
    for update;
    next_rate_found := found;

    if previous_rate_found
      and (previous_rate.effective_to is null or previous_rate.effective_to >= p_effective_from) then
      update public.production_wage_rates
      set effective_to = p_effective_from - 1
      where id = previous_rate.id and factory_id = p_factory_id;
    end if;

    insert into public.production_wage_rates (
      factory_id, production_crew_id, labourer_id, rate_per_1000_bricks,
      effective_from, effective_to
    ) values (
      p_factory_id, null, selected_labourer_id, p_rate_per_1000_bricks,
      p_effective_from,
      case when next_rate_found then next_rate.effective_from - 1 else null end
    )
    returning * into new_rate;

    return next new_rate;
  end loop;
end;
$$;

revoke all on function public.set_production_labourer_rates(uuid, uuid[], numeric, date)
  from public, anon, authenticated;
grant execute on function public.set_production_labourer_rates(uuid, uuid[], numeric, date)
  to authenticated;

-- Keep the legacy signature for old clients, but permanently close its write
-- path. Mud Supply uses calculate_mud_supply_wages and is unaffected.
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
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  raise exception 'Production earnings are continuous. Calculate Wages is no longer used.'
    using errcode = 'P2522';
end;
$$;

revoke all on function public.calculate_production_wages(uuid, date)
  from public, anon, authenticated;
grant execute on function public.calculate_production_wages(uuid, date)
  to authenticated;

comment on function public.save_production_entry(uuid, uuid, uuid, uuid, date, integer) is
  'Authoritative idempotent Production create/update path protected by the labourer account settlement lock.';
comment on function public.assert_production_date_is_unsettled(uuid, uuid, date) is
  'Private shared lock and cutoff guard used for every Production row mutation.';
comment on function public.calculate_production_wages(uuid, date) is
  'Disabled legacy Production weekly posting signature retained only to give old clients a controlled cutover error.';
