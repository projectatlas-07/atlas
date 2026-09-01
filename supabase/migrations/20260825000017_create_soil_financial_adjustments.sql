-- Atlas Soil Supply T5: immutable manual additions and deductions.

create table public.soil_financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  soil_worker_id uuid not null,
  adjustment_type text not null,
  adjustment_date date not null,
  amount numeric not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint soil_financial_adjustments_id_factory_key unique (id, factory_id),
  constraint soil_financial_adjustments_type_check
    check (adjustment_type in ('ADDITION', 'DEDUCTION')),
  constraint soil_financial_adjustments_date_check
    check (isfinite(adjustment_date)),
  constraint soil_financial_adjustments_amount_check check (
    amount > 0
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
  ),
  constraint soil_financial_adjustments_reason_check check (
    reason = btrim(reason)
    and reason <> ''
  ),
  constraint soil_financial_adjustments_worker_factory_fkey
    foreign key (soil_worker_id, factory_id)
    references public.soil_workers (id, factory_id) on delete restrict
);

create index soil_financial_adjustments_factory_worker_history_idx
  on public.soil_financial_adjustments (
    factory_id,
    soil_worker_id,
    adjustment_date desc,
    created_at desc,
    id desc
  );

create or replace function public.prevent_soil_financial_adjustment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Soil financial adjustment history is immutable.'
    using errcode = 'P2901';
  return null;
end;
$$;

create trigger soil_financial_adjustments_prevent_update_delete
before update or delete on public.soil_financial_adjustments
for each row execute function public.prevent_soil_financial_adjustment_mutation();

alter table public.soil_financial_adjustments enable row level security;

revoke all on public.soil_financial_adjustments from public, anon, authenticated;
grant select on public.soil_financial_adjustments to authenticated;

create policy "Authenticated users can read their factory Soil financial adjustments"
  on public.soil_financial_adjustments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = soil_financial_adjustments.factory_id
        and factory_users.is_active = true
    )
  );

drop function public.get_soil_financial_summary(uuid, uuid);

