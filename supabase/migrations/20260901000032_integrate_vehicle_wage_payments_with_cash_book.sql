-- Atlas Vehicle Delivery Wage Account V3: derive Cash Book Money Out directly
-- from the immutable Vehicle wage payment ledger.

begin;

create index vehicle_wage_payments_factory_cash_book_idx
  on public.vehicle_wage_payments(
    factory_id,
    payment_date,
    created_at,
    id
  );

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
  where payments.factory_id = p_factory_id;
$$;

revoke all on function public.get_cash_book_source_movements(uuid)
  from public, anon, authenticated;

comment on function public.get_cash_book_source_movements(uuid) is
  'Private Cash Book source union. Customer receipts and expense or Vehicle wage payments each appear once per authoritative payment header; manual entries remain separate.';

commit;
