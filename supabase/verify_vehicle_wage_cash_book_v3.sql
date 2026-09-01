-- Atlas Vehicle Delivery Wage Account V3 verifier.
-- Run after 20260901000032_integrate_vehicle_wage_payments_with_cash_book.sql.
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
  source_definition text := pg_get_functiondef(
    'public.get_cash_book_source_movements(uuid)'::regprocedure
  );
  payment_definition text := pg_get_functiondef(
    'public.record_vehicle_wage_payment(uuid,uuid,date,numeric,text)'::regprocedure
  );
  source_marker text;
begin
  if (select provolatile <> 's' or not prosecdef
      from pg_proc
      where oid = 'public.get_cash_book_source_movements(uuid)'::regprocedure)
    or not exists (
      select 1
      from pg_proc
      where oid = 'public.get_cash_book_source_movements(uuid)'::regprocedure
        and proconfig @> array['search_path=pg_catalog, public']
    ) then
    raise exception 'FAIL: Cash Book source union lost STABLE SECURITY DEFINER or safe search_path';
  end if;
  if has_function_privilege(
      'authenticated', 'public.get_cash_book_source_movements(uuid)', 'execute'
    ) or has_function_privilege(
      'anon', 'public.get_cash_book_source_movements(uuid)', 'execute'
    ) then
    raise exception 'FAIL: private Cash Book source union is directly executable';
  end if;

  foreach source_marker in array array[
    '''customer_payment''::text',
    '''manual_cash_entry''::text',
    '''expense_payment''::text',
    '''vehicle_wage_payment''::text'
  ] loop
    if regexp_count(source_definition, source_marker, 1, 'i') <> 1 then
      raise exception 'FAIL: Cash Book source branch % is missing or duplicated', source_marker;
    end if;
  end loop;
  if source_definition not ilike '%from public.vehicle_wage_payments as payments%'
    or source_definition not ilike '%join public.vehicles as vehicles%'
    or source_definition not ilike '%vehicles.id = payments.vehicle_id%'
    or source_definition not ilike '%vehicles.factory_id = payments.factory_id%'
    or source_definition not ilike '%payments.id%payments.payment_date%''out''::text%'
    or source_definition not ilike '%payments.amount%''unspecified''::text%vehicles.vehicle_number%'
    or source_definition not ilike '%''Vehicle Wage Payment''::text%'
    or source_definition ilike '%vehicles.is_active%'
    or source_definition ilike '%vehicles.delivery_wage_tracking_enabled%' then
    raise exception 'FAIL: Vehicle wage Cash Book projection is incomplete or configuration-dependent';
  end if;
  if payment_definition not ilike '%vehicle_wage_account:%'
    or payment_definition not ilike '%pg_advisory_xact_lock%'
    or payment_definition ilike '%cash_book%' then
    raise exception 'FAIL: V3 changed or bypassed the authoritative Vehicle wage payment writer';
  end if;
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'vehicle_wage_payments'
      and indexname = 'vehicle_wage_payments_factory_cash_book_idx'
      and indexdef ilike '%(factory_id, payment_date, created_at, id)%'
  ) then
    raise exception 'FAIL: Vehicle wage Cash Book lookup index is missing or inconsistent';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.vehicle_wage_payments'::regclass
      and conname = 'vehicle_wage_payments_vehicle_factory_fkey'
      and confdeltype = 'r'
  ) then
    raise exception 'FAIL: Vehicle payment-to-Vehicle factory-safe RESTRICT reference is missing';
  end if;
  raise notice 'PASS: source union is private, factory-keyed, exact-once by payment header, and keeps prior source branches';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  customer_b_id uuid := gen_random_uuid();
  vehicle_b_id uuid := gen_random_uuid();
  payment_b_id uuid := gen_random_uuid();
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
      factory_a_id, format('Vehicle Wage V3 Factory A %s', factory_a_id),
      'Brick maker', 'Village A', 'Post A', 'Police A', 'District A',
      'State A', 'Address A', '9000000001'
    ),
    (
      factory_b_id, format('Vehicle Wage V3 Factory B %s', factory_b_id),
      'Brick maker', 'Village B', 'Post B', 'Police B', 'District B',
      'State B', 'Address B', '9000000002'
    );
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types(id, factory_id, name)
  values (brick_a_id, factory_a_id, 'Vehicle Wage V3 Brick');
  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_b_id, factory_b_id, 'Vehicle Wage V3 Customer B', 'Address B', '9222222222');
  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (
    vehicle_b_id, factory_b_id, 'WB99B0001', 'WB99B0001', true
  );
  insert into public.challans(
    factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    vehicle_number, tractor_labour_rate_snapshot,
    vehicle_id, vehicle_number_snapshot,
    delivery_wage_applicable_snapshot, trip_labour_wage
  ) values (
    factory_b_id, 1, date '2026-09-05', customer_b_id,
    'Vehicle Wage V3 Customer B', 'Address B', '9222222222',
    'Vehicle Wage V3 Factory B', 'Brick maker', 'Address B', '9000000002',
    'WB99B0001', 1000, vehicle_b_id, 'WB99B0001', true, 1000
  );
  insert into public.vehicle_wage_payments(
    id, factory_id, vehicle_id, payment_date, amount, note, created_by
  ) values (
    payment_b_id, factory_b_id, vehicle_b_id, date '2026-09-05', 500,
    'Factory B secret payment', test_user_id
  );
  insert into public.cash_book_initializations(
    factory_id, start_date, opening_balance, created_by
  ) values (factory_b_id, date '2026-09-01', 10000, test_user_id);

  perform set_config('atlas_vw3.user_id', test_user_id::text, true);
  perform set_config('atlas_vw3.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_vw3.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_vw3.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_vw3.vehicle_b_id', vehicle_b_id::text, true);
  perform set_config('atlas_vw3.payment_b_id', payment_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_vw3.user_id'), true);

do $$
<<v3_integration>>
declare
  factory_id uuid := current_setting('atlas_vw3.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_vw3.factory_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_vw3.brick_a_id')::uuid;
  vehicle_b_id uuid := current_setting('atlas_vw3.vehicle_b_id')::uuid;
  payment_b_id uuid := current_setting('atlas_vw3.payment_b_id')::uuid;
  customer public.customers%rowtype;
  vehicle public.vehicles%rowtype;
  challan public.challans%rowtype;
  customer_payment public.customer_payments%rowtype;
  supplier public.suppliers%rowtype;
  expense_record public.expense_records%rowtype;
  expense_payment public.expense_payments%rowtype;
  wage_payment_one record;
  wage_payment_two record;
  movement record;
  summary_before record;
  summary_after record;
  customer_before record;
  customer_after record;
  account_after record;
  payment_count_before bigint;
begin
  perform public.initialize_cash_book(factory_id, date '2026-09-01', 10000);
  select * into customer from public.create_customer(
    factory_id, 'Vehicle Wage V3 Customer A', 'Address A', '9111111111'
  );
  select * into vehicle from public.find_or_create_vehicle(
    factory_id, 'WB12AB1234', true
  );
  select * into challan from public.create_challan(
    factory_id,
    date '2026-09-01',
    customer.id,
    vehicle.id,
    5000,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id,
      'quantity', 1000,
      'rate', 1000
    )),
    '[]'::jsonb
  );

  -- Prove the three pre-V3 Cash Book branches still execute after replacement.
  select * into customer_payment from public.create_customer_payment(
    factory_id, customer.id, date '2026-09-04', 100, 'cash', 'Customer receipt',
    jsonb_build_array(jsonb_build_object('challan_id', challan.id, 'amount', 100))
  );
  perform public.create_cash_book_manual_entry(
    factory_id, gen_random_uuid(), date '2026-09-04', 'out', 50,
    'cash', 'Manual test outflow', null
  );
  select * into supplier from public.create_supplier(
    factory_id, 'Vehicle Wage V3 Supplier', null, null
  );
  select * into expense_record from public.create_expense_record(
    factory_id, date '2026-09-04', 'expense', supplier.id, null,
    'Verifier expense', 75, null
  );
  select * into expense_payment from public.create_expense_payment(
    factory_id, date '2026-09-04', 75, 'cash', null,
    jsonb_build_array(jsonb_build_object(
      'expense_record_id', expense_record.id,
      'amount', 75
    ))
  );
  if (select count(distinct source_type)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-04')
      where source_type in ('customer_payment', 'manual_cash_entry', 'expense_payment')) <> 3
    or (select count(*)
        from public.list_cash_book_day_entries(factory_id, date '2026-09-04')
        where source_type = 'customer_payment' and source_id = customer_payment.id) <> 1
    or (select count(*)
        from public.list_cash_book_day_entries(factory_id, date '2026-09-04')
        where source_type = 'expense_payment' and source_id = expense_payment.id) <> 1 then
    raise exception 'FAIL: replacement source union broke an existing Cash Book flow';
  end if;
  raise notice 'PASS: customer, manual, and supplier/expense Cash Book flows still work';

  select * into customer_before
  from public.get_customer_sales_summary(factory_id, customer.id);
  select * into summary_before
  from public.get_cash_book_day_summary(factory_id, date '2026-09-05');

  select * into wage_payment_one from public.record_vehicle_wage_payment(
    factory_id, vehicle.id, date '2026-09-05', 1200, '  Weekly   settlement  '
  );
  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_one.payment_id) <> 1 then
    raise exception 'FAIL: ₹1,200 Vehicle wage payment did not appear exactly once';
  end if;
  select * into movement
  from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
  where source_type = 'vehicle_wage_payment'
    and source_id = wage_payment_one.payment_id;
  if movement.direction <> 'out'
    or movement.business_date <> date '2026-09-05'
    or movement.amount <> 1200
    or movement.payment_mode <> 'unspecified'
    or movement.counterparty <> 'WB12AB1234'
    or movement.description <> 'Vehicle Wage Payment'
    or movement.note <> 'Weekly settlement'
    or movement.source_status <> 'active' then
    raise exception 'FAIL: normalized ₹1,200 Vehicle wage movement is wrong: %',
      row_to_json(movement);
  end if;
  select * into summary_after
  from public.get_cash_book_day_summary(factory_id, date '2026-09-05');
  if summary_after.total_money_out - summary_before.total_money_out <> 1200
    or summary_after.closing_balance <> summary_before.closing_balance - 1200 then
    raise exception 'FAIL: ₹1,200 payment did not increase Money Out and reduce closing by ₹1,200';
  end if;
  -- A second identical read proves reads do not create or duplicate movements.
  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_one.payment_id) <> 1 then
    raise exception 'FAIL: repeated Cash Book read duplicated the Vehicle wage movement';
  end if;
  raise notice 'PASS: ₹1,200 Vehicle wage payment produces one exact Money Out row and total';

  select * into wage_payment_two from public.record_vehicle_wage_payment(
    factory_id, vehicle.id, date '2026-09-06', 300, null
  );
  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-06')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_two.payment_id
        and amount = 300) <> 1
    or exists (
      select 1
      from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_two.payment_id
    ) or exists (
      select 1
      from public.list_cash_book_day_entries(factory_id, date '2026-09-06')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_one.payment_id
    ) then
    raise exception 'FAIL: two payments or payment-date filtering is incorrect';
  end if;
  raise notice 'PASS: two Vehicle payments remain two rows on their authoritative payment dates';

  select count(*) into payment_count_before
  from public.vehicle_wage_payments as stored_payment
  where stored_payment.factory_id = v3_integration.factory_id
    and stored_payment.vehicle_id = vehicle.id;
  perform pg_temp.expect_error(
    'over-limit payment creates no Cash Book outflow', 'P3110',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,3501,null)',
      factory_id, vehicle.id, '2026-09-07'
    )
  );
  if (select count(*)
      from public.vehicle_wage_payments as stored_payment
      where stored_payment.factory_id = v3_integration.factory_id
        and stored_payment.vehicle_id = vehicle.id) <> payment_count_before
    or exists (
      select 1
      from public.list_cash_book_day_entries(factory_id, date '2026-09-07')
      where source_type = 'vehicle_wage_payment'
    ) then
    raise exception 'FAIL: rejected over-limit payment left a payment or Cash Book row';
  end if;

  perform public.archive_vehicle(factory_id, vehicle.id);
  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_one.payment_id
        and amount = 1200) <> 1 then
    raise exception 'FAIL: Vehicle archive removed or changed historical Money Out';
  end if;
  perform public.set_vehicle_delivery_wage_tracking(factory_id, vehicle.id, false);
  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
      where source_type = 'vehicle_wage_payment'
        and source_id = wage_payment_one.payment_id
        and amount = 1200) <> 1 then
    raise exception 'FAIL: Tracking OFF removed or changed historical Money Out';
  end if;
  raise notice 'PASS: archive and Tracking OFF do not change historical Cash Book payments';

  select * into account_after
  from public.get_vehicle_wage_account_summary(factory_id, vehicle.id);
  if account_after.total_earned <> 5000
    or account_after.total_paid <> 1500
    or account_after.available_balance <> 3500 then
    raise exception 'FAIL: Cash Book integration changed Vehicle Earned/Paid/Available';
  end if;
  select * into customer_after
  from public.get_customer_sales_summary(factory_id, customer.id);
  if customer_after.total_active_sales <> customer_before.total_active_sales
    or customer_after.total_payments_allocated <> customer_before.total_payments_allocated
    or customer_after.total_outstanding <> customer_before.total_outstanding then
    raise exception 'FAIL: Vehicle wage payments changed customer financial totals';
  end if;
  raise notice 'PASS: Vehicle account and customer financial totals remain authoritative and unchanged by Cash Book reads';

  if exists (
    select 1
    from public.vehicle_wage_payments as foreign_payment
    where foreign_payment.factory_id = factory_b_id
  ) then
    raise exception 'FAIL: Factory A can read Factory B Vehicle wage payments';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot read Factory B Vehicle wage Cash Book row', '42501',
    format(
      'select * from public.list_cash_book_day_entries(%L::uuid,date %L)',
      factory_b_id, '2026-09-05'
    )
  );
  if exists (
    select 1
    from public.list_cash_book_day_entries(factory_id, date '2026-09-05')
    where source_id = payment_b_id
      or counterparty = 'WB99B0001'
  ) then
    raise exception 'FAIL: Factory B Vehicle wage payment leaked into Factory A Cash Book';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot record Factory B Vehicle wage payment', '42501',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,1,null)',
      factory_b_id, vehicle_b_id, '2026-09-05'
    )
  );
  raise notice 'PASS: Vehicle wage Cash Book Money Out remains absolutely factory-isolated';
end;
$$;

reset role;

rollback;
