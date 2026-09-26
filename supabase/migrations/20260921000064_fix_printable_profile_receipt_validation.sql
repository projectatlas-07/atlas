-- Align customer-payment receipt snapshots with the current structured printable
-- Factory Profile contract already used by Challan creation.

begin;

create or replace function public.snapshot_customer_payment_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  customer_profile public.customers%rowtype;
  factory_profile public.factories%rowtype;
  printable_address_snapshot text;
begin
  select *
  into customer_profile
  from public.customers
  where customers.id = new.customer_id
    and customers.factory_id = new.factory_id;

  if not found then
    raise exception 'Customer does not belong to this factory.' using errcode = 'P3002';
  end if;

  select *
  into factory_profile
  from public.factories
  where factories.id = new.factory_id;

  if not found
    or factory_profile.name = ''
    or factory_profile.business_description = ''
    or factory_profile.village = ''
    or factory_profile.post_office = ''
    or factory_profile.police_station = ''
    or factory_profile.district = ''
    or factory_profile.state = ''
    or factory_profile.mobile = '' then
    raise exception 'Complete the structured printable factory profile before recording a customer payment.'
      using errcode = 'P3010';
  end if;

  printable_address_snapshot := coalesce(
    nullif(factory_profile.address, ''),
    format(
      'Vill. %s · P.O. %s · P.S. %s · Dist. %s · %s',
      factory_profile.village,
      factory_profile.post_office,
      factory_profile.police_station,
      factory_profile.district,
      factory_profile.state
    )
  );

  new.customer_name_snapshot := customer_profile.name;
  new.customer_address_snapshot := customer_profile.address;
  new.customer_mobile_snapshot := customer_profile.mobile;
  new.company_name_snapshot := factory_profile.name;
  new.company_business_description_snapshot := factory_profile.business_description;
  new.company_address_snapshot := printable_address_snapshot;
  new.company_mobile_snapshot := factory_profile.mobile;
  return new;
end;
$$;

revoke all on function public.snapshot_customer_payment_receipt()
  from public, anon, authenticated;

comment on function public.snapshot_customer_payment_receipt() is
  'Captures immutable customer and company receipt snapshots using the structured printable Factory Profile contract shared with Challan creation; GSTIN remains optional.';

commit;
