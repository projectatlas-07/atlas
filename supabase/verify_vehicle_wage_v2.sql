-- Atlas Vehicle Delivery Wage Account V2 verifier.
-- Run after 20260901000031_create_vehicle_wage_payment_foundation.sql.
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
  brick_a_id uuid := gen_random_uuid();
  vehicle_b_id uuid := gen_random_uuid();
  challan_b_id uuid := gen_random_uuid();
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
      factory_a_id, format('Vehicle Wage V2 Factory A %s', factory_a_id),
      'Brick maker', 'Village A', 'Post A', 'Police A', 'District A',
      'State A', 'Legacy A', '9000000001'
    ),
    (
      factory_b_id, format('Vehicle Wage V2 Factory B %s', factory_b_id),
      'Brick maker', 'Village B', 'Post B', 'Police B', 'District B',
      'State B', 'Legacy B', '9000000002'
    );
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'Vehicle Wage Customer A', 'Address A', '9111111111'),
    (customer_b_id, factory_b_id, 'Vehicle Wage Customer B', 'Address B', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Vehicle Wage Brick A');

  -- One valid Factory B account proves that authenticated Factory A reads do
  -- not merely return zero because no foreign rows exist.
  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (
    vehicle_b_id, factory_b_id, 'WB99B0001', 'WB99B0001', true
  );
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    vehicle_number, tractor_labour_rate_snapshot,
    vehicle_id, vehicle_number_snapshot,
    delivery_wage_applicable_snapshot, trip_labour_wage
  ) values (
    challan_b_id, factory_b_id, 1, date '2026-09-01', customer_b_id,
    'Vehicle Wage Customer B', 'Address B', '9222222222',
    'Vehicle Wage Factory B', 'Brick maker', 'Legacy B', '9000000002',
    'WB99B0001', 1000, vehicle_b_id, 'WB99B0001', true, 1000
  );
  insert into public.vehicle_wage_payments(
    factory_id, vehicle_id, payment_date, amount, note, created_by
  ) values (
    factory_b_id, vehicle_b_id, date '2026-09-01', 500,
    'Foreign factory fixture', test_user_id
  );

  perform set_config('atlas_vw2.user_id', test_user_id::text, true);
  perform set_config('atlas_vw2.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_vw2.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_vw2.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_vw2.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_vw2.vehicle_b_id', vehicle_b_id::text, true);
end;
$$;

create or replace function pg_temp.make_wage_challan(
  p_vehicle_id uuid,
  p_wage numeric
)
returns public.challans
language plpgsql
as $$
declare
  saved public.challans%rowtype;
begin
  select * into saved
  from public.create_challan(
    current_setting('atlas_vw2.factory_a_id')::uuid,
    date '2026-09-01',
    current_setting('atlas_vw2.customer_a_id')::uuid,
    p_vehicle_id,
    p_wage,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', current_setting('atlas_vw2.brick_a_id')::uuid,
      'quantity', 1000,
      'rate', 1000
    )),
    '[]'::jsonb
  );
  return saved;
end;
$$;

create or replace function pg_temp.edit_wage_challan(
  p_challan_id uuid,
  p_vehicle_id uuid,
  p_wage numeric
)
returns public.challans
language plpgsql
as $$
declare
  saved public.challans%rowtype;
begin
  select * into saved
  from public.update_challan(
    current_setting('atlas_vw2.factory_a_id')::uuid,
    p_challan_id,
    date '2026-09-01',
    current_setting('atlas_vw2.customer_a_id')::uuid,
    p_vehicle_id,
    p_wage,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', current_setting('atlas_vw2.brick_a_id')::uuid,
      'quantity', 1000,
      'rate', 1000
    )),
    '[]'::jsonb
  );
  return saved;
end;
$$;

do $$
declare
  payment_definition text := pg_get_functiondef(
    'public.record_vehicle_wage_payment(uuid,uuid,date,numeric,text)'::regprocedure
  );
  guard_definition text := pg_get_functiondef(
    'public.guard_challan_vehicle_wage_balance()'::regprocedure
  );
  totals_definition text := pg_get_functiondef(
    'public.get_vehicle_wage_account_totals(uuid,uuid)'::regprocedure
  );
