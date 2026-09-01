-- Atlas Sales S5A verifier. Run against the current Sales schema through S6A.
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
  customer_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Sales S5A Factory A %s', factory_a_id),
      'Brick manufacturer A', 'Factory Address A', '9000000001',
      'Village A', 'Post A', 'Police A', 'District A', 'State A'),
    (factory_b_id, format('Sales S5A Factory B %s', factory_b_id),
      'Brick manufacturer B', 'Factory Address B', '9000000002',
      'Village B', 'Post B', 'Police B', 'District B', 'State B');
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'S5A Factory A Brick'),
    (brick_b_id, factory_b_id, 'S5A Factory B Brick');
  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_b_id, factory_b_id, 'Factory B Customer', 'B Address', '9222222222');

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_test.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_test.customer_b_id', customer_b_id::text, true);
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
  single_customer public.customers%rowtype;
  explicit_customer public.customers%rowtype;
  multi_customer public.customers%rowtype;
  rollback_customer public.customers%rowtype;
  other_customer public.customers%rowtype;
  void_customer public.customers%rowtype;
  single_challan public.challans%rowtype;
  explicit_one public.challans%rowtype;
  explicit_two public.challans%rowtype;
  multi_one public.challans%rowtype;
  multi_two public.challans%rowtype;
  rollback_valid public.challans%rowtype;
  rollback_invalid public.challans%rowtype;
  void_challan_row public.challans%rowtype;
  payment public.customer_payments%rowtype;
  state record;
  summary record;
  payment_count_before bigint;
