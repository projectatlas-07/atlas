-- Atlas Vehicle Delivery Wage Account V2: immutable settlement payments and
-- authoritative lifetime Earned / Paid / Available balance protection.

begin;

create table public.vehicle_wage_payments (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  vehicle_id uuid not null,
  payment_date date not null,
  amount numeric(14, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint vehicle_wage_payments_id_factory_key unique (id, factory_id),
  constraint vehicle_wage_payments_vehicle_factory_fkey
    foreign key (vehicle_id, factory_id)
    references public.vehicles(id, factory_id) on delete restrict,
  constraint vehicle_wage_payments_date_check check (isfinite(payment_date)),
  constraint vehicle_wage_payments_amount_check check (
    amount > 0
    and amount < 1000000000
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
    and amount = round(amount, 2)
  ),
  constraint vehicle_wage_payments_note_check check (
    note is null or (
      note <> ''
      and note = btrim(note)
      and note = regexp_replace(note, '[[:space:]]+', ' ', 'g')
      and length(note) <= 500
      and note !~ '[[:cntrl:]]'
    )
  )
);

create index vehicle_wage_payments_factory_vehicle_history_idx
  on public.vehicle_wage_payments(
    factory_id,
    vehicle_id,
    payment_date desc,
    created_at desc,
    id desc
  );

create or replace function public.prevent_vehicle_wage_payment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Vehicle wage payment history is immutable.'
    using errcode = 'P3112';
end;
$$;

create trigger vehicle_wage_payments_are_immutable
before update or delete on public.vehicle_wage_payments
for each row execute function public.prevent_vehicle_wage_payment_mutation();

alter table public.vehicle_wage_payments enable row level security;

revoke all on public.vehicle_wage_payments from public, anon, authenticated;
grant select on public.vehicle_wage_payments to authenticated;

create policy "Authenticated users can read their factory Vehicle wage payments"
  on public.vehicle_wage_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = vehicle_wage_payments.factory_id
        and factory_users.is_active = true
    )
  );

