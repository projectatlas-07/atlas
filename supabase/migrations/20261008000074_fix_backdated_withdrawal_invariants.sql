-- Atlas 12D1.3A: preserve withdrawal RPC security and serialization; enforce
-- non-negative affected historical balances. Source/rate consistency is outside
-- this change. Main promotion requires a separate read-only negative-account
-- scan of Legacy Mud, Settlement Mud and Transport; Test proof is not approval.

CREATE OR REPLACE FUNCTION public.create_labour_group_withdrawal(p_factory_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_amount numeric)
 RETURNS TABLE(withdrawal_id uuid, withdrawal_factory_id uuid, withdrawal_labour_group_id uuid, withdrawal_date date, withdrawal_amount numeric, created_at timestamp with time zone, available_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  total_earned numeric := 0;
  total_withdrawn numeric := 0;
  balance_before_withdrawal numeric := 0;
  violating_date date;
  violating_headroom numeric;
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


  -- One candidate and later withdrawal dates; aggregate credits/debits by
  -- business date before checking. Weekly earnings are effective week_start + 6.
  with events as (
    select p_withdrawal_date as event_date, 0::numeric as delta, true as check_balance
    union all
    select e.week_start + 6, e.amount, false
    from public.weekly_earnings as e
    where e.factory_id = p_factory_id
      and e.labour_group_id = p_labour_group_id
      and e.labourer_id is null
      and e.week_start > p_withdrawal_date - 6
    union all
    select w.withdrawal_date, -w.amount, true
    from public.withdrawals as w
    where w.factory_id = p_factory_id
      and w.labour_group_id = p_labour_group_id
      and w.labourer_id is null
      and w.withdrawal_date > p_withdrawal_date
  ), daily as (
    select event_date, sum(delta) as delta, bool_or(check_balance) as check_balance
    from events
    group by event_date
  ), running as (
    select event_date, check_balance,
      balance_before_withdrawal + sum(delta) over (
        order by event_date rows between unbounded preceding and current row
      ) as headroom
    from daily
  )
  select event_date, headroom into violating_date, violating_headroom
  from running
  where check_balance and headroom < p_amount
  order by event_date
  limit 1;
  if found then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount, violating_headroom, violating_date using errcode = 'P0001';
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
$function$;

CREATE OR REPLACE FUNCTION public.create_mud_settlement_withdrawal(p_factory_id uuid, p_withdrawal_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric)
 RETURNS TABLE(withdrawal_id uuid, settlement_id uuid, previous_cutoff date, settled_through date, withdrawal_date date, withdrawal_amount numeric, settled_earned numeric, total_withdrawn numeric, settled_available_balance numeric, daily_snapshots integer, group_snapshots integer, was_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_mode public.mud_accounting_mode;
  current_cutoff date;
  existing_withdrawal public.withdrawals%rowtype;
  existing_settlement public.mud_factory_settlements%rowtype;
  new_withdrawal public.withdrawals%rowtype;
  settlement_result record;
  settled_account record;
  all_withdrawn numeric;
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


  -- Settled-only earnings are a shared pool available before this candidate's
  -- date. Include EVERY withdrawal in this account (Legacy and Settlement),
  -- including the candidate, without borrowing live/unsettled earnings.
  -- A rejection rolls back the withdrawal and all new checkpoint/snapshot rows.
  select coalesce(sum(w.amount), 0) into all_withdrawn
  from public.withdrawals as w
  where w.factory_id = p_factory_id
    and w.labour_group_id = p_labour_group_id
    and w.labourer_id is null;
  if all_withdrawn > settled_account.settled_earned then
    raise exception 'Withdrawal amount exceeds earnings settled through the requested cutoff.'
      using errcode = 'P3303',
        detail = format('Settled earned: %s. Total withdrawals across all dates: %s.',
          settled_account.settled_earned, all_withdrawn);
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
$function$;

CREATE OR REPLACE FUNCTION public.create_transport_worker_withdrawal(p_factory_id uuid, p_transport_worker_id uuid, p_withdrawal_date date, p_amount numeric)
 RETURNS TABLE(withdrawal_id uuid, withdrawal_factory_id uuid, withdrawal_transport_worker_id uuid, withdrawal_date date, withdrawal_amount numeric, created_at timestamp with time zone, available_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  total_earned numeric := 0;
  total_withdrawn numeric := 0;
  balance_before_withdrawal numeric := 0;
  violating_date date;
  violating_headroom numeric;
  new_withdrawal public.transport_withdrawals%rowtype;
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

  if p_transport_worker_id is null or not exists (
    select 1
    from public.transport_workers
    where transport_workers.id = p_transport_worker_id
      and transport_workers.factory_id = p_factory_id
  ) then
    raise exception 'Transport worker does not belong to this factory.'
      using errcode = '42501';
  end if;

  if p_withdrawal_date is null or not isfinite(p_withdrawal_date) then
    raise exception 'withdrawal_date must be a valid finite date.'
      using errcode = '22023';
  end if;

  if p_amount is null
    or p_amount <= 0
    or p_amount = 'NaN'::numeric then
    raise exception 'amount must be greater than zero.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('transport_worker_withdrawal:' || p_transport_worker_id::text)
  );

  select coalesce(sum(earnings.total_amount), 0)
    into total_earned
  from public.transport_weekly_earnings as earnings
  where earnings.factory_id = p_factory_id
    and earnings.transport_worker_id = p_transport_worker_id
    and earnings.week_start + 6 <= p_withdrawal_date;

  select coalesce(sum(existing_withdrawals.amount), 0)
    into total_withdrawn
  from public.transport_withdrawals as existing_withdrawals
  where existing_withdrawals.factory_id = p_factory_id
    and existing_withdrawals.transport_worker_id = p_transport_worker_id
    and existing_withdrawals.withdrawal_date <= p_withdrawal_date;

  balance_before_withdrawal := total_earned - total_withdrawn;

  if p_amount > balance_before_withdrawal then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount,
      balance_before_withdrawal,
      p_withdrawal_date
      using errcode = 'P0001';
  end if;


  -- One candidate and later withdrawal dates; aggregate credits/debits by
  -- business date before checking. Weekly earnings are effective week_start + 6.
  with events as (
    select p_withdrawal_date as event_date, 0::numeric as delta, true as check_balance
    union all
    select e.week_start + 6, e.total_amount, false
    from public.transport_weekly_earnings as e
    where e.factory_id = p_factory_id
      and e.transport_worker_id = p_transport_worker_id
      and e.week_start > p_withdrawal_date - 6
    union all
    select w.withdrawal_date, -w.amount, true
    from public.transport_withdrawals as w
    where w.factory_id = p_factory_id
      and w.transport_worker_id = p_transport_worker_id
      and w.withdrawal_date > p_withdrawal_date
  ), daily as (
    select event_date, sum(delta) as delta, bool_or(check_balance) as check_balance
    from events
    group by event_date
  ), running as (
    select event_date, check_balance,
      balance_before_withdrawal + sum(delta) over (
        order by event_date rows between unbounded preceding and current row
      ) as headroom
    from daily
  )
  select event_date, headroom into violating_date, violating_headroom
  from running
  where check_balance and headroom < p_amount
  order by event_date
  limit 1;
  if found then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount, violating_headroom, violating_date using errcode = 'P0001';
  end if;

  insert into public.transport_withdrawals (
    factory_id,
    transport_worker_id,
    withdrawal_date,
    amount
  ) values (
    p_factory_id,
    p_transport_worker_id,
    p_withdrawal_date,
    p_amount
  )
  returning * into new_withdrawal;

  withdrawal_id := new_withdrawal.id;
  withdrawal_factory_id := new_withdrawal.factory_id;
  withdrawal_transport_worker_id := new_withdrawal.transport_worker_id;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  created_at := new_withdrawal.created_at;
  available_balance := balance_before_withdrawal - new_withdrawal.amount;

  return next;
end;
$function$;
