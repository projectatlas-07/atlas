-- Atlas Sales S5B: immutable payment-time receipt snapshots.

alter table public.customer_payments
  add column customer_name_snapshot text,
  add column customer_address_snapshot text,
  add column customer_mobile_snapshot text,
  add column company_name_snapshot text,
  add column company_business_description_snapshot text,
  add column company_address_snapshot text,
  add column company_mobile_snapshot text;

-- S5A rows predate receipts. Backfill them once from the currently saved profiles,
-- then restore the existing immutable-history guard before normal traffic resumes.
alter table public.customer_payments
  disable trigger customer_payments_prevent_update_delete;

update public.customer_payments as payments
set
  customer_name_snapshot = customers.name,
  customer_address_snapshot = customers.address,
  customer_mobile_snapshot = customers.mobile,
  company_name_snapshot = factories.name,
  company_business_description_snapshot = factories.business_description,
  company_address_snapshot = factories.address,
  company_mobile_snapshot = factories.mobile
from public.customers as customers,
  public.factories as factories
where customers.id = payments.customer_id
  and customers.factory_id = payments.factory_id
  and factories.id = payments.factory_id;

alter table public.customer_payments
  enable trigger customer_payments_prevent_update_delete;

alter table public.customer_payments
  alter column customer_name_snapshot set not null,
  alter column customer_address_snapshot set not null,
  alter column customer_mobile_snapshot set not null,
  alter column company_name_snapshot set not null,
  alter column company_business_description_snapshot set not null,
  alter column company_address_snapshot set not null,
  alter column company_mobile_snapshot set not null,
  add constraint customer_payments_customer_name_snapshot_check
    check (customer_name_snapshot <> ''),
  add constraint customer_payments_company_snapshots_check check (
    company_name_snapshot <> ''
    and company_business_description_snapshot <> ''
    and company_address_snapshot <> ''
    and company_mobile_snapshot <> ''
  );

create or replace function public.snapshot_customer_payment_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  customer_profile public.customers%rowtype;
  factory_profile public.factories%rowtype;
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
    or factory_profile.address = ''
    or factory_profile.mobile = '' then
    raise exception 'Complete the printable factory profile before recording a customer payment.'
      using errcode = 'P3010';
  end if;

  new.customer_name_snapshot := customer_profile.name;
  new.customer_address_snapshot := customer_profile.address;
  new.customer_mobile_snapshot := customer_profile.mobile;
  new.company_name_snapshot := factory_profile.name;
  new.company_business_description_snapshot := factory_profile.business_description;
  new.company_address_snapshot := factory_profile.address;
  new.company_mobile_snapshot := factory_profile.mobile;
  return new;
end;
$$;

create trigger customer_payments_snapshot_receipt
before insert on public.customer_payments
for each row execute function public.snapshot_customer_payment_receipt();

revoke all on function public.snapshot_customer_payment_receipt()
  from public, anon, authenticated;

comment on function public.snapshot_customer_payment_receipt() is
  'Captures customer and printable company values atomically when an immutable payment is inserted.';
comment on column public.customer_payments.customer_name_snapshot is
  'Customer name captured at payment time for historical receipts.';
comment on column public.customer_payments.company_name_snapshot is
  'Printable company name captured at payment time for historical receipts.';