create function public.get_soil_financial_summary(
  p_factory_id uuid,
  p_soil_worker_id uuid
)
returns table (
  total_earned numeric,
  total_additions numeric,
  total_deductions numeric,
  total_paid numeric,
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

  if p_soil_worker_id is null or not exists (
    select 1
    from public.soil_workers
    where soil_workers.id = p_soil_worker_id
      and soil_workers.factory_id = p_factory_id
  ) then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  select authoritative_earnings.total_earned
  into total_earned
  from public.get_soil_total_earned(
    p_factory_id,
    p_soil_worker_id
  ) as authoritative_earnings;

  select
    coalesce(sum(adjustments.amount) filter (
      where adjustments.adjustment_type = 'ADDITION'
    ), 0),
    coalesce(sum(adjustments.amount) filter (
      where adjustments.adjustment_type = 'DEDUCTION'
    ), 0)
  into total_additions, total_deductions
  from public.soil_financial_adjustments as adjustments
  where adjustments.factory_id = p_factory_id
    and adjustments.soil_worker_id = p_soil_worker_id;

  select coalesce(sum(payments.amount), 0)
  into total_paid
  from public.soil_payments as payments
  where payments.factory_id = p_factory_id
    and payments.soil_worker_id = p_soil_worker_id;

  available_balance := total_earned
    + total_additions
    - total_deductions
    - total_paid;
  return next;
end;
$$;

create or replace function public.create_soil_payment(
  p_factory_id uuid,
  p_soil_worker_id uuid,
  p_payment_date date,
  p_amount numeric
)
returns table (
  payment_id uuid,
  payment_factory_id uuid,
  payment_soil_worker_id uuid,
  payment_date date,
  payment_amount numeric,
  created_at timestamptz,
  total_earned numeric,
  total_paid numeric,
  available_balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_summary record;
  new_payment public.soil_payments%rowtype;
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

  if p_soil_worker_id is null or not exists (
    select 1
    from public.soil_workers
    where soil_workers.id = p_soil_worker_id
      and soil_workers.factory_id = p_factory_id
  ) then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  if p_payment_date is null or not isfinite(p_payment_date) then
    raise exception 'payment_date must be a valid finite date.'
      using errcode = '22023';
  end if;

  if p_amount is null
    or p_amount <= 0
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric then
    raise exception 'amount must be a positive finite number.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('soil_financial:' || p_soil_worker_id::text)
  );

  select *
  into current_summary
  from public.get_soil_financial_summary(
    p_factory_id,
    p_soil_worker_id
  );

  if p_amount > current_summary.available_balance then
    raise exception 'Payment amount % exceeds available balance %.',
      p_amount,
      current_summary.available_balance
      using errcode = 'P2802';
  end if;

  insert into public.soil_payments (
    factory_id,
    soil_worker_id,
    payment_date,
    amount
  ) values (
    p_factory_id,
    p_soil_worker_id,
    p_payment_date,
    p_amount
  )
  returning * into new_payment;

  payment_id := new_payment.id;
  payment_factory_id := new_payment.factory_id;
  payment_soil_worker_id := new_payment.soil_worker_id;
  payment_date := new_payment.payment_date;
  payment_amount := new_payment.amount;
  created_at := new_payment.created_at;
  total_earned := current_summary.total_earned;
  total_paid := current_summary.total_paid + new_payment.amount;
  available_balance := current_summary.available_balance - new_payment.amount;

  return next;
end;
$$;

create or replace function public.create_soil_financial_adjustment(
  p_factory_id uuid,
  p_soil_worker_id uuid,
  p_adjustment_type text,
  p_adjustment_date date,
  p_amount numeric,
  p_reason text
)
returns table (
  adjustment_id uuid,
  adjustment_factory_id uuid,
  adjustment_soil_worker_id uuid,
  adjustment_type text,
  adjustment_date date,
  adjustment_amount numeric,
  adjustment_reason text,
  created_at timestamptz,
  total_earned numeric,
  total_additions numeric,
  total_deductions numeric,
  total_paid numeric,
  available_balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_reason text := nullif(btrim(p_reason), '');
  current_summary record;
  new_adjustment public.soil_financial_adjustments%rowtype;
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

  if p_soil_worker_id is null or not exists (
    select 1
    from public.soil_workers
    where soil_workers.id = p_soil_worker_id
      and soil_workers.factory_id = p_factory_id
  ) then
    raise exception 'Soil worker does not belong to this factory.'
      using errcode = 'P2602';
  end if;

  if p_adjustment_type is null
    or p_adjustment_type not in ('ADDITION', 'DEDUCTION') then
    raise exception 'adjustment_type must be ADDITION or DEDUCTION.'
      using errcode = '22023';
  end if;

  if p_adjustment_date is null or not isfinite(p_adjustment_date) then
    raise exception 'adjustment_date must be a valid finite date.'
      using errcode = '22023';
  end if;

  if p_amount is null
    or p_amount <= 0
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric then
    raise exception 'amount must be a positive finite number.'
      using errcode = '22023';
  end if;

  if normalized_reason is null then
    raise exception 'reason is required.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('soil_financial:' || p_soil_worker_id::text)
  );

  select *
  into current_summary
  from public.get_soil_financial_summary(
    p_factory_id,
    p_soil_worker_id
  );

  if p_adjustment_type = 'DEDUCTION'
    and p_amount > current_summary.available_balance then
    raise exception 'Deduction amount % exceeds available balance %.',
      p_amount,
      current_summary.available_balance
      using errcode = 'P2902';
  end if;

  insert into public.soil_financial_adjustments (
    factory_id,
    soil_worker_id,
    adjustment_type,
    adjustment_date,
    amount,
    reason
  ) values (
    p_factory_id,
    p_soil_worker_id,
    p_adjustment_type,
    p_adjustment_date,
    p_amount,
    normalized_reason
  )
  returning * into new_adjustment;

  adjustment_id := new_adjustment.id;
  adjustment_factory_id := new_adjustment.factory_id;
  adjustment_soil_worker_id := new_adjustment.soil_worker_id;
  adjustment_type := new_adjustment.adjustment_type;
  adjustment_date := new_adjustment.adjustment_date;
  adjustment_amount := new_adjustment.amount;
  adjustment_reason := new_adjustment.reason;
  created_at := new_adjustment.created_at;
  total_earned := current_summary.total_earned;
  total_additions := current_summary.total_additions;
  total_deductions := current_summary.total_deductions;
  total_paid := current_summary.total_paid;

  if new_adjustment.adjustment_type = 'ADDITION' then
    total_additions := total_additions + new_adjustment.amount;
    available_balance := current_summary.available_balance + new_adjustment.amount;
  else
    total_deductions := total_deductions + new_adjustment.amount;
    available_balance := current_summary.available_balance - new_adjustment.amount;
  end if;

  return next;
end;
$$;

revoke all on function public.prevent_soil_financial_adjustment_mutation()
  from public, anon, authenticated;
revoke all on function public.get_soil_financial_summary(uuid, uuid)
  from public, anon;
grant execute on function public.get_soil_financial_summary(uuid, uuid)
  to authenticated;
revoke all on function public.create_soil_payment(uuid, uuid, date, numeric)
  from public, anon;
grant execute on function public.create_soil_payment(uuid, uuid, date, numeric)
  to authenticated;
revoke all on function public.create_soil_financial_adjustment(
  uuid, uuid, text, date, numeric, text
) from public, anon;
grant execute on function public.create_soil_financial_adjustment(
  uuid, uuid, text, date, numeric, text
) to authenticated;

comment on table public.soil_financial_adjustments is
  'Immutable T5 manual Soil additions and deductions. They remain separate from trolley earnings and payments.';
