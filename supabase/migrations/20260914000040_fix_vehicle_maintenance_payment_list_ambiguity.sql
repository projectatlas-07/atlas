-- Qualify Vehicle/Garage ownership checks because RETURNS TABLE output names
-- are PL/pgSQL variables inside list_vehicle_maintenance_payments.

begin;

create or replace function public.list_vehicle_maintenance_payments(
  p_factory_id uuid,
  p_vehicle_id uuid,
  p_garage_id uuid
)
returns table (
  payment_id uuid,
  factory_id uuid,
  maintenance_id uuid,
  vehicle_id uuid,
  vehicle_number_snapshot text,
  garage_id uuid,
  garage_name_snapshot text,
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
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles as requested_vehicle
    where requested_vehicle.id = p_vehicle_id
      and requested_vehicle.factory_id = p_factory_id
  ) then raise exception 'Vehicle does not belong to this factory.' using errcode = 'P4301'; end if;
  if p_garage_id is not null and not exists (
    select 1 from public.suppliers as requested_garage
    where requested_garage.id = p_garage_id
      and requested_garage.factory_id = p_factory_id
  ) then raise exception 'Garage does not belong to this factory.' using errcode = 'P4303'; end if;
  return query
  select payments.id, payments.factory_id, maintenance.id,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where maintenance.factory_id = p_factory_id
    and (p_vehicle_id is null or maintenance.vehicle_id = p_vehicle_id)
    and (p_garage_id is null or records.supplier_id = p_garage_id)
  order by payments.payment_date desc, payments.created_at desc, payments.id desc;
end;
$$;

revoke all on function public.list_vehicle_maintenance_payments(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_vehicle_maintenance_payments(uuid, uuid, uuid)
  to authenticated;

comment on function public.list_vehicle_maintenance_payments(uuid, uuid, uuid) is
  'Lists factory-authorized Garage payments with fully qualified ownership checks.';

commit;