begin
  select * into single_customer from public.create_customer(
    factory_a_id, 'Single Payment Customer', '', ''
  );
  select * into single_challan from public.create_challan(
    factory_a_id, date '2026-08-27', single_customer.id, 'S5A100', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );

  select * into payment from public.create_customer_payment(
    factory_a_id,
    single_customer.id,
    date '2026-08-27',
    30000,
    'cash',
    'First payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', single_challan.id, 'amount', 30000)
    )
  );
  select * into state from public.get_challan_payment_state(factory_a_id, single_challan.id);
  if state.sale_total <> 100000
    or state.total_paid <> 30000
    or state.outstanding_amount <> 70000
    or state.payment_state <> 'partially_paid'
    or not (select is_locked from public.challans where id = single_challan.id) then
    raise exception 'FAIL: single-Challan payment state or lock is incorrect';
  end if;
  raise notice 'PASS: ₹30,000 allocation leaves ₹70,000 due and locks only its Challan';

  perform public.create_customer_payment(
    factory_a_id,
    single_customer.id,
    date '2026-08-28',
    70000,
    'cash',
    null,
    jsonb_build_array(
      jsonb_build_object('challan_id', single_challan.id, 'amount', 70000)
    )
  );
  select * into state from public.get_challan_payment_state(factory_a_id, single_challan.id);
  if state.total_paid <> 100000
    or state.outstanding_amount <> 0
    or state.payment_state <> 'paid' then
    raise exception 'FAIL: full payment did not produce paid state';
  end if;
  perform pg_temp.expect_error(
    'fully paid Challan rejects another allocation', 'P3105',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 1, ''cash'', null, %L::jsonb)',
      factory_a_id, single_customer.id, '2026-08-29',
      jsonb_build_array(jsonb_build_object('challan_id', single_challan.id, 'amount', 1))::text
    )
  );
  perform pg_temp.expect_error(
    'paid Challan cannot be updated', 'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb)',
      factory_a_id, single_challan.id, '2026-08-30', single_customer.id, 'S5A100',
      jsonb_build_array(
        jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
      )::text
    )
  );
  perform pg_temp.expect_error(
    'paid Challan cannot be voided', 'P3005',
    format('select * from public.void_challan(%L::uuid, %L::uuid)',
      factory_a_id, single_challan.id)
  );
  raise notice 'PASS: full payment reaches paid state and S1 lifecycle RPCs enforce the payment lock';

  select * into explicit_customer from public.create_customer(
    factory_a_id, 'Explicit Allocation Customer', '', ''
  );
  select * into explicit_one from public.create_challan(
    factory_a_id, date '2026-08-27', explicit_customer.id, 'S5A201', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );
  select * into explicit_two from public.create_challan(
    factory_a_id, date '2026-08-27', explicit_customer.id, 'S5A202', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 30000)
    )
  );
  perform public.create_customer_payment(
    factory_a_id,
    explicit_customer.id,
    date '2026-08-27',
    30000,
    'cash',
    null,
    jsonb_build_array(
      jsonb_build_object('challan_id', explicit_two.id, 'amount', 30000)
    )
  );
  select * into summary from public.get_customer_sales_summary(
    factory_a_id, explicit_customer.id
  );
  if (select is_locked from public.challans where id = explicit_one.id)
    or not (select is_locked from public.challans where id = explicit_two.id)
    or summary.total_active_sales <> 130000
    or summary.total_payments_allocated <> 30000
    or summary.total_outstanding <> 100000 then
    raise exception 'FAIL: explicit allocation touched the wrong Challan or customer summary';
  end if;
  raise notice 'PASS: explicit payment clears #2 only; #1 remains ₹100,000 due and unlocked';

  select * into multi_customer from public.create_customer(
    factory_a_id, 'Multi Allocation Customer', '', ''
  );
  select * into multi_one from public.create_challan(
    factory_a_id, date '2026-08-27', multi_customer.id, 'S5A301', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );
  select * into multi_two from public.create_challan(
    factory_a_id, date '2026-08-27', multi_customer.id, 'S5A302', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 30000)
    )
  );
  select count(*) into payment_count_before
  from public.customer_payments
  where factory_id = factory_a_id and customer_id = multi_customer.id;
  select * into payment from public.create_customer_payment(
    factory_a_id,
    multi_customer.id,
    date '2026-08-27',
    60000,
    'cash',
    'Split deliberately',
    jsonb_build_array(
      jsonb_build_object('challan_id', multi_two.id, 'amount', 30000),
      jsonb_build_object('challan_id', multi_one.id, 'amount', 30000)
    )
  );
  if (select count(*) from public.customer_payments
      where factory_id = factory_a_id and customer_id = multi_customer.id)
      <> payment_count_before + 1
    or (select count(*) from public.customer_payment_allocations
      where payment_id = payment.id) <> 2 then
    raise exception 'FAIL: multi-Challan payment did not create one header and two allocations';
  end if;
  raise notice 'PASS: ₹60,000 creates one payment and two explicit ₹30,000 allocations';

  perform pg_temp.expect_error(
    'allocation total below payment fails', 'P3101',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 60000, ''cash'', null, %L::jsonb)',
      factory_a_id, multi_customer.id, '2026-08-28',
      jsonb_build_array(jsonb_build_object('challan_id', multi_one.id, 'amount', 59999))::text
    )
  );
  perform pg_temp.expect_error(
    'allocation total above payment fails', 'P3101',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 60000, ''cash'', null, %L::jsonb)',
      factory_a_id, multi_customer.id, '2026-08-28',
      jsonb_build_array(jsonb_build_object('challan_id', multi_one.id, 'amount', 60001))::text
    )
  );
  perform pg_temp.expect_error(
    'same Challan cannot appear twice in one payment', '22023',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 2000, ''cash'', null, %L::jsonb)',
      factory_a_id, multi_customer.id, '2026-08-28',
      jsonb_build_array(
        jsonb_build_object('challan_id', multi_one.id, 'amount', 1000),
        jsonb_build_object('challan_id', multi_one.id, 'amount', 1000)
      )::text
    )
  );
  perform pg_temp.expect_error(
    'allocation above outstanding fails', 'P3105',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 70001, ''cash'', null, %L::jsonb)',
      factory_a_id, multi_customer.id, '2026-08-28',
      jsonb_build_array(jsonb_build_object('challan_id', multi_one.id, 'amount', 70001))::text
    )
  );

  select * into rollback_customer from public.create_customer(
    factory_a_id, 'Rollback Customer', '', ''
  );
  select * into other_customer from public.create_customer(
    factory_a_id, 'Other Customer', '', ''
  );
  select * into rollback_valid from public.create_challan(
    factory_a_id, date '2026-08-27', rollback_customer.id, 'S5A401', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 10000)
    )
  );
  select * into rollback_invalid from public.create_challan(
    factory_a_id, date '2026-08-27', other_customer.id, 'S5A402', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 10000)
    )
  );
  select count(*) into payment_count_before from public.customer_payments;
  perform pg_temp.expect_error(
    'one valid and one invalid allocation rolls back atomically', 'P3103',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 2000, ''cash'', null, %L::jsonb)',
      factory_a_id, rollback_customer.id, '2026-08-28',
      jsonb_build_array(
        jsonb_build_object('challan_id', rollback_valid.id, 'amount', 1000),
        jsonb_build_object('challan_id', rollback_invalid.id, 'amount', 1000)
      )::text
    )
  );
  if (select count(*) from public.customer_payments) <> payment_count_before
    or exists (select 1 from public.customer_payment_allocations
      where challan_id in (rollback_valid.id, rollback_invalid.id))
    or (select is_locked from public.challans where id = rollback_valid.id) then
    raise exception 'FAIL: invalid multi-allocation left payment, allocation, or lock state behind';
  end if;
  raise notice 'PASS: invalid multi-allocation rolls back the entire payment and every new lock';

  select * into void_customer from public.create_customer(
    factory_a_id, 'Void Customer', '', ''
  );
  select * into void_challan_row from public.create_challan(
    factory_a_id, date '2026-08-27', void_customer.id, 'S5A501', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 10000)
    )
  );
  perform public.void_challan(factory_a_id, void_challan_row.id);
  perform pg_temp.expect_error(
    'void Challan rejects allocation', 'P3104',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 1000, ''cash'', null, %L::jsonb)',
      factory_a_id, void_customer.id, '2026-08-28',
      jsonb_build_array(jsonb_build_object('challan_id', void_challan_row.id, 'amount', 1000))::text
    )
  );
  select * into summary from public.get_customer_sales_summary(factory_a_id, void_customer.id);
  if summary.total_active_sales <> 0
    or summary.total_payments_allocated <> 0
    or summary.total_outstanding <> 0 then
    raise exception 'FAIL: void Challan contributes to customer outstanding';
  end if;

  perform pg_temp.expect_error(
    'payment customer cannot use another customer Challan', 'P3103',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 1000, ''cash'', null, %L::jsonb)',
      factory_a_id, rollback_customer.id, '2026-08-28',
      jsonb_build_array(jsonb_build_object('challan_id', rollback_invalid.id, 'amount', 1000))::text
    )
  );
  perform pg_temp.expect_error(
    'Factory A user cannot create Factory B payment', '42501',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 1, ''cash'', null, %L::jsonb)',
      factory_b_id, customer_b_id, '2026-08-28',
      jsonb_build_array(jsonb_build_object('challan_id', gen_random_uuid(), 'amount', 1))::text
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct payment update is denied', '42501',
    format('update public.customer_payments set note = %L where id = %L::uuid',
      'Changed', payment.id)
  );

  perform set_config('atlas_test.payment_id', payment.id::text, true);
  perform set_config('atlas_test.factory_a_challan_id', explicit_one.id::text, true);
  raise notice 'PASS: void, customer mismatch, factory mismatch, and direct mutation protections hold';
