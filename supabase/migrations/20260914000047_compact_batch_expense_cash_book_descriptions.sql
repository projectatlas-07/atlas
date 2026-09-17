-- Keep structured batch expense payments compact in Cash Book while exposing
-- full Fuel allocation detail through the operational payment history.

begin;

drop function public.list_vehicle_fuel_batch_payments(uuid, uuid);

create function public.list_vehicle_fuel_batch_payments(
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
  if p_pump_id is not null and not exists (
    select 1 from public.supplier_roles as requested_pump
    where requested_pump.factory_id = p_factory_id
      and requested_pump.supplier_id = p_pump_id
      and requested_pump.role = 'FUEL_PUMP'
  ) then raise exception 'Choose a Fuel Pump belonging to this factory.' using errcode = 'P4503'; end if;

  return query
  select payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    array_agg(distinct fuel.vehicle_id order by fuel.vehicle_id),
    count(allocations.id),
    jsonb_agg(jsonb_build_object(
      'fuel_record_id', fuel.id,
      'fuel_date', records.business_date,
      'fuel_time', fuel.fuel_time,
      'vehicle_id', fuel.vehicle_id,
      'vehicle_number_snapshot', fuel.vehicle_number_snapshot,
      'fuel_type', fuel.fuel_type,
      'litres', fuel.litres,
      'allocated_amount', allocations.allocated_amount
    ) order by records.business_date, fuel.fuel_time, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
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
    when bool_and(fuel.id is not null) and count(*) > 1
      then 'Fuel payment · ' || count(*)::text || ' refuels'
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
  left join public.vehicle_fuel_records as fuel
    on fuel.id = records.id and fuel.factory_id = records.factory_id
  where allocations.factory_id = p_factory_id
    and allocations.payment_id = p_payment_id;
$$;

revoke all on function public.list_vehicle_fuel_batch_payments(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_vehicle_fuel_batch_payments(uuid, uuid)
  to authenticated;
revoke all on function public.get_expense_payment_cash_book_description(uuid, uuid)
  from public, anon, authenticated;

comment on function public.list_vehicle_fuel_batch_payments(uuid, uuid) is
  'Returns one immutable Pump payment row with its ordered Fuel allocation breakdown.';
comment on function public.get_expense_payment_cash_book_description(uuid, uuid) is
  'Uses compact descriptions for multi-obligation Coal, Maintenance, and Fuel payments while preserving specific single and generic expense descriptions.';

commit;
