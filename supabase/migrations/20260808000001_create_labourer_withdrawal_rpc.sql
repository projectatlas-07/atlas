create or replace function public.create_labourer_withdrawal(
  p_factory_id uuid,
  p_labourer_id uuid,
  p_withdrawal_date date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  withdrawal_factory_id uuid,
  withdrawal_labourer_id uuid,
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

  if p_withdrawal_date is null then
    raise exception 'withdrawal_date is required.'
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
    hashtext('labourer_withdrawal:' || p_labourer_id::text)
  );

  select coalesce(sum(earnings.amount), 0)
    into total_earned
    from public.weekly_earnings as earnings
    where earnings.factory_id = p_factory_id
      and earnings.labourer_id = p_labourer_id
      and earnings.week_start + 6 <= p_withdrawal_date;

  select coalesce(sum(existing_withdrawals.amount), 0)
    into total_withdrawn
    from public.withdrawals as existing_withdrawals
    where existing_withdrawals.factory_id = p_factory_id
      and existing_withdrawals.labourer_id = p_labourer_id
      and existing_withdrawals.withdrawal_date <= p_withdrawal_date;

  balance_before_withdrawal := total_earned - total_withdrawn;

  if p_amount > balance_before_withdrawal then
    raise exception 'Withdrawal amount % exceeds available balance % as of %.',
      p_amount,
      balance_before_withdrawal,
      p_withdrawal_date
      using errcode = 'P0001';
  end if;

  insert into public.withdrawals (
    factory_id,
    labourer_id,
    withdrawal_date,
    amount
  )
  values (
    p_factory_id,
    p_labourer_id,
    p_withdrawal_date,
    p_amount
  )
  returning * into new_withdrawal;

  withdrawal_id := new_withdrawal.id;
  withdrawal_factory_id := new_withdrawal.factory_id;
  withdrawal_labourer_id := new_withdrawal.labourer_id;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  created_at := new_withdrawal.created_at;
  available_balance := balance_before_withdrawal - new_withdrawal.amount;

  return next;
end;
$$;

revoke insert, update, delete on public.withdrawals from authenticated;
grant select on public.withdrawals to authenticated;

drop policy if exists "Authenticated users can insert their factory withdrawals"
  on public.withdrawals;

revoke all on function public.create_labourer_withdrawal(uuid, uuid, date, numeric) from public;
revoke all on function public.create_labourer_withdrawal(uuid, uuid, date, numeric) from anon;
grant execute on function public.create_labourer_withdrawal(uuid, uuid, date, numeric) to authenticated;
