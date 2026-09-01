-- Atlas Staff redesign S4: organizational archive/restore and payment-ledger delete guard.

comment on column public.staff_workers.is_active is
  'Organizational Staff status only: true is Active and false is Archived. It does not create or alter financial history, eligibility, earnings, balances, or salary data.';

create or replace function public.archive_staff_worker(
  p_factory_id uuid,
  p_staff_worker_id uuid
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.staff_workers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  -- Share the payment lock so archive and payment recording cannot race.
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('staff_payment:' || p_staff_worker_id::text)
  );

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;
  if not worker_row.is_active then
    raise exception 'This Staff member is already archived.' using errcode = 'P2560';
  end if;

  update public.staff_workers
  set is_active = false
  where id = p_staff_worker_id
    and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
end;
$$;

create or replace function public.restore_staff_worker(
  p_factory_id uuid,
  p_staff_worker_id uuid
)
returns public.staff_workers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.staff_workers%rowtype;
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
    hashtext(p_factory_id::text),
    hashtext('staff_payment:' || p_staff_worker_id::text)
  );

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;
  if worker_row.is_active then
    raise exception 'This Staff member is already active.' using errcode = 'P2561';
  end if;

  update public.staff_workers
  set is_active = true
  where id = p_staff_worker_id
    and factory_id = p_factory_id
  returning * into worker_row;

  return worker_row;
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
  worker_row public.staff_workers%rowtype;
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

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;
  if not worker_row.is_active then
    raise exception 'Archived Staff members cannot receive new payments. Restore them first.'
      using errcode = 'P2562';
  end if;

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

create or replace function public.delete_staff_worker(
  p_factory_id uuid,
  p_staff_worker_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_row public.staff_workers%rowtype;
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
    hashtext(p_factory_id::text),
    hashtext('staff_payment:' || p_staff_worker_id::text)
  );

  select * into worker_row
  from public.staff_workers
  where staff_workers.id = p_staff_worker_id
    and staff_workers.factory_id = p_factory_id
  for update;

  if not found then
    raise exception 'Staff worker does not belong to this factory.' using errcode = 'P2502';
  end if;

  if exists (
    select 1 from public.staff_payments
    where staff_payments.factory_id = p_factory_id
      and staff_payments.staff_worker_id = p_staff_worker_id
  ) then
    raise exception 'This Staff member has payment history and cannot be deleted. Archive them instead.'
      using errcode = 'P2540';
  end if;

  delete from public.staff_workers
  where id = p_staff_worker_id
    and factory_id = p_factory_id;

  return worker_row.id;
end;
$$;

revoke all on function public.archive_staff_worker(uuid, uuid) from public;
revoke all on function public.archive_staff_worker(uuid, uuid) from anon;
grant execute on function public.archive_staff_worker(uuid, uuid) to authenticated;

revoke all on function public.restore_staff_worker(uuid, uuid) from public;
revoke all on function public.restore_staff_worker(uuid, uuid) from anon;
grant execute on function public.restore_staff_worker(uuid, uuid) to authenticated;

revoke all on function public.record_staff_payment(uuid, uuid, date, numeric, text) from public;
revoke all on function public.record_staff_payment(uuid, uuid, date, numeric, text) from anon;
grant execute on function public.record_staff_payment(uuid, uuid, date, numeric, text)
  to authenticated;

revoke all on function public.delete_staff_worker(uuid, uuid) from public;
revoke all on function public.delete_staff_worker(uuid, uuid) from anon;
grant execute on function public.delete_staff_worker(uuid, uuid) to authenticated;
