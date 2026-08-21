create table public.staff_withdrawals (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  staff_worker_id uuid not null,
  withdrawal_date date not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  constraint staff_withdrawals_id_factory_key unique (id, factory_id),
  constraint staff_withdrawals_date_check check (isfinite(withdrawal_date)),
  constraint staff_withdrawals_amount_check
    check (amount > 0 and amount <> 'NaN'::numeric),
  constraint staff_withdrawals_worker_factory_fkey
    foreign key (staff_worker_id, factory_id)
    references public.staff_workers (id, factory_id) on delete restrict
);

create index staff_withdrawals_worker_history_idx
  on public.staff_withdrawals (
    factory_id,
    staff_worker_id,
    withdrawal_date desc,
    created_at desc,
    id desc
  );

create or replace function public.prevent_staff_withdrawal_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Staff withdrawals are immutable.' using errcode = 'P2520';
end;
$$;

create trigger staff_withdrawals_are_immutable
before update or delete on public.staff_withdrawals
for each row execute function public.prevent_staff_withdrawal_mutation();

alter table public.staff_withdrawals enable row level security;

revoke all on public.staff_withdrawals from anon;
revoke all on public.staff_withdrawals from authenticated;
grant select on public.staff_withdrawals to authenticated;

create policy "Authenticated users can read their factory Staff withdrawals"
  on public.staff_withdrawals for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_withdrawals.factory_id
      and factory_users.is_active = true
  ));

create or replace function public.get_staff_financial_summary(
  p_factory_id uuid,
  p_staff_worker_id uuid
)
returns table (
  total_earnings numeric,
  total_withdrawn numeric,
  available_balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  business_month date := date_trunc(
    'month', (now() at time zone 'Asia/Kolkata')::date
  )::date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_staff_worker_id is null or not exists (
    select 1 from public.staff_workers
    where staff_workers.id = p_staff_worker_id
      and staff_workers.factory_id = p_factory_id
  ) then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
  );

  perform public.ensure_staff_monthly_earnings(
    p_factory_id, p_staff_worker_id, business_month
  );

  select coalesce(sum(staff_monthly_earnings.credited_amount), 0)
  into total_earnings
  from public.staff_monthly_earnings
  where staff_monthly_earnings.factory_id = p_factory_id
    and staff_monthly_earnings.staff_worker_id = p_staff_worker_id
    and staff_monthly_earnings.salary_month <= business_month;

  select coalesce(sum(staff_withdrawals.amount), 0)
  into total_withdrawn
  from public.staff_withdrawals
  where staff_withdrawals.factory_id = p_factory_id
    and staff_withdrawals.staff_worker_id = p_staff_worker_id
    and staff_withdrawals.withdrawal_date <= business_today;

  available_balance := total_earnings - total_withdrawn;
  if available_balance < 0 then
    raise exception 'Staff financial history is overdrawn by %.', -available_balance
      using errcode = 'P2521';
  end if;

  return next;
end;
$$;

create or replace function public.create_staff_withdrawal(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_withdrawal_date date,
  p_amount numeric
)
returns table (
  withdrawal_id uuid,
  withdrawal_factory_id uuid,
  withdrawal_staff_worker_id uuid,
  withdrawal_date date,
  withdrawal_amount numeric,
  created_at timestamptz,
  total_earnings numeric,
  total_withdrawn numeric,
  available_balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  summary record;
  new_withdrawal public.staff_withdrawals%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_staff_worker_id is null or not exists (
    select 1 from public.staff_workers
    where staff_workers.id = p_staff_worker_id
      and staff_workers.factory_id = p_factory_id
  ) then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  if p_withdrawal_date is null or not isfinite(p_withdrawal_date) then
    raise exception 'withdrawal_date must be a valid finite date.'
      using errcode = '22023';
  end if;
  if p_withdrawal_date > business_today then
    raise exception 'withdrawal_date cannot be later than the current business date (%).',
      business_today using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'amount must be greater than zero.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_salary_lifecycle:' || p_staff_worker_id::text)
  );

  select * into summary from public.get_staff_financial_summary(
    p_factory_id, p_staff_worker_id
  );

  if p_amount > summary.available_balance then
    raise exception 'Withdrawal amount % exceeds available Staff balance %.',
      p_amount, summary.available_balance using errcode = 'P0001';
  end if;

  insert into public.staff_withdrawals (
    factory_id, staff_worker_id, withdrawal_date, amount
  ) values (
    p_factory_id, p_staff_worker_id, p_withdrawal_date, p_amount
  ) returning * into new_withdrawal;

  withdrawal_id := new_withdrawal.id;
  withdrawal_factory_id := new_withdrawal.factory_id;
  withdrawal_staff_worker_id := new_withdrawal.staff_worker_id;
  withdrawal_date := new_withdrawal.withdrawal_date;
  withdrawal_amount := new_withdrawal.amount;
  created_at := new_withdrawal.created_at;
  total_earnings := summary.total_earnings;
  total_withdrawn := summary.total_withdrawn + new_withdrawal.amount;
  available_balance := summary.available_balance - new_withdrawal.amount;
  return next;
end;
$$;

revoke all on function public.prevent_staff_withdrawal_mutation() from public;
revoke all on function public.get_staff_financial_summary(uuid, uuid) from public;
revoke all on function public.get_staff_financial_summary(uuid, uuid) from anon;
grant execute on function public.get_staff_financial_summary(uuid, uuid) to authenticated;
revoke all on function public.create_staff_withdrawal(uuid, uuid, date, numeric) from public;
revoke all on function public.create_staff_withdrawal(uuid, uuid, date, numeric) from anon;
grant execute on function public.create_staff_withdrawal(uuid, uuid, date, numeric) to authenticated;
