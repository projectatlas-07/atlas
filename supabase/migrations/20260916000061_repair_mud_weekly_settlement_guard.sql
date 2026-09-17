begin;

-- Forward repair: preserve the post-placeholder, one-group-per-factory-week
-- calculator while retaining the Phase 5B1 SETTLEMENT-mode guard.
create or replace function public.calculate_mud_supply_wages(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_week_start date
)
returns table (
  weekly_earning_id uuid,
  groups_calculated integer,
  rows_skipped integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  group_is_active boolean;
  mud_rate public.wage_rates%rowtype;
  matching_rate_count integer;
  eligible_quantity integer;
  inserted_rows integer;
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_mode public.mud_accounting_mode;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
  );
  select accounting_mode into current_mode
  from public.mud_accounting_states
  where factory_id = p_factory_id;
  if current_mode = 'SETTLEMENT' then
    raise exception 'Mud accounting is now continuous settlement accounting.'
      using errcode = 'P3305';
  end if;

  select labour_groups.is_active into group_is_active
  from public.labour_groups
  where labour_groups.id = p_labour_group_id
    and labour_groups.factory_id = p_factory_id;
  if not found then
    raise exception 'Labour group does not belong to this factory.' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'week_start must be a Monday.' using errcode = '22023';
  end if;
  if p_week_start + 6 >= business_today then
    raise exception 'Week starting % is not completed yet.', p_week_start using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('calculate_mud_supply_wages:' || p_week_start::text)
  );

  select earnings.id into weekly_earning_id
  from public.weekly_earnings as earnings
  where earnings.factory_id = p_factory_id
    and earnings.week_start = p_week_start
    and earnings.labour_group_id is not null;
  if found then
    groups_calculated := 0;
    rows_skipped := 1;
    return next;
    return;
  end if;
  if not group_is_active then
    raise exception 'Labour group is inactive and cannot be calculated.' using errcode = 'P0001';
  end if;

  select count(*) into matching_rate_count
  from public.wage_rates
  where wage_rates.factory_id = p_factory_id
    and wage_rates.applies_to = 'mud_supply'
    and wage_rates.effective_from <= p_week_start
    and (wage_rates.effective_to is null or wage_rates.effective_to >= p_week_start);
  if matching_rate_count = 0 then
    raise exception 'No mud_supply wage rate applies to week starting %.', p_week_start using errcode = 'P0001';
  end if;
  if matching_rate_count > 1 then
    raise exception 'Multiple mud_supply wage rates apply to week starting %.', p_week_start using errcode = 'P0001';
  end if;

  select * into mud_rate
  from public.wage_rates
  where wage_rates.factory_id = p_factory_id
    and wage_rates.applies_to = 'mud_supply'
    and wage_rates.effective_from <= p_week_start
    and (wage_rates.effective_to is null or wage_rates.effective_to >= p_week_start);

  select coalesce(sum(production_entries.quantity), 0)::integer into eligible_quantity
  from public.production_entries
  join public.labourers
    on labourers.id = production_entries.labourer_id
    and labourers.factory_id = production_entries.factory_id
  where production_entries.factory_id = p_factory_id
    and production_entries.production_date >= p_week_start
    and production_entries.production_date <= p_week_start + 6;

  insert into public.weekly_earnings(
    factory_id, labour_group_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    p_factory_id, p_labour_group_id, p_week_start, eligible_quantity,
    mud_rate.id, mud_rate.rate_per_1000_bricks,
    (eligible_quantity::numeric * mud_rate.rate_per_1000_bricks) / 1000
  )
  on conflict (factory_id, week_start)
    where labour_group_id is not null
    do nothing
  returning id into weekly_earning_id;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    groups_calculated := 1;
    rows_skipped := 0;
  else
    select earnings.id into weekly_earning_id
    from public.weekly_earnings as earnings
    where earnings.factory_id = p_factory_id
      and earnings.week_start = p_week_start
      and earnings.labour_group_id is not null;
    groups_calculated := 0;
    rows_skipped := 1;
  end if;
  return next;
end;
$$;

comment on function public.calculate_mud_supply_wages(uuid, uuid, date) is
  'Legacy one-group-per-factory-week Mud posting authority for LEGACY_WEEKLY and SHADOW only; SETTLEMENT factories use continuous daily settlement.';

commit;
