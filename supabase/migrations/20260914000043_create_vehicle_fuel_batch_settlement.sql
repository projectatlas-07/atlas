-- One Pump settlement creates one immutable expense-payment header with
-- oldest-first allocations across eligible Vehicle Fuel obligations.

begin;

create or replace function public.create_vehicle_fuel_batch_payment(
  p_factory_id uuid,
  p_pump_id uuid,
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
    raise exception 'Choose a valid inclusive Fuel date range.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.supplier_roles as pump_role
    where pump_role.factory_id = p_factory_id
      and pump_role.supplier_id = p_pump_id
      and pump_role.role = 'FUEL_PUMP'
  ) then raise exception 'Choose a Fuel Pump belonging to this factory.' using errcode = 'P4503'; end if;

  -- Every potentially eligible obligation is locked by UUID order. This is the
  -- same deadlock-safe order used by the shared payment authority.
  perform records.id
  from public.expense_records as records
  join public.vehicle_fuel_records as fuel
    on fuel.id = records.id and fuel.factory_id = records.factory_id
  where records.factory_id = p_factory_id
    and records.supplier_id = p_pump_id
    and records.business_date between p_from_date and p_to_date
    and records.status = 'active'
  order by records.id
  for update of records;

  select coalesce(sum(eligible.outstanding_amount), 0)
  into period_outstanding
  from (
    select records.total_amount - coalesce(sum(allocations.allocated_amount), 0) as outstanding_amount
    from public.expense_records as records
    join public.vehicle_fuel_records as fuel
      on fuel.id = records.id and fuel.factory_id = records.factory_id
    left join public.expense_payment_allocations as allocations
      on allocations.expense_record_id = records.id
      and allocations.factory_id = records.factory_id
    where records.factory_id = p_factory_id
      and records.supplier_id = p_pump_id
      and records.business_date between p_from_date and p_to_date
      and records.status = 'active'
    group by records.id, records.total_amount
    having records.total_amount - coalesce(sum(allocations.allocated_amount), 0) > 0
  ) as eligible;

  if p_amount is null or p_amount <= 0
    or p_amount = 'NaN'::numeric or p_amount = 'Infinity'::numeric
    or p_amount >= 10000000000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be positive and use at most two decimal places.' using errcode = '22023';
  end if;
  if period_outstanding <= 0 or p_amount > period_outstanding then
    raise exception 'Payment exceeds current outstanding Fuel dues in this Pump and date range.' using errcode = 'P4510';
  end if;

  for candidate in
    select records.id,
      records.total_amount - coalesce(sum(allocations.allocated_amount), 0) as outstanding_amount
    from public.expense_records as records
    join public.vehicle_fuel_records as fuel
      on fuel.id = records.id and fuel.factory_id = records.factory_id
    left join public.expense_payment_allocations as allocations
      on allocations.expense_record_id = records.id
      and allocations.factory_id = records.factory_id
    where records.factory_id = p_factory_id
      and records.supplier_id = p_pump_id
      and records.business_date between p_from_date and p_to_date
      and records.status = 'active'
    group by records.id, records.business_date, records.created_at,
      records.total_amount, fuel.fuel_time
    having records.total_amount - coalesce(sum(allocations.allocated_amount), 0) > 0
    order by records.business_date, fuel.fuel_time, records.created_at, records.id
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
    raise exception 'Could not allocate the full Pump payment.' using errcode = 'P4510';
  end if;
  if jsonb_array_length(allocations) > 100 then
    raise exception 'This payment spans more than 100 Fuel entries. Choose a shorter date range.' using errcode = '22023';
  end if;

  perform set_config('atlas.internal_vehicle_fuel_write', 'on', true);
  select * into saved_payment from public.create_expense_payment(
    p_factory_id, p_payment_date, p_amount, p_payment_mode, p_note, allocations
  );
  perform set_config('atlas.internal_vehicle_fuel_write', 'off', true);
  return saved_payment;
end;
$$;

create or replace function public.list_vehicle_fuel_batch_payments(
  p_factory_id uuid,
  p_pump_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  pump_id uuid,
  pump_name text,
  vehicle_ids uuid[],
  allocation_count bigint,
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
  if p_pump_id is not null and not exists (
    select 1 from public.supplier_roles as requested_pump
    where requested_pump.factory_id = p_factory_id
      and requested_pump.supplier_id = p_pump_id
      and requested_pump.role = 'FUEL_PUMP'
  ) then raise exception 'Choose a Fuel Pump belonging to this factory.' using errcode = 'P4503'; end if;

  return query
  select payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    array_agg(distinct fuel.vehicle_id order by fuel.vehicle_id),
    count(allocations.id), payments.payment_date, payments.amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as allocations
    on allocations.payment_id = payments.id and allocations.factory_id = payments.factory_id
  join public.vehicle_fuel_records as fuel
    on fuel.id = allocations.expense_record_id and fuel.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  join public.suppliers as suppliers
    on suppliers.id = records.supplier_id and suppliers.factory_id = records.factory_id
  where payments.factory_id = p_factory_id
    and (p_pump_id is null or records.supplier_id = p_pump_id)
  group by payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc;
end;
$$;

revoke all on function public.create_vehicle_fuel_batch_payment(
  uuid, uuid, date, date, date, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.create_vehicle_fuel_batch_payment(
  uuid, uuid, date, date, date, numeric, text, text
) to authenticated;
revoke all on function public.list_vehicle_fuel_batch_payments(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_vehicle_fuel_batch_payments(uuid, uuid)
  to authenticated;

comment on function public.create_vehicle_fuel_batch_payment(
  uuid, uuid, date, date, date, numeric, text, text
) is
  'Atomically settles one Pump across an inclusive Fuel date range using oldest-date/time-first allocations and one shared payment header.';
comment on function public.list_vehicle_fuel_batch_payments(uuid, uuid) is
  'Returns one Pump statement row per immutable payment, regardless of allocation count.';

commit;
