-- Atlas S7A verifier. Run after migrations 20260828000024 and 20260828000025.
-- Requires one existing factory_users row. All fixtures are rolled back.

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
  supplier_b_id uuid := gen_random_uuid();
  record_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('S7A Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('S7A Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.suppliers(id, factory_id, name)
  values (supplier_b_id, factory_b_id, 'Factory B Supplier');
  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, description, total_amount, created_by
  ) values (
    record_b_id, factory_b_id, date '2026-08-28', 'purchase', supplier_b_id,
    'Factory B Supplier', 'Factory B secret purchase', 999, test_user_id
  );
  insert into public.cash_book_initializations(
    factory_id, start_date, opening_balance, created_by
  ) values (factory_b_id, date '2026-08-28', 999, test_user_id);

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.supplier_b_id', supplier_b_id::text, true);
  perform set_config('atlas_test.record_b_id', record_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  supplier_b_id uuid := current_setting('atlas_test.supplier_b_id')::uuid;
  record_b_id uuid := current_setting('atlas_test.record_b_id')::uuid;
  supplier public.suppliers%rowtype;
  purchase public.expense_records%rowtype;
  payment public.expense_payments%rowtype;
  state record;
  movement record;
  source_one public.expense_records%rowtype;
  source_two public.expense_records%rowtype;
  source_three public.expense_records%rowtype;
  explicit_payment public.expense_payments%rowtype;
  multi_payment public.expense_payments%rowtype;
  lifecycle_record public.expense_records%rowtype;
  count_before bigint;
  test_mode text;
  mode_record public.expense_records%rowtype;
begin
  perform public.initialize_cash_book(factory_a_id, date '2026-08-28', 200000);
  select * into supplier from public.create_supplier(
    factory_a_id, 'ABC Coal', 'Coal Market', '9111111111'
  );
  select * into purchase from public.create_expense_record(
    factory_a_id, date '2026-08-28', 'purchase', supplier.id, null,
    'Coal', 100000, 'Invoice ABC-1'
  );
  select * into state from public.get_expense_record_payment_state(factory_a_id, purchase.id);
  if state.total_paid <> 0 or state.outstanding_amount <> 100000
    or state.payment_state <> 'unpaid' or state.is_locked then
    raise exception 'FAIL: new purchase state is wrong: %', row_to_json(state);
  end if;
  raise notice 'PASS: 100,000 purchase starts unpaid with 100,000 outstanding';

  -- Execute both Office and supplier-filtered list paths. The original S7A function
  -- failed here because its RETURNS TABLE factory_id variable collided with a bare
  -- suppliers.factory_id reference.
  select * into state
  from public.list_expense_records(factory_a_id, null)
  where expense_record_id = purchase.id;
  if not found or state.factory_id <> factory_a_id or state.total_paid <> 0
    or state.outstanding_amount <> 100000 then
    raise exception 'FAIL: unfiltered Expense/Purchase list returned wrong state: %',
      row_to_json(state);
  end if;
  select * into state
  from public.list_expense_records(factory_a_id, supplier.id)
  where expense_record_id = purchase.id;
  if not found or state.factory_id <> factory_a_id
    or state.supplier_id <> supplier.id then
    raise exception 'FAIL: supplier-filtered Expense/Purchase list returned wrong row: %',
      row_to_json(state);
  end if;
  raise notice 'PASS: Expense/Purchase list RPC executes without factory_id ambiguity';

  perform public.update_supplier(
    factory_a_id, supplier.id, 'ABC Coal Renamed', 'New Address', '9222222222'
  );
  if (select counterparty_name_snapshot from public.expense_records where id = purchase.id)
      <> 'ABC Coal' then
    raise exception 'FAIL: supplier edit rewrote historical purchase snapshot';
  end if;

  select * into payment from public.create_expense_payment(
    factory_a_id, date '2026-08-28', 40000, 'upi', 'Partial payment',
    jsonb_build_array(jsonb_build_object('expense_record_id', purchase.id, 'amount', 40000))
  );
  select * into state from public.get_expense_record_payment_state(factory_a_id, purchase.id);
  if state.total_paid <> 40000 or state.outstanding_amount <> 60000
    or state.payment_state <> 'partially_paid' or not state.is_locked then
    raise exception 'FAIL: partial payment state is wrong: %', row_to_json(state);
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-08-28'
    ) where source_type = 'expense_payment' and source_id = payment.id) <> 1 then
    raise exception 'FAIL: one expense payment did not produce exactly one Cash Book row';
  end if;
  select * into movement from public.list_cash_book_day_entries(
    factory_a_id, date '2026-08-28'
  ) where source_type = 'expense_payment' and source_id = payment.id;
  if movement.direction <> 'out' or movement.amount <> 40000
    or movement.payment_mode <> 'upi' or movement.counterparty <> 'ABC Coal' then
    raise exception 'FAIL: expense payment Cash Book movement is wrong: %', row_to_json(movement);
  end if;
  perform pg_temp.expect_error(
    'paid purchase cannot be updated', 'P4104',
    format(
      'select * from public.update_expense_record(%L::uuid,%L::uuid,date %L,''purchase'',%L::uuid,null,''Changed'',100000,null)',
      factory_a_id, purchase.id, '2026-08-28', supplier.id
    )
  );
  perform pg_temp.expect_error(
    'paid purchase cannot be voided', 'P4104',
    format('select * from public.void_expense_record(%L::uuid,%L::uuid)', factory_a_id, purchase.id)
  );
  raise notice 'PASS: 40,000 actual payment creates one Money Out, leaves 60,000 due, and locks source';

  perform public.create_expense_payment(
    factory_a_id, date '2026-08-29', 60000, 'bank_transfer', 'Final payment',
    jsonb_build_array(jsonb_build_object('expense_record_id', purchase.id, 'amount', 60000))
  );
  select * into state from public.get_expense_record_payment_state(factory_a_id, purchase.id);
  if state.total_paid <> 100000 or state.outstanding_amount <> 0
    or state.payment_state <> 'paid' then
    raise exception 'FAIL: full payment state is wrong';
  end if;
  perform pg_temp.expect_error(
    'fully-paid purchase rejects further payment', 'P4105',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_a_id, '2026-08-29', purchase.id
    )
  );

  select * into source_one from public.create_expense_record(
    factory_a_id, date '2026-08-30', 'purchase', supplier.id, null, 'Coal lot two', 100000, null
  );
  select * into source_two from public.create_expense_record(
    factory_a_id, date '2026-08-30', 'expense', null, 'Diesel pump', 'Diesel', 30000, null
  );
  select * into explicit_payment from public.create_expense_payment(
    factory_a_id, date '2026-08-30', 30000, 'cash', null,
    jsonb_build_array(jsonb_build_object('expense_record_id', source_two.id, 'amount', 30000))
  );
  select * into state from public.get_expense_record_payment_state(factory_a_id, source_one.id);
  if state.total_paid <> 0 or state.outstanding_amount <> 100000 then
    raise exception 'FAIL: explicit allocation changed the older purchase';
  end if;
  select * into state from public.get_expense_record_payment_state(factory_a_id, source_two.id);
  if state.payment_state <> 'paid' then
    raise exception 'FAIL: explicit allocation did not fully pay its target';
  end if;
  raise notice 'PASS: explicit allocation has no oldest-first behavior';

  select * into source_three from public.create_expense_record(
    factory_a_id, date '2026-08-31', 'expense', null, 'Mechanic', 'Tractor repair', 30000, null
  );
  select * into multi_payment from public.create_expense_payment(
    factory_a_id, date '2026-08-31', 60000, 'cheque', 'Two-source payment',
    jsonb_build_array(
      jsonb_build_object('expense_record_id', source_one.id, 'amount', 30000),
      jsonb_build_object('expense_record_id', source_three.id, 'amount', 30000)
    )
  );
  if (select count(*) from public.expense_payment_allocations
      where payment_id = multi_payment.id) <> 2 then
    raise exception 'FAIL: multi-source payment did not store two allocations';
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-08-31'
    ) where source_type = 'expense_payment' and source_id = multi_payment.id
      and amount = 60000) <> 1 then
    raise exception 'FAIL: multi-source payment duplicated Cash Book Money Out';
  end if;
  raise notice 'PASS: two allocations remain one 60,000 Cash Book Money Out';

  perform pg_temp.expect_error(
    'payment/allocation mismatch rolls back', 'P4101',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1000,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',999)))',
      factory_a_id, '2026-09-01', source_one.id
    )
  );
  select count(*) into count_before from public.expense_payments where factory_id = factory_a_id;
  perform pg_temp.expect_error(
    'one invalid allocation rolls back entire payment', 'P4102',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,2000,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1000),jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1000)))',
      factory_a_id, '2026-09-01', source_one.id, gen_random_uuid()
    )
  );
  if (select count(*) from public.expense_payments where factory_id = factory_a_id) <> count_before then
    raise exception 'FAIL: atomic allocation failure persisted a payment';
  end if;

  select * into lifecycle_record from public.create_expense_record(
    factory_a_id, date '2026-09-02', 'expense', null, 'Garage', 'Repair estimate', 5000, null
  );
  select * into lifecycle_record from public.update_expense_record(
    factory_a_id, lifecycle_record.id, date '2026-09-02', 'expense', null,
    'Garage', 'Final tractor repair', 5500, 'Corrected before payment'
  );
  perform public.void_expense_record(factory_a_id, lifecycle_record.id);
  if not exists (
    select 1 from public.expense_records where id = lifecycle_record.id and status = 'void'
  ) then
    raise exception 'FAIL: void unpaid source did not remain historically stored';
  end if;
  perform pg_temp.expect_error(
    'void source cannot receive payment', 'P4103',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_a_id, '2026-09-02', lifecycle_record.id
    )
  );

  foreach test_mode in array array['cash', 'upi', 'bank_transfer', 'cheque', 'other']
  loop
    select * into mode_record from public.create_expense_record(
      factory_a_id, date '2026-09-03', 'expense', null, 'Mode test',
      format('%s payment', test_mode), 1, null
    );
    perform public.create_expense_payment(
      factory_a_id, date '2026-09-03', 1, test_mode, null,
      jsonb_build_array(jsonb_build_object('expense_record_id', mode_record.id, 'amount', 1))
    );
  end loop;
  perform pg_temp.expect_error(
    'unsupported outgoing payment mode is rejected', 'P3200',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1,''card'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_a_id, '2026-09-03', source_one.id
    )
  );

  perform pg_temp.expect_error(
    'Factory A user cannot update Factory B supplier', '42501',
    format(
      'select * from public.update_supplier(%L::uuid,%L::uuid,''Denied'',null,null)',
      factory_b_id, supplier_b_id
    )
  );
  perform pg_temp.expect_error(
    'Factory A user cannot void Factory B source', '42501',
    format('select * from public.void_expense_record(%L::uuid,%L::uuid)', factory_b_id, record_b_id)
  );
  perform pg_temp.expect_error(
    'Factory A user cannot pay Factory B source', '42501',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_b_id, '2026-09-03', record_b_id
    )
  );
  if exists (select 1 from public.suppliers where factory_id = factory_b_id)
    or exists (select 1 from public.expense_records where factory_id = factory_b_id)
    or exists (select 1 from public.expense_payments where factory_id = factory_b_id)
    or exists (select 1 from public.expense_payment_allocations where factory_id = factory_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Expense/Purchase data';
  end if;
  raise notice 'PASS: supplier, source, payment, allocation, and Cash Book reads are factory-isolated';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  payment_id uuid;
  record_id uuid;
  payment_definition text;
  routine_oid oid;
begin
  select id into payment_id from public.expense_payments
  where factory_id = factory_a_id order by created_at, id limit 1;
  select id into record_id from public.expense_records
  where factory_id = factory_a_id and is_locked order by created_at, id limit 1;

  perform pg_temp.expect_error(
    'outgoing payment cannot be directly rewritten', 'P4106',
    format('update public.expense_payments set amount = 1 where id = %L::uuid', payment_id)
  );
  perform pg_temp.expect_error(
    'outgoing allocation cannot be directly deleted', 'P4106',
    format('delete from public.expense_payment_allocations where payment_id = %L::uuid', payment_id)
  );
  perform pg_temp.expect_error(
    'financially locked source cannot be directly rewritten', 'P4104',
    format('update public.expense_records set total_amount = 1 where id = %L::uuid', record_id)
  );

  foreach routine_oid in array array[
    'public.create_supplier(uuid,text,text,text)'::regprocedure::oid,
    'public.update_supplier(uuid,uuid,text,text,text)'::regprocedure::oid,
    'public.create_expense_record(uuid,date,text,uuid,text,text,numeric,text)'::regprocedure::oid,
    'public.update_expense_record(uuid,uuid,date,text,uuid,text,text,numeric,text)'::regprocedure::oid,
    'public.void_expense_record(uuid,uuid)'::regprocedure::oid,
    'public.create_expense_payment(uuid,date,numeric,text,text,jsonb)'::regprocedure::oid,
    'public.list_expense_records(uuid,uuid)'::regprocedure::oid,
    'public.get_expense_record_payment_state(uuid,uuid)'::regprocedure::oid,
    'public.get_supplier_expense_summary(uuid,uuid)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = routine_oid and prosecdef
        and proconfig @> array['search_path=pg_catalog, public']
    ) or not has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or has_function_privilege('anon', routine_oid, 'EXECUTE') then
      raise exception 'FAIL: S7A RPC % has unsafe definer, search path, or grants',
        routine_oid::regprocedure;
    end if;
  end loop;

  payment_definition := pg_get_functiondef(
    'public.create_expense_payment(uuid,date,numeric,text,text,jsonb)'::regprocedure
  );
  if payment_definition !~ 'order by target.id'
    or payment_definition !~ 'for update'
    or payment_definition !~ 'existing_paid'
    or payment_definition !~ 'set is_locked = true' then
    raise exception 'FAIL: outgoing payment RPC lacks deterministic concurrency protection';
  end if;

  if has_table_privilege('authenticated', 'public.suppliers', 'INSERT')
    or has_table_privilege('authenticated', 'public.suppliers', 'UPDATE')
    or has_table_privilege('authenticated', 'public.suppliers', 'DELETE')
    or has_table_privilege('authenticated', 'public.expense_records', 'INSERT')
    or has_table_privilege('authenticated', 'public.expense_records', 'UPDATE')
    or has_table_privilege('authenticated', 'public.expense_records', 'DELETE')
    or has_table_privilege('authenticated', 'public.expense_payments', 'INSERT')
    or has_table_privilege('authenticated', 'public.expense_payments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.expense_payments', 'DELETE')
    or has_table_privilege('authenticated', 'public.expense_payment_allocations', 'INSERT')
    or has_table_privilege('authenticated', 'public.expense_payment_allocations', 'UPDATE')
    or has_table_privilege('authenticated', 'public.expense_payment_allocations', 'DELETE') then
    raise exception 'FAIL: authenticated role has direct S7A mutation privileges';
  end if;
  raise notice 'PASS: S7A privileges, immutable payments, source lifecycle, and lock-order invariants hold';
end;
$$;

rollback;
