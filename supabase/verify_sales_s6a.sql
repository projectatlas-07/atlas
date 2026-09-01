-- Atlas Sales S6A verifier. Run after 20260827000023_create_cash_book_foundation.sql.
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
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  factory_b_entry_id uuid := gen_random_uuid();
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
    (factory_a_id, format('S6A Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001',
      'Village A', 'Post A', 'Police A', 'District A', 'State A'),
    (factory_b_id, format('S6A Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002',
      'Village B', 'Post B', 'Police B', 'District B', 'State B');
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'S6A Brick A'),
    (brick_b_id, factory_b_id, 'S6A Brick B');

  insert into public.cash_book_initializations(
    factory_id, start_date, opening_balance, created_by
  ) values (factory_b_id, date '2026-08-27', 999, test_user_id);
  insert into public.cash_book_manual_entries(
    id, factory_id, business_date, direction, amount, payment_mode,
    party_details, created_by
  ) values (
    factory_b_entry_id, factory_b_id, date '2026-08-27', 'out', 99,
    'cash', 'Factory B secret', test_user_id
  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_test.factory_b_entry_id', factory_b_entry_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_test.brick_a_id')::uuid;
  factory_b_entry_id uuid := current_setting('atlas_test.factory_b_entry_id')::uuid;
  customer public.customers%rowtype;
  multi_customer public.customers%rowtype;
  challan public.challans%rowtype;
  multi_one public.challans%rowtype;
  multi_two public.challans%rowtype;
  payment public.customer_payments%rowtype;
  multi_payment public.customer_payments%rowtype;
  initialization public.cash_book_initializations%rowtype;
  manual_in public.cash_book_manual_entries%rowtype;
  manual_out public.cash_book_manual_entries%rowtype;
  void_out public.cash_book_manual_entries%rowtype;
  summary record;
  movement record;
  test_mode text;
  mode_entry_id uuid;
begin
  select * into initialization from public.initialize_cash_book(
    factory_a_id, date '2026-08-27', 20000
  );
  if initialization.start_date <> date '2026-08-27'
    or initialization.opening_balance <> 20000 then
    raise exception 'FAIL: Cash Book initialization is incorrect';
  end if;
  perform public.initialize_cash_book(factory_a_id, date '2026-08-27', 20000);
  perform pg_temp.expect_error(
    'different initialization cannot rewrite history', 'P3202',
    format(
      'select * from public.initialize_cash_book(%L::uuid, date %L, 25000)',
      factory_a_id, '2026-08-27'
    )
  );

  select * into customer from public.create_customer(
    factory_a_id, 'S6A Customer', 'Customer Address', '9111111111'
  );
  select * into challan from public.create_challan(
    factory_a_id, date '2026-08-27', customer.id, 'S6A100', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );
  select * into payment from public.create_customer_payment(
    factory_a_id, customer.id, date '2026-08-27', 30000, 'upi', 'UPI reference',
    jsonb_build_array(jsonb_build_object('challan_id', challan.id, 'amount', 30000))
  );
  if payment.payment_mode <> 'upi' then
    raise exception 'FAIL: customer payment mode did not round-trip';
  end if;

  select * into manual_in from public.create_cash_book_manual_entry(
    factory_a_id, gen_random_uuid(), date '2026-08-27', 'in', 100000,
    'bank_transfer', 'Owner temporary money', 'Working capital'
  );
  select * into manual_out from public.create_cash_book_manual_entry(
    factory_a_id, gen_random_uuid(), date '2026-08-27', 'out', 80000,
    'cash', 'General payment', null
  );
  select * into void_out from public.create_cash_book_manual_entry(
    factory_a_id, gen_random_uuid(), date '2026-08-27', 'out', 10000,
    'cash', 'Incorrect outflow', null
  );
  perform public.void_cash_book_manual_entry(factory_a_id, void_out.id);

  -- Retrying one request UUID with identical data returns the same row, not a duplicate.
  perform public.create_cash_book_manual_entry(
    factory_a_id, manual_in.id, date '2026-08-27', 'in', 100000,
    'bank_transfer', 'Owner temporary money', 'Working capital'
  );
  if (select count(*) from public.cash_book_manual_entries where id = manual_in.id) <> 1 then
    raise exception 'FAIL: idempotent manual request created a duplicate';
  end if;

  select * into summary from public.get_cash_book_day_summary(
    factory_a_id, date '2026-08-27'
  );
  if summary.opening_balance <> 20000
    or summary.total_money_in <> 130000
    or summary.total_money_out <> 80000
    or summary.closing_balance <> 70000 then
    raise exception 'FAIL: daily arithmetic is wrong: %', row_to_json(summary);
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-08-27'
    ) where source_type = 'customer_payment' and source_id = payment.id) <> 1 then
    raise exception 'FAIL: one customer payment did not produce exactly one Cash Book movement';
  end if;
  select * into movement from public.list_cash_book_day_entries(
    factory_a_id, date '2026-08-27'
  ) where source_type = 'customer_payment' and source_id = payment.id;
  if movement.amount <> 30000 or movement.payment_mode <> 'upi'
    or movement.direction <> 'in' then
    raise exception 'FAIL: customer payment Cash Book movement is incorrect';
  end if;
  if not exists (
    select 1 from public.list_cash_book_day_entries(factory_a_id, date '2026-08-27')
    where source_id = void_out.id and source_status = 'void'
  ) then
    raise exception 'FAIL: void entry did not remain in historical day rows';
  end if;
  raise notice 'PASS: opening 20,000 + Money In 130,000 - Money Out 80,000 = closing 70,000';

  select * into summary from public.get_cash_book_day_summary(
    factory_a_id, date '2026-08-28'
  );
  if summary.opening_balance <> 70000
    or summary.total_money_in <> 0
    or summary.total_money_out <> 0
    or summary.closing_balance <> 70000 then
    raise exception 'FAIL: empty-day carry-forward is wrong';
  end if;
  raise notice 'PASS: no-transaction next day opens and closes at 70,000';

  select * into multi_customer from public.create_customer(
    factory_a_id, 'S6A Multi Customer', '', ''
  );
  select * into multi_one from public.create_challan(
    factory_a_id, date '2026-08-29', multi_customer.id, 'S6A201', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 30000)
    )
  );
  select * into multi_two from public.create_challan(
    factory_a_id, date '2026-08-29', multi_customer.id, 'S6A202', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 30000)
    )
  );
  select * into multi_payment from public.create_customer_payment(
    factory_a_id, multi_customer.id, date '2026-08-29', 60000,
    'bank_transfer', 'One real payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', multi_one.id, 'amount', 30000),
      jsonb_build_object('challan_id', multi_two.id, 'amount', 30000)
    )
  );
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-08-29'
    ) where source_type = 'customer_payment' and source_id = multi_payment.id
      and amount = 60000) <> 1 then
    raise exception 'FAIL: multi-Challan payment duplicated its Cash Book movement';
  end if;
  raise notice 'PASS: two allocations remain one 60,000 Cash Book movement';

  foreach test_mode in array array['cash', 'upi', 'bank_transfer', 'cheque', 'other']
  loop
    mode_entry_id := gen_random_uuid();
    perform public.create_cash_book_manual_entry(
      factory_a_id, mode_entry_id, date '2026-08-30', 'in', 1,
      test_mode, 'Mode round-trip', null
    );
    if (select payment_mode from public.cash_book_manual_entries where id = mode_entry_id)
      <> test_mode then
      raise exception 'FAIL: payment mode % did not round-trip', test_mode;
    end if;
  end loop;
  perform pg_temp.expect_error(
    'unsupported payment mode is rejected', 'P3200',
    format(
      'select * from public.create_cash_book_manual_entry(%L::uuid, %L::uuid, date %L, ''in'', 1, ''card'', ''Bad mode'', null)',
      factory_a_id, gen_random_uuid(), '2026-08-30'
    )
  );

  perform pg_temp.expect_error(
    'Factory A user cannot initialize Factory B Cash Book', '42501',
    format(
      'select * from public.initialize_cash_book(%L::uuid, date %L, 1)',
      factory_b_id, '2026-08-27'
    )
  );
  perform pg_temp.expect_error(
    'Factory A user cannot create Factory B manual entry', '42501',
    format(
      'select * from public.create_cash_book_manual_entry(%L::uuid, %L::uuid, date %L, ''in'', 1, ''cash'', ''Denied'', null)',
      factory_b_id, gen_random_uuid(), '2026-08-27'
    )
  );
  perform pg_temp.expect_error(
    'Factory A user cannot void Factory B manual entry', '42501',
    format(
      'select * from public.void_cash_book_manual_entry(%L::uuid, %L::uuid)',
      factory_b_id, factory_b_entry_id
    )
  );
  perform pg_temp.expect_error(
    'Factory A user cannot read Factory B summary', '42501',
    format(
      'select * from public.get_cash_book_day_summary(%L::uuid, date %L)',
      factory_b_id, '2026-08-27'
    )
  );
  if exists (select 1 from public.cash_book_initializations where factory_id = factory_b_id)
    or exists (select 1 from public.cash_book_manual_entries where factory_id = factory_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Cash Book rows';
  end if;
  raise notice 'PASS: Cash Book tables and RPCs are factory-isolated';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  manual_entry_id uuid;
  payment_definition text;
  routine_oid oid;
begin
  select id into manual_entry_id
  from public.cash_book_manual_entries
  where factory_id = factory_a_id
  order by created_at, id
  limit 1;

  perform pg_temp.expect_error(
    'initialization row cannot be directly updated', 'P3206',
    format(
      'update public.cash_book_initializations set opening_balance = 999 where factory_id = %L::uuid',
      factory_a_id
    )
  );
  perform pg_temp.expect_error(
    'manual financial details cannot be rewritten', 'P3206',
    format(
      'update public.cash_book_manual_entries set amount = 999 where id = %L::uuid',
      manual_entry_id
    )
  );

  foreach routine_oid in array array[
    'public.create_customer_payment(uuid,uuid,date,numeric,text,text,jsonb)'::regprocedure::oid,
    'public.initialize_cash_book(uuid,date,numeric)'::regprocedure::oid,
    'public.create_cash_book_manual_entry(uuid,uuid,date,text,numeric,text,text,text)'::regprocedure::oid,
    'public.void_cash_book_manual_entry(uuid,uuid)'::regprocedure::oid,
    'public.get_cash_book_day_summary(uuid,date)'::regprocedure::oid,
    'public.list_cash_book_day_entries(uuid,date)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = routine_oid
        and prosecdef
        and proconfig @> array['search_path=pg_catalog, public']
    ) or not has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or has_function_privilege('anon', routine_oid, 'EXECUTE') then
      raise exception 'FAIL: S6A RPC % has unsafe definer, search path, or grants',
        routine_oid::regprocedure;
    end if;
  end loop;

  if to_regprocedure('public.create_customer_payment(uuid,uuid,date,numeric,text,jsonb)')
      is not null then
    raise exception 'FAIL: legacy payment RPC without required mode still exists';
  end if;

  payment_definition := pg_get_functiondef(
    'public.create_customer_payment(uuid,uuid,date,numeric,text,text,jsonb)'::regprocedure
  );
  if payment_definition !~ 'order by target.id'
    or payment_definition !~ 'for update'
    or payment_definition !~ 'existing_paid'
    or payment_definition !~ 'set is_locked = true' then
    raise exception 'FAIL: payment-mode extension weakened S5 concurrency protection';
  end if;

  if has_table_privilege('authenticated', 'public.cash_book_initializations', 'INSERT')
    or has_table_privilege('authenticated', 'public.cash_book_initializations', 'UPDATE')
    or has_table_privilege('authenticated', 'public.cash_book_initializations', 'DELETE')
    or has_table_privilege('authenticated', 'public.cash_book_manual_entries', 'INSERT')
    or has_table_privilege('authenticated', 'public.cash_book_manual_entries', 'UPDATE')
    or has_table_privilege('authenticated', 'public.cash_book_manual_entries', 'DELETE') then
    raise exception 'FAIL: authenticated role has direct Cash Book mutation privileges';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('cash_book_initializations', 'cash_book_manual_entries')) <> 2 then
    raise exception 'FAIL: expected two Cash Book factory-read policies';
  end if;
  raise notice 'PASS: S6A privileges, RLS, immutability, and S5 lock invariants hold';
end;
$$;

rollback;
