-- Dedicated Vehicle Fuel Book rollback verifier.
-- Run after 20260914000042_create_vehicle_fuel_book.sql.

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
  vehicle_b_id uuid := gen_random_uuid();
  pump_b_id uuid := gen_random_uuid();
  fuel_b_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;
  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Fuel Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Fuel Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;

  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number, delivery_wage_tracking_enabled
  ) values (vehicle_b_id, factory_b_id, 'WB 00 B 0001', 'WB00B0001', false);
  insert into public.suppliers(id, factory_id, name) values (pump_b_id, factory_b_id, 'Factory B Pump');
  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (factory_b_id, pump_b_id, 'FUEL_PUMP', test_user_id);
  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, description, total_amount, created_by
  ) values (
    fuel_b_id, factory_b_id, date '2026-09-10', 'expense', pump_b_id,
    'Factory B Pump', 'Factory B secret fuel', 920, test_user_id
  );
  insert into public.vehicle_fuel_records(
    id, factory_id, vehicle_id, vehicle_number_snapshot, fuel_time,
    fuel_type, litres, rate_per_litre, created_by
  ) values (
    fuel_b_id, factory_b_id, vehicle_b_id, 'WB 00 B 0001', time '06:30',
    'DIESEL', 10, 92, test_user_id
  );

  perform set_config('atlas_fuel.user_id', test_user_id::text, true);
  perform set_config('atlas_fuel.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_fuel.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_fuel.fuel_b_id', fuel_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_fuel.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_fuel.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_fuel.factory_b_id')::uuid;
  fuel_b_id uuid := current_setting('atlas_fuel.fuel_b_id')::uuid;
  vehicle_one public.vehicles%rowtype;
  vehicle_two public.vehicles%rowtype;
  pump_one public.suppliers%rowtype;
  pump_two public.suppliers%rowtype;
  coal_only public.suppliers%rowtype;
  garage_only public.suppliers%rowtype;
  multi_coal public.suppliers%rowtype;
  multi_pump public.suppliers%rowtype;
  unpaid public.vehicle_fuel_detail;
  partial public.vehicle_fuel_detail;
  fully_paid public.vehicle_fuel_detail;
  back_entered public.vehicle_fuel_detail;
  same_time_one public.vehicle_fuel_detail;
  same_time_two public.vehicle_fuel_detail;
  previous public.vehicle_fuel_detail;
  listed public.vehicle_fuel_detail;
  payment public.expense_payments%rowtype;
  payment_row record;
  cash_row record;
  generic_record public.expense_records%rowtype;
  first_order uuid[];
  second_order uuid[];
begin
  perform public.initialize_cash_book(factory_a_id, date '2026-09-01', 500000);
  select * into vehicle_one from public.find_or_create_vehicle(factory_a_id, 'WB58 A 1234', false);
  select * into vehicle_two from public.find_or_create_vehicle(factory_a_id, 'WB58 A 5678', false);
  select * into pump_one from public.create_or_assign_supplier_role(
    factory_a_id, 'FUEL_PUMP', 'Shell Pump Kolkata', 'Main Road', null
  );
  select * into pump_two from public.create_or_assign_supplier_role(
    factory_a_id, 'FUEL_PUMP', 'Bharat Fuel', 'Station Road', null
  );
  select * into coal_only from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Coal Only Traders', null, null
  );
  select * into garage_only from public.create_or_assign_supplier_role(
    factory_a_id, 'GARAGE', 'Garage Only Works', null, null
  );
  select * into multi_coal from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Atlas Multi Role', 'Original Address', null
  );
  select * into multi_pump from public.create_or_assign_supplier_role(
    factory_a_id, 'FUEL_PUMP', 'Atlas Multi Role', 'Ignored New Address', null
  );
  if multi_coal.id <> multi_pump.id
    or (select count(*) from public.suppliers where factory_id = factory_a_id and name = 'Atlas Multi Role') <> 1
    or (select count(*) from public.supplier_roles where supplier_id = multi_coal.id) <> 2 then
    raise exception 'FAIL: multi-role Pump did not reuse one supplier UUID';
  end if;
  if exists (select 1 from public.list_suppliers_by_role(factory_a_id, 'FUEL_PUMP') where id in (coal_only.id, garage_only.id))
    or not exists (select 1 from public.list_suppliers_by_role(factory_a_id, 'FUEL_PUMP') where id = pump_one.id)
    or exists (select 1 from public.list_suppliers_by_role(factory_a_id, 'COAL_SELLER') where id = pump_one.id)
    or exists (select 1 from public.list_suppliers_by_role(factory_a_id, 'GARAGE') where id = pump_one.id) then
    raise exception 'FAIL: FUEL_PUMP role separation is wrong';
  end if;
  raise notice 'PASS: Fuel Pump creation, reuse, role separation, and multi-role supplier identity work';

  select * into unpaid from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-10', time '07:35', vehicle_one.id, pump_one.id,
    'DIESEL', 42, 92, null, 0, null
  );
  select * into partial from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-14', time '08:00', vehicle_one.id, pump_one.id,
    'DIESEL', null, 92, 3680, 1840, 'cash'
  );
  select * into fully_paid from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-13', time '18:45', vehicle_two.id, pump_two.id,
    'PETROL', 10, null, 1000, 1000, 'upi'
  );
  select * into back_entered from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-11', time '20:15', vehicle_one.id, pump_one.id,
    'DIESEL', 20, 91.5, null, 0, null
  );
  if unpaid.fuel_amount <> 3864 or unpaid.litres <> 42 or unpaid.rate_per_litre <> 92
    or unpaid.total_paid <> 0 or unpaid.outstanding_amount <> 3864 or unpaid.payment_state <> 'unpaid'
    or partial.litres <> 40 or partial.total_paid <> 1840 or partial.outstanding_amount <> 1840
    or partial.payment_state <> 'partially_paid' or not partial.is_locked
    or fully_paid.rate_per_litre <> 100 or fully_paid.payment_state <> 'paid'
    or fully_paid.outstanding_amount <> 0 or fully_paid.fuel_type <> 'PETROL'
    or unpaid.fuel_time <> time '07:35' or unpaid.fuel_type <> 'DIESEL' then
    raise exception 'FAIL: smart measurements or unpaid, partial, and full states are wrong';
  end if;
  if (select count(*) from public.expense_records where id = unpaid.id) <> 1
    or (select count(*) from public.vehicle_fuel_records where id = unpaid.id) <> 1 then
    raise exception 'FAIL: Fuel did not create exactly one shared expense obligation';
  end if;
  raise notice 'PASS: smart measurements, local time, Diesel/Petrol, and unpaid, partial, and full states work';

  perform pg_temp.expect_error(
    'invalid CNG Fuel Type rejected', '22023',
    format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,''CNG'',10,92,null,0,null)',
      factory_a_id, '2026-09-15', '10:00', vehicle_one.id, pump_one.id)
  );
  perform pg_temp.expect_error(
    'zero Rate division rejected', '22023',
    format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,''DIESEL'',null,0,100,0,null)',
      factory_a_id, '2026-09-15', '10:00', vehicle_one.id, pump_one.id)
  );
  perform pg_temp.expect_error(
    'Coal-only supplier rejected as Pump', 'P4503',
    format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,''DIESEL'',10,92,null,0,null)',
      factory_a_id, '2026-09-15', '10:00', vehicle_one.id, coal_only.id)
  );
  raise notice 'PASS: type, division-by-zero, invalid measurement, and Pump-role guards work';

  select * into previous from public.get_previous_vehicle_refuel(
    factory_a_id, vehicle_one.id, date '2026-09-14', time '08:00', partial.id
  );
  if previous.id <> back_entered.id or previous.fuel_date <> date '2026-09-11'
    or previous.fuel_time <> time '20:15' or previous.litres <> 20
    or previous.fuel_type <> 'DIESEL' then
    raise exception 'FAIL: Last Refuel did not follow business date/time chronology';
  end if;
  if exists (
    select 1 from public.get_previous_vehicle_refuel(
      factory_a_id, vehicle_two.id, date '2026-09-01', time '00:00', null
    )
  ) then raise exception 'FAIL: no-previous-refuel state returned another Vehicle history'; end if;
  if (select id from public.list_vehicle_fuel_records(factory_a_id, vehicle_one.id, null) limit 1) <> partial.id then
    raise exception 'FAIL: back-entered Fuel history is not ordered by actual date/time';
  end if;
  select * into same_time_one from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-12', time '12:00', vehicle_two.id, pump_two.id,
    'PETROL', 5, 100, null, 0, null
  );
  select * into same_time_two from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-12', time '12:00', vehicle_two.id, pump_two.id,
    'PETROL', 6, 100, null, 0, null
  );
  select array_agg(id order by fuel_date desc, fuel_time desc, created_at desc, id desc)
    into first_order from public.list_vehicle_fuel_records(factory_a_id, vehicle_two.id, null);
  select array_agg(id order by fuel_date desc, fuel_time desc, created_at desc, id desc)
    into second_order from public.list_vehicle_fuel_records(factory_a_id, vehicle_two.id, null);
  if first_order is distinct from second_order then
    raise exception 'FAIL: identical date/time Fuel ordering is not deterministic';
  end if;
  raise notice 'PASS: Last Refuel is Vehicle-specific and chronological ordering handles back-entry and stable ties';

  if (select count(*) from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id)) <> 3
    or (select coalesce(sum(fuel_amount), 0) from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where status = 'active') <> 9374
    or (select coalesce(sum(total_paid), 0) from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where status = 'active') <> 1840
    or (select coalesce(sum(outstanding_amount), 0) from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where status = 'active') <> 7534 then
    raise exception 'FAIL: Pump statement totals/history are wrong';
  end if;
  raise notice 'PASS: Pump statement and Vehicle/Pump history filters derive correct totals';

  select * into cash_row from public.list_cash_book_day_entries(factory_a_id, date '2026-09-14')
  where source_type = 'expense_payment' and source_id in (
    select payment_id from public.expense_payment_allocations where expense_record_id = partial.id
  );
  if not found or cash_row.direction <> 'out' or cash_row.amount <> 1840
    or cash_row.counterparty <> 'Shell Pump Kolkata' then
    raise exception 'FAIL: initial Fuel payment Cash Book Money Out is wrong';
  end if;
  select * into payment from public.create_vehicle_fuel_payment(
    factory_a_id, partial.id, date '2026-09-15', 1000, 'bank_transfer', 'Second instalment'
  );
  select * into partial from public.list_vehicle_fuel_records(factory_a_id, vehicle_one.id, pump_one.id)
  where id = partial.id;
  if partial.total_paid <> 2840 or partial.outstanding_amount <> 840 then
    raise exception 'FAIL: later Pump payment outstanding is wrong';
  end if;
  select * into payment_row from public.list_vehicle_fuel_payments(factory_a_id, vehicle_one.id, pump_one.id)
  where payment_id = payment.id;
  if not found or payment_row.fuel_record_id <> partial.id or payment_row.amount <> 1000
    or payment_row.vehicle_number_snapshot <> 'WB58 A 1234'
    or payment_row.pump_name_snapshot <> 'Shell Pump Kolkata' then
    raise exception 'FAIL: later Pump payment history is wrong';
  end if;
  if (select count(*) from public.list_cash_book_day_entries(factory_a_id, date '2026-09-15')
      where source_type = 'expense_payment' and source_id = payment.id) <> 1 then
    raise exception 'FAIL: later Pump payment did not create exactly one Cash Book Money Out';
  end if;
  perform pg_temp.expect_error(
    'Fuel overpayment rejected', 'P4105',
    format('select * from public.create_vehicle_fuel_payment(%L::uuid,%L::uuid,date %L,840.01,''cash'',null)',
      factory_a_id, partial.id, '2026-09-15')
  );
  perform pg_temp.expect_error(
    'generic payment cannot bypass Fuel control', 'P4505',
    format('select * from public.create_expense_payment(%L::uuid,date %L,1,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_a_id, '2026-09-15', partial.id)
  );
  raise notice 'PASS: initial/later payments, outstanding, overpayment, immutable allocation, and Cash Book linkage work';

  select * into unpaid from public.update_vehicle_fuel(
    factory_a_id, unpaid.id, date '2026-09-10', time '07:40', vehicle_one.id,
    pump_one.id, 'DIESEL', 42, 93, null
  );
  if unpaid.id is null or unpaid.fuel_time <> time '07:40' or unpaid.fuel_amount <> 3906 then
    raise exception 'FAIL: unpaid Fuel correction is wrong';
  end if;
  perform pg_temp.expect_error(
    'paid Fuel cannot be corrected', 'P4104',
    format('select * from public.update_vehicle_fuel(%L::uuid,%L::uuid,date %L,time %L,%L::uuid,%L::uuid,''DIESEL'',40,93,null)',
      factory_a_id, partial.id, '2026-09-14', '08:00', vehicle_one.id, pump_one.id)
  );
  perform pg_temp.expect_error(
    'paid Fuel cannot be voided', 'P4104',
    format('select * from public.void_vehicle_fuel(%L::uuid,%L::uuid)', factory_a_id, partial.id)
  );
  select * into back_entered from public.void_vehicle_fuel(factory_a_id, back_entered.id);
  if back_entered.status <> 'void' or back_entered.outstanding_amount <> 0 then
    raise exception 'FAIL: unpaid Fuel void lifecycle is wrong';
  end if;
  raise notice 'PASS: unpaid correction/void and first-payment financial lock work';

  perform public.update_supplier(factory_a_id, pump_one.id, 'Shell Pump Renamed', 'New Road', null);
  perform public.archive_vehicle(factory_a_id, vehicle_one.id);
  select * into listed from public.list_vehicle_fuel_records(factory_a_id, vehicle_one.id, pump_one.id)
  where id = unpaid.id;
  if listed.vehicle_number_snapshot <> 'WB58 A 1234'
    or listed.pump_name_snapshot <> 'Shell Pump Kolkata'
    or listed.pump_address_snapshot <> 'Main Road' then
    raise exception 'FAIL: Vehicle/Pump master edits rewrote Fuel history snapshots';
  end if;
  perform pg_temp.expect_error(
    'archived Vehicle rejected for new Fuel', 'P4502',
    format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,''DIESEL'',10,92,null,0,null)',
      factory_a_id, '2026-09-16', '09:00', vehicle_one.id, pump_one.id)
  );
  if not exists (select 1 from public.list_vehicle_fuel_records(factory_a_id, vehicle_one.id, null) where id = unpaid.id) then
    raise exception 'FAIL: archived Vehicle history disappeared';
  end if;
  raise notice 'PASS: archived Vehicle selection is blocked while historical snapshots remain readable';

  if exists (
    select 1 from public.list_expense_records(factory_a_id, null)
    where expense_record_id in (unpaid.id, partial.id, fully_paid.id, back_entered.id)
  ) then raise exception 'FAIL: dedicated Fuel duplicated in generic Expenses'; end if;
  select * into generic_record from public.create_expense_record(
    factory_a_id, date '2026-09-16', 'expense', pump_two.id, null,
    'Legacy generic fuel expense', 100, null
  );
  if not exists (
    select 1 from public.list_expense_records(factory_a_id, null)
    where expense_record_id = generic_record.id
  ) then raise exception 'FAIL: legacy generic Expense was hidden'; end if;
  raise notice 'PASS: dedicated Fuel has one obligation, no generic Expense duplicate, and legacy expenses remain untouched';

  if exists (select 1 from public.vehicle_fuel_records where id = fuel_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Fuel';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot list Factory B Fuel', '42501',
    format('select * from public.list_vehicle_fuel_records(%L::uuid,null,null)', factory_b_id)
  );
  perform pg_temp.expect_error(
    'Factory A cannot pay Factory B Fuel', '42501',
    format('select * from public.create_vehicle_fuel_payment(%L::uuid,%L::uuid,date %L,1,''cash'',null)',
      factory_b_id, fuel_b_id, '2026-09-16')
  );
  raise notice 'PASS: Vehicles, Pumps, Fuel history, Last Refuel, and payments are factory-isolated';
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('authenticated', 'public.vehicle_fuel_records', 'INSERT')
    or has_table_privilege('authenticated', 'public.vehicle_fuel_records', 'UPDATE')
    or has_table_privilege('authenticated', 'public.vehicle_fuel_records', 'DELETE') then
    raise exception 'FAIL: authenticated role has direct Fuel mutation privileges';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'vehicle_fuel_records_vehicle_factory_fkey' and contype = 'f'
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'vehicle_fuel_allocation_guard_insert' and not tgisinternal
  ) then raise exception 'FAIL: Fuel relationship or payment guard invariant is missing'; end if;
  raise notice 'PASS: Fuel schema, direct-write denial, stable relationships, and financial guards exist';
end;
$$;

rollback;

select 'PASS: Vehicle Fuel verifier completed and rolled back all fixtures.' as result;
