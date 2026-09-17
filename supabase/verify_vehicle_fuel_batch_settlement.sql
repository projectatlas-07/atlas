-- Vehicle Fuel batch settlement rollback verifier.
-- Run after 20260914000047_compact_batch_expense_cash_book_descriptions.sql.

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
    (factory_a_id, format('Fuel Batch Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Fuel Batch Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
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
    'Factory B Pump', 'Factory B Fuel', 1000, test_user_id
  );
  insert into public.vehicle_fuel_records(
    id, factory_id, vehicle_id, vehicle_number_snapshot, fuel_time,
    fuel_type, litres, rate_per_litre, created_by
  ) values (
    fuel_b_id, factory_b_id, vehicle_b_id, 'WB 00 B 0001', time '06:30',
    'DIESEL', 10, 100, test_user_id
  );

  perform set_config('atlas_fuel_batch.user_id', test_user_id::text, true);
  perform set_config('atlas_fuel_batch.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_fuel_batch.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_fuel_batch.fuel_b_id', fuel_b_id::text, true);
  perform set_config('atlas_fuel_batch.pump_b_id', pump_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_fuel_batch.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_fuel_batch.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_fuel_batch.factory_b_id')::uuid;
  fuel_b_id uuid := current_setting('atlas_fuel_batch.fuel_b_id')::uuid;
  pump_b_id uuid := current_setting('atlas_fuel_batch.pump_b_id')::uuid;
  vehicle_one public.vehicles%rowtype;
  vehicle_two public.vehicles%rowtype;
  pump_one public.suppliers%rowtype;
  pump_two public.suppliers%rowtype;
  outside_range public.vehicle_fuel_detail;
  oldest public.vehicle_fuel_detail;
  same_date_early public.vehicle_fuel_detail;
  same_date_late public.vehicle_fuel_detail;
  other_pump public.vehicle_fuel_detail;
  fully_paid public.vehicle_fuel_detail;
  voided public.vehicle_fuel_detail;
  tie_one public.vehicle_fuel_detail;
  tie_two public.vehicle_fuel_detail;
  single_entry public.vehicle_fuel_detail;
  batch_payment public.expense_payments%rowtype;
  full_payment public.expense_payments%rowtype;
  tie_payment public.expense_payments%rowtype;
  single_payment public.expense_payments%rowtype;
  large_payment public.expense_payments%rowtype;
  before_payment_count bigint;
  before_allocation_count bigint;
  entry_index integer;
  statement_row record;
begin
  perform public.initialize_cash_book(factory_a_id, date '2026-09-01', 500000);
  select * into vehicle_one from public.find_or_create_vehicle(factory_a_id, 'WB58 A 1234', false);
  select * into vehicle_two from public.find_or_create_vehicle(factory_a_id, 'WB58 A 5678', false);
  select * into pump_one from public.create_or_assign_supplier_role(
    factory_a_id, 'FUEL_PUMP', 'Batch Pump One', 'Main Road', null
  );
  select * into pump_two from public.create_or_assign_supplier_role(
    factory_a_id, 'FUEL_PUMP', 'Batch Pump Two', 'Station Road', null
  );

  select * into outside_range from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-09', time '09:00', vehicle_one.id, pump_one.id,
    'DIESEL', 10, 100, null, 0, null
  );
  select * into oldest from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-10', time '08:00', vehicle_one.id, pump_one.id,
    'DIESEL', 20, 100, null, 0, null
  );
  select * into same_date_early from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-12', time '07:00', vehicle_two.id, pump_one.id,
    'DIESEL', 30, 100, null, 0, null
  );
  select * into same_date_late from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-12', time '09:00', vehicle_one.id, pump_one.id,
    'DIESEL', 40, 100, null, 0, null
  );
  select * into other_pump from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-11', time '08:00', vehicle_one.id, pump_two.id,
    'DIESEL', 7, 100, null, 0, null
  );
  select * into fully_paid from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-11', time '10:00', vehicle_one.id, pump_one.id,
    'DIESEL', 5, 100, null, 500, 'cash'
  );
  select * into voided from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-11', time '11:00', vehicle_one.id, pump_one.id,
    'DIESEL', 6, 100, null, 0, null
  );
  select * into voided from public.void_vehicle_fuel(factory_a_id, voided.id);

  select count(*) into before_payment_count from public.expense_payments where factory_id = factory_a_id;
  select count(*) into before_allocation_count from public.expense_payment_allocations where factory_id = factory_a_id;
  perform pg_temp.expect_error(
    'batch overpayment is atomic', 'P4510',
    format('select * from public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,9000.01,''cash'',null)',
      factory_a_id, pump_one.id, '2026-09-10', '2026-09-14', '2026-09-14')
  );
  if (select count(*) from public.expense_payments where factory_id = factory_a_id) <> before_payment_count
    or (select count(*) from public.expense_payment_allocations where factory_id = factory_a_id) <> before_allocation_count then
    raise exception 'FAIL: atomic rejected payment left partial financial rows';
  end if;
  perform pg_temp.expect_error(
    'zero batch payment rejected', '22023',
    format('select * from public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,0,''cash'',null)',
      factory_a_id, pump_one.id, '2026-09-10', '2026-09-14', '2026-09-14')
  );
  perform pg_temp.expect_error(
    'negative batch payment rejected', '22023',
    format('select * from public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,-1,''cash'',null)',
      factory_a_id, pump_one.id, '2026-09-10', '2026-09-14', '2026-09-14')
  );
  perform pg_temp.expect_error(
    'reversed batch date range rejected', '22023',
    format('select * from public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,1,''cash'',null)',
      factory_a_id, pump_one.id, '2026-09-15', '2026-09-14', '2026-09-14')
  );
  raise notice 'PASS: overpayment, zero, negative, reversed range, and atomic failure handling work';

  select * into batch_payment from public.create_vehicle_fuel_batch_payment(
    factory_a_id, pump_one.id, date '2026-09-10', date '2026-09-14',
    date '2026-09-14', 6000, 'bank_transfer', 'Partial period settlement'
  );
  if batch_payment.amount <> 6000
    or (select count(*) from public.expense_payment_allocations where payment_id = batch_payment.id) <> 3
    or (select allocated_amount from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id = oldest.id) <> 2000
    or (select allocated_amount from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id = same_date_early.id) <> 3000
    or (select allocated_amount from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id = same_date_late.id) <> 1000 then
    raise exception 'FAIL: oldest-first allocation with partial final allocation is wrong';
  end if;
  select * into oldest from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where id = oldest.id;
  select * into same_date_early from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where id = same_date_early.id;
  select * into same_date_late from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where id = same_date_late.id;
  if oldest.outstanding_amount <> 0 or same_date_early.outstanding_amount <> 0
    or same_date_late.outstanding_amount <> 3000
    or not oldest.is_locked or not same_date_early.is_locked or not same_date_late.is_locked then
    raise exception 'FAIL: individual outstanding or first-payment locks are wrong';
  end if;
  if (select outstanding_amount from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id) where id = outside_range.id) <> 1000
    or (select outstanding_amount from public.list_vehicle_fuel_records(factory_a_id, null, pump_two.id) where id = other_pump.id) <> 700
    or exists (select 1 from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id in (outside_range.id, other_pump.id, fully_paid.id, voided.id)) then
    raise exception 'FAIL: outside range, another Pump, fully paid, or void Fuel was touched';
  end if;
  raise notice 'PASS: partial batch uses oldest-first and same-date time ordering with a partial final allocation';
  raise notice 'PASS: inclusive range excludes outside range, another Pump, fully paid, and void entries';

  if (select count(*) from public.list_cash_book_day_entries(factory_a_id, date '2026-09-14')
      where source_type = 'expense_payment' and source_id = batch_payment.id) <> 1 then
    raise exception 'FAIL: batch did not create exactly one Cash Book Money Out';
  end if;
  if (select amount from public.list_cash_book_day_entries(factory_a_id, date '2026-09-14')
      where source_type = 'expense_payment' and source_id = batch_payment.id) <> 6000 then
    raise exception 'FAIL: batch Cash Book amount is wrong';
  end if;
  if (select description from public.list_cash_book_day_entries(factory_a_id, date '2026-09-14')
      where source_type = 'expense_payment' and source_id = batch_payment.id) <> 'Fuel payment · 3 refuels' then
    raise exception 'FAIL: batch Cash Book description is not compact';
  end if;
  select * into statement_row from public.list_vehicle_fuel_batch_payments(factory_a_id, pump_one.id)
  where payment_id = batch_payment.id;
  if not found or statement_row.amount <> 6000 or statement_row.allocation_count <> 3
    or cardinality(statement_row.vehicle_ids) <> 2
    or jsonb_array_length(statement_row.allocations) <> 3
    or (select count(*) from public.list_vehicle_fuel_batch_payments(factory_a_id, pump_one.id)
        where payment_id = batch_payment.id) <> 1 then
    raise exception 'FAIL: Pump statement did not show the batch payment once';
  end if;
  raise notice 'PASS: one payment has multiple allocation rows but exactly one Cash Book Money Out and one Pump statement row';

  select * into full_payment from public.create_vehicle_fuel_batch_payment(
    factory_a_id, pump_one.id, date '2026-09-10', date '2026-09-14',
    date '2026-09-15', 3000, 'upi', 'Full remaining period settlement'
  );
  if (select coalesce(sum(outstanding_amount), 0)
      from public.list_vehicle_fuel_records(factory_a_id, null, pump_one.id)
      where status = 'active' and fuel_date between date '2026-09-10' and date '2026-09-14') <> 0
    or (select count(*) from public.expense_payment_allocations where payment_id = full_payment.id) <> 1 then
    raise exception 'FAIL: full period settlement is wrong';
  end if;
  raise notice 'PASS: full period settlement reduces total Pump outstanding by the payment amount';

  select * into tie_one from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-20', time '12:00', vehicle_one.id, pump_one.id,
    'DIESEL', 1, 100, null, 0, null
  );
  select * into tie_two from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-20', time '12:00', vehicle_two.id, pump_one.id,
    'DIESEL', 1, 100, null, 0, null
  );
  select * into tie_payment from public.create_vehicle_fuel_batch_payment(
    factory_a_id, pump_one.id, date '2026-09-20', date '2026-09-20',
    date '2026-09-20', 100, 'cash', 'Tie-break settlement'
  );
  if (select expense_record_id from public.expense_payment_allocations where payment_id = tie_payment.id)
      <> least(tie_one.id, tie_two.id) then
    raise exception 'FAIL: stable UUID tie-breaker was not followed';
  end if;
  raise notice 'PASS: stable tie-breaking works after identical Fuel date, time, and creation timestamp';

  select * into single_entry from public.create_vehicle_fuel(
    factory_a_id, date '2026-09-21', time '10:00', vehicle_one.id, pump_one.id,
    'DIESEL', 5, 100, null, 0, null
  );
  select * into single_payment from public.create_vehicle_fuel_payment(
    factory_a_id, single_entry.id, date '2026-09-21', 500, 'cash', 'Legacy single wrapper'
  );
  if (select count(*) from public.expense_payment_allocations where payment_id = single_payment.id) <> 1 then
    raise exception 'FAIL: existing single Fuel payment compatibility regressed';
  end if;
  if (select description from public.list_cash_book_day_entries(factory_a_id, date '2026-09-21')
      where source_type = 'expense_payment' and source_id = single_payment.id) not like 'Payment for %' then
    raise exception 'FAIL: single Fuel payment lost its specific Cash Book description';
  end if;
  raise notice 'PASS: existing single-entry Fuel payment remains specific and backend-compatible';

  for entry_index in 1..101 loop
    perform public.create_vehicle_fuel(
      factory_a_id, date '2026-10-01', time '00:00' + make_interval(secs => entry_index),
      vehicle_one.id, pump_one.id, 'DIESEL', 1, 1, null, 0, null
    );
  end loop;
  select * into large_payment from public.create_vehicle_fuel_batch_payment(
    factory_a_id, pump_one.id, date '2026-10-01', date '2026-10-01',
    date '2026-10-01', 101, 'cash', 'Unbounded range settlement'
  );
  if (select count(*) from public.expense_payment_allocations where payment_id = large_payment.id) <> 101
    or (select count(*) from public.list_cash_book_day_entries(factory_a_id, date '2026-10-01')
        where source_type = 'expense_payment' and source_id = large_payment.id) <> 1 then
    raise exception 'FAIL: a valid range spanning 101 allocations was capped or duplicated in Cash Book';
  end if;
  if (select description from public.list_cash_book_day_entries(factory_a_id, date '2026-10-01')
      where source_type = 'expense_payment' and source_id = large_payment.id) <> 'Fuel payment · 101 refuels' then
    raise exception 'FAIL: large Fuel batch concatenated allocation descriptions';
  end if;
  raise notice 'PASS: a valid Fuel range can settle 101 allocations in one payment and one Cash Book Money Out';

  perform pg_temp.expect_error(
    'Factory A cannot settle Factory B Pump', '42501',
    format('select * from public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,1,''cash'',null)',
      factory_b_id, pump_b_id, '2026-09-01', '2026-09-30', '2026-09-30')
  );
  if exists (select 1 from public.vehicle_fuel_records where id = fuel_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Fuel';
  end if;
  raise notice 'PASS: batch settlement, Pump history, and Fuel obligations are factory-isolated';
end;
$$;

reset role;

do $$
begin
  if has_function_privilege('anon',
    'public.create_vehicle_fuel_batch_payment(uuid,uuid,date,date,date,numeric,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anonymous role can execute batch settlement';
  end if;
  if not pg_get_functiondef(
    'public.create_vehicle_fuel_batch_payment(uuid,uuid,date,date,date,numeric,text,text)'::regprocedure
  ) ~ 'order by records.id[[:space:]]+for update of records' then
    raise exception 'FAIL: deterministic obligation lock is missing';
  end if;
  raise notice 'PASS: batch RPC authorization and deterministic concurrency lock exist';
end;
$$;

rollback;

select 'PASS: Vehicle Fuel batch settlement verifier completed and rolled back all fixtures.' as result;
