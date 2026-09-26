-- Atlas Sales Paid Now verifier. Run only against Test Atlas Clean.
-- Requires one existing factory_users row. Every fixture is rolled back.

begin;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  customer_b_id uuid := gen_random_uuid();
  vehicle_a_id uuid := gen_random_uuid();
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
    village, post_office, police_station, district, state
  ) values
    (factory_a_id, format('Paid Now Factory A %s', factory_a_id),
      'Brick manufacturer A', 'Factory Address A', '9000000001',
      'Village A', 'Post A', 'Police A', 'District A', 'State A'),
    (factory_b_id, format('Paid Now Factory B %s', factory_b_id),
      'Brick manufacturer B', 'Factory Address B', '9000000002',
      'Village B', 'Post B', 'Police B', 'District B', 'State B');

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Paid Now Factory A Brick'),
    (brick_b_id, factory_b_id, 'Paid Now Factory B Brick');
  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_b_id, factory_b_id, 'Factory B Customer', 'B Address', '9222222222');
  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (
    vehicle_a_id, factory_a_id, 'WB 12 AB 1234', 'WB12AB1234', true
  );

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_test.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_test.customer_b_id', customer_b_id::text, true);
  perform set_config('atlas_test.vehicle_a_id', vehicle_a_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_test.brick_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_test.customer_b_id')::uuid;
  vehicle_a_id uuid := current_setting('atlas_test.vehicle_a_id')::uuid;
  pay_later_customer public.customers%rowtype;
  full_customer public.customers%rowtype;
  partial_customer public.customers%rowtype;
  rollback_customer public.customers%rowtype;
  pay_later_challan public.challans%rowtype;
  full_challan public.challans%rowtype;
  partial_challan public.challans%rowtype;
  payment public.customer_payments%rowtype;
  state record;
  summary record;
  payment_count_before bigint;
begin
  select * into pay_later_customer from public.create_customer(
    factory_a_id, 'Pay Later Customer', 'Address', '9111111111'
  );
  select * into pay_later_challan from public.create_challan(
    factory_a_id, 'PN-LATER', date '2026-09-19', pay_later_customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 96000
    )),
    '[]'::jsonb
  );
  select * into state from public.get_challan_payment_state(
    factory_a_id, pay_later_challan.id
  );
  if exists (
      select 1 from public.customer_payments
      where factory_id = factory_a_id and customer_id = pay_later_customer.id
    ) or state.sale_total <> 96000 or state.total_paid <> 0
    or state.outstanding_amount <> 96000 or state.payment_state <> 'unpaid'
    or pay_later_challan.is_locked then
    raise exception 'FAIL: Pay Later changed legacy Challan creation semantics';
  end if;
  raise notice 'PASS: Pay Later creates no customer payment';

  select * into full_customer from public.create_customer(
    factory_a_id, 'Full Paid Customer', 'Address', '9111111112'
  );
  select * into full_challan from public.create_challan_with_received_payment(
    factory_a_id, 'PN-FULL', date '2026-09-19', full_customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 96000
    )),
    '[]'::jsonb,
    date '2026-09-20', 96000, 'upi'
  );
  select * into state from public.get_challan_payment_state(factory_a_id, full_challan.id);
  if state.sale_total <> 96000 or state.total_paid <> 96000
    or state.outstanding_amount <> 0 or state.payment_state <> 'paid'
    or not full_challan.is_locked then
    raise exception 'FAIL: full Paid Now state is incorrect';
  end if;
  raise notice 'PASS: full Received Now leaves zero outstanding';

  select * into partial_customer from public.create_customer(
    factory_a_id, 'Partial Paid Customer', 'Address', '9111111113'
  );
  select * into partial_challan from public.create_challan_with_received_payment(
    factory_a_id, 'PN-PARTIAL', date '2026-09-19', partial_customer.id,
    vehicle_a_id, 750,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 96000
    )),
    '[]'::jsonb,
    date '2026-09-20', 50000, 'cash'
  );
  select * into state from public.get_challan_payment_state(
    factory_a_id, partial_challan.id
  );
  select * into summary from public.get_customer_sales_summary(
    factory_a_id, partial_customer.id
  );
  select * into payment
  from public.customer_payments
  where factory_id = factory_a_id and customer_id = partial_customer.id;

  if state.sale_total <> 96000 or state.total_paid <> 50000
    or state.outstanding_amount <> 46000 or state.payment_state <> 'partially_paid'
    or summary.total_active_sales <> 96000
    or summary.total_payments_allocated <> 50000
    or summary.total_outstanding <> 46000
    or payment.payment_date <> date '2026-09-20'
    or payment.payment_mode <> 'cash'
    or payment.amount <> 50000
    or not exists (
      select 1 from public.customer_payment_allocations
      where payment_id = payment.id and challan_id = partial_challan.id
        and factory_id = factory_a_id and allocated_amount = 50000
    ) then
    raise exception 'FAIL: partial Paid Now ledger or derived dues are incorrect';
  end if;
  raise notice 'PASS: partial Received Now leaves the correct remainder';

  if partial_challan.challan_total <> 96000
    or partial_challan.vehicle_id <> vehicle_a_id
    or partial_challan.vehicle_number_snapshot <> 'WB 12 AB 1234'
    or partial_challan.delivery_wage_applicable_snapshot is not true
    or partial_challan.trip_labour_wage <> 750
    or not exists (
      select 1 from public.challan_items
      where challan_id = partial_challan.id and factory_id = factory_a_id
        and quantity = 1000 and brick_particulars_snapshot = 'Paid Now Factory A Brick'
    ) then
    raise exception 'FAIL: authoritative sale, item, or Vehicle snapshots changed';
  end if;
  raise notice 'PASS: Vehicle and trip wage snapshots survive Paid Now unchanged';

  perform public.initialize_cash_book(factory_a_id, date '2026-09-19', 0);
  if not exists (
    select 1 from public.list_cash_book_day_entries(factory_a_id, date '2026-09-20')
    where source_type = 'customer_payment' and source_id = payment.id
      and direction = 'in' and amount = 50000 and payment_mode = 'cash'
  ) then
    raise exception 'FAIL: Paid Now receipt is missing from Cash Book';
  end if;
  raise notice 'PASS: same payment appears in payment history, dues, and Cash Book';

  select * into rollback_customer from public.create_customer(
    factory_a_id, 'Rollback Customer', 'Address', '9111111114'
  );
  select count(*) into payment_count_before
  from public.customer_payments
  where factory_id = factory_a_id and customer_id = rollback_customer.id;
  begin
    perform public.create_challan_with_received_payment(
      factory_a_id, 'PN-ROLLBACK', date '2026-09-19', rollback_customer.id,
      null, null,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000,
        'pricing_mode', 'RATE', 'rate', 96000
      )),
      '[]'::jsonb,
      date '2026-09-20', 96000.01, 'cash'
    );
    raise exception 'FAIL: overpayment unexpectedly succeeded' using errcode = 'P9999';
  exception when sqlstate 'P3105' then
    null;
  end;
  if exists (
      select 1 from public.challans
      where factory_id = factory_a_id and challan_number = 'PN-ROLLBACK'
    ) or (select count(*) from public.customer_payments
      where factory_id = factory_a_id and customer_id = rollback_customer.id)
      <> payment_count_before then
    raise exception 'FAIL: failed payment left a half-created transaction';
  end if;
  raise notice 'PASS: overpayment rolls back Challan and payment together';

  begin
    perform public.create_challan_with_received_payment(
      factory_b_id, 'PN-CROSS', date '2026-09-19', customer_b_id,
      null, null,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', current_setting('atlas_test.brick_b_id')::uuid,
        'quantity', 1000, 'pricing_mode', 'RATE', 'rate', 1
      )),
      '[]'::jsonb,
      date '2026-09-19', 1, 'cash'
    );
    raise exception 'FAIL: cross-factory paid Challan unexpectedly succeeded' using errcode = 'P9999';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS: Factory A user cannot create a paid Challan in Factory B';

  perform set_config('atlas_test.partial_payment_id', payment.id::text, true);
end;
$$;

reset role;

update public.factory_users
set factory_id = current_setting('atlas_test.factory_b_id')::uuid, is_active = true
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
begin
  if exists (select 1 from public.challans where factory_id = factory_a_id)
    or exists (select 1 from public.customer_payments where factory_id = factory_a_id)
    or exists (
      select 1 from public.customer_payment_allocations where factory_id = factory_a_id
    ) then
    raise exception 'FAIL: Factory B can read Factory A Paid Now records';
  end if;
  raise notice 'PASS: Paid Now records remain factory-isolated under RLS';
end;
$$;

reset role;

rollback;