begin
  if to_regclass('public.vehicle_wage_payments') is null then
    raise exception 'FAIL: vehicle_wage_payments table is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vehicle_wage_payments'::regclass) then
    raise exception 'FAIL: vehicle_wage_payments RLS is not enabled';
  end if;
  if not has_table_privilege('authenticated', 'public.vehicle_wage_payments', 'select')
    or has_table_privilege('authenticated', 'public.vehicle_wage_payments', 'insert')
    or has_table_privilege('authenticated', 'public.vehicle_wage_payments', 'update')
    or has_table_privilege('authenticated', 'public.vehicle_wage_payments', 'delete') then
    raise exception 'FAIL: authenticated payment table privileges are not SELECT-only';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'vehicle_wage_payments') <> 1 then
    raise exception 'FAIL: expected exactly one Vehicle wage payment RLS policy';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.record_vehicle_wage_payment(uuid,uuid,date,numeric,text)',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.record_vehicle_wage_payment(uuid,uuid,date,numeric,text)',
      'execute'
    ) then
    raise exception 'FAIL: payment RPC execution privileges are incorrect';
  end if;
  if not exists (
      select 1 from pg_proc
      where oid = 'public.record_vehicle_wage_payment(uuid,uuid,date,numeric,text)'::regprocedure
        and prosecdef
        and proconfig @> array['search_path=pg_catalog, public']
    ) or not exists (
      select 1 from pg_proc
      where oid = 'public.get_vehicle_wage_account_summary(uuid,uuid)'::regprocedure
        and prosecdef
        and provolatile = 's'
        and proconfig @> array['search_path=pg_catalog, public']
    ) or guard_definition not like '%vehicle_wage_account:%'
    or payment_definition not like '%vehicle_wage_account:%'
    or payment_definition not like '%pg_advisory_xact_lock%'
    or guard_definition not like '%pg_advisory_xact_lock%'
    or lower(guard_definition) not like '%array_agg(vehicle_id order by vehicle_id)%' then
    raise exception 'FAIL: shared or deterministic account locking is incomplete';
  end if;
  if totals_definition ilike '% join %'
    or totals_definition not like '%sum(challans.trip_labour_wage)%'
    or totals_definition not like '%sum(payments.amount)%' then
    raise exception 'FAIL: lifetime totals are not independent join-free aggregates';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('vehicles', 'challans')
      and column_name in ('total_earned', 'total_paid', 'current_balance', 'available_balance')
  ) or to_regclass('public.vehicle_wage_earnings') is not null then
    raise exception 'FAIL: V2 introduced duplicated earnings or stored balance state';
  end if;
  raise notice 'PASS: schema, RLS, RPC-only writes, independent totals, and shared deterministic locks';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_vw2.user_id'), true);

do $$
<<main_payments>>
declare
  factory_id uuid := current_setting('atlas_vw2.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_vw2.factory_b_id')::uuid;
  vehicle_b_id uuid := current_setting('atlas_vw2.vehicle_b_id')::uuid;
  vehicle_main public.vehicles%rowtype;
  trip_a public.challans%rowtype;
  trip_b public.challans%rowtype;
  payment record;
  account record;
  payment_count integer;
