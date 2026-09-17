-- One explicit Coal seller settlement reuses the shared expense-payment engine,
-- while validating every selected purchase against the chosen seller and range.

begin;

create or replace function public.create_coal_selective_payment(
  p_factory_id uuid,
  p_seller_id uuid,
  p_from_date date,
  p_to_date date,
  p_payment_date date,
  p_payment_mode text,
  p_note text,
  p_allocations jsonb
)
returns public.expense_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  allocation_value jsonb;
  allocation_position integer;
  purchase_id uuid;
  allocation_amount numeric;
  purchase_ids uuid[] := array[]::uuid[];
  allocation_amounts numeric[] := array[]::numeric[];
  shared_allocations jsonb := '[]'::jsonb;
  payment_total numeric := 0;
  purchase_index integer;
  locked_count integer;
  target_record record;
  saved_payment public.expense_payments%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id
      and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_from_date is null or p_to_date is null
    or not isfinite(p_from_date) or not isfinite(p_to_date)
    or p_from_date > p_to_date then
    raise exception 'Choose a valid inclusive Coal date range.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.supplier_roles as seller_role
    where seller_role.factory_id = p_factory_id
      and seller_role.supplier_id = p_seller_id
      and seller_role.role = 'COAL_SELLER'
  ) then raise exception 'Choose a Coal Seller belonging to this factory.' using errcode = 'P4002'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) = 0
    or jsonb_array_length(p_allocations) > 100 then
    raise exception 'Select between 1 and 100 Coal Purchases.' using errcode = '22023';
  end if;

  for allocation_value, allocation_position in
    select allocation, ordinality::integer
    from jsonb_array_elements(p_allocations)
      with ordinality as supplied(allocation, ordinality)
  loop
    if jsonb_typeof(allocation_value) <> 'object'
      or not allocation_value ? 'purchase_id'
      or not allocation_value ? 'amount'
      or exists (
        select 1 from jsonb_object_keys(allocation_value) as supplied_keys(key)
        where supplied_keys.key not in ('purchase_id', 'amount')
      ) then
      raise exception 'Allocation % must contain only purchase_id and amount.',
        allocation_position using errcode = '22023';
    end if;
    begin
      purchase_id := (allocation_value ->> 'purchase_id')::uuid;
      allocation_amount := (allocation_value ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Allocation % contains an invalid purchase or amount.',
        allocation_position using errcode = '22023';
    end;
    if allocation_amount is null or allocation_amount <= 0
      or allocation_amount = 'NaN'::numeric or allocation_amount = 'Infinity'::numeric
      or allocation_amount >= 10000000000000000
      or allocation_amount <> round(allocation_amount, 2) then
      raise exception 'Allocation % must be positive and use at most two decimal places.',
        allocation_position using errcode = '22023';
    end if;
    if purchase_id = any(purchase_ids) then
      raise exception 'The same Coal Purchase cannot appear twice in one payment.' using errcode = '22023';
    end if;
    purchase_ids := array_append(purchase_ids, purchase_id);
    allocation_amounts := array_append(allocation_amounts, allocation_amount);
    payment_total := payment_total + allocation_amount;
    shared_allocations := shared_allocations || jsonb_build_array(jsonb_build_object(
      'expense_record_id', purchase_id, 'amount', allocation_amount
    ));
  end loop;

  -- Lock all selected obligations in the same stable order as the shared engine.
  perform records.id
  from public.expense_records as records
  join public.coal_purchases as coal
    on coal.id = records.id and coal.factory_id = records.factory_id
  where records.factory_id = p_factory_id
    and records.id = any(purchase_ids)
  order by records.id
  for update of records;
  get diagnostics locked_count = row_count;
  if locked_count <> array_length(purchase_ids, 1) then
    raise exception 'A selected Coal Purchase does not belong to this factory.' using errcode = 'P4210';
  end if;

  for purchase_index in 1..array_length(purchase_ids, 1)
  loop
    select records.supplier_id, records.business_date, records.status,
      records.total_amount, coalesce(sum(existing.allocated_amount), 0) as total_paid
    into target_record
    from public.expense_records as records
    join public.coal_purchases as coal
      on coal.id = records.id and coal.factory_id = records.factory_id
    left join public.expense_payment_allocations as existing
      on existing.expense_record_id = records.id
      and existing.factory_id = records.factory_id
    where records.factory_id = p_factory_id
      and records.id = purchase_ids[purchase_index]
    group by records.id;
    if not found or target_record.supplier_id <> p_seller_id
      or target_record.business_date < p_from_date
      or target_record.business_date > p_to_date
      or target_record.status <> 'active' then
      raise exception 'A selected Coal Purchase is outside this seller/date range or is no longer payable.'
        using errcode = 'P4210';
    end if;
    if target_record.total_paid > target_record.total_amount
      or allocation_amounts[purchase_index] > target_record.total_amount - target_record.total_paid then
      raise exception 'Allocation exceeds the current Coal Purchase outstanding amount.'
        using errcode = 'P4105';
    end if;
  end loop;

  perform set_config('atlas.internal_coal_purchase_write', 'on', true);
  select * into saved_payment from public.create_expense_payment(
    p_factory_id, p_payment_date, payment_total, p_payment_mode, p_note, shared_allocations
  );
  perform set_config('atlas.internal_coal_purchase_write', 'off', true);
  return saved_payment;
end;
$$;

create or replace function public.list_coal_selective_payments(
  p_factory_id uuid,
  p_seller_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  seller_id uuid,
  seller_name_snapshot text,
  allocation_count bigint,
  allocations jsonb,
  payment_date date,
  amount numeric,
  payment_mode text,
  note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users as authorized_user
    where authorized_user.user_id = auth.uid()
      and authorized_user.factory_id = p_factory_id
      and authorized_user.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if p_seller_id is not null and not exists (
    select 1 from public.supplier_roles as seller_role
    where seller_role.factory_id = p_factory_id
      and seller_role.supplier_id = p_seller_id
      and seller_role.role = 'COAL_SELLER'
  ) then raise exception 'Seller does not belong to this factory.' using errcode = 'P4002'; end if;

  return query
  select payments.id, payments.factory_id, records.supplier_id,
    min(records.counterparty_name_snapshot), count(payment_allocations.id),
    jsonb_agg(jsonb_build_object(
      'purchase_id', coal.id,
      'purchase_date', records.business_date,
      'coal_challan_number', coal.coal_challan_number,
      'coal_name_snapshot', coal.coal_name_snapshot,
      'source_location_snapshot', coal.source_location_snapshot,
      'vehicle_number_snapshot', coal.vehicle_number_snapshot,
      'allocated_amount', payment_allocations.allocated_amount
    ) order by records.business_date, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as payment_allocations
    on payment_allocations.payment_id = payments.id
    and payment_allocations.factory_id = payments.factory_id
  join public.coal_purchases as coal
    on coal.id = payment_allocations.expense_record_id
    and coal.factory_id = payment_allocations.factory_id
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  where payments.factory_id = p_factory_id
    and (p_seller_id is null or records.supplier_id = p_seller_id)
  group by payments.id, payments.factory_id, records.supplier_id,
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc;
end;
$$;

create or replace function public.get_expense_payment_cash_book_description(
  p_factory_id uuid,
  p_payment_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when bool_and(coal.id is not null) and count(*) > 1
      then 'Coal seller settlement · ' || count(*)::text || ' purchases'
    else 'Payment for ' || string_agg(records.description, ', ' order by records.description, records.id)
  end
  from public.expense_payment_allocations as allocations
  join public.expense_records as records
    on records.id = allocations.expense_record_id
    and records.factory_id = allocations.factory_id
  left join public.coal_purchases as coal
    on coal.id = records.id and coal.factory_id = records.factory_id
  where allocations.factory_id = p_factory_id
    and allocations.payment_id = p_payment_id;
$$;

create or replace function public.get_cash_book_source_movements(
  p_factory_id uuid
)
returns table (
  source_type text, source_id uuid, business_date date, direction text,
  amount numeric, payment_mode text, counterparty text, description text,
  note text, source_status text, created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select 'customer_payment'::text, payments.id, payments.payment_date, 'in'::text,
    payments.amount, payments.payment_mode, payments.customer_name_snapshot,
    coalesce((select 'Challans ' || string_agg('#' || challans.challan_number::text, ', ' order by challans.challan_number)
      from public.customer_payment_allocations as allocations
      join public.challans on challans.id = allocations.challan_id and challans.factory_id = allocations.factory_id
      where allocations.factory_id = payments.factory_id and allocations.payment_id = payments.id), 'Customer payment'),
    payments.note, 'active'::text, payments.created_at
  from public.customer_payments as payments where payments.factory_id = p_factory_id

  union all

  select 'manual_cash_entry'::text, entries.id, entries.business_date, entries.direction,
    entries.amount, entries.payment_mode, entries.party_details,
    case entries.direction when 'in' then 'Manual Money In' else 'Manual Money Out' end,
    entries.note, entries.status, entries.created_at
  from public.cash_book_manual_entries as entries where entries.factory_id = p_factory_id

  union all

  select 'expense_payment'::text, payments.id, payments.payment_date, 'out'::text,
    payments.amount, payments.payment_mode,
    coalesce((select string_agg(counterparties.name, ', ' order by counterparties.name)
      from (select distinct records.counterparty_name_snapshot as name
        from public.expense_payment_allocations as allocations
        join public.expense_records as records on records.id = allocations.expense_record_id and records.factory_id = allocations.factory_id
        where allocations.factory_id = payments.factory_id and allocations.payment_id = payments.id) as counterparties), 'Expense payment'),
    coalesce(public.get_expense_payment_cash_book_description(payments.factory_id, payments.id), 'Expense payment'),
    payments.note, 'active'::text, payments.created_at
  from public.expense_payments as payments where payments.factory_id = p_factory_id

  union all

  select 'vehicle_wage_payment'::text, payments.id, payments.payment_date, 'out'::text,
    payments.amount, 'unspecified'::text, vehicles.vehicle_number,
    'Vehicle Wage Payment'::text, payments.note, 'active'::text, payments.created_at
  from public.vehicle_wage_payments as payments
  join public.vehicles as vehicles on vehicles.id = payments.vehicle_id and vehicles.factory_id = payments.factory_id
  where payments.factory_id = p_factory_id

  union all

  select 'vehicle_wage_payment_reversal'::text, reversals.id, reversals.reversal_date, 'in'::text,
    payments.amount, 'unspecified'::text, vehicles.vehicle_number,
    'Vehicle Wage Payment Reversal'::text, reversals.reason, 'active'::text, reversals.created_at
  from public.vehicle_wage_payment_reversals as reversals
  join public.vehicle_wage_payments as payments on payments.id = reversals.payment_id and payments.factory_id = reversals.factory_id
  join public.vehicles as vehicles on vehicles.id = payments.vehicle_id and vehicles.factory_id = payments.factory_id
  where reversals.factory_id = p_factory_id;
$$;

revoke all on function public.create_coal_selective_payment(uuid, uuid, date, date, date, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_coal_selective_payment(uuid, uuid, date, date, date, text, text, jsonb)
  to authenticated;
revoke all on function public.list_coal_selective_payments(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_coal_selective_payments(uuid, uuid) to authenticated;
revoke all on function public.get_expense_payment_cash_book_description(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_cash_book_source_movements(uuid)
  from public, anon, authenticated;

comment on function public.create_coal_selective_payment(uuid, uuid, date, date, date, text, text, jsonb) is
  'Atomically validates explicit Coal allocations against one seller and inclusive range, then delegates one immutable payment to the shared expense-payment engine.';
comment on function public.list_coal_selective_payments(uuid, uuid) is
  'Returns one immutable Coal seller payment row with its ordered allocation breakdown.';
comment on function public.get_expense_payment_cash_book_description(uuid, uuid) is
  'Keeps multi-purchase Coal settlements concise in Cash Book while preserving existing descriptions for every other expense payment.';

commit;
