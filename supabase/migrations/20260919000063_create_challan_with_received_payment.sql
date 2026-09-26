-- Atlas Sales: create a Challan and its optional at-creation customer receipt
-- as one database transaction while preserving the existing authoritative writers.

begin;

create function public.create_challan_with_received_payment(
  p_factory_id uuid,
  p_challan_number text,
  p_challan_date date,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_trip_labour_wage numeric,
  p_items jsonb,
  p_flexible_lines jsonb,
  p_payment_date date,
  p_payment_amount numeric,
  p_payment_mode text
)
returns public.challans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_challan public.challans%rowtype;
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

  -- Keep Challan totals, snapshots, content validation, and Vehicle wage snapshots
  -- owned by the existing authoritative Challan writer.
  select * into new_challan
  from public.create_challan(
    p_factory_id,
    p_challan_number,
    p_challan_date,
    p_customer_id,
    p_vehicle_id,
    p_trip_labour_wage,
    p_items,
    coalesce(p_flexible_lines, '[]'::jsonb)
  );

  -- Keep receipt snapshots, mode validation, overpayment protection, immutable
  -- history, explicit allocation, and the financial lock in the existing writer.
  perform public.create_customer_payment(
    p_factory_id,
    p_customer_id,
    p_payment_date,
    p_payment_amount,
    p_payment_mode,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'challan_id', new_challan.id,
        'amount', p_payment_amount
      )
    )
  );

  -- create_customer_payment locks the allocated Challan. Return that final state.
  select * into new_challan
  from public.challans
  where challans.id = new_challan.id
    and challans.factory_id = p_factory_id;

  return new_challan;
end;
$$;

revoke all on function public.create_challan_with_received_payment(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb, date, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_challan_with_received_payment(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb, date, numeric, text
) to authenticated;

comment on function public.create_challan_with_received_payment(
  uuid, text, date, uuid, uuid, numeric, jsonb, jsonb, date, numeric, text
) is
  'Atomically creates a Challan through create_challan and records one explicitly allocated receipt through create_customer_payment; any failure rolls back both.';

commit;
