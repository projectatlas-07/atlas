-- Atlas Staff payment replacement S1: additive reference salary and payment ledger.

alter table public.staff_workers
  add column reference_salary numeric,
  add constraint staff_workers_reference_salary_check check (
    reference_salary is null
    or (reference_salary > 0 and reference_salary <> 'NaN'::numeric)
  );

comment on column public.staff_workers.reference_salary is
  'Informational individual salary reference only. It does not create earnings, balances, entitlements, deductions, withdrawals, or payment limits.';

create table public.staff_payments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  staff_worker_id uuid not null,
  payment_date date not null,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now(),
  constraint staff_payments_id_factory_key unique (id, factory_id),
  constraint staff_payments_date_check check (isfinite(payment_date)),
  constraint staff_payments_amount_check
    check (amount > 0 and amount <> 'NaN'::numeric),
  constraint staff_payments_note_check
    check (note is null or (note = btrim(note) and note <> '')),
  constraint staff_payments_worker_factory_fkey
    foreign key (staff_worker_id, factory_id)
    references public.staff_workers (id, factory_id) on delete restrict
);

comment on table public.staff_payments is
  'Immutable historical record of actual Staff payments. Amounts are independent of reference salary and legacy salary entitlement data.';

create index staff_payments_worker_history_idx
  on public.staff_payments (
    factory_id,
    staff_worker_id,
    payment_date desc,
    created_at desc,
    id desc
  );

create or replace function public.prevent_staff_payment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Staff payments are immutable.' using errcode = 'P2550';
end;
$$;

create trigger staff_payments_are_immutable
before update or delete on public.staff_payments
for each row execute function public.prevent_staff_payment_mutation();

alter table public.staff_payments enable row level security;

revoke all on public.staff_payments from anon;
revoke all on public.staff_payments from authenticated;
grant select on public.staff_payments to authenticated;

create policy "Authenticated users can read their factory Staff payments"
  on public.staff_payments for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = staff_payments.factory_id
      and factory_users.is_active = true
  ));

create or replace function public.get_staff_payment_summary(
  p_factory_id uuid,
  p_staff_worker_id uuid
)
returns table (total_paid numeric)
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

  if p_staff_worker_id is null or not exists (
    select 1 from public.staff_workers
    where staff_workers.id = p_staff_worker_id
      and staff_workers.factory_id = p_factory_id
  ) then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  select coalesce(sum(staff_payments.amount), 0)
  into total_paid
  from public.staff_payments
  where staff_payments.factory_id = p_factory_id
    and staff_payments.staff_worker_id = p_staff_worker_id;

  return next;
end;
$$;

create or replace function public.record_staff_payment(
  p_factory_id uuid,
  p_staff_worker_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text default null
)
returns table (
  payment_id uuid,
  payment_factory_id uuid,
  payment_staff_worker_id uuid,
  payment_date date,
  payment_amount numeric,
  payment_note text,
  created_at timestamptz,
  total_paid numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  normalized_note text := nullif(btrim(p_note), '');
  new_payment public.staff_payments%rowtype;
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

  if p_payment_date is null or not isfinite(p_payment_date) then
    raise exception 'payment_date must be a valid finite date.'
      using errcode = '22023';
  end if;
  if p_payment_date > business_today then
    raise exception 'payment_date cannot be later than the current business date (%).',
      business_today using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'amount must be greater than zero.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_payment:' || p_staff_worker_id::text)
  );

  insert into public.staff_payments (
    factory_id, staff_worker_id, payment_date, amount, note
  ) values (
    p_factory_id, p_staff_worker_id, p_payment_date, p_amount, normalized_note
  ) returning * into new_payment;

  payment_id := new_payment.id;
  payment_factory_id := new_payment.factory_id;
  payment_staff_worker_id := new_payment.staff_worker_id;
  payment_date := new_payment.payment_date;
  payment_amount := new_payment.amount;
  payment_note := new_payment.note;
  created_at := new_payment.created_at;

  select coalesce(sum(staff_payments.amount), 0)
  into total_paid
  from public.staff_payments
  where staff_payments.factory_id = p_factory_id
    and staff_payments.staff_worker_id = p_staff_worker_id;

  return next;
end;
$$;

revoke all on function public.prevent_staff_payment_mutation() from public;
revoke all on function public.get_staff_payment_summary(uuid, uuid) from public;
revoke all on function public.get_staff_payment_summary(uuid, uuid) from anon;
grant execute on function public.get_staff_payment_summary(uuid, uuid) to authenticated;
revoke all on function public.record_staff_payment(uuid, uuid, date, numeric, text) from public;
revoke all on function public.record_staff_payment(uuid, uuid, date, numeric, text) from anon;
grant execute on function public.record_staff_payment(uuid, uuid, date, numeric, text)
  to authenticated;