begin
  select * into vehicle_main from public.find_or_create_vehicle(
    factory_id, 'VW2 MAIN 001', true
  );
  select * into trip_a from pg_temp.make_wage_challan(vehicle_main.id, 1200);
  select * into trip_b from pg_temp.make_wage_challan(vehicle_main.id, 800);

  select * into account from public.get_vehicle_wage_account_summary(
    factory_id, vehicle_main.id
  );
  if account.total_earned <> 2000 or account.total_paid <> 0
    or account.available_balance <> 2000 then
    raise exception 'FAIL: initial lifetime account was not 2000 / 0 / 2000';
  end if;

  select * into payment from public.record_vehicle_wage_payment(
    factory_id, vehicle_main.id, date '2026-09-01', 1200, '  Weekly   payment  '
  );
  if payment.total_earned <> 2000 or payment.total_paid <> 1200
    or payment.available_balance <> 800 or payment.payment_note <> 'Weekly payment'
    or payment.created_by <> current_setting('atlas_vw2.user_id')::uuid then
    raise exception 'FAIL: first payment did not return 2000 / 1200 / 800 with audit data';
  end if;
  select count(*) into payment_count
  from public.vehicle_wage_payments as stored_payment
  where stored_payment.factory_id = main_payments.factory_id
    and stored_payment.vehicle_id = vehicle_main.id;
  if payment_count <> 1 then
    raise exception 'FAIL: first RPC did not insert exactly one payment';
  end if;
  raise notice 'PASS: ₹2,000 earned -> ₹1,200 paid -> ₹800 available';

  perform pg_temp.expect_error(
    '₹801 overpayment is rejected at ₹800 available',
    'P3110',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,801,null)',
      factory_id, vehicle_main.id, '2026-09-01'
    )
  );
  select count(*) into payment_count
  from public.vehicle_wage_payments as p
  where p.factory_id = main_payments.factory_id and p.vehicle_id = vehicle_main.id;
  if payment_count <> 1 then
    raise exception 'FAIL: rejected overpayment inserted a partial payment';
  end if;

  select * into payment from public.record_vehicle_wage_payment(
    factory_id, vehicle_main.id, date '2026-09-01', 800, null
  );
  if payment.total_paid <> 2000 or payment.available_balance <> 0 then
    raise exception 'FAIL: second payment did not settle the account to zero';
  end if;
  perform pg_temp.expect_error(
    'zero payment is rejected', '22023',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,0,null)',
      factory_id, vehicle_main.id, '2026-09-01'
    )
  );
  perform pg_temp.expect_error(
    'negative payment is rejected', '22023',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,-1,null)',
      factory_id, vehicle_main.id, '2026-09-01'
    )
  );
  raise notice 'PASS: second payment settles to zero and invalid amounts remain rejected';

  if (select count(*) from public.vehicle_wage_payments as foreign_payment
      where foreign_payment.factory_id = factory_b_id) <> 0 then
    raise exception 'FAIL: Factory A can read Factory B Vehicle wage payments';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot record a Factory B payment', '42501',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,1,null)',
      factory_b_id, vehicle_b_id, '2026-09-01'
    )
  );
  raise notice 'PASS: payment reads and writes are factory-isolated';

  perform pg_temp.expect_error(
    'authenticated direct INSERT is denied', '42501',
    format(
      'insert into public.vehicle_wage_payments(factory_id,vehicle_id,payment_date,amount,created_by) values (%L::uuid,%L::uuid,date %L,1,%L::uuid)',
      factory_id, vehicle_main.id, '2026-09-01', current_setting('atlas_vw2.user_id')
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct UPDATE is denied', '42501',
    format(
      'update public.vehicle_wage_payments set amount=amount where id=%L::uuid',
      payment.payment_id
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct DELETE is denied', '42501',
    format('delete from public.vehicle_wage_payments where id=%L::uuid', payment.payment_id)
  );

  if exists (
    select 1 from public.customer_payment_allocations as allocation
    where allocation.factory_id = main_payments.factory_id
  ) or exists (
    select 1 from public.customer_payments as customer_payment
    where customer_payment.factory_id = main_payments.factory_id
  ) or trip_a.challan_total <> (
    select saved_challan.challan_total from public.challans as saved_challan
    where saved_challan.id = trip_a.id
  ) then
    raise exception 'FAIL: Vehicle wage settlement changed customer financial state';
  end if;
  raise notice 'PASS: payments never change customer Challan totals, receipts, or allocations';
end;
$$;

do $$
<<history_test>>
declare
  factory_id uuid := current_setting('atlas_vw2.factory_a_id')::uuid;
  vehicle_history public.vehicles%rowtype;
  payment record;
begin
  select * into vehicle_history from public.find_or_create_vehicle(
    factory_id, 'VW2 HISTORY 002', true
  );
  perform pg_temp.make_wage_challan(vehicle_history.id, 2000);
  perform public.record_vehicle_wage_payment(
    factory_id, vehicle_history.id, date '2026-09-05', 500, 'Weekly payment'
  );
  perform public.record_vehicle_wage_payment(
    factory_id, vehicle_history.id, date '2026-09-12', 750, null
  );
  if (select count(*) from public.vehicle_wage_payments as stored_payment
      where stored_payment.factory_id = history_test.factory_id
        and stored_payment.vehicle_id = vehicle_history.id) <> 2
    or (select sum(stored_payment.amount)
        from public.vehicle_wage_payments as stored_payment
        where stored_payment.factory_id = history_test.factory_id
          and stored_payment.vehicle_id = vehicle_history.id) <> 1250
    or not exists (
      select 1 from public.vehicle_wage_payments as stored_payment
      where stored_payment.factory_id = history_test.factory_id
        and stored_payment.vehicle_id = vehicle_history.id
        and stored_payment.payment_date = date '2026-09-05'
        and stored_payment.amount = 500
        and stored_payment.note = 'Weekly payment'
    ) or not exists (
      select 1 from public.vehicle_wage_payments as stored_payment
      where stored_payment.factory_id = history_test.factory_id
        and stored_payment.vehicle_id = vehicle_history.id
        and stored_payment.payment_date = date '2026-09-12'
        and stored_payment.amount = 750 and stored_payment.note is null
    ) then
    raise exception 'FAIL: independent payment history rows were not preserved';
  end if;
  select * into payment from public.get_vehicle_wage_account_summary(
    factory_id, vehicle_history.id
  );
  if payment.total_earned <> 2000 or payment.total_paid <> 1250
    or payment.available_balance <> 750 then
    raise exception 'FAIL: multiple history rows multiplied account totals';
  end if;
  raise notice 'PASS: payment history is complete, independent, ordered data without total multiplication';
end;
$$;

do $$
<<lifecycle_test>>
declare
  factory_id uuid := current_setting('atlas_vw2.factory_a_id')::uuid;
  archived_vehicle public.vehicles%rowtype;
  tracking_off_vehicle public.vehicles%rowtype;
  payment record;
begin
  select * into archived_vehicle from public.find_or_create_vehicle(
    factory_id, 'VW2 ARCHIVE 003', true
  );
  perform pg_temp.make_wage_challan(archived_vehicle.id, 1250);
  select * into archived_vehicle from public.archive_vehicle(
    factory_id, archived_vehicle.id
  );
  select * into payment from public.record_vehicle_wage_payment(
    factory_id, archived_vehicle.id, date '2026-09-01', 1000, 'Archived settlement'
  );
  if payment.available_balance <> 250 or archived_vehicle.is_active
    or (select stored_vehicle.is_active from public.vehicles as stored_vehicle
        where stored_vehicle.id = archived_vehicle.id) then
    raise exception 'FAIL: archived Vehicle settlement or lifecycle state is incorrect';
  end if;

  select * into tracking_off_vehicle from public.find_or_create_vehicle(
    factory_id, 'VW2 OFF 004', true
  );
  perform pg_temp.make_wage_challan(tracking_off_vehicle.id, 1250);
  select * into tracking_off_vehicle from public.set_vehicle_delivery_wage_tracking(
    factory_id, tracking_off_vehicle.id, false
  );
  select * into payment from public.record_vehicle_wage_payment(
    factory_id, tracking_off_vehicle.id, date '2026-09-01', 1000, 'Tracking OFF settlement'
  );
  if payment.available_balance <> 250
    or tracking_off_vehicle.delivery_wage_tracking_enabled then
    raise exception 'FAIL: Tracking OFF historical settlement is incorrect';
  end if;
  raise notice 'PASS: archived and Tracking-OFF Vehicles can settle historical Available without lifecycle changes';
end;
$$;

do $$
<<void_test>>
declare
  factory_id uuid := current_setting('atlas_vw2.factory_a_id')::uuid;
  vehicle_void_first public.vehicles%rowtype;
  vehicle_paid_first public.vehicles%rowtype;
  trip_750 public.challans%rowtype;
  trip_500 public.challans%rowtype;
begin
  select * into vehicle_void_first from public.find_or_create_vehicle(
    factory_id, 'VW2 VOID FIRST 005', true
  );
  select * into trip_750 from pg_temp.make_wage_challan(vehicle_void_first.id, 750);
  select * into trip_500 from pg_temp.make_wage_challan(vehicle_void_first.id, 500);
  perform public.void_challan(factory_id, trip_500.id);
  perform pg_temp.expect_error(
    'void-before-payment reduces authority before the payment check', 'P3110',
    format(
      'select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,1000,null)',
      factory_id, vehicle_void_first.id, '2026-09-01'
    )
  );

  select * into vehicle_paid_first from public.find_or_create_vehicle(
    factory_id, 'VW2 PAID FIRST 006', true
  );
  select * into trip_750 from pg_temp.make_wage_challan(vehicle_paid_first.id, 750);
  select * into trip_500 from pg_temp.make_wage_challan(vehicle_paid_first.id, 500);
  perform public.record_vehicle_wage_payment(
    factory_id, vehicle_paid_first.id, date '2026-09-01', 1000, null
  );
  perform pg_temp.expect_error(
    'payment-before-void rejects an insolvent void atomically', 'P3111',
    format('select * from public.void_challan(%L::uuid,%L::uuid)', factory_id, trip_500.id)
  );
  if (select stored_challan.status from public.challans as stored_challan
      where stored_challan.id = trip_500.id) <> 'active'
    or (select sum(stored_payment.amount)
        from public.vehicle_wage_payments as stored_payment
        where stored_payment.factory_id = void_test.factory_id
          and stored_payment.vehicle_id = vehicle_paid_first.id) <> 1000 then
    raise exception 'FAIL: rejected void left partial financial state';
  end if;
  raise notice 'PASS: void-before-payment revalues earnings; payment-before-void cannot overpay';
end;
$$;

do $$
<<move_test>>
declare
  factory_id uuid := current_setting('atlas_vw2.factory_a_id')::uuid;
  source_vehicle public.vehicles%rowtype;
  target_vehicle public.vehicles%rowtype;
  solvent_source public.vehicles%rowtype;
  wage_750 public.challans%rowtype;
  wage_500 public.challans%rowtype;
  moved public.challans%rowtype;
  account record;
begin
  select * into source_vehicle from public.find_or_create_vehicle(
    factory_id, 'VW2 MOVE A 007', true
  );
  select * into target_vehicle from public.find_or_create_vehicle(
    factory_id, 'VW2 MOVE B 008', true
  );
  select * into wage_750 from pg_temp.make_wage_challan(source_vehicle.id, 750);
  select * into wage_500 from pg_temp.make_wage_challan(source_vehicle.id, 500);
  perform public.record_vehicle_wage_payment(
    factory_id, source_vehicle.id, date '2026-09-01', 1000, null
  );

  -- Boundary case: 1250 - 500 + 250 = 1000, exactly equal to Paid.
  -- The invariant is Paid <= Earned, so this edit must succeed.
  select * into wage_500 from pg_temp.edit_wage_challan(
    wage_500.id, source_vehicle.id, 250
  );
  select * into account from public.get_vehicle_wage_account_summary(
    factory_id, source_vehicle.id
  );
  if wage_500.trip_labour_wage <> 250
    or account.total_earned <> 1000
    or account.total_paid <> 1000
    or account.available_balance <> 0 then
    raise exception 'FAIL: exact-solvency downward edit did not produce 1000 / 1000 / 0';
  end if;
  raise notice 'PASS: downward edit to the exact Paid = Earned boundary succeeds';

  -- Genuine insolvency: 1000 - 250 + 200 = 950, below Paid 1000.
  perform pg_temp.expect_error(
    'downward wage edit cannot make the source Vehicle overpaid', 'P3111',
    format(
      'select * from pg_temp.edit_wage_challan(%L::uuid,%L::uuid,200)',
      wage_500.id, source_vehicle.id
    )
  );
  perform pg_temp.expect_error(
    'Vehicle removal cannot make the source Vehicle overpaid', 'P3111',
    format(
      'select * from pg_temp.edit_wage_challan(%L::uuid,null::uuid,null::numeric)',
      wage_500.id
    )
  );
  perform pg_temp.expect_error(
    'Vehicle move cannot make the source Vehicle overpaid', 'P3111',
    format(
      'select * from pg_temp.edit_wage_challan(%L::uuid,%L::uuid,500)',
      wage_500.id, target_vehicle.id
    )
  );
  if (select stored_challan.vehicle_id from public.challans as stored_challan
      where stored_challan.id = wage_500.id) <> source_vehicle.id
    or (select stored_challan.trip_labour_wage from public.challans as stored_challan
        where stored_challan.id = wage_500.id) <> 250 then
    raise exception 'FAIL: rejected edit/move changed the source Challan';
  end if;

  select * into solvent_source from public.find_or_create_vehicle(
    factory_id, 'VW2 SOLVENT 009', true
  );
  perform pg_temp.make_wage_challan(solvent_source.id, 1000);
  select * into wage_500 from pg_temp.make_wage_challan(solvent_source.id, 500);
  perform public.record_vehicle_wage_payment(
    factory_id, solvent_source.id, date '2026-09-01', 500, null
  );

  select * into wage_500 from pg_temp.edit_wage_challan(
    wage_500.id, solvent_source.id, 250
  );
  select * into account from public.get_vehicle_wage_account_summary(
    factory_id, solvent_source.id
  );
  if wage_500.trip_labour_wage <> 250
    or account.total_earned <> 1250
    or account.total_paid <> 500
    or account.available_balance <> 750 then
    raise exception 'FAIL: solvent downward edit did not produce 1250 / 500 / 750';
  end if;

  select * into moved from pg_temp.edit_wage_challan(
    wage_500.id, target_vehicle.id, 250
  );
  if moved.vehicle_id <> target_vehicle.id then
    raise exception 'FAIL: solvent Vehicle move did not succeed';
  end if;
  select * into account from public.get_vehicle_wage_account_summary(
    factory_id, solvent_source.id
  );
  if account.total_earned <> 1000 or account.total_paid <> 500
    or account.available_balance <> 500 then
    raise exception 'FAIL: solvent source totals are incorrect after move';
  end if;
  raise notice 'PASS: insolvent reduction/removal/move fail; solvent reduction and move succeed';
end;
$$;

reset role;

do $$
declare
  payment_id uuid;
begin
  select id into payment_id
  from public.vehicle_wage_payments
  where factory_id = current_setting('atlas_vw2.factory_a_id')::uuid
  order by created_at, id
  limit 1;
  perform pg_temp.expect_error(
    'immutable trigger rejects privileged UPDATE', 'P3112',
    format('update public.vehicle_wage_payments set amount=amount where id=%L::uuid', payment_id)
  );
  perform pg_temp.expect_error(
    'immutable trigger rejects privileged DELETE', 'P3112',
    format('delete from public.vehicle_wage_payments where id=%L::uuid', payment_id)
  );

  if exists (
    select 1
    from (
      select distinct factory_id, vehicle_id
      from public.vehicle_wage_payments
    ) as paid_accounts
    cross join lateral public.get_vehicle_wage_account_totals(
      paid_accounts.factory_id,
      paid_accounts.vehicle_id
    ) as account
    where account.total_paid > account.total_earned
      or account.available_balance < 0
  ) then
    raise exception 'FAIL: a verifier account ended with Paid > Earned';
  end if;
  raise notice 'PASS: immutable trigger and final Paid <= Earned invariant hold for every fixture account';
  raise notice 'PASS: shared post-lock rechecks structurally serialize payment/payment and payment/Challan races';
  raise notice 'PASS: Vehicle Delivery Wage Account V2 verifier completed; rolling back all fixtures';
end;
$$;

rollback;
