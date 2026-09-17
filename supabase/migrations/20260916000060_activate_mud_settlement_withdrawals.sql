begin;

-- Mud Phase 5B1: authoritative withdrawal/accounting runtime for factories
-- already in SETTLEMENT. UI switching and settled-date mutation protection
-- remain deliberately out of scope.

create or replace function public.calculate_mud_group_settlement_account(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_as_of_date date,
  p_include_live_earnings boolean
)
returns table (
  settled_earned numeric,
  live_earned numeric,
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric,
  latest_settlement_cutoff date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_cutoff date;
  live_start date;
  resolved_settled_earned numeric := 0;
  resolved_live_earned numeric := 0;
  resolved_total_withdrawn numeric := 0;
begin
  if p_factory_id is null or p_labour_group_id is null
    or p_as_of_date is null or not isfinite(p_as_of_date)
    or p_include_live_earnings is null then
    raise exception 'Factory, Mud group, finite as-of date, and live-earning choice are required.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id
      and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;

  select max(settlements.settled_through)
  into resolved_cutoff
  from public.mud_factory_settlements as settlements
  where settlements.factory_id = p_factory_id;

  if resolved_cutoff is not null and p_as_of_date < resolved_cutoff then
    raise exception 'As-of date cannot be before the factory Mud cutoff %.', resolved_cutoff
      using errcode = 'P2908';
  end if;

  select
    coalesce((
      select sum(openings.locked_weekly_earned)
      from public.mud_group_legacy_openings as openings
      where openings.factory_id = p_factory_id
        and openings.labour_group_id = p_labour_group_id
    ), 0)
    + coalesce((
      select sum(days.earned_amount)
      from public.mud_group_settlement_days as days
      where days.factory_id = p_factory_id
        and days.labour_group_id = p_labour_group_id
    ), 0)
  into resolved_settled_earned;

  if p_include_live_earnings then
    if resolved_cutoff is null then
      select min(terms.effective_from)
      into live_start
      from public.mud_group_terms as terms
      where terms.factory_id = p_factory_id;
    else
      live_start := resolved_cutoff + 1;
    end if;

    if live_start is not null and live_start <= p_as_of_date then
      select coalesce(sum(allocation.earned_amount) filter (
        where allocation.labour_group_id = p_labour_group_id
      ), 0)
      into resolved_live_earned
      from generate_series(0, p_as_of_date - live_start) as generated(day_offset)
      cross join lateral public.get_mud_group_daily_allocation(
        p_factory_id, live_start + generated.day_offset
      ) as allocation;
    end if;
  end if;

  select coalesce(sum(existing.amount), 0)
  into resolved_total_withdrawn
  from public.withdrawals as existing
  where existing.factory_id = p_factory_id
    and existing.labour_group_id = p_labour_group_id
    and existing.labourer_id is null
    and existing.withdrawal_date <= p_as_of_date;

  settled_earned := resolved_settled_earned;
  live_earned := resolved_live_earned;
  total_earned := resolved_settled_earned + resolved_live_earned;
  total_withdrawn := resolved_total_withdrawn;
  available_balance := total_earned - resolved_total_withdrawn;
  latest_settlement_cutoff := resolved_cutoff;
  return next;
end;
$$;

-- Preserve the Phase 3 signature while delegating all arithmetic to one core.
create or replace function public.calculate_mud_group_settlement_account(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_as_of_date date
)
returns table (
  settled_earned numeric,
  live_earned numeric,
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric,
  latest_settlement_cutoff date
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from public.calculate_mud_group_settlement_account(
    p_factory_id, p_labour_group_id, p_as_of_date, true
  );
$$;

create or replace function public.get_mud_group_settlement_account(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_as_of_date date
)
returns table (
  settled_earned numeric,
  live_earned numeric,
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric,
  latest_settlement_cutoff date
)
language plpgsql
stable
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
  if not exists (
    select 1 from public.mud_accounting_states
    where mud_accounting_states.factory_id = p_factory_id
      and mud_accounting_states.accounting_mode = 'SETTLEMENT'
  ) then
    raise exception 'Mud settlement account is available only in SETTLEMENT mode.'
      using errcode = 'P3300';
  end if;

  return query
  select * from public.calculate_mud_group_settlement_account(
    p_factory_id, p_labour_group_id, p_as_of_date, true
  );
end;
$$;

create or replace function public.create_mud_settlement_withdrawal(
  p_factory_id uuid,
  p_withdrawal_id uuid,
  p_labour_group_id uuid,
  p_withdrawal_date date,
  p_settlement_cutoff date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  settlement_id uuid,
  previous_cutoff date,
  settled_through date,
  withdrawal_date date,
  withdrawal_amount numeric,
  settled_earned numeric,
  total_withdrawn numeric,
  settled_available_balance numeric,
  daily_snapshots integer,
  group_snapshots integer,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_mode public.mud_accounting_mode;
  current_cutoff date;
  existing_withdrawal public.withdrawals%rowtype;
  existing_settlement public.mud_factory_settlements%rowtype;
  new_withdrawal public.withdrawals%rowtype;
  settlement_result record;
  settled_account record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;
  if p_withdrawal_id is null then
    raise exception 'Client withdrawal identity is required.' using errcode = '22023';
  end if;
  if p_labour_group_id is null or not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id
      and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Mud group does not belong to this factory.' using errcode = '42501';
  end if;
  if p_withdrawal_date is null or not isfinite(p_withdrawal_date)
    or p_settlement_cutoff is null or not isfinite(p_settlement_cutoff) then
    raise exception 'Finite withdrawal and settlement cutoff dates are required.' using errcode = '22023';
  end if;
  if p_settlement_cutoff >= p_withdrawal_date then
    raise exception 'Mud settlement cutoff must be before the withdrawal date.' using errcode = 'P3301';
  end if;
  if p_settlement_cutoff > business_today then
    raise exception 'Mud settlement cutoff cannot be in the future.' using errcode = 'P3301';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric
    or p_amount = '-Infinity'::numeric then
    raise exception 'Withdrawal amount must be a positive finite number.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text), hashtext('mud_factory_settlement')
  );

  select states.accounting_mode into current_mode
  from public.mud_accounting_states as states
  where states.factory_id = p_factory_id
  for update;
  if current_mode is distinct from 'SETTLEMENT' then
    raise exception 'Mud settlement withdrawals require SETTLEMENT accounting mode.'
      using errcode = 'P3300';
  end if;

  select * into existing_withdrawal
  from public.withdrawals as withdrawals
  where withdrawals.id = p_withdrawal_id;
  if found then
    select * into existing_settlement
    from public.mud_factory_settlements as settlements
    where settlements.triggering_withdrawal_id = p_withdrawal_id;

    if existing_withdrawal.factory_id <> p_factory_id
      or existing_withdrawal.labour_group_id is distinct from p_labour_group_id
      or existing_withdrawal.labourer_id is not null
      or existing_withdrawal.withdrawal_date <> p_withdrawal_date
      or existing_withdrawal.amount <> p_amount
      or existing_settlement.id is null
      or existing_settlement.factory_id <> p_factory_id
      or existing_settlement.triggering_labour_group_id is distinct from p_labour_group_id
      or existing_settlement.settled_through <> p_settlement_cutoff then
      raise exception 'Client withdrawal identity was already used for different Mud withdrawal details.'
        using errcode = 'P3304';
    end if;

    select * into settled_account
    from public.calculate_mud_group_settlement_account(
      p_factory_id, p_labour_group_id, p_withdrawal_date, false
    );

    withdrawal_id := existing_withdrawal.id;
    settlement_id := existing_settlement.id;
    previous_cutoff := existing_settlement.previous_cutoff;
    settled_through := existing_settlement.settled_through;
    withdrawal_date := existing_withdrawal.withdrawal_date;
    withdrawal_amount := existing_withdrawal.amount;
    settled_earned := settled_account.settled_earned;
    total_withdrawn := settled_account.total_withdrawn;
    settled_available_balance := settled_account.available_balance;
    daily_snapshots := (
      select count(*)::integer from public.mud_factory_settlement_days
      where mud_factory_settlement_days.settlement_id = existing_settlement.id
    );
    group_snapshots := (
      select count(*)::integer from public.mud_group_settlement_days
      where mud_group_settlement_days.settlement_id = existing_settlement.id
    );
    was_replayed := true;
    return next;
    return;
  end if;

  select max(settlements.settled_through) into current_cutoff
  from public.mud_factory_settlements as settlements
  where settlements.factory_id = p_factory_id;
  if current_cutoff is null then
    raise exception 'Mud SETTLEMENT factory is missing its Legacy Opening cutoff.' using errcode = 'P3302';
  end if;
  if p_settlement_cutoff < current_cutoff then
    raise exception 'Mud settlement cutoff cannot move backward from %.', current_cutoff
      using errcode = 'P2902';
  end if;

  insert into public.withdrawals(
    id, factory_id, labour_group_id, withdrawal_date, amount
  ) values (
    p_withdrawal_id, p_factory_id, p_labour_group_id, p_withdrawal_date, p_amount
  ) returning * into new_withdrawal;

  select * into settlement_result
  from public.create_mud_factory_settlement(
    p_factory_id, p_settlement_cutoff, p_labour_group_id, new_withdrawal.id
  );

  select * into settled_account
  from public.calculate_mud_group_settlement_account(
    p_factory_id, p_labour_group_id, p_withdrawal_date, false
  );
  if settled_account.available_balance < 0 then
    raise exception 'Withdrawal amount exceeds earnings settled through the requested cutoff.'
      using errcode = 'P3303',
        detail = format('Settled earned: %s. Withdrawn through %s: %s.',
          settled_account.settled_earned, p_withdrawal_date, settled_account.total_withdrawn);
  end if;

  withdrawal_id := new_withdrawal.id;
  settlement_id := settlement_result.settlement_id;
  previous_cutoff := settlement_result.previous_cutoff;
  settled_through := settlement_result.settled_through;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  settled_earned := settled_account.settled_earned;
  total_withdrawn := settled_account.total_withdrawn;
  settled_available_balance := settled_account.available_balance;
  daily_snapshots := settlement_result.daily_snapshots;
  group_snapshots := settlement_result.group_snapshots;
  was_replayed := false;
  return next;
end;
$$;

create or replace function public.create_labour_group_withdrawal(
  p_factory_id uuid,
  p_labour_group_id uuid,
  p_withdrawal_date date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  withdrawal_factory_id uuid,
  withdrawal_labour_group_id uuid,
  withdrawal_date date,
  withdrawal_amount numeric,
  created_at timestamptz,
  available_balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  total_earned numeric := 0;
  total_withdrawn numeric := 0;
  balance_before_withdrawal numeric := 0;
  new_withdrawal public.withdrawals%rowtype;
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
  if p_labour_group_id is null or not exists (
    select 1 from public.labour_groups
    where labour_groups.id = p_labour_group_id
      and labour_groups.factory_id = p_factory_id
  ) then
    raise exception 'Labour group does not belong to this factory.' using errcode = '42501';
  end if;
  if p_withdrawal_date is null then
    raise exception 'withdrawal_date is required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'amount must be greater than zero.' using errcode = '22023';
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

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('labour_group_withdrawal:' || p_labour_group_id::text)
  );

  select coalesce(sum(earnings.amount), 0) into total_earned
  from public.weekly_earnings as earnings
  where earnings.factory_id = p_factory_id
    and earnings.labour_group_id = p_labour_group_id
    and earnings.labourer_id is null
    and earnings.week_start + 6 <= p_withdrawal_date;

  select coalesce(sum(existing_withdrawals.amount), 0) into total_withdrawn
  from public.withdrawals as existing_withdrawals
  where existing_withdrawals.factory_id = p_factory_id
    and existing_withdrawals.labour_group_id = p_labour_group_id
    and existing_withdrawals.labourer_id is null
    and existing_withdrawals.withdrawal_date <= p_withdrawal_date;

  balance_before_withdrawal := total_earned - total_withdrawn;
  if p_amount > balance_before_withdrawal then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount, balance_before_withdrawal, p_withdrawal_date using errcode = 'P0001';
  end if;

  insert into public.withdrawals(factory_id, labour_group_id, withdrawal_date, amount)
  values (p_factory_id, p_labour_group_id, p_withdrawal_date, p_amount)
  returning * into new_withdrawal;

  withdrawal_id := new_withdrawal.id;
  withdrawal_factory_id := new_withdrawal.factory_id;
  withdrawal_labour_group_id := new_withdrawal.labour_group_id;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  created_at := new_withdrawal.created_at;
  available_balance := balance_before_withdrawal - new_withdrawal.amount;
  return next;
end;
$$;

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
    hashtext('calculate_mud_supply_wages:' || p_labour_group_id::text || ':' || p_week_start::text)
  );

  select earnings.id into weekly_earning_id
  from public.weekly_earnings as earnings
  where earnings.factory_id = p_factory_id
    and earnings.labour_group_id = p_labour_group_id
    and earnings.week_start = p_week_start;
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
    and production_entries.production_date <= p_week_start + 6
    and not labourers.is_placeholder;

  insert into public.weekly_earnings(
    factory_id, labour_group_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    p_factory_id, p_labour_group_id, p_week_start, eligible_quantity,
    mud_rate.id, mud_rate.rate_per_1000_bricks,
    (eligible_quantity::numeric * mud_rate.rate_per_1000_bricks) / 1000
  )
  on conflict (factory_id, labour_group_id, week_start)
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
      and earnings.labour_group_id = p_labour_group_id
      and earnings.week_start = p_week_start;
    groups_calculated := 0;
    rows_skipped := 1;
  end if;
  return next;
end;
$$;

revoke all on function public.calculate_mud_group_settlement_account(uuid, uuid, date, boolean)
  from public, anon, authenticated;
revoke all on function public.create_mud_factory_settlement(uuid, date, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_mud_settlement_withdrawal(uuid, uuid, uuid, date, date, numeric)
  from public, anon, authenticated;
grant execute on function public.create_mud_settlement_withdrawal(uuid, uuid, uuid, date, date, numeric)
  to authenticated;

comment on function public.calculate_mud_group_settlement_account(uuid, uuid, date, boolean) is
  'Single Mud account arithmetic authority; live earnings can be excluded for safe withdrawal validation.';
comment on function public.get_mud_group_settlement_account(uuid, uuid, date) is
  'SETTLEMENT-mode Mud account: Legacy Opening plus immutable settled earnings plus post-cutoff live earnings minus group withdrawals.';
comment on function public.create_mud_settlement_withdrawal(uuid, uuid, uuid, date, date, numeric) is
  'Idempotent atomic SETTLEMENT-mode Mud withdrawal that snapshots every active group through the supplied factory cutoff before validating settled funds.';
comment on function public.create_labour_group_withdrawal(uuid, uuid, date, numeric) is
  'Legacy Mud withdrawal authority for LEGACY_WEEKLY and SHADOW only; SETTLEMENT factories must use create_mud_settlement_withdrawal.';
comment on function public.calculate_mud_supply_wages(uuid, uuid, date) is
  'Legacy Mud weekly posting authority for LEGACY_WEEKLY and SHADOW only; SETTLEMENT factories use continuous daily settlement.';

commit;
