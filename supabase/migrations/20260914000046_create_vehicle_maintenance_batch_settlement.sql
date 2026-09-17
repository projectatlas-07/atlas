-- One Garage payment automatically settles eligible Vehicle Maintenance jobs
-- oldest-first while reusing the shared immutable expense-payment engine.

begin;

-- Permit trusted Maintenance batches to exceed the direct-call allocation cap,
-- matching the existing trusted Fuel batch behavior.
create or replace function public.create_expense_payment(
  p_factory_id uuid,
  p_payment_date date,
  p_amount numeric,
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
  allocation_record_id uuid;
  allocation_amount numeric;
  allocation_record_ids uuid[] := array[]::uuid[];
  allocation_amounts numeric[] := array[]::numeric[];
  allocation_total numeric := 0;
  allocation_index integer;
  existing_paid numeric;
  normalized_payment_mode text := lower(btrim(coalesce(p_payment_mode, '')));
  normalized_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:space:]]+', ' ', 'g')), '');
  target_record public.expense_records%rowtype;
  new_payment public.expense_payments%rowtype;
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
    raise exception 'Payment date must be a finite calendar date.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount = 'NaN'::numeric or p_amount = 'Infinity'::numeric
    or p_amount >= 10000000000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be positive and use at most two decimal places.'
      using errcode = '22023';
  end if;
  if normalized_payment_mode not in ('cash', 'upi', 'bank_transfer', 'cheque', 'other') then
    raise exception 'Choose a supported payment mode.' using errcode = 'P3200';
  end if;
  if normalized_note is not null
    and (length(normalized_note) > 500 or normalized_note ~ '[[:cntrl:]]') then
    raise exception 'Payment note must be at most 500 characters.' using errcode = '22023';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) = 0
    or (
      jsonb_array_length(p_allocations) > 100
      and current_setting('atlas.internal_vehicle_fuel_write', true) is distinct from 'on'
      and current_setting('atlas.internal_vehicle_maintenance_write', true) is distinct from 'on'
    ) then
    raise exception 'A payment requires between 1 and 100 allocations.' using errcode = '22023';
  end if;

  for allocation_value, allocation_position in
    select allocation, ordinality::integer
    from jsonb_array_elements(p_allocations)
      with ordinality as supplied(allocation, ordinality)
  loop
    if jsonb_typeof(allocation_value) <> 'object'
      or not allocation_value ? 'expense_record_id'
      or not allocation_value ? 'amount'
      or exists (
        select 1 from jsonb_object_keys(allocation_value) as supplied_keys(key)
        where supplied_keys.key not in ('expense_record_id', 'amount')
      ) then
      raise exception 'Allocation % must contain only expense_record_id and amount.',
        allocation_position using errcode = '22023';
    end if;
    begin
      allocation_record_id := (allocation_value ->> 'expense_record_id')::uuid;
      allocation_amount := (allocation_value ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Allocation % contains an invalid record or amount.',
        allocation_position using errcode = '22023';
    end;
    if allocation_amount is null or allocation_amount <= 0
      or allocation_amount = 'NaN'::numeric or allocation_amount = 'Infinity'::numeric
      or allocation_amount >= 10000000000000000
      or allocation_amount <> round(allocation_amount, 2) then
      raise exception 'Allocation % must be positive and use at most two decimal places.',
        allocation_position using errcode = '22023';
    end if;
    if allocation_record_id = any(allocation_record_ids) then
      raise exception 'The same Expense/Purchase cannot appear twice in one payment.'
        using errcode = '22023';
    end if;
    allocation_record_ids := array_append(allocation_record_ids, allocation_record_id);
    allocation_amounts := array_append(allocation_amounts, allocation_amount);
    allocation_total := allocation_total + allocation_amount;
  end loop;

  if allocation_total <> p_amount then
    raise exception 'Allocation total % must equal payment amount %.', allocation_total, p_amount
      using errcode = 'P4101';
  end if;

  perform target.id
  from public.expense_records as target
  where target.factory_id = p_factory_id
    and target.id = any(allocation_record_ids)
  order by target.id
  for update;

  for allocation_index in 1..array_length(allocation_record_ids, 1)
  loop
    select * into target_record
    from public.expense_records
    where id = allocation_record_ids[allocation_index]
      and factory_id = p_factory_id;
    if not found then
      raise exception 'Expense/Purchase does not belong to this factory.' using errcode = 'P4102';
    end if;
    if target_record.status <> 'active' then
      raise exception 'A void Expense/Purchase cannot receive a payment.' using errcode = 'P4103';
    end if;
    select coalesce(sum(allocated_amount), 0) into existing_paid
    from public.expense_payment_allocations
    where factory_id = p_factory_id
      and expense_record_id = target_record.id;
    if existing_paid > target_record.total_amount then
      raise exception 'Stored allocations exceed the Expense/Purchase total.' using errcode = 'P4107';
    end if;
    if allocation_amounts[allocation_index] > target_record.total_amount - existing_paid then
      raise exception 'Allocation exceeds the Expense/Purchase outstanding amount.'
        using errcode = 'P4105';
    end if;
  end loop;

  insert into public.expense_payments(
    factory_id, payment_date, amount, payment_mode, note, created_by
  ) values (
    p_factory_id, p_payment_date, p_amount, normalized_payment_mode, normalized_note, auth.uid()
  ) returning * into new_payment;

  for allocation_index in 1..array_length(allocation_record_ids, 1)
  loop
    insert into public.expense_payment_allocations(
      factory_id, payment_id, expense_record_id, allocated_amount
    ) values (
      p_factory_id, new_payment.id, allocation_record_ids[allocation_index],
      allocation_amounts[allocation_index]
    );
  end loop;

  update public.expense_records
  set is_locked = true
  where factory_id = p_factory_id
    and id = any(allocation_record_ids)
    and not is_locked;
  return new_payment;
end;
$$;

create or replace function public.create_vehicle_maintenance_batch_payment(
  p_factory_id uuid,
  p_garage_id uuid,
  p_from_date date,
  p_to_date date,
  p_payment_date date,
  p_amount numeric,
  p_payment_mode text,
  p_note text
)
returns public.expense_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  candidate record;
  period_outstanding numeric := 0;
  remaining_amount numeric := p_amount;
  allocation_amount numeric;
  allocations jsonb := '[]'::jsonb;
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
    raise exception 'Choose a valid inclusive Maintenance date range.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.supplier_roles as garage_role
    where garage_role.factory_id = p_factory_id
      and garage_role.supplier_id = p_garage_id
      and garage_role.role = 'GARAGE'
  ) then raise exception 'Choose a Garage belonging to this factory.' using errcode = 'P4303'; end if;

  -- Locks serialize competing settlements. UUID order matches the shared engine.
  perform records.id
  from public.expense_records as records
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = records.id and maintenance.factory_id = records.factory_id
  where records.factory_id = p_factory_id
    and records.supplier_id = p_garage_id
    and records.business_date between p_from_date and p_to_date
    and records.status = 'active'
  order by records.id
  for update of records;

  select coalesce(sum(eligible.outstanding_amount), 0)
  into period_outstanding
  from (
    select records.total_amount - coalesce(sum(existing.allocated_amount), 0) as outstanding_amount
    from public.expense_records as records
    join public.vehicle_maintenance_records as maintenance
      on maintenance.id = records.id and maintenance.factory_id = records.factory_id
    left join public.expense_payment_allocations as existing
      on existing.expense_record_id = records.id
      and existing.factory_id = records.factory_id
    where records.factory_id = p_factory_id
      and records.supplier_id = p_garage_id
      and records.business_date between p_from_date and p_to_date
      and records.status = 'active'
    group by records.id, records.total_amount
    having records.total_amount - coalesce(sum(existing.allocated_amount), 0) > 0
  ) as eligible;

  if p_amount is null or p_amount <= 0
    or p_amount = 'NaN'::numeric or p_amount = 'Infinity'::numeric
    or p_amount >= 10000000000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be positive and use at most two decimal places.' using errcode = '22023';
  end if;
  if period_outstanding <= 0 or p_amount > period_outstanding then
    raise exception 'Payment exceeds current outstanding Maintenance dues for this Garage and date range.'
      using errcode = 'P4310';
  end if;

  for candidate in
    select records.id,
      records.total_amount - coalesce(sum(existing.allocated_amount), 0) as outstanding_amount
    from public.expense_records as records
    join public.vehicle_maintenance_records as maintenance
      on maintenance.id = records.id and maintenance.factory_id = records.factory_id
    left join public.expense_payment_allocations as existing
      on existing.expense_record_id = records.id
      and existing.factory_id = records.factory_id
    where records.factory_id = p_factory_id
      and records.supplier_id = p_garage_id
      and records.business_date between p_from_date and p_to_date
      and records.status = 'active'
    group by records.id, records.business_date, records.created_at, records.total_amount
    having records.total_amount - coalesce(sum(existing.allocated_amount), 0) > 0
    order by records.business_date, records.created_at, records.id
  loop
    allocation_amount := least(remaining_amount, candidate.outstanding_amount);
    allocations := allocations || jsonb_build_array(jsonb_build_object(
      'expense_record_id', candidate.id,
      'amount', allocation_amount
    ));
    remaining_amount := remaining_amount - allocation_amount;
    exit when remaining_amount = 0;
  end loop;

  if remaining_amount <> 0 then
    raise exception 'Could not allocate the full Garage payment.' using errcode = 'P4310';
  end if;

  perform set_config('atlas.internal_vehicle_maintenance_write', 'on', true);
  select * into saved_payment from public.create_expense_payment(
    p_factory_id, p_payment_date, p_amount, p_payment_mode, p_note, allocations
  );
  perform set_config('atlas.internal_vehicle_maintenance_write', 'off', true);
  return saved_payment;
