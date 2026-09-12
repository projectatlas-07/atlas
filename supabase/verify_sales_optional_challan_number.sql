-- Atlas optional manual Challan number verifier.
-- Run after 20260911000035_make_challan_number_optional_manual_text.sql.
-- Requires one existing factory_users row. All fixtures and mapping changes roll back.

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
  test_factory_id uuid := gen_random_uuid();
  other_factory_id uuid := gen_random_uuid();
  customer_id uuid := gen_random_uuid();
  other_customer_id uuid := gen_random_uuid();
  brick_id uuid := gen_random_uuid();
  other_brick_id uuid := gen_random_uuid();
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
      test_factory_id, format('Manual Number Factory %s', test_factory_id), 'Brick manufacturer',
      'Village', 'Post', 'Police', 'District', 'State', 'Legacy address', '9000000000'
    ),
    (
      other_factory_id, format('Other Number Factory %s', other_factory_id), 'Brick manufacturer',
      'Other Village', 'Other Post', 'Other Police', 'Other District', 'Other State',
      'Other address', '9000000001'
    );
  update public.factory_users
  set factory_id = test_factory_id, is_active = true
  where id = mapping_id;
  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_id, test_factory_id, 'Manual Number Customer', 'Delivery address', '9111111111'),
    (other_customer_id, other_factory_id, 'Other Customer', 'Other address', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_id, test_factory_id, 'Class One'),
    (other_brick_id, other_factory_id, 'Other Brick');

  perform set_config('atlas_number.user_id', test_user_id::text, true);
  perform set_config('atlas_number.factory_id', test_factory_id::text, true);
  perform set_config('atlas_number.other_factory_id', other_factory_id::text, true);
  perform set_config('atlas_number.customer_id', customer_id::text, true);
  perform set_config('atlas_number.other_customer_id', other_customer_id::text, true);
  perform set_config('atlas_number.brick_id', brick_id::text, true);
  perform set_config('atlas_number.other_brick_id', other_brick_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_number.user_id'), true);

do $$
declare
  factory_id uuid := current_setting('atlas_number.factory_id')::uuid;
  other_factory_id uuid := current_setting('atlas_number.other_factory_id')::uuid;
  customer_id uuid := current_setting('atlas_number.customer_id')::uuid;
  other_customer_id uuid := current_setting('atlas_number.other_customer_id')::uuid;
  brick_id uuid := current_setting('atlas_number.brick_id')::uuid;
  other_brick_id uuid := current_setting('atlas_number.other_brick_id')::uuid;
  basic_items jsonb := jsonb_build_array(jsonb_build_object(
    'brick_type_id', brick_id, 'quantity', 1000,
    'pricing_mode', 'RATE', 'rate', 1000
  ));
  manual_challan public.challans%rowtype;
  alpha_challan public.challans%rowtype;
  slash_challan public.challans%rowtype;
  blank_challan public.challans%rowtype;
  second_blank_challan public.challans%rowtype;
  exact_challan public.challans%rowtype;
  payment public.customer_payments%rowtype;
begin
  select * into manual_challan from public.create_challan(
    factory_id, '145', date '2026-09-11', customer_id,
    null::uuid, null::numeric, basic_items, '[]'::jsonb
  );
  select * into alpha_challan from public.create_challan(
    factory_id, '  A-39  ', date '2026-09-11', customer_id,
    null::uuid, null::numeric, basic_items, '[]'::jsonb
  );
  select * into slash_challan from public.create_challan(
    factory_id, '2026/145', date '2026-09-11', customer_id,
    null::uuid, null::numeric, basic_items, '[]'::jsonb
  );
  select * into blank_challan from public.create_challan(
    factory_id, null, date '2026-09-11', customer_id,
    null::uuid, null::numeric, basic_items, '[]'::jsonb
  );
  select * into second_blank_challan from public.create_challan(
    factory_id, '   ', date '2026-09-11', customer_id,
    null::uuid, null::numeric, basic_items, '[]'::jsonb
  );

  if manual_challan.challan_number <> '145'
    or alpha_challan.challan_number <> 'A-39'
    or slash_challan.challan_number <> '2026/145'
    or blank_challan.challan_number is not null
    or second_blank_challan.challan_number is not null
    or manual_challan.id is null
    or blank_challan.id is null
    or manual_challan.id = blank_challan.id then
    raise exception 'FAIL: manual/blank number round-trip or UUID identity is wrong';
  end if;
  raise notice 'PASS: numeric text, alphanumeric, slash, edge trim, and multiple blank references round-trip';

  perform pg_temp.expect_error(
    'duplicate non-NULL manual number remains factory-scoped unique', '23505',
    format(
      'select * from public.create_challan(%L::uuid, %L::text, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_id, '145', '2026-09-11', customer_id, basic_items, '[]'
    )
  );

  select * into manual_challan from public.update_challan(
    factory_id, manual_challan.id, '  MAN-145/A  ', manual_challan.challan_date,
    customer_id, null::uuid, null::numeric, basic_items, '[]'::jsonb
  );
  if manual_challan.challan_number <> 'MAN-145/A' then
    raise exception 'FAIL: unlocked edit did not preserve the new manual reference';
  end if;
  raise notice 'PASS: unlocked edit follows the existing Challan edit path';

  select * into exact_challan from public.create_challan(
    factory_id, 'EXACT-80K', date '2026-09-11', customer_id,
    null::uuid, null::numeric,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_id, 'quantity', 12347,
      'pricing_mode', 'AMOUNT', 'amount', '80000.00'
    )),
    '[]'::jsonb
  );
  if exact_challan.challan_total <> 80000
    or (select pricing_mode from public.challan_items where challan_id = exact_challan.id) <> 'AMOUNT'
    or (select line_amount from public.challan_items where challan_id = exact_challan.id) <> 80000 then
    raise exception 'FAIL: exact Amount pricing changed under the new create path';
  end if;
  raise notice 'PASS: exact Amount pricing remains authoritative';

  select * into payment from public.create_customer_payment(
    factory_id, customer_id, date '2026-09-11', 1000,
    'cash', null,
    jsonb_build_array(jsonb_build_object(
      'challan_id', blank_challan.id, 'amount', 1000
    ))
  );
  if payment.id is null
    or not exists (
      select 1 from public.customer_payment_allocations
      where payment_id = payment.id and challan_id = blank_challan.id
    ) then
    raise exception 'FAIL: payment did not retain the unnumbered Challan UUID';
  end if;
  raise notice 'PASS: payments reference an unnumbered Challan by internal UUID';

  perform pg_temp.expect_error(
    'payment-locked Challan number cannot be edited', 'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, %L::text, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_id, blank_challan.id, 'LOCK-BYPASS', '2026-09-11', customer_id,
      basic_items, '[]'
    )
  );

  perform pg_temp.expect_error(
    'authenticated user cannot create for another factory', '42501',
    format(
      'select * from public.create_challan(%L::uuid, %L::text, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      other_factory_id, 'OTHER-1', '2026-09-11', other_customer_id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', other_brick_id, 'quantity', 1000,
        'pricing_mode', 'RATE', 'rate', 1000
      )), '[]'
    )
  );
  if exists (
    select 1 from public.challans
    where challans.factory_id = other_factory_id
  ) then
    raise exception 'FAIL: RLS exposed another factory Challan';
  end if;
  raise notice 'PASS: factory isolation and RLS remain intact';
end;
$$;

reset role;

do $$
declare
  public_create_count integer;
  public_update_count integer;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challans'
      and column_name = 'challan_number'
      and (data_type <> 'text' or is_nullable <> 'YES')
  ) then
    raise exception 'FAIL: challan_number is not nullable text';
  end if;
  if to_regclass('public.challan_number_counters') is not null then
    raise exception 'FAIL: automatic Challan number counter still exists';
  end if;
  select count(*) into public_create_count
  from pg_proc
  where oid = 'public.create_challan(uuid,text,date,uuid,uuid,numeric,jsonb,jsonb)'::regprocedure
    and has_function_privilege('authenticated', oid, 'EXECUTE');
  select count(*) into public_update_count
  from pg_proc
  where oid = 'public.update_challan(uuid,uuid,text,date,uuid,uuid,numeric,jsonb,jsonb)'::regprocedure
    and has_function_privilege('authenticated', oid, 'EXECUTE');
  if public_create_count <> 1 or public_update_count <> 1 then
    raise exception 'FAIL: authenticated manual create/update RPC grants are wrong';
  end if;
  raise notice 'PASS: schema, retired counter, and controlled RPC grants are correct';
end;
$$;

rollback;
