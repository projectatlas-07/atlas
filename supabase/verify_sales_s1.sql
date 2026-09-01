-- Atlas Sales S1 verifier. Run after 20260826000020_create_sales_challan_foundation.sql.
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
  brick_a_one_id uuid := gen_random_uuid();
  brick_a_two_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Sales S1 Factory A %s', factory_a_id),
      'Brick manufacturer A', 'Factory Address A', '9000000001',
      'Village A', 'Post A', 'Police A', 'District A', 'State A'),
    (factory_b_id, format('Sales S1 Factory B %s', factory_b_id),
      'Brick manufacturer B', 'Factory Address B', '9000000002',
      'Village B', 'Post B', 'Police B', 'District B', 'State B');

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_one_id, factory_a_id, 'Red Class One'),
    (brick_a_two_id, factory_a_id, 'Red Class Two'),
    (brick_b_id, factory_b_id, 'Factory B Brick');
  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_b_id, factory_b_id, 'Factory B Customer', 'B Address', '9222222222');

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_a_one_id', brick_a_one_id::text, true);
  perform set_config('atlas_test.brick_a_two_id', brick_a_two_id::text, true);
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
  brick_a_one_id uuid := current_setting('atlas_test.brick_a_one_id')::uuid;
  brick_a_two_id uuid := current_setting('atlas_test.brick_a_two_id')::uuid;
  brick_b_id uuid := current_setting('atlas_test.brick_b_id')::uuid;
  customer_b_id uuid := current_setting('atlas_test.customer_b_id')::uuid;
  customer_a public.customers%rowtype;
  first_challan public.challans%rowtype;
  second_challan public.challans%rowtype;
  third_challan public.challans%rowtype;
  original_company_name text;