-- Private, join-free account authority. Keeping the two aggregates separate
-- prevents a Challan/payment join from multiplying either lifetime total.
create or replace function public.get_vehicle_wage_account_totals(
  p_factory_id uuid,
  p_vehicle_id uuid
)
returns table (
  total_earned numeric,
  total_paid numeric,
  available_balance numeric
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    totals.total_earned,
    totals.total_paid,
    totals.total_earned - totals.total_paid as available_balance
  from (
    select
      coalesce((
        select sum(challans.trip_labour_wage)
        from public.challans
        where challans.factory_id = p_factory_id
          and challans.vehicle_id = p_vehicle_id
          and challans.status = 'active'
          and challans.vehicle_number_snapshot is not null
          and challans.delivery_wage_applicable_snapshot = true
          and challans.trip_labour_wage > 0
      ), 0)::numeric as total_earned,
      coalesce((
        select sum(payments.amount)
        from public.vehicle_wage_payments as payments
        where payments.factory_id = p_factory_id
          and payments.vehicle_id = p_vehicle_id
      ), 0)::numeric as total_paid
  ) as totals;
$$;

create or replace function public.get_vehicle_wage_account_summary(
  p_factory_id uuid,
  p_vehicle_id uuid
)
returns table (
  total_earned numeric,
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
    raise exception 'You do not have access to this factory.' using errcode = '42501';
  end if;

  if p_vehicle_id is null or not exists (
    select 1
    from public.vehicles
    where vehicles.id = p_vehicle_id
      and vehicles.factory_id = p_factory_id
  ) then
    raise exception 'Vehicle does not belong to this factory.' using errcode = 'P3102';
  end if;

  return query
  select account.total_earned, account.total_paid, account.available_balance
  from public.get_vehicle_wage_account_totals(
    p_factory_id,
    p_vehicle_id
  ) as account;
end;
$$;

create or replace function public.record_vehicle_wage_payment(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text default null
)
returns table (
  payment_id uuid,
  payment_factory_id uuid,
  payment_vehicle_id uuid,
  payment_date date,
  payment_amount numeric,
  payment_note text,
  created_at timestamptz,
  created_by uuid,
  total_earned numeric,
  total_paid numeric,
  available_balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_note text := nullif(btrim(regexp_replace(
    coalesce(p_note, ''), '[[:space:]]+', ' ', 'g'
  )), '');
  current_account record;
  new_payment public.vehicle_wage_payments%rowtype;
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

  if p_vehicle_id is null or not exists (
    select 1
    from public.vehicles
    where vehicles.id = p_vehicle_id
      and vehicles.factory_id = p_factory_id
  ) then
    raise exception 'Vehicle does not belong to this factory.' using errcode = 'P3102';
  end if;

  if p_payment_date is null or not isfinite(p_payment_date) then
    raise exception 'Payment date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_amount is null
    or p_amount <= 0
    or p_amount >= 1000000000
    or p_amount = 'NaN'::numeric
    or p_amount = 'Infinity'::numeric
    or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be positive and use at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_note is not null and (
    length(normalized_note) > 500 or normalized_note ~ '[[:cntrl:]]'
  ) then
    raise exception 'Payment note must be at most 500 characters and contain no control characters.'
      using errcode = '22023';
  end if;

  -- Payment writers and Challan exposure guards share this exact account lock.
  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('vehicle_wage_account:' || p_vehicle_id::text)
  );

  select * into current_account
  from public.get_vehicle_wage_account_totals(p_factory_id, p_vehicle_id);

  if current_account.total_paid > current_account.total_earned then
    raise exception 'Stored Vehicle wage payments exceed eligible earnings.'
      using errcode = 'P3113';
  end if;
  if p_amount > current_account.available_balance then
    raise exception 'Payment exceeds available Vehicle wage balance.'
      using errcode = 'P3110';
  end if;

  insert into public.vehicle_wage_payments(
    factory_id, vehicle_id, payment_date, amount, note, created_by
  ) values (
    p_factory_id, p_vehicle_id, p_payment_date, p_amount,
    normalized_note, auth.uid()
  ) returning * into new_payment;

  payment_id := new_payment.id;
  payment_factory_id := new_payment.factory_id;
  payment_vehicle_id := new_payment.vehicle_id;
  payment_date := new_payment.payment_date;
  payment_amount := new_payment.amount;
  payment_note := new_payment.note;
  created_at := new_payment.created_at;
  created_by := new_payment.created_by;
  total_earned := current_account.total_earned;
  total_paid := current_account.total_paid + new_payment.amount;
  available_balance := current_account.available_balance - new_payment.amount;
  return next;
end;
$$;

create or replace function public.guard_challan_vehicle_wage_balance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  affected_vehicle_ids uuid[];
  affected_vehicle_id uuid;
  current_account record;
  old_eligible_amount numeric := 0;
  new_eligible_amount numeric := 0;
  projected_earned numeric;
begin
  if new.status is not distinct from old.status
    and new.vehicle_id is not distinct from old.vehicle_id
    and new.vehicle_number_snapshot is not distinct from old.vehicle_number_snapshot
    and new.delivery_wage_applicable_snapshot
      is not distinct from old.delivery_wage_applicable_snapshot
    and new.trip_labour_wage is not distinct from old.trip_labour_wage then
    return new;
  end if;

  select array_agg(vehicle_id order by vehicle_id)
  into affected_vehicle_ids
  from (
    select distinct vehicle_id
    from unnest(array[old.vehicle_id, new.vehicle_id]) as changed(vehicle_id)
    where vehicle_id is not null
  ) as affected;

  if affected_vehicle_ids is null then
    return new;
  end if;

  -- Deterministic UUID order prevents two opposite Vehicle moves deadlocking.
  foreach affected_vehicle_id in array affected_vehicle_ids
  loop
    perform pg_advisory_xact_lock(
      hashtext(old.factory_id::text),
      hashtext('vehicle_wage_account:' || affected_vehicle_id::text)
    );
  end loop;

  foreach affected_vehicle_id in array affected_vehicle_ids
  loop
    select * into current_account
    from public.get_vehicle_wage_account_totals(
      old.factory_id,
      affected_vehicle_id
    );

    old_eligible_amount := case
      when old.status = 'active'
        and old.vehicle_id = affected_vehicle_id
        and old.vehicle_number_snapshot is not null
        and old.delivery_wage_applicable_snapshot = true
        and old.trip_labour_wage > 0
      then old.trip_labour_wage
      else 0
    end;
    new_eligible_amount := case
      when new.status = 'active'
        and new.vehicle_id = affected_vehicle_id
        and new.vehicle_number_snapshot is not null
        and new.delivery_wage_applicable_snapshot = true
        and new.trip_labour_wage > 0
      then new.trip_labour_wage
      else 0
    end;
    projected_earned := current_account.total_earned
      - old_eligible_amount
      + new_eligible_amount;

    if current_account.total_paid > projected_earned then
      raise exception 'This Challan change would overpay the Vehicle wage account.'
        using errcode = 'P3111';
    end if;
  end loop;

  return new;
end;
$$;

-- PostgreSQL runs same-event triggers by name. The historical header guard runs
-- first; this targeted account guard then evaluates the final proposed snapshot.
create trigger challans_vehicle_wage_balance_guard
before update on public.challans
for each row execute function public.guard_challan_vehicle_wage_balance();

revoke all on function public.prevent_vehicle_wage_payment_mutation()
  from public, anon, authenticated;
revoke all on function public.get_vehicle_wage_account_totals(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.guard_challan_vehicle_wage_balance()
  from public, anon, authenticated;

revoke all on function public.get_vehicle_wage_account_summary(uuid, uuid)
  from public, anon;
grant execute on function public.get_vehicle_wage_account_summary(uuid, uuid)
  to authenticated;
revoke all on function public.record_vehicle_wage_payment(
  uuid, uuid, date, numeric, text
) from public, anon;
grant execute on function public.record_vehicle_wage_payment(
  uuid, uuid, date, numeric, text
) to authenticated;

comment on table public.vehicle_wage_payments is
  'Immutable Vehicle Delivery Wage settlement history. Eligible earnings remain derived directly from active Challan snapshots.';
comment on column public.vehicle_wage_payments.payment_date is
  'Business date on which the Vehicle wage settlement occurred.';
comment on column public.vehicle_wage_payments.created_by is
  'Authenticated Atlas user who recorded this immutable payment.';
comment on function public.prevent_vehicle_wage_payment_mutation() is
  'Rejects all UPDATE and DELETE attempts against immutable Vehicle wage payments.';
comment on function public.get_vehicle_wage_account_totals(uuid, uuid) is
  'Private join-free authority for lifetime eligible Challan earnings, immutable payments, and available balance.';
comment on function public.get_vehicle_wage_account_summary(uuid, uuid) is
  'Returns authorized lifetime Vehicle wage Earned, Paid, and Available totals regardless of current archive or Tracking state.';
comment on function public.record_vehicle_wage_payment(uuid, uuid, date, numeric, text) is
  'Serializes one immutable Vehicle wage payment, rechecks lifetime available balance, and returns authoritative resulting totals.';
comment on function public.guard_challan_vehicle_wage_balance() is
  'Serializes Vehicle wage exposure changes and rejects any Challan update or void that would make lifetime paid exceed eligible earned.';

commit;