end;
$$;

reset role;

do $$
declare
  payment_id uuid := current_setting('atlas_test.payment_id')::uuid;
begin
  perform pg_temp.expect_error(
    'privileged payment update is rejected by immutable-history trigger', 'P3106',
    format('update public.customer_payments set note = %L where id = %L::uuid',
      'Changed', payment_id)
  );
  perform pg_temp.expect_error(
    'privileged allocation delete is rejected by immutable-history trigger', 'P3106',
    format(
      'delete from public.customer_payment_allocations where payment_id = %L::uuid',
      payment_id
    )
  );
end;
$$;

update public.factory_users
set factory_id = current_setting('atlas_test.factory_b_id')::uuid, is_active = true
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  customer_b_id uuid := current_setting('atlas_test.customer_b_id')::uuid;
  factory_a_challan_id uuid := current_setting('atlas_test.factory_a_challan_id')::uuid;
begin
  if exists (select 1 from public.customer_payments where factory_id = factory_a_id)
    or exists (
      select 1 from public.customer_payment_allocations where factory_id = factory_a_id
    ) then
    raise exception 'FAIL: Factory B can read Factory A customer-payment records';
  end if;
  perform pg_temp.expect_error(
    'Factory B cannot read Factory A customer summary RPC', '42501',
    format(
      'select * from public.get_customer_sales_summary(%L::uuid, %L::uuid)',
      factory_a_id, gen_random_uuid()
    )
  );
  perform pg_temp.expect_error(
    'Factory B payment cannot allocate to Factory A Challan', 'P3102',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 1, ''cash'', null, %L::jsonb)',
      factory_b_id, customer_b_id, '2026-08-28',
      jsonb_build_array(
        jsonb_build_object('challan_id', factory_a_challan_id, 'amount', 1)
      )::text
    )
  );
  raise notice 'PASS: payment tables and derived financial reads are factory-isolated';
