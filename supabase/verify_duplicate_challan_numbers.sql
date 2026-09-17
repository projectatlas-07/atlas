-- Duplicate visible Challan number verifier.
-- Run after 20260913000037_allow_duplicate_challan_numbers.sql.
-- Requires one existing factory_users row. Every fixture and mapping change rolls back.

begin;

create or replace function pg_temp.expect_error(
  test_label text,
  expected_sqlstate text,
  statement_to_test text
)
returns void
language plpgsql
as $$
begin
  execute statement_to_test;
  raise exception 'FAIL: % unexpectedly succeeded', test_label using errcode = 'P9999';
exception when others then
  if sqlstate = expected_sqlstate then
    raise notice 'PASS: %', test_label;
  else
    raise exception 'FAIL: % expected SQLSTATE %, received % (%)',
      test_label, expected_sqlstate, sqlstate, sqlerrm;
  end if;
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  customer_a_id uuid := gen_random_uuid();
  customer_b_id uuid := gen_random_uuid();
  other_customer_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  other_brick_id uuid := gen_random_uuid();
  vehicle_a_id uuid := gen_random_uuid();
  other_challan_id uuid := gen_random_uuid();
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
    id, name, business_description, village, post_office, police_station,
    district, state, address, mobile
  ) values
    (
      factory_a_id, format('Duplicate Number Factory A %s', factory_a_id),
      'Brick manufacturer', 'Village A', 'Post A', 'Police A', 'District A',
      'State A', 'Address A', '9000000001'
    ),
    (
      factory_b_id, format('Duplicate Number Factory B %s', factory_b_id),
      'Brick manufacturer', 'Village B', 'Post B', 'Police B', 'District B',
      'State B', 'Address B', '9000000002'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'Customer A', 'Delivery A', '9111111111'),
    (customer_b_id, factory_a_id, 'Customer B', 'Delivery B', '9222222222'),
    (other_customer_id, factory_b_id, 'Other Customer', 'Other Delivery', '9333333333');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Class One'),
    (other_brick_id, factory_b_id, 'Other Brick');
  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (
    vehicle_a_id, factory_a_id, 'WB58 A 1234', 'WB58A1234', true
  );

  -- Factory B independently uses the same display number. It remains invisible to A.
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot
  ) values (
    other_challan_id, factory_b_id, '11', date '2026-09-12', other_customer_id,
    'Other Customer', 'Other Delivery', '9333333333',
    'Factory B', 'Brick manufacturer', 'Address B', '9000000002'
  );

  perform set_config('atlas_duplicate.user_id', test_user_id::text, true);
  perform set_config('atlas_duplicate.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_duplicate.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_duplicate.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_duplicate.customer_b_id', customer_b_id::text, true);
  perform set_config('atlas_duplicate.other_customer_id', other_customer_id::text, true);
  perform set_config('atlas_duplicate.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_duplicate.other_brick_id', other_brick_id::text, true);
  perform set_config('atlas_duplicate.vehicle_a_id', vehicle_a_id::text, true);
  perform set_config('atlas_duplicate.other_challan_id', other_challan_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_duplicate.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_duplicate.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_duplicate.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_duplicate.customer_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_duplicate.customer_b_id')::uuid;
  other_customer_id uuid := current_setting('atlas_duplicate.other_customer_id')::uuid;
  brick_a_id uuid := current_setting('atlas_duplicate.brick_a_id')::uuid;
  other_brick_id uuid := current_setting('atlas_duplicate.other_brick_id')::uuid;
  vehicle_a_id uuid := current_setting('atlas_duplicate.vehicle_a_id')::uuid;
  other_challan_id uuid := current_setting('atlas_duplicate.other_challan_id')::uuid;
  items_a jsonb := jsonb_build_array(jsonb_build_object(
    'brick_type_id', brick_a_id, 'quantity', 1000,
    'pricing_mode', 'RATE', 'rate', 1000
  ));
  items_b jsonb := jsonb_build_array(jsonb_build_object(
    'brick_type_id', brick_a_id, 'quantity', 2000,
    'pricing_mode', 'RATE', 'rate', 1000
  ));
  first_challan public.challans%rowtype;
  second_challan public.challans%rowtype;
  first_state record;
  second_state record;
  vehicle_account record;
  payment public.customer_payments%rowtype;
begin
  select * into first_challan from public.create_challan(
    factory_a_id, '11', date '2026-09-12', customer_a_id,
    vehicle_a_id, 100, items_a, '[]'::jsonb
  );
  select * into second_challan from public.create_challan(
    factory_a_id, '11', date '2026-09-13', customer_b_id,
    vehicle_a_id, 200, items_b, '[]'::jsonb
  );

  if first_challan.id is null
    or second_challan.id is null
    or first_challan.id = second_challan.id
    or first_challan.challan_number <> '11'
    or second_challan.challan_number <> '11'
    or (select count(*) from public.challans
        where factory_id = factory_a_id and challan_number = '11') <> 2 then
    raise exception 'FAIL: duplicate display numbers did not create separate UUID records';
  end if;
  raise notice 'PASS: same-factory duplicate visible numbers create separate internal Challan IDs';

  if not exists (
      select 1 from public.challans
      where id = first_challan.id
        and customer_name_snapshot = 'Customer A'
        and challan_date = date '2026-09-12'
        and vehicle_number_snapshot = 'WB58 A 1234'
        and challan_total = 1000
    ) or not exists (
      select 1 from public.challans
      where id = second_challan.id
        and customer_name_snapshot = 'Customer B'
        and challan_date = date '2026-09-13'
        and vehicle_number_snapshot = 'WB58 A 1234'
        and challan_total = 2000
    ) then
    raise exception 'FAIL: UUID lookups mixed duplicate-number Challan data';
  end if;
  raise notice 'PASS: view and print source rows resolve independently by internal ID';

  select * into second_challan from public.update_challan(
    factory_a_id, second_challan.id, '11', date '2026-09-14', customer_b_id,
    vehicle_a_id, 250, items_b, '[]'::jsonb
  );
  if second_challan.challan_date <> date '2026-09-14'
    or second_challan.trip_labour_wage <> 250
    or first_challan.challan_date <> date '2026-09-12'
    or (select challan_date from public.challans where id = first_challan.id)
      <> date '2026-09-12' then
    raise exception 'FAIL: editing one duplicate changed the other';
  end if;
  raise notice 'PASS: editing targets one duplicate-number Challan by internal ID';

  select * into vehicle_account
  from public.get_vehicle_wage_account_summary(factory_a_id, vehicle_a_id);
  if vehicle_account.total_earned <> 350 then
    raise exception 'FAIL: duplicate numbers merged Vehicle Delivery Wage earnings';
  end if;
  raise notice 'PASS: both duplicate-number Challans contribute independently to Vehicle Delivery Wage';

  select * into payment from public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-14', 500, 'cash', null,
    jsonb_build_array(jsonb_build_object(
      'challan_id', first_challan.id, 'amount', 500
    ))
  );
  select * into first_state
  from public.get_challan_payment_state(factory_a_id, first_challan.id);
  select * into second_state
  from public.get_challan_payment_state(factory_a_id, second_challan.id);
  if first_state.total_paid <> 500
    or first_state.outstanding_amount <> 500
    or second_state.total_paid <> 0
    or second_state.outstanding_amount <> 2000
    or not (select is_locked from public.challans where id = first_challan.id)
    or (select is_locked from public.challans where id = second_challan.id) then
    raise exception 'FAIL: payment, outstanding, or lock state leaked between duplicates';
  end if;
  raise notice 'PASS: payment and outstanding remain independent by Challan ID';

  select * into second_challan
  from public.void_challan(factory_a_id, second_challan.id);
  if second_challan.status <> 'void'
    or (select status from public.challans where id = first_challan.id) <> 'active' then
    raise exception 'FAIL: voiding one duplicate changed the other';
  end if;
  raise notice 'PASS: voiding targets only one duplicate-number Challan ID';

  if (select count(*) from public.challans
      where factory_id = factory_a_id and challan_number = '11') <> 2 then
    raise exception 'FAIL: Sales Register source rows merged duplicate numbers';
  end if;
  raise notice 'PASS: Sales Register source retains both duplicate-number transactions';

  if exists (select 1 from public.challans where id = other_challan_id)
    or exists (select 1 from public.challans where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B duplicate-number Challan';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot create Factory B duplicate-number Challan',
    '42501',
    format(
      'select * from public.create_challan(%L::uuid, %L, date %L, %L::uuid, null, null, jsonb_build_array(jsonb_build_object(%L, %L::uuid, %L, 1000, %L, %L, %L, 1000)), %L::jsonb)',
      factory_b_id, '11', '2026-09-14', other_customer_id,
      'brick_type_id', other_brick_id, 'quantity', 'pricing_mode', 'RATE', 'rate', '[]'
    )
  );
  raise notice 'PASS: factories independently reuse visible numbers without cross-factory leakage';

  perform set_config('atlas_duplicate.first_id', first_challan.id::text, true);
  perform set_config('atlas_duplicate.second_id', second_challan.id::text, true);
  perform set_config('atlas_duplicate.factory_id', factory_a_id::text, true);
  perform set_config('atlas_duplicate.payment_id', payment.id::text, true);
