-- Atlas Vehicle Delivery Wage Account V4 verifier.
-- Run after 20260901000033_create_vehicle_wage_payment_reversals.sql.
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
  totals_definition text := pg_get_functiondef(
    'public.get_vehicle_wage_account_totals(uuid,uuid)'::regprocedure
  );
  payment_definition text := pg_get_functiondef(
    'public.record_vehicle_wage_payment(uuid,uuid,date,numeric,text)'::regprocedure
  );
  reversal_definition text := pg_get_functiondef(
    'public.reverse_vehicle_wage_payment(uuid,uuid,date,text)'::regprocedure
  );
  guard_definition text := pg_get_functiondef(
    'public.guard_challan_vehicle_wage_balance()'::regprocedure
  );
  cash_definition text := pg_get_functiondef(
    'public.get_cash_book_source_movements(uuid)'::regprocedure
  );
begin
  if to_regclass('public.vehicle_wage_payment_reversals') is null
    or not (select relrowsecurity
            from pg_class
            where oid = 'public.vehicle_wage_payment_reversals'::regclass) then
    raise exception 'FAIL: immutable reversal table or RLS is missing';
  end if;
  if (select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vehicle_wage_payment_reversals'
        and column_name = 'amount') <> 0 then
    raise exception 'FAIL: reversal duplicated the original authoritative payment amount';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.vehicle_wage_payment_reversals'::regclass
      and conname = 'vehicle_wage_payment_reversals_payment_id_key'
      and contype = 'u'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.vehicle_wage_payment_reversals'::regclass
      and conname = 'vehicle_wage_payment_reversals_payment_factory_fkey'
      and confdeltype = 'r'
  ) then
    raise exception 'FAIL: at-most-once or factory-safe payment reference is missing';
  end if;
  if (select count(*)
      from pg_trigger
      where tgrelid = 'public.vehicle_wage_payment_reversals'::regclass
        and not tgisinternal
        and tgname = 'vehicle_wage_payment_reversals_are_immutable') <> 1 then
    raise exception 'FAIL: reversal immutability trigger is missing';
  end if;
  if not has_table_privilege('authenticated', 'public.vehicle_wage_payment_reversals', 'select')
    or has_table_privilege('authenticated', 'public.vehicle_wage_payment_reversals', 'insert')
    or has_table_privilege('authenticated', 'public.vehicle_wage_payment_reversals', 'update')
    or has_table_privilege('authenticated', 'public.vehicle_wage_payment_reversals', 'delete') then
    raise exception 'FAIL: authenticated reversal table privileges are not SELECT-only';
  end if;
  if (select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'vehicle_wage_payment_reversals') <> 1 then
    raise exception 'FAIL: expected exactly one reversal read policy';
  end if;
  if not exists (
    select 1
    from pg_proc
    where oid = 'public.reverse_vehicle_wage_payment(uuid,uuid,date,text)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']
  ) or not has_function_privilege(
    'authenticated', 'public.reverse_vehicle_wage_payment(uuid,uuid,date,text)', 'execute'
  ) or has_function_privilege(
    'anon', 'public.reverse_vehicle_wage_payment(uuid,uuid,date,text)', 'execute'
  ) then
    raise exception 'FAIL: reversal RPC definer, search_path, or execution grants are unsafe';
  end if;

  if totals_definition not ilike '%sum(payments.amount)%'
    or totals_definition not ilike '%not exists%vehicle_wage_payment_reversals%'
    or totals_definition ilike '% join %'
    or payment_definition not ilike '%get_vehicle_wage_account_totals%'
    or guard_definition not ilike '%get_vehicle_wage_account_totals%'
    or reversal_definition not ilike '%get_vehicle_wage_account_totals%' then
    raise exception 'FAIL: payment, reversal, summary, and Challan guard do not share effective Paid authority';
  end if;
  if payment_definition not ilike '%vehicle_wage_account:%'
    or reversal_definition not ilike '%vehicle_wage_account:%'
    or guard_definition not ilike '%vehicle_wage_account:%'
    or payment_definition not ilike '%pg_advisory_xact_lock%'
    or reversal_definition not ilike '%pg_advisory_xact_lock%'
    or guard_definition not ilike '%pg_advisory_xact_lock%' then
    raise exception 'FAIL: payment, reversal, and Challan exposure do not share the account lock';
  end if;
  if cash_definition not ilike '%''vehicle_wage_payment''::text%''out''::text%'
    or cash_definition not ilike '%''vehicle_wage_payment_reversal''::text%''in''::text%'
    or cash_definition not ilike '%reversals.reversal_date%payments.amount%'
    or cash_definition not ilike '%''Vehicle Wage Payment Reversal''::text%'
    or cash_definition ilike '%vehicles.is_active%'
    or cash_definition ilike '%vehicles.delivery_wage_tracking_enabled%' then
    raise exception 'FAIL: append-only Vehicle wage Cash Book correction is incomplete';
  end if;
  raise notice 'PASS: V4 schema is immutable, at-most-once, RPC-only, factory-safe, and shares one effective-Paid authority';
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
  reversal_b_id uuid := gen_random_uuid();
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
      factory_a_id, format('Vehicle Wage V4 Factory A %s', factory_a_id),
      'Brick maker', 'Village A', 'Post A', 'Police A', 'District A',
      'State A', 'Address A', '9000000001'
    ),
    (
      factory_b_id, format('Vehicle Wage V4 Factory B %s', factory_b_id),
      'Brick maker', 'Village B', 'Post B', 'Police B', 'District B',
      'State B', 'Address B', '9000000002'
    );
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.brick_types(id, factory_id, name)
  values (brick_a_id, factory_a_id, 'Vehicle Wage V4 Brick');

  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_b_id, factory_b_id, 'Vehicle Wage V4 Customer B', 'Address B', '9222222222');
  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (vehicle_b_id, factory_b_id, 'WB99B0001', 'WB99B0001', true);
  insert into public.challans(
    factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    vehicle_number, tractor_labour_rate_snapshot,
    vehicle_id, vehicle_number_snapshot,
    delivery_wage_applicable_snapshot, trip_labour_wage
  ) values (
    factory_b_id, 1, date '2026-09-01', customer_b_id,
    'Vehicle Wage V4 Customer B', 'Address B', '9222222222',
    'Vehicle Wage V4 Factory B', 'Brick maker', 'Address B', '9000000002',
    'WB99B0001', 1000, vehicle_b_id, 'WB99B0001', true, 1000
  );
  insert into public.vehicle_wage_payments(
    id, factory_id, vehicle_id, payment_date, amount, note, created_by
  ) values (
    payment_b_id, factory_b_id, vehicle_b_id, date '2026-09-01', 500,
    'Factory B payment', test_user_id
  );
  insert into public.vehicle_wage_payment_reversals(
    id, factory_id, payment_id, reversal_date, reason, created_by
  ) values (
    reversal_b_id, factory_b_id, payment_b_id, date '2026-09-02',
    'Factory B secret reversal', test_user_id
  );
  insert into public.cash_book_initializations(
    factory_id, start_date, opening_balance, created_by
  ) values (factory_b_id, date '2026-09-01', 10000, test_user_id);

  perform set_config('atlas_vw4.user_id', test_user_id::text, true);
  perform set_config('atlas_vw4.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_vw4.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_vw4.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_vw4.vehicle_b_id', vehicle_b_id::text, true);
  perform set_config('atlas_vw4.payment_b_id', payment_b_id::text, true);
  perform set_config('atlas_vw4.reversal_b_id', reversal_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_vw4.user_id'), true);

do $$
<<reversal_flow>>
declare
  factory_id uuid := current_setting('atlas_vw4.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_vw4.factory_b_id')::uuid;
  brick_id uuid := current_setting('atlas_vw4.brick_a_id')::uuid;
  vehicle_b_id uuid := current_setting('atlas_vw4.vehicle_b_id')::uuid;
  payment_b_id uuid := current_setting('atlas_vw4.payment_b_id')::uuid;
  reversal_b_id uuid := current_setting('atlas_vw4.reversal_b_id')::uuid;
  customer public.customers%rowtype;
  vehicle public.vehicles%rowtype;
  challan public.challans%rowtype;
  payment record;
  corrected_payment record;
  reversal record;
  account record;
  customer_before record;
  customer_after record;
  cash_movement record;
  reversal_count bigint;
begin
  perform public.initialize_cash_book(factory_id, date '2026-09-01', 10000);
  select * into customer from public.create_customer(
    factory_id, 'Vehicle Wage V4 Customer A', 'Address A', '9111111111'
  );
  select * into vehicle from public.find_or_create_vehicle(
    factory_id, 'WB12AB1234', true
  );
  select * into challan from public.create_challan(
    factory_id, date '2026-09-01', customer.id, vehicle.id, 2000,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_id, 'quantity', 1000, 'rate', 1000
    )),
    '[]'::jsonb
  );
  select * into customer_before
  from public.get_customer_sales_summary(factory_id, customer.id);

  select * into payment from public.record_vehicle_wage_payment(
    factory_id, vehicle.id, date '2026-09-01', 1200, 'Wrong amount'
  );
  select * into reversal from public.reverse_vehicle_wage_payment(
    factory_id, payment.payment_id, date '2026-09-02', '  Incorrect   amount  '
  );
  if reversal.reversal_amount <> 1200
    or reversal.reversal_reason <> 'Incorrect amount'
    or reversal.total_earned <> 2000
    or reversal.total_paid <> 0
    or reversal.available_balance <> 2000 then
    raise exception 'FAIL: ₹1,200 reversal did not restore 2000 / 0 / 2000: %',
      row_to_json(reversal);
  end if;
  if not exists (
    select 1
    from public.vehicle_wage_payments as stored_payment
    where stored_payment.id = payment.payment_id
      and stored_payment.factory_id = reversal_flow.factory_id
      and stored_payment.amount = 1200
      and stored_payment.note = 'Wrong amount'
  ) or not exists (
    select 1
    from public.vehicle_wage_payment_reversals as stored_reversal
    where stored_reversal.id = reversal.reversal_id
      and stored_reversal.payment_id = payment.payment_id
      and stored_reversal.reason = 'Incorrect amount'
  ) then
    raise exception 'FAIL: original payment or immutable reversal audit row was not preserved';
  end if;
  if (select trip_labour_wage from public.challans where id = challan.id) <> 2000 then
    raise exception 'FAIL: payment reversal changed Trip Labour Wage';
  end if;
  select * into customer_after
  from public.get_customer_sales_summary(factory_id, customer.id);
  if customer_after.total_active_sales <> customer_before.total_active_sales
    or customer_after.total_payments_allocated <> customer_before.total_payments_allocated
    or customer_after.total_outstanding <> customer_before.total_outstanding then
    raise exception 'FAIL: payment reversal changed customer financial totals';
  end if;
  raise notice 'PASS: ₹1,200 full reversal restores Paid 0 / Available 2,000 while preserving original payment and source data';

  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-01')
      where source_type = 'vehicle_wage_payment'
        and source_id = payment.payment_id
        and direction = 'out'
        and amount = 1200) <> 1 then
    raise exception 'FAIL: original ₹1,200 Cash Book Money Out was not preserved';
  end if;
  if (select count(*)
      from public.list_cash_book_day_entries(factory_id, date '2026-09-02')
      where source_type = 'vehicle_wage_payment_reversal'
        and source_id = reversal.reversal_id
        and direction = 'in'
        and amount = 1200) <> 1 then
    raise exception 'FAIL: reversal did not create exactly one ₹1,200 Cash Book Money In';
  end if;
  select * into cash_movement
  from public.list_cash_book_day_entries(factory_id, date '2026-09-02')
  where source_type = 'vehicle_wage_payment_reversal'
    and source_id = reversal.reversal_id;
  if cash_movement.counterparty <> 'WB12AB1234'
    or cash_movement.description <> 'Vehicle Wage Payment Reversal'
    or cash_movement.note <> 'Incorrect amount' then
    raise exception 'FAIL: reversal Cash Book identity is incomplete: %', row_to_json(cash_movement);
  end if;
  raise notice 'PASS: Cash Book preserves original Money Out and adds one equal dated reversal Money In';

  select count(*) into reversal_count
  from public.vehicle_wage_payment_reversals
  where payment_id = payment.payment_id;
  perform pg_temp.expect_error(
    'second reversal attempt fails', 'P3121',
    format(
      'select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',
      factory_id, payment.payment_id, '2026-09-03', 'Duplicate reversal'
    )
  );
  if (select count(*) from public.vehicle_wage_payment_reversals
      where payment_id = payment.payment_id) <> reversal_count then
    raise exception 'FAIL: duplicate reversal attempt inserted another row';
  end if;

  select * into corrected_payment from public.record_vehicle_wage_payment(
    factory_id, vehicle.id, date '2026-09-03', 800, 'Correct amount'
  );
  if corrected_payment.total_paid <> 800
    or corrected_payment.available_balance <> 1200 then
    raise exception 'FAIL: reverse ₹1,200 then record ₹800 did not produce Paid 800 / Available 1,200';
  end if;
  perform pg_temp.expect_error(
    'reversal cannot predate original payment', '22023',
    format(
      'select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',
      factory_id, corrected_payment.payment_id, '2026-09-02', 'Backdated reversal'
    )
  );
  perform pg_temp.expect_error(
    'reversal reason is required', '22023',
    format(
      'select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',
      factory_id, corrected_payment.payment_id, '2026-09-04', '   '
    )
  );

  perform public.archive_vehicle(factory_id, vehicle.id);
  perform public.set_vehicle_delivery_wage_tracking(factory_id, vehicle.id, false);
  select * into reversal from public.reverse_vehicle_wage_payment(
    factory_id, corrected_payment.payment_id, date '2026-09-04',
    'Corrected after archive and Tracking OFF'
  );
  if reversal.total_paid <> 0 or reversal.available_balance <> 2000 then
    raise exception 'FAIL: archived Tracking-OFF reversal did not restore full Available';
  end if;
  raise notice 'PASS: archived and Tracking-OFF Vehicles can reverse historical payments';

  if exists (
    select 1
    from public.vehicle_wage_payment_reversals as foreign_reversal
    where foreign_reversal.factory_id = factory_b_id
  ) then
    raise exception 'FAIL: Factory A can read Factory B reversals';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot reverse a Factory B payment through Factory A', 'P3120',
    format(
      'select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',
      factory_id, payment_b_id, '2026-09-03', 'Denied'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B reversal access', '42501',
    format(
      'select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',
      factory_b_id, payment_b_id, '2026-09-03', 'Denied'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot read Factory B reversal Cash Book row', '42501',
    format(
      'select * from public.list_cash_book_day_entries(%L::uuid,date %L)',
      factory_b_id, '2026-09-02'
    )
  );
  if exists (
    select 1
    from public.list_cash_book_day_entries(factory_id, date '2026-09-02')
    where source_id = reversal_b_id
  ) then
    raise exception 'FAIL: Factory B reversal leaked into Factory A Cash Book';
  end if;
  raise notice 'PASS: reversal rows, RPC, and Cash Book correction are factory-isolated';

  perform set_config('atlas_vw4.payment_id', payment.payment_id::text, true);
  perform set_config('atlas_vw4.reversal_id', reversal.reversal_id::text, true);
end;
$$;

do $$
<<effective_guard>>
declare
  factory_id uuid := current_setting('atlas_vw4.factory_a_id')::uuid;
  brick_id uuid := current_setting('atlas_vw4.brick_a_id')::uuid;
  customer public.customers%rowtype;
  vehicle public.vehicles%rowtype;
  challan public.challans%rowtype;
  payment record;
  account record;
begin
  select * into customer from public.create_customer(
    factory_id, 'Vehicle Wage V4 Guard Customer', 'Address A', '9333333333'
  );
  select * into vehicle from public.find_or_create_vehicle(
    factory_id, 'WB12GUARD04', true
  );
  select * into challan from public.create_challan(
    factory_id, date '2026-09-01', customer.id, vehicle.id, 1000,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_id, 'quantity', 1000, 'rate', 1000
    )),
    '[]'::jsonb
  );
  select * into payment from public.record_vehicle_wage_payment(
    factory_id, vehicle.id, date '2026-09-01', 900, null
  );
  perform public.reverse_vehicle_wage_payment(
    factory_id, payment.payment_id, date '2026-09-02', 'Replace wrong payment'
  );
  perform public.record_vehicle_wage_payment(
    factory_id, vehicle.id, date '2026-09-02', 800, 'Correct payment'
  );

  select * into challan from public.update_challan(
    factory_id, challan.id, date '2026-09-01', customer.id,
    vehicle.id, 800,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_id, 'quantity', 1000, 'rate', 1000
    )),
    '[]'::jsonb
  );
  if challan.trip_labour_wage <> 800 then
    raise exception 'FAIL: exact-solvency edit still counted the reversed ₹900 payment';
  end if;
  perform pg_temp.expect_error(
    'Challan guard rejects Earned below effective Paid after reversal', 'P3111',
    format(
      'select * from public.update_challan(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,799,jsonb_build_array(jsonb_build_object(''brick_type_id'',%L::uuid,''quantity'',1000,''rate'',1000)),''[]''::jsonb)',
      factory_id, challan.id, '2026-09-01', customer.id, vehicle.id, brick_id
    )
  );
  select * into account
  from public.get_vehicle_wage_account_summary(factory_id, vehicle.id);
  if account.total_earned <> 800
    or account.total_paid <> 800
    or account.available_balance <> 0 then
    raise exception 'FAIL: effective-Paid guard did not preserve 800 / 800 / 0';
  end if;
  raise notice 'PASS: Challan solvency guard uses effective Paid after reversal';
end;
$$;

reset role;

do $$
declare
  payment_id uuid := current_setting('atlas_vw4.payment_id')::uuid;
  reversal_id uuid := current_setting('atlas_vw4.reversal_id')::uuid;
begin
  perform pg_temp.expect_error(
    'original payment remains immutable', 'P3112',
    format(
      'update public.vehicle_wage_payments set amount = amount where id = %L::uuid',
      payment_id
    )
  );
  perform pg_temp.expect_error(
    'reversal update is blocked by immutable trigger', 'P3122',
    format(
      'update public.vehicle_wage_payment_reversals set reason = reason where id = %L::uuid',
      reversal_id
    )
  );
  perform pg_temp.expect_error(
    'reversal delete is blocked by immutable trigger', 'P3122',
    format(
      'delete from public.vehicle_wage_payment_reversals where id = %L::uuid',
      reversal_id
    )
  );
  raise notice 'PASS: original payments and reversals remain independently immutable';
end;
$$;

rollback;
