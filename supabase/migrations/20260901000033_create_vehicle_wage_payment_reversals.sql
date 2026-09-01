-- Atlas Vehicle Delivery Wage Account V4: immutable full payment reversals,
-- effective Paid authority, and append-only Cash Book correction movements.

begin;

create table public.vehicle_wage_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  payment_id uuid not null unique,
  reversal_date date not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint vehicle_wage_payment_reversals_id_factory_key
    unique (id, factory_id),
  constraint vehicle_wage_payment_reversals_payment_factory_fkey
    foreign key (payment_id, factory_id)
    references public.vehicle_wage_payments(id, factory_id) on delete restrict,
  constraint vehicle_wage_payment_reversals_date_check
    check (isfinite(reversal_date)),
  constraint vehicle_wage_payment_reversals_reason_check check (
    reason <> ''
    and reason = btrim(reason)
    and reason = regexp_replace(reason, '[[:space:]]+', ' ', 'g')
    and length(reason) <= 500
    and reason !~ '[[:cntrl:]]'
  )
);

create index vehicle_wage_payment_reversals_factory_history_idx
  on public.vehicle_wage_payment_reversals(
    factory_id,
    reversal_date desc,
    created_at desc,
    id desc
  );

create or replace function public.prevent_vehicle_wage_payment_reversal_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Vehicle wage payment reversal history is immutable.'
    using errcode = 'P3122';
end;
$$;

create trigger vehicle_wage_payment_reversals_are_immutable
before update or delete on public.vehicle_wage_payment_reversals
for each row execute function public.prevent_vehicle_wage_payment_reversal_mutation();

alter table public.vehicle_wage_payment_reversals enable row level security;

revoke all on public.vehicle_wage_payment_reversals
  from public, anon, authenticated;
grant select on public.vehicle_wage_payment_reversals to authenticated;

create policy "Authenticated users can read their factory Vehicle wage payment reversals"
  on public.vehicle_wage_payment_reversals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.factory_users
      where factory_users.user_id = auth.uid()
        and factory_users.factory_id = vehicle_wage_payment_reversals.factory_id
        and factory_users.is_active = true
    )
  );

-- This remains the single join-free authority used by payment writes, account
-- summaries, reversal writes, and the Challan solvency trigger. A reversed
-- payment is preserved but excluded from effective Paid exactly once.
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
          and not exists (
            select 1
            from public.vehicle_wage_payment_reversals as reversals
            where reversals.factory_id = payments.factory_id
              and reversals.payment_id = payments.id
          )
      ), 0)::numeric as total_paid
  ) as totals;
$$;

create or replace function public.reverse_vehicle_wage_payment(
  p_factory_id uuid,
  p_payment_id uuid,
  p_reversal_date date,
  p_reason text
)
returns table (
  reversal_id uuid,
  reversal_factory_id uuid,
  reversed_payment_id uuid,
  reversal_vehicle_id uuid,
  reversal_date date,
  reversal_amount numeric,
  reversal_reason text,
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
  normalized_reason text := btrim(regexp_replace(
    coalesce(p_reason, ''), '[[:space:]]+', ' ', 'g'
  ));
  target_payment public.vehicle_wage_payments%rowtype;
  new_reversal public.vehicle_wage_payment_reversals%rowtype;
  current_account record;
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

  select * into target_payment
  from public.vehicle_wage_payments as payments
  where payments.id = p_payment_id
    and payments.factory_id = p_factory_id;
  if not found then
    raise exception 'Vehicle wage payment does not belong to this factory.'
      using errcode = 'P3120';
  end if;

  if p_reversal_date is null or not isfinite(p_reversal_date)
    or p_reversal_date < target_payment.payment_date then
    raise exception 'Reversal date must be on or after the original payment date.'
      using errcode = '22023';
  end if;
  if normalized_reason = ''
    or length(normalized_reason) > 500
    or normalized_reason ~ '[[:cntrl:]]' then
    raise exception 'Reversal reason is required and must be at most 500 characters.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_factory_id::text),
    hashtext('vehicle_wage_account:' || target_payment.vehicle_id::text)
  );

  if exists (
    select 1
    from public.vehicle_wage_payment_reversals as reversals
    where reversals.payment_id = target_payment.id
  ) then
    raise exception 'This Vehicle wage payment has already been reversed.'
      using errcode = 'P3121';
  end if;

  insert into public.vehicle_wage_payment_reversals(
    factory_id, payment_id, reversal_date, reason, created_by
  ) values (
    p_factory_id, target_payment.id, p_reversal_date,
    normalized_reason, auth.uid()
  ) returning * into new_reversal;

  select * into current_account
  from public.get_vehicle_wage_account_totals(
    p_factory_id,
    target_payment.vehicle_id
  );

  reversal_id := new_reversal.id;
  reversal_factory_id := new_reversal.factory_id;
  reversed_payment_id := new_reversal.payment_id;
  reversal_vehicle_id := target_payment.vehicle_id;
  reversal_date := new_reversal.reversal_date;
  reversal_amount := target_payment.amount;
  reversal_reason := new_reversal.reason;
  created_at := new_reversal.created_at;
  created_by := new_reversal.created_by;
  total_earned := current_account.total_earned;
  total_paid := current_account.total_paid;
  available_balance := current_account.available_balance;
  return next;
end;
$$;

