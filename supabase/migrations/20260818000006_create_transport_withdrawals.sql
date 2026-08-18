create table public.transport_withdrawals (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  transport_worker_id uuid not null,
  withdrawal_date date not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  constraint transport_withdrawals_date_check
    check (isfinite(withdrawal_date)),
  constraint transport_withdrawals_amount_check
    check (amount > 0 and amount <> 'NaN'::numeric),
  constraint transport_withdrawals_worker_factory_fkey
    foreign key (transport_worker_id, factory_id)
    references public.transport_workers (id, factory_id) on delete restrict
);

create index transport_withdrawals_worker_history_idx
  on public.transport_withdrawals (
    factory_id,
    transport_worker_id,
    withdrawal_date desc,
    created_at desc,
    id desc
  );

alter table public.transport_withdrawals enable row level security;

revoke all on public.transport_withdrawals from anon;
revoke all on public.transport_withdrawals from authenticated;
grant select on public.transport_withdrawals to authenticated;

create policy "Authenticated users can read their factory transport withdrawals"
  on public.transport_withdrawals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = transport_withdrawals.factory_id
        and factory_users.is_active = true
    )
  );

create or replace function public.get_transport_worker_available_balance(
  p_factory_id uuid,
  p_transport_worker_id uuid,
  p_as_of_date date
)
returns table (
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
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

  if p_as_of_date is null or not isfinite(p_as_of_date) then
    raise exception 'as_of_date must be a valid finite date.'
      using errcode = '22023';
  end if;

  select coalesce(sum(earnings.total_amount), 0)
    into total_earned
  from public.transport_weekly_earnings as earnings
  where earnings.factory_id = p_factory_id
    and earnings.transport_worker_id = p_transport_worker_id
    and earnings.week_start + 6 <= p_as_of_date;

  select coalesce(sum(withdrawals.amount), 0)
    into total_withdrawn
  from public.transport_withdrawals as withdrawals
  where withdrawals.factory_id = p_factory_id
    and withdrawals.transport_worker_id = p_transport_worker_id
    and withdrawals.withdrawal_date <= p_as_of_date;

  available_balance := total_earned - total_withdrawn;
  return next;
end;
$$;

create or replace function public.create_transport_worker_withdrawal(
  p_factory_id uuid,
  p_transport_worker_id uuid,
  p_withdrawal_date date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  withdrawal_factory_id uuid,
  withdrawal_transport_worker_id uuid,
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
$$;

revoke all on function public.get_transport_worker_available_balance(uuid, uuid, date)
  from public;
revoke all on function public.get_transport_worker_available_balance(uuid, uuid, date)
  from anon;
grant execute on function public.get_transport_worker_available_balance(uuid, uuid, date)
  to authenticated;

revoke all on function public.create_transport_worker_withdrawal(uuid, uuid, date, numeric)
  from public;
revoke all on function public.create_transport_worker_withdrawal(uuid, uuid, date, numeric)
  from anon;
grant execute on function public.create_transport_worker_withdrawal(uuid, uuid, date, numeric)
  to authenticated;