end;
$$;

create or replace function public.list_vehicle_maintenance_batch_payments(
  p_factory_id uuid,
  p_garage_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  garage_id uuid,
  garage_name_snapshot text,
  vehicle_ids uuid[],
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
  if p_garage_id is not null and not exists (
    select 1 from public.supplier_roles as requested_garage
    where requested_garage.factory_id = p_factory_id
      and requested_garage.supplier_id = p_garage_id
      and requested_garage.role = 'GARAGE'
  ) then raise exception 'Choose a Garage belonging to this factory.' using errcode = 'P4303'; end if;

  return query
  select payments.id, payments.factory_id, records.supplier_id,
    records.counterparty_name_snapshot,
    array_agg(distinct maintenance.vehicle_id order by maintenance.vehicle_id),
    count(allocations.id),
    jsonb_agg(jsonb_build_object(
      'maintenance_id', maintenance.id,
      'maintenance_date', records.business_date,
      'vehicle_id', maintenance.vehicle_id,
      'vehicle_number_snapshot', maintenance.vehicle_number_snapshot,
      'work_description', maintenance.work_description,
      'allocated_amount', allocations.allocated_amount
    ) order by records.business_date, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as allocations
    on allocations.payment_id = payments.id and allocations.factory_id = payments.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where payments.factory_id = p_factory_id
    and (p_garage_id is null or records.supplier_id = p_garage_id)
  group by payments.id, payments.factory_id, records.supplier_id,
    records.counterparty_name_snapshot, payments.payment_date, payments.amount,
    payments.payment_mode, payments.note, payments.created_at
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
    when bool_and(maintenance.id is not null)
      then min(records.counterparty_name_snapshot) || ' · Maintenance payment · '
        || count(*)::text || case when count(*) = 1 then ' job' else ' jobs' end
    else 'Payment for ' || string_agg(records.description, ', ' order by records.description, records.id)
  end
  from public.expense_payment_allocations as allocations
  join public.expense_records as records
    on records.id = allocations.expense_record_id
    and records.factory_id = allocations.factory_id
  left join public.coal_purchases as coal
    on coal.id = records.id and coal.factory_id = records.factory_id
  left join public.vehicle_maintenance_records as maintenance
    on maintenance.id = records.id and maintenance.factory_id = records.factory_id
  where allocations.factory_id = p_factory_id
    and allocations.payment_id = p_payment_id;
$$;

revoke all on function public.create_vehicle_maintenance_batch_payment(
  uuid, uuid, date, date, date, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.create_vehicle_maintenance_batch_payment(
  uuid, uuid, date, date, date, numeric, text, text
) to authenticated;
revoke all on function public.list_vehicle_maintenance_batch_payments(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_vehicle_maintenance_batch_payments(uuid, uuid)
  to authenticated;
revoke all on function public.get_expense_payment_cash_book_description(uuid, uuid)
  from public, anon, authenticated;

comment on function public.create_expense_payment(uuid, date, numeric, text, text, jsonb) is
  'Atomically validates explicit allocations, caps direct callers at 100, permits trusted Fuel and Maintenance batches of any size, prevents concurrent overpayment, and writes one immutable payment header.';
comment on function public.create_vehicle_maintenance_batch_payment(
  uuid, uuid, date, date, date, numeric, text, text
) is
  'Atomically settles one Garage across an inclusive Maintenance date range using oldest-date/created/id-first allocations and one shared payment header.';
comment on function public.list_vehicle_maintenance_batch_payments(uuid, uuid) is
  'Returns one Garage statement row per immutable payment with ordered Maintenance allocation detail.';
comment on function public.get_expense_payment_cash_book_description(uuid, uuid) is
  'Keeps Coal and Vehicle Maintenance multi-obligation payments concise in Cash Book while preserving generic expense descriptions.';

commit;
