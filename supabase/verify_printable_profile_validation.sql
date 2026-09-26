-- Printable Factory Profile validation regression verifier.
-- Run only against Test Atlas Clean. Every fixture is rolled back.

begin;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  test_factory_id uuid := gen_random_uuid();
  brick_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(
    id, name, business_description, address, mobile,
    village, post_office, police_station, district, state, gstin
  ) values (
    test_factory_id, 'Structured Profile Factory', 'Brick manufacturer', '', '9000000001',
    'Rampur', 'Rampur Head', 'Kotwali', 'Jaipur', 'Rajasthan', null
  );
  update public.factory_users
  set factory_id = test_factory_id, is_active = true
  where id = mapping_id;
  insert into public.brick_types(id, factory_id, name)
  values (brick_id, test_factory_id, 'Structured Profile Brick');

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_id', test_factory_id::text, true);
  perform set_config('atlas_test.brick_id', brick_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_id uuid := current_setting('atlas_test.factory_id')::uuid;
  brick_id uuid := current_setting('atlas_test.brick_id')::uuid;
  customer public.customers%rowtype;
  challan public.challans%rowtype;
  second_challan public.challans%rowtype;
  payment public.customer_payments%rowtype;
  expected_address text := 'Vill. Rampur · P.O. Rampur Head · P.S. Kotwali · Dist. Jaipur · Rajasthan';
begin
  select * into customer from public.create_customer(
    factory_id, 'Structured Profile Customer', 'Delivery Address', '9111111111'
  );
  select * into challan from public.create_challan(
    factory_id, 'PROFILE-CHALLAN', date '2026-09-21', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 10000
    )),
    '[]'::jsonb
  );
  if challan.company_address_snapshot <> expected_address
    or challan.company_gstin_snapshot is not null then
    raise exception 'FAIL: Challan creation rejected or mis-snapshotted a complete structured profile';
  end if;
  raise notice 'PASS: New Challan accepts complete structured profile with blank legacy address and optional GSTIN';

  select * into payment from public.create_customer_payment(
    factory_id, customer.id, date '2026-09-21', 4000, 'cash', null,
    jsonb_build_array(jsonb_build_object(
      'challan_id', challan.id, 'amount', 4000
    ))
  );
  if payment.company_address_snapshot <> expected_address
    or payment.company_name_snapshot <> 'Structured Profile Factory'
    or payment.company_business_description_snapshot <> 'Brick manufacturer'
    or payment.company_mobile_snapshot <> '9000000001' then
    raise exception 'FAIL: Customer Dues payment did not use the structured printable profile';
  end if;
  raise notice 'PASS: Customer Dues payment accepts the same complete structured profile';

  select * into second_challan from public.create_challan(
    factory_id, 'PROFILE-INCOMPLETE', date '2026-09-21', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 10000
    )),
    '[]'::jsonb
  );
  perform set_config('atlas_test.second_challan_id', second_challan.id::text, true);
  perform set_config('atlas_test.customer_id', customer.id::text, true);
end;
$$;

reset role;

update public.factories
set district = ''
where id = current_setting('atlas_test.factory_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  test_factory_id uuid := current_setting('atlas_test.factory_id')::uuid;
  test_customer_id uuid := current_setting('atlas_test.customer_id')::uuid;
  test_challan_id uuid := current_setting('atlas_test.second_challan_id')::uuid;
begin
  begin
    perform public.create_customer_payment(
      test_factory_id, test_customer_id, date '2026-09-21', 1, 'cash', null,
      jsonb_build_array(jsonb_build_object('challan_id', test_challan_id, 'amount', 1))
    );
    raise exception 'FAIL: incomplete structured profile unexpectedly accepted'
      using errcode = 'P9999';
  exception when sqlstate 'P3010' then
    null;
  end;
  if exists (
    select 1 from public.customer_payment_allocations
    where customer_payment_allocations.factory_id = test_factory_id
      and customer_payment_allocations.challan_id = test_challan_id
  ) then
    raise exception 'FAIL: rejected profile left a payment allocation';
  end if;
  raise notice 'PASS: genuinely incomplete structured profile remains rejected';
end;
$$;

reset role;

rollback;