begin
  select * into customer_a from public.create_customer(
    factory_a_id, '  Anand   Traders  ', 'Address A', '9111111111'
  );
  if customer_a.name <> 'Anand Traders' or customer_a.address <> 'Address A' then
    raise exception 'FAIL: customer master creation did not normalize and save data';
  end if;

  select * into first_challan from public.create_challan(
    factory_a_id,
    date '2026-08-26',
    customer_a.id,
    ' rj 14 ab 1234 ',
    450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_one_id, 'quantity', 1500, 'rate', 2000),
      jsonb_build_object('brick_type_id', brick_a_two_id, 'quantity', 500, 'rate', 1000)
    )
  );
  original_company_name := first_challan.company_name_snapshot;

  if first_challan.challan_number <> 1
    or first_challan.vehicle_number <> 'RJ14AB1234'
    or first_challan.tractor_labour_rate_snapshot <> 450
    or first_challan.challan_total <> 3500
    or first_challan.status <> 'active'
    or first_challan.is_locked then
    raise exception 'FAIL: first Challan header, normalization, numbering, or total is incorrect';
  end if;
  if (select count(*) from public.challan_items where challan_id = first_challan.id) <> 2
    or (select line_amount from public.challan_items
        where challan_id = first_challan.id and line_position = 1) <> 3000
    or (select line_amount from public.challan_items
        where challan_id = first_challan.id and line_position = 2) <> 500
    or exists (select 1 from public.challan_items
        where challan_id = first_challan.id and pricing_unit <> 'PER_1000_BRICKS') then
    raise exception 'FAIL: database line math, total, pricing unit, or deterministic ordering is incorrect';
  end if;
  raise notice 'PASS: database calculates multiple lines as quantity / 1000 * rate and sums the Challan total';

  perform public.update_customer(
    factory_a_id, customer_a.id, 'Anand Traders', 'Address B', '9333333333'
  );
  perform public.update_factory_printable_profile(
    factory_a_id,
    'Updated Factory A',
    'Updated brick manufacturer',
    'Updated Factory Address',
    '9444444444'
  );

  select * into first_challan from public.challans where id = first_challan.id;
  if first_challan.customer_address_snapshot <> 'Address A'
    or first_challan.customer_mobile_snapshot <> '9111111111'
    or first_challan.company_name_snapshot <> original_company_name
    or first_challan.company_address_snapshot <> 'Factory Address A' then
    raise exception 'FAIL: mutable customer/factory data rewrote an existing Challan snapshot';
  end if;
  raise notice 'PASS: customer and printable factory snapshots preserve Address A and original company data';

  select * into second_challan from public.create_challan(
    factory_a_id,
    date '2026-08-27',
    customer_a.id,
    'RJ14AB1234',
    475.50,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_one_id, 'quantity', 1000, 'rate', 2100)
    )
  );
  if second_challan.challan_number <> 2
    or second_challan.customer_address_snapshot <> 'Address B'
    or second_challan.customer_mobile_snapshot <> '9333333333'
    or second_challan.company_name_snapshot <> 'Updated Factory A'
    or second_challan.company_address_snapshot <> 'Updated Factory Address' then
    raise exception 'FAIL: a new Challan did not use the latest customer/factory snapshots';
  end if;
  raise notice 'PASS: a new Challan snapshots Address B and the latest printable company data';

  select * into second_challan from public.update_challan(
    factory_a_id,
    second_challan.id,
    date '2026-08-28',
    customer_a.id,
    'rj-14-ab-1234',
    500,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_two_id, 'quantity', 2500, 'rate', 1200)
    )
  );
  if second_challan.challan_number <> 2
    or second_challan.challan_date <> date '2026-08-28'
    or second_challan.challan_total <> 3000
    or (select count(*) from public.challan_items where challan_id = second_challan.id) <> 1 then
    raise exception 'FAIL: active unlocked Challan update was not atomic or preserved its number';
  end if;
  raise notice 'PASS: active unlocked Challan update atomically replaces its item set and recalculates total';

  select * into first_challan from public.void_challan(factory_a_id, first_challan.id);
  if first_challan.status <> 'void' or first_challan.voided_at is null
    or not exists (select 1 from public.challans where id = first_challan.id)
    or (select count(*) from public.challan_items where challan_id = first_challan.id) <> 2 then
    raise exception 'FAIL: void did not preserve the numbered Challan and its items';
  end if;
  raise notice 'PASS: void Challan remains permanently stored with its number and lines';

  select * into third_challan from public.create_challan(
    factory_a_id,
    date '2026-08-29',
    customer_a.id,
    'RJ14AB9999',
    0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_one_id, 'quantity', 1000, 'rate', 2000)
    )
  );
  if third_challan.challan_number <> 3 then
    raise exception 'FAIL: a void Challan number was reused';
  end if;
  raise notice 'PASS: void numbers are never reused and numbering remains monotonic';

  perform pg_temp.expect_error(
    'client-supplied false line amount is rejected', '22023',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000, %L, 1)))',
      factory_a_id, '2026-08-30', customer_a.id, 'RJ14AB5555',
      'brick_type_id', brick_a_one_id, 'quantity', 'rate', 'line_amount'
    )
  );
  raise notice 'PASS: false client amounts are rejected before any values can be persisted';

  perform pg_temp.expect_error(
    'Factory A customer cannot be replaced with Factory B customer', 'P3002',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_a_id, second_challan.id, '2026-08-28', customer_b_id, 'RJ14AB1234',
      'brick_type_id', brick_a_one_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'Factory A Challan cannot use Factory B brick type', 'P3004',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_a_id, second_challan.id, '2026-08-28', customer_a.id, 'RJ14AB1234',
      'brick_type_id', brick_b_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B Challan creation', '42501',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_b_id, '2026-08-30', customer_b_id, 'RJ14BB1234',
      'brick_type_id', brick_b_id, 'quantity', 'rate'
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct total update is denied', '42501',
    format('update public.challans set challan_total = 1 where id = %L::uuid', second_challan.id)
  );
  perform pg_temp.expect_error(
    'authenticated hard delete is denied', '42501',
    format('delete from public.challans where id = %L::uuid', first_challan.id)
  );

  perform set_config('atlas_test.customer_a_id', customer_a.id::text, true);
  perform set_config('atlas_test.first_challan_id', first_challan.id::text, true);
  perform set_config('atlas_test.second_challan_id', second_challan.id::text, true);
  perform set_config('atlas_test.third_challan_id', third_challan.id::text, true);
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  first_challan_id uuid := current_setting('atlas_test.first_challan_id')::uuid;
  second_challan_id uuid := current_setting('atlas_test.second_challan_id')::uuid;
  third_challan_id uuid := current_setting('atlas_test.third_challan_id')::uuid;