end;
$$;

reset role;

do $$
declare
  table_name text;
  routine_oid oid;
  create_definition text;
begin
  foreach table_name in array array[
    'customer_payments', 'customer_payment_allocations'
  ] loop
    if not (select relrowsecurity from pg_class
      where oid = format('public.%I', table_name)::regclass) then
      raise exception 'FAIL: RLS is not enabled on %', table_name;
    end if;
    if has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE')
      or has_table_privilege('anon', format('public.%I', table_name), 'SELECT') then
      raise exception 'FAIL: unsafe direct privilege exists on %', table_name;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('customer_payments', 'customer_payment_allocations')) <> 2 then
    raise exception 'FAIL: expected two factory-read payment policies';
  end if;

  foreach routine_oid in array array[
    'public.create_customer_payment(uuid,uuid,date,numeric,text,text,jsonb)'::regprocedure::oid,
    'public.get_challan_payment_state(uuid,uuid)'::regprocedure::oid,
    'public.get_customer_sales_summary(uuid,uuid)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = routine_oid
        and prosecdef
        and proconfig @> array['search_path=pg_catalog, public']
    ) or not has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or has_function_privilege('anon', routine_oid, 'EXECUTE') then
      raise exception 'FAIL: S5A RPC % has unsafe definer, search path, or grants',
        routine_oid::regprocedure;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname ~* '(update|delete|edit|reverse).*customer.*payment'
      and has_function_privilege('authenticated', oid, 'EXECUTE')
  ) then
    raise exception 'FAIL: S5A exposes a mutable payment-history RPC';
  end if;

  create_definition := pg_get_functiondef(
    'public.create_customer_payment(uuid,uuid,date,numeric,text,text,jsonb)'::regprocedure
  );
  if create_definition !~ 'order by target.id'
    or create_definition !~ 'for update'
    or create_definition !~ 'existing_paid'
    or create_definition !~ 'set is_locked = true' then
    raise exception 'FAIL: atomic payment RPC lacks deterministic locks, recheck, or Challan lock';
  end if;

  if not exists (
      select 1 from pg_constraint
      where conname = 'customer_payment_allocations_payment_challan_key'
    ) or not exists (
      select 1 from pg_trigger
      where tgname = 'customer_payments_prevent_update_delete' and not tgisinternal
    ) or not exists (
      select 1 from pg_trigger
      where tgname = 'customer_payment_allocations_prevent_update_delete' and not tgisinternal
    ) then
    raise exception 'FAIL: duplicate-allocation constraint or immutable-history triggers missing';
  end if;

  raise notice 'PASS: S5A tables, RLS, grants, immutable history, controlled RPCs, and deterministic locking exist';
end;
$$;

rollback;