end;
$$;

reset role;

do $$
declare
  first_id uuid := current_setting('atlas_duplicate.first_id')::uuid;
  second_id uuid := current_setting('atlas_duplicate.second_id')::uuid;
  factory_id uuid := current_setting('atlas_duplicate.factory_id')::uuid;
  payment_id uuid := current_setting('atlas_duplicate.payment_id')::uuid;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.challans'::regclass
      and conname = 'challans_factory_number_key'
  ) then
    raise exception 'FAIL: visible Challan number uniqueness still exists';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.challans'::regclass
      and conname = 'challans_pkey'
      and contype = 'p'
  ) then
    raise exception 'FAIL: internal Challan primary-key identity is missing';
  end if;
  if first_id = second_id then
    raise exception 'FAIL: internal Challan IDs are not unique';
  end if;
  if (select count(*) from public.get_cash_book_source_movements(factory_id)
      where source_type = 'customer_payment' and source_id = payment_id) <> 1 then
    raise exception 'FAIL: Cash Book lost or duplicated the ID-linked payment movement';
  end if;
  raise notice 'PASS: Cash Book remains linked to the correct payment transaction';

  perform pg_temp.expect_error(
    'internal Challan primary key still rejects duplicate IDs',
    '23505',
    format(
      'insert into public.challans(id, factory_id, challan_number, challan_date, customer_id, customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot, company_name_snapshot, company_business_description_snapshot, company_address_snapshot, company_mobile_snapshot) select id, factory_id, challan_number, challan_date, customer_id, customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot, company_name_snapshot, company_business_description_snapshot, company_address_snapshot, company_mobile_snapshot from public.challans where id = %L::uuid',
      first_id
    )
  );
  raise notice 'PASS: UUID primary key and all unrelated Challan constraints remain authoritative';
end;
$$;

rollback;

select 'PASS: duplicate Challan identity, dependent modules, factory isolation, and rollback verified' as verifier_result;