begin
  perform pg_temp.expect_error(
    'generated line amount cannot be explicitly falsified', '428C9',
    format(
      'insert into public.challan_items(id, factory_id, challan_id, brick_type_id, brick_particulars_snapshot, quantity, rate_per_1000_bricks, pricing_unit, line_amount, line_position) select gen_random_uuid(), factory_id, id, %L::uuid, %L, 1000, 2000, %L, 1, 99 from public.challans where id = %L::uuid',
      current_setting('atlas_test.brick_a_one_id'), 'False Amount',
      'PER_1000_BRICKS', second_challan_id
    )
  );
  perform pg_temp.expect_error(
    'numbered Challan cannot be hard-deleted even by a privileged caller', 'P3001',
    format('delete from public.challans where id = %L::uuid', first_challan_id)
  );

  update public.challans set is_locked = true where id = third_challan_id;
  if not (select is_locked from public.challans where id = third_challan_id) then
    raise exception 'FAIL: S1 lock-compatible schema could not establish the future payment lock';
  end if;
  if (select last_challan_number from public.challan_number_counters
      where factory_id = factory_a_id) <> 3 then
    raise exception 'FAIL: Factory A counter is inconsistent after lifecycle tests';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  customer_a_id uuid := current_setting('atlas_test.customer_a_id')::uuid;
  brick_a_one_id uuid := current_setting('atlas_test.brick_a_one_id')::uuid;
  first_challan_id uuid := current_setting('atlas_test.first_challan_id')::uuid;
  third_challan_id uuid := current_setting('atlas_test.third_challan_id')::uuid;
begin
  perform pg_temp.expect_error(
    'void Challan cannot be edited', 'P3006',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_a_id, first_challan_id, '2026-08-30', customer_a_id, 'RJ14AB1234',
      'brick_type_id', brick_a_one_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'locked Challan cannot be edited', 'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_a_id, third_challan_id, '2026-08-30', customer_a_id, 'RJ14AB9999',
      'brick_type_id', brick_a_one_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'locked Challan cannot be voided', 'P3005',
    format('select * from public.void_challan(%L::uuid, %L::uuid)', factory_a_id, third_challan_id)
  );
  raise notice 'PASS: locked Challan cannot be edited or voided while lock remains independent of active status';
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
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_test.customer_a_id')::uuid;
  brick_a_one_id uuid := current_setting('atlas_test.brick_a_one_id')::uuid;
  brick_b_id uuid := current_setting('atlas_test.brick_b_id')::uuid;
  first_challan_id uuid := current_setting('atlas_test.first_challan_id')::uuid;
  customer_b public.customers%rowtype;
  challan_b public.challans%rowtype;
begin
  if exists (select 1 from public.customers where factory_id = factory_a_id)
    or exists (select 1 from public.challans where factory_id = factory_a_id)
    or exists (select 1 from public.challan_items where factory_id = factory_a_id) then
    raise exception 'FAIL: Factory B can read Factory A Sales rows';
  end if;

  select * into customer_b from public.create_customer(
    factory_b_id, 'Factory B RPC Customer', 'B2 Address', '9555555555'
  );
  select * into challan_b from public.create_challan(
    factory_b_id,
    date '2026-08-30',
    customer_b.id,
    'RJ14BB1234',
    100,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_b_id, 'quantity', 1000, 'rate', 2500)
    )
  );
  if challan_b.challan_number <> 1 or challan_b.challan_total <> 2500 then
    raise exception 'FAIL: Factory B did not receive an independent number-one counter';
  end if;

  perform pg_temp.expect_error(
    'Factory B cannot create with Factory A customer', 'P3002',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_b_id, '2026-08-30', customer_a_id, 'RJ14BB2222',
      'brick_type_id', brick_b_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'Factory B cannot create with Factory A brick type', 'P3004',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_b_id, '2026-08-30', customer_b.id, 'RJ14BB2222',
      'brick_type_id', brick_a_one_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'Factory B cannot update Factory A Challan', '42501',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1000, %L, 2000)))',
      factory_a_id, first_challan_id, '2026-08-30', customer_a_id, 'RJ14AB1234',
      'brick_type_id', brick_a_one_id, 'quantity', 'rate'
    )
  );
  perform pg_temp.expect_error(
    'Factory B cannot void Factory A Challan', '42501',
    format('select * from public.void_challan(%L::uuid, %L::uuid)', factory_a_id, first_challan_id)
  );
  raise notice 'PASS: RLS, composite references, RPC authorization, and per-factory counters isolate factories';
end;
$$;

reset role;

do $$
declare
  sales_table text;
  required_policy_count integer;
  routine_oid oid;
  routine_definition text;
