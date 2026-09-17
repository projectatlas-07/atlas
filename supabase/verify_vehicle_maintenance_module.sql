-- Dedicated Vehicle Maintenance verifier.
-- Run after 20260914000041_create_supplier_roles.sql.
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
  vehicle_b_id uuid := gen_random_uuid();
  garage_b_id uuid := gen_random_uuid();
  maintenance_b_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Maintenance Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Maintenance Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (vehicle_b_id, factory_b_id, 'WB 00 B 0001', 'WB00B0001', false);
  insert into public.suppliers(id, factory_id, name)
  values (garage_b_id, factory_b_id, 'Factory B Garage');
  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (factory_b_id, garage_b_id, 'GARAGE', test_user_id);
  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, description, total_amount, created_by
  ) values (
    maintenance_b_id, factory_b_id, date '2026-09-10', 'expense', garage_b_id,
    'Factory B Garage', 'Factory B secret repair', 999, test_user_id
  );
  insert into public.vehicle_maintenance_records(
    id, factory_id, vehicle_id, vehicle_number_snapshot,
    work_description, created_by
  ) values (
    maintenance_b_id, factory_b_id, vehicle_b_id, 'WB 00 B 0001',
    'Factory B secret repair', test_user_id
  );

  perform set_config('atlas_maintenance.user_id', test_user_id::text, true);
  perform set_config('atlas_maintenance.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_maintenance.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_maintenance.maintenance_b_id', maintenance_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_maintenance.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_maintenance.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_maintenance.factory_b_id')::uuid;
  maintenance_b_id uuid := current_setting('atlas_maintenance.maintenance_b_id')::uuid;
  vehicle_one public.vehicles%rowtype;
  vehicle_two public.vehicles%rowtype;
  garage_one public.suppliers%rowtype;
  garage_two public.suppliers%rowtype;
  unpaid public.vehicle_maintenance_detail;
  partial public.vehicle_maintenance_detail;
  fully_paid public.vehicle_maintenance_detail;
  other_job public.vehicle_maintenance_detail;
  payment public.expense_payments%rowtype;
  listed public.vehicle_maintenance_detail;
  payment_row record;
  cash_row record;
  generic_record public.expense_records%rowtype;
begin
  perform public.initialize_cash_book(factory_a_id, date '2026-09-01', 500000);
  select * into vehicle_one from public.find_or_create_vehicle(
    factory_a_id, 'WB58 A 1234', false
  );
  select * into vehicle_two from public.find_or_create_vehicle(
    factory_a_id, 'WB58 A 5678', false
  );
  select * into garage_one from public.create_or_assign_supplier_role(
    factory_a_id, 'GARAGE', 'Rahman Garage', 'Old Garage Road', '9111111111'
  );
  select * into garage_two from public.create_or_assign_supplier_role(
    factory_a_id, 'GARAGE', 'Das Mechanic', null, null
  );

  select * into unpaid from public.create_vehicle_maintenance(
    factory_a_id, date '2026-09-01', vehicle_one.id, garage_one.id,
    'Rear tyre replacement', 8000, 0, null
  );
  if unpaid.vehicle_id <> vehicle_one.id
    or unpaid.vehicle_number_snapshot <> 'WB58 A 1234'
    or unpaid.garage_id <> garage_one.id
    or unpaid.garage_name_snapshot <> 'Rahman Garage'
    or unpaid.work_description <> 'Rear tyre replacement'
    or unpaid.total_amount <> 8000 or unpaid.total_paid <> 0
    or unpaid.outstanding_amount <> 8000 or unpaid.payment_state <> 'unpaid'
    or unpaid.is_locked or unpaid.maintenance_date <> date '2026-09-01' then
    raise exception 'FAIL: unpaid back-entered Maintenance is wrong: %', row_to_json(unpaid);
  end if;

  select * into partial from public.create_vehicle_maintenance(
    factory_a_id, date '2026-09-02', vehicle_one.id, garage_one.id,
    'Engine repair', 9000, 5000, 'cash'
  );
  if partial.total_paid <> 5000 or partial.outstanding_amount <> 4000
    or partial.payment_state <> 'partially_paid' or not partial.is_locked then
    raise exception 'FAIL: partial initial payment state is wrong: %', row_to_json(partial);
  end if;

  select * into fully_paid from public.create_vehicle_maintenance(
    factory_a_id, date '2026-09-03', vehicle_two.id, garage_one.id,
    'Battery', 4000, 4000, 'upi'
  );
  if fully_paid.total_paid <> 4000 or fully_paid.outstanding_amount <> 0
    or fully_paid.payment_state <> 'paid' or not fully_paid.is_locked then
    raise exception 'FAIL: full initial payment state is wrong: %', row_to_json(fully_paid);
  end if;

  select * into other_job from public.create_vehicle_maintenance(
    factory_a_id, date '2026-09-04', vehicle_one.id, garage_two.id,
    'Welding', 2000, 0, null
  );
  if (select count(*) from public.list_vehicle_maintenance_records(
      factory_a_id, vehicle_one.id, null
    )) <> 3
    or (select count(*) from public.list_vehicle_maintenance_records(
      factory_a_id, null, garage_one.id
    )) <> 3
    or (select count(*) from public.list_vehicle_maintenance_records(
      factory_a_id, vehicle_one.id, garage_two.id
    )) <> 1 then
    raise exception 'FAIL: Vehicle/Garage histories did not preserve relationship combinations';
  end if;
  raise notice 'PASS: unpaid, partial, full, back-entry, multiple Vehicles, and multiple Garages work';

  select * into cash_row from public.list_cash_book_day_entries(
    factory_a_id, date '2026-09-02'
  ) where source_type = 'expense_payment'
    and source_id in (
      select allocations.payment_id from public.expense_payment_allocations as allocations
      where allocations.expense_record_id = partial.id
    );
  if not found or cash_row.direction <> 'out' or cash_row.amount <> 5000
    or cash_row.payment_mode <> 'cash' or cash_row.counterparty <> 'Rahman Garage' then
    raise exception 'FAIL: partial initial payment Cash Book Money Out is wrong';
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-09-03'
    ) where source_type = 'expense_payment'
      and source_id in (
        select allocations.payment_id from public.expense_payment_allocations as allocations
        where allocations.expense_record_id = fully_paid.id
      )) <> 1 then
    raise exception 'FAIL: full initial payment did not create exactly one Money Out';
  end if;
  raise notice 'PASS: each initial payment creates exactly one Cash Book Money Out';

  -- Master edits and archive operations never rewrite stored historical snapshots.
  perform public.update_supplier(
    factory_a_id, garage_one.id, 'Rahman Garage Renamed', 'New Garage Road', '9222222222'
  );
  perform public.archive_vehicle(factory_a_id, vehicle_one.id);
  select * into listed from public.list_vehicle_maintenance_records(
    factory_a_id, vehicle_one.id, garage_one.id
  ) where id = unpaid.id;
  if listed.vehicle_number_snapshot <> 'WB58 A 1234'
    or listed.garage_name_snapshot <> 'Rahman Garage'
    or listed.garage_address_snapshot <> 'Old Garage Road'
    or listed.garage_mobile_snapshot <> '9111111111' then
    raise exception 'FAIL: Vehicle/Garage master changes rewrote Maintenance history';
  end if;
  perform pg_temp.expect_error(
    'archived Vehicle cannot receive new Maintenance', 'P4302',
    format(
      'select * from public.create_vehicle_maintenance(%L::uuid,date %L,%L::uuid,%L::uuid,%L,1,0,null)',
      factory_a_id, '2026-09-05', vehicle_one.id, garage_one.id, 'Denied new work'
    )
  );
  -- The same archived Vehicle remains correctable on its existing unpaid history.
  select * into unpaid from public.update_vehicle_maintenance(
    factory_a_id, unpaid.id, date '2026-09-01', vehicle_one.id, garage_one.id,
    'Rear tyre and tube replacement', 8500
  );
  if unpaid.vehicle_number_snapshot <> 'WB58 A 1234'
    or unpaid.work_description <> 'Rear tyre and tube replacement'
    or unpaid.total_amount <> 8500 then
    raise exception 'FAIL: safe unpaid correction lost archived Vehicle history';
  end if;
  raise notice 'PASS: archived Vehicle and edited Garage histories remain readable from snapshots';

  perform pg_temp.expect_error(
    'generic Expense editor cannot mutate Maintenance', 'P4305',
    format(
      'select * from public.update_expense_record(%L::uuid,%L::uuid,date %L,''expense'',%L::uuid,null,%L,8500,null)',
      factory_a_id, unpaid.id, '2026-09-01', garage_one.id, 'Bypass attempt'
    )
  );
  perform pg_temp.expect_error(
    'generic Expense void cannot mutate Maintenance', 'P4305',
    format('select * from public.void_expense_record(%L::uuid,%L::uuid)', factory_a_id, unpaid.id)
  );
  perform pg_temp.expect_error(
    'paid Maintenance cannot be corrected', 'P4104',
    format(
      'select * from public.update_vehicle_maintenance(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L,9000)',
      factory_a_id, partial.id, '2026-09-02', vehicle_one.id, garage_one.id, 'Changed'
    )
  );
  perform pg_temp.expect_error(
    'paid Maintenance cannot be voided', 'P4104',
    format('select * from public.void_vehicle_maintenance(%L::uuid,%L::uuid)', factory_a_id, partial.id)
  );

  select * into payment from public.create_vehicle_maintenance_payment(
    factory_a_id, partial.id, date '2026-09-05', 1000, 'bank_transfer', 'Second instalment'
  );
  select * into partial from public.list_vehicle_maintenance_records(
    factory_a_id, vehicle_one.id, garage_one.id
  ) where id = partial.id;
  if partial.total_paid <> 6000 or partial.outstanding_amount <> 3000
    or partial.payment_state <> 'partially_paid' then
    raise exception 'FAIL: later payment outstanding is wrong: %', row_to_json(partial);
  end if;
  select * into payment_row from public.list_vehicle_maintenance_payments(
    factory_a_id, vehicle_one.id, garage_one.id
  ) where payment_id = payment.id;
  if not found or payment_row.maintenance_id <> partial.id
    or payment_row.amount <> 1000
    or payment_row.vehicle_number_snapshot <> 'WB58 A 1234'
    or payment_row.garage_name_snapshot <> 'Rahman Garage' then
    raise exception 'FAIL: Garage payment history is wrong';
  end if;
  select * into cash_row from public.list_cash_book_day_entries(
    factory_a_id, date '2026-09-05'
  ) where source_type = 'expense_payment' and source_id = payment.id;
  if not found or cash_row.direction <> 'out' or cash_row.amount <> 1000
    or cash_row.payment_mode <> 'bank_transfer' then
    raise exception 'FAIL: later payment Cash Book Money Out is wrong';
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-09-05'
    ) where source_type = 'expense_payment' and source_id = payment.id) <> 1 then
    raise exception 'FAIL: later payment duplicated Cash Book Money Out';
  end if;
  perform pg_temp.expect_error(
    'Maintenance overpayment is rejected', 'P4105',
    format(
      'select * from public.create_vehicle_maintenance_payment(%L::uuid,%L::uuid,date %L,3000.01,''cash'',null)',
      factory_a_id, partial.id, '2026-09-05'
    )
  );
  perform pg_temp.expect_error(
    'generic payment cannot bypass Maintenance control', 'P4305',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_a_id, '2026-09-05', partial.id
    )
  );
  raise notice 'PASS: later payment, outstanding, overpayment, immutable allocation, and Cash Book linkage work';

  select * into other_job from public.void_vehicle_maintenance(factory_a_id, other_job.id);
  if other_job.status <> 'void' or other_job.outstanding_amount <> 0 then
    raise exception 'FAIL: unpaid Maintenance void lifecycle is wrong';
  end if;
  if exists (
    select 1 from public.list_expense_records(factory_a_id, null)
    where expense_record_id in (unpaid.id, partial.id, fully_paid.id, other_job.id)
  ) then
    raise exception 'FAIL: dedicated Maintenance duplicated in generic Expenses';
  end if;
  select * into generic_record from public.create_expense_record(
    factory_a_id, date '2026-09-06', 'expense', garage_one.id, null,
    'Legacy generic expense', 100, null
  );
  if not exists (
    select 1 from public.list_expense_records(factory_a_id, null)
    where expense_record_id = generic_record.id
  ) then
    raise exception 'FAIL: existing generic Expense workflow was hidden';
  end if;
  raise notice 'PASS: unpaid void and generic Expense non-duplication preserve existing workflows';

  if exists (select 1 from public.vehicle_maintenance_records where id = maintenance_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Maintenance';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot list Factory B Maintenance', '42501',
    format('select * from public.list_vehicle_maintenance_records(%L::uuid,null,null)', factory_b_id)
  );
  perform pg_temp.expect_error(
    'Factory A cannot pay Factory B Maintenance', '42501',
    format(
      'select * from public.create_vehicle_maintenance_payment(%L::uuid,%L::uuid,date %L,1,''cash'',null)',
      factory_b_id, maintenance_b_id, '2026-09-06'
    )
  );
  raise notice 'PASS: Vehicles, Garages, Maintenance, histories, and payments are factory-isolated';
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('authenticated', 'public.vehicle_maintenance_records', 'INSERT')
    or has_table_privilege('authenticated', 'public.vehicle_maintenance_records', 'UPDATE')
    or has_table_privilege('authenticated', 'public.vehicle_maintenance_records', 'DELETE') then
    raise exception 'FAIL: authenticated role has direct Maintenance mutation privileges';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'vehicle_maintenance_records_vehicle_factory_fkey' and contype = 'f'
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'vehicle_maintenance_allocation_guard_insert' and not tgisinternal
  ) then
    raise exception 'FAIL: Maintenance relationship or payment guard invariant is missing';
  end if;
  raise notice 'PASS: schema, direct-write denial, stable relationships, and financial guards exist';
end;
$$;

rollback;

select 'PASS: Vehicle Maintenance verifier completed and rolled back all fixtures.' as result;