create or replace function public.get_cash_book_source_movements(
  p_factory_id uuid
)
returns table (
  source_type text,
  source_id uuid,
  business_date date,
  direction text,
  amount numeric,
  payment_mode text,
  counterparty text,
  description text,
  note text,
  source_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    'customer_payment'::text, payments.id, payments.payment_date, 'in'::text,
    payments.amount, payments.payment_mode, payments.customer_name_snapshot,
    coalesce((
      select 'Challans ' || string_agg(
        '#' || challans.challan_number::text, ', ' order by challans.challan_number
      )
      from public.customer_payment_allocations as allocations
      join public.challans
        on challans.id = allocations.challan_id
        and challans.factory_id = allocations.factory_id
      where allocations.factory_id = payments.factory_id
        and allocations.payment_id = payments.id
    ), 'Customer payment'),
    payments.note, 'active'::text, payments.created_at
  from public.customer_payments as payments
  where payments.factory_id = p_factory_id

  union all

  select
    'manual_cash_entry'::text, entries.id, entries.business_date, entries.direction,
    entries.amount, entries.payment_mode, entries.party_details,
    case entries.direction when 'in' then 'Manual Money In' else 'Manual Money Out' end,
    entries.note, entries.status, entries.created_at
  from public.cash_book_manual_entries as entries
  where entries.factory_id = p_factory_id

  union all

  select
    'expense_payment'::text, payments.id, payments.payment_date, 'out'::text,
    payments.amount, payments.payment_mode,
    coalesce((
      select string_agg(counterparties.name, ', ' order by counterparties.name)
      from (
        select distinct records.counterparty_name_snapshot as name
        from public.expense_payment_allocations as allocations
        join public.expense_records as records
          on records.id = allocations.expense_record_id
          and records.factory_id = allocations.factory_id
        where allocations.factory_id = payments.factory_id
          and allocations.payment_id = payments.id
      ) as counterparties
    ), 'Expense payment'),
    coalesce((
      select 'Payment for ' || string_agg(
        records.description, ', ' order by records.description, records.id
      )
      from public.expense_payment_allocations as allocations
      join public.expense_records as records
        on records.id = allocations.expense_record_id
        and records.factory_id = allocations.factory_id
      where allocations.factory_id = payments.factory_id
        and allocations.payment_id = payments.id
    ), 'Expense payment'),
    payments.note, 'active'::text, payments.created_at
  from public.expense_payments as payments
  where payments.factory_id = p_factory_id

  union all

  select
    'vehicle_wage_payment'::text, payments.id, payments.payment_date, 'out'::text,
    payments.amount, 'unspecified'::text, vehicles.vehicle_number,
    'Vehicle Wage Payment'::text,
    payments.note, 'active'::text, payments.created_at
  from public.vehicle_wage_payments as payments
  join public.vehicles as vehicles
    on vehicles.id = payments.vehicle_id
    and vehicles.factory_id = payments.factory_id
  where payments.factory_id = p_factory_id

  union all

  select
    'vehicle_wage_payment_reversal'::text, reversals.id,
    reversals.reversal_date, 'in'::text,
    payments.amount, 'unspecified'::text, vehicles.vehicle_number,
    'Vehicle Wage Payment Reversal'::text,
    reversals.reason, 'active'::text, reversals.created_at
  from public.vehicle_wage_payment_reversals as reversals
  join public.vehicle_wage_payments as payments
    on payments.id = reversals.payment_id
    and payments.factory_id = reversals.factory_id
  join public.vehicles as vehicles
    on vehicles.id = payments.vehicle_id
    and vehicles.factory_id = payments.factory_id
  where reversals.factory_id = p_factory_id;
$$;

revoke all on function public.prevent_vehicle_wage_payment_reversal_mutation()
  from public, anon, authenticated;
revoke all on function public.get_vehicle_wage_account_totals(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_cash_book_source_movements(uuid)
  from public, anon, authenticated;

revoke all on function public.reverse_vehicle_wage_payment(uuid, uuid, date, text)
  from public, anon;
grant execute on function public.reverse_vehicle_wage_payment(uuid, uuid, date, text)
  to authenticated;

comment on table public.vehicle_wage_payment_reversals is
  'Immutable full reversals of Vehicle wage payments. Original payments remain preserved and each payment can be reversed at most once.';
comment on column public.vehicle_wage_payment_reversals.reversal_date is
  'Business date of the correcting Cash Book Money In; it cannot predate the original payment.';
comment on column public.vehicle_wage_payment_reversals.reason is
  'Required normalized audit reason for fully reversing the linked immutable payment.';
comment on function public.prevent_vehicle_wage_payment_reversal_mutation() is
  'Rejects all UPDATE and DELETE attempts against immutable Vehicle wage payment reversals.';
comment on function public.get_vehicle_wage_account_totals(uuid, uuid) is
  'Private join-free authority for lifetime eligible Challan earnings, effective unreversed payments, and available balance.';
comment on function public.reverse_vehicle_wage_payment(uuid, uuid, date, text) is
  'Serializes one immutable full payment reversal and returns authoritative effective Vehicle wage totals.';
comment on function public.get_cash_book_source_movements(uuid) is
  'Private Cash Book source union. Vehicle wage payments remain Money Out and their immutable full reversals appear once as correcting Money In.';

commit;