begin
  if exists (
    select 1 from pg_class
    where oid = any(array[
      'public.factories'::regclass,
      'public.customers'::regclass,
      'public.challan_number_counters'::regclass,
      'public.challans'::regclass,
      'public.challan_items'::regclass
    ]) and not relrowsecurity
  ) then
    raise exception 'FAIL: one or more S1 tables do not have RLS enabled';
  end if;

  select count(*) into required_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array['factories', 'customers', 'challans', 'challan_items']);
  if required_policy_count <> 4 then
    raise exception 'FAIL: expected four factory-read S1 policies, found %',
      required_policy_count;
  end if;

  foreach sales_table in array array[
    'factories', 'customers', 'challan_number_counters', 'challans', 'challan_items'
  ] loop
    if has_table_privilege('authenticated', format('public.%I', sales_table), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', sales_table), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', sales_table), 'DELETE')
      or has_table_privilege('anon', format('public.%I', sales_table), 'SELECT') then
      raise exception 'FAIL: unsafe direct privilege exists on %', sales_table;
    end if;
  end loop;

  if to_regprocedure('public.create_customer(uuid,text,text,text)') is null
    or to_regprocedure('public.update_customer(uuid,uuid,text,text,text)') is null
    or to_regprocedure('public.create_challan(uuid,date,uuid,text,numeric,jsonb)') is null
    or to_regprocedure('public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb)') is null
    or to_regprocedure('public.void_challan(uuid,uuid)') is null then
    raise exception 'FAIL: a required S1 controlled RPC is missing';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname ~* '(delete|unlock|lock).*challan|challan.*(delete|unlock|lock)'
      and has_function_privilege('authenticated', oid, 'EXECUTE')
  ) then
    raise exception 'FAIL: S1 exposes a forbidden delete or financial-lock toggle RPC';
  end if;

  foreach routine_oid in array array[
    'public.update_factory_printable_profile(uuid,text,text,text,text)'::regprocedure::oid,
    'public.create_customer(uuid,text,text,text)'::regprocedure::oid,
    'public.update_customer(uuid,uuid,text,text,text)'::regprocedure::oid,
    'public.create_challan(uuid,date,uuid,text,numeric,jsonb)'::regprocedure::oid,
    'public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb)'::regprocedure::oid,
    'public.void_challan(uuid,uuid)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = routine_oid
        and prosecdef
        and proconfig @> array['search_path=pg_catalog, public']
    ) or not has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or has_function_privilege('anon', routine_oid, 'EXECUTE') then
      raise exception 'FAIL: S1 RPC % does not have the required definer, search path, or grants',
        routine_oid::regprocedure;
    end if;
  end loop;
  if has_function_privilege(
      'authenticated',
      'public.insert_challan_items(uuid,uuid,jsonb)'::regprocedure,
      'EXECUTE'
    ) then
    raise exception 'FAIL: internal Challan item writer is client-executable';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.challan_items'::regclass
      and attname = 'line_amount'
      and attgenerated = 's'
  ) then
    raise exception 'FAIL: Challan line amount is not a stored generated column';
  end if;
  if not exists (select 1 from pg_trigger
      where tgname = 'challan_items_recalculate_total' and not tgisinternal)
    or not exists (select 1 from pg_trigger
      where tgname = 'challans_reject_delete' and not tgisinternal)
    or not exists (select 1 from pg_constraint
      where conname = 'challans_factory_number_key') then
    raise exception 'FAIL: total derivation, permanent-row guard, or unique number constraint is missing';
  end if;

  routine_definition := pg_get_functiondef(
    'public.create_challan(uuid,date,uuid,text,numeric,jsonb)'::regprocedure
  );
  if routine_definition !~ 'on conflict \(factory_id\) do update'
    or routine_definition ~ 'p_(challan_total|line_amount)'
    or routine_definition !~ 'insert_challan_items' then
    raise exception 'FAIL: create_challan does not use the atomic counter/item boundary';
  end if;

  if (select last_challan_number from public.challan_number_counters
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid) <> 3
    or (select max(challan_number) from public.challans
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid) <> 3
    or (select last_challan_number from public.challan_number_counters
      where factory_id = current_setting('atlas_test.factory_b_id')::uuid) <> 1 then
    raise exception 'FAIL: final per-factory counter state is inconsistent';
  end if;

  raise notice 'PASS: required RLS, privileges, RPCs, generated math, counters, constraints, and lifecycle guards exist';
  raise notice 'PASS: no hard-delete operation or unrestricted financial-lock toggle exists';
end;
$$;

rollback;
