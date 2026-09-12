-- Atlas exact Challan brick Amount verifier.
-- Run after 20260910000034_allow_exact_challan_brick_amount.sql.
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
  exact_factory_id uuid := gen_random_uuid();
  other_factory_id uuid := gen_random_uuid();
  exact_customer_id uuid := gen_random_uuid();
  other_customer_id uuid := gen_random_uuid();
  exact_brick_a_id uuid := gen_random_uuid();
  exact_brick_b_id uuid := gen_random_uuid();
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
      exact_factory_id, format('Exact Amount Factory %s', exact_factory_id), 'Brick manufacturer',
      'Village', 'Post', 'Police', 'District', 'State', 'Legacy address', '9000000000'
    ),
    (
      other_factory_id, format('Other Exact Factory %s', other_factory_id), 'Brick manufacturer',
      'Other Village', 'Other Post', 'Other Police', 'Other District', 'Other State',
      'Other legacy address', '9000000001'
    );
  update public.factory_users
  set factory_id = exact_factory_id, is_active = true
  where id = mapping_id;
  insert into public.customers(id, factory_id, name, address, mobile) values
    (exact_customer_id, exact_factory_id, 'Exact Amount Customer', 'Delivery address', '9111111111'),
    (other_customer_id, other_factory_id, 'Other Customer', 'Other address', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (exact_brick_a_id, exact_factory_id, 'Class One'),
    (exact_brick_b_id, exact_factory_id, 'Class Two'),
    (other_brick_id, other_factory_id, 'Other Factory Brick');

  perform set_config('atlas_exact.user_id', test_user_id::text, true);
  perform set_config('atlas_exact.factory_id', exact_factory_id::text, true);
  perform set_config('atlas_exact.customer_id', exact_customer_id::text, true);
  perform set_config('atlas_exact.brick_a_id', exact_brick_a_id::text, true);
  perform set_config('atlas_exact.brick_b_id', exact_brick_b_id::text, true);
  perform set_config('atlas_exact.other_factory_id', other_factory_id::text, true);
  perform set_config('atlas_exact.other_customer_id', other_customer_id::text, true);
  perform set_config('atlas_exact.other_brick_id', other_brick_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_exact.user_id'), true);

do $$
declare
  factory_id uuid := current_setting('atlas_exact.factory_id')::uuid;
  customer_id uuid := current_setting('atlas_exact.customer_id')::uuid;
  brick_a_id uuid := current_setting('atlas_exact.brick_a_id')::uuid;
  brick_b_id uuid := current_setting('atlas_exact.brick_b_id')::uuid;
  other_factory_id uuid := current_setting('atlas_exact.other_factory_id')::uuid;
  other_customer_id uuid := current_setting('atlas_exact.other_customer_id')::uuid;
  other_brick_id uuid := current_setting('atlas_exact.other_brick_id')::uuid;
  rate_challan public.challans%rowtype;
  amount_challan public.challans%rowtype;
  mixed_challan public.challans%rowtype;
  saved_item public.challan_items%rowtype;
  payment_state record;
  customer_summary record;
begin
  select * into rate_challan from public.create_challan(
    factory_id, date '2026-09-10', customer_id, null::uuid, null::numeric,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 10000,
      'pricing_mode', 'RATE', 'rate', 8000
    )), '[]'::jsonb
  );
  select * into saved_item from public.challan_items
  where challan_id = rate_challan.id;
  if saved_item.pricing_mode <> 'RATE'
    or saved_item.rate_per_1000_bricks <> 8000
    or saved_item.line_amount <> 80000
    or rate_challan.challan_total <> 80000 then
    raise exception 'FAIL: existing Rate workflow changed: item %, Challan %',
      saved_item, rate_challan;
  end if;
  raise notice 'PASS: existing Rate workflow still derives and saves ₹80,000';

  select * into amount_challan from public.create_challan(
    factory_id, date '2026-09-10', customer_id, null::uuid, null::numeric,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 12347,
      'pricing_mode', 'AMOUNT', 'amount', '80000.00'
    )), '[]'::jsonb
  );
  select * into saved_item from public.challan_items
  where challan_id = amount_challan.id;
  if saved_item.pricing_mode <> 'AMOUNT'
    or saved_item.line_amount <> 80000
    or saved_item.rate_per_1000_bricks <> 6479.306714182
    or amount_challan.challan_total <> 80000 then
    raise exception 'FAIL: exact Amount row did not round-trip: item %, Challan %',
      saved_item, amount_challan;
  end if;

  select * into payment_state from public.get_challan_payment_state(
    factory_id, amount_challan.id
  );
  if payment_state.sale_total <> 80000
    or payment_state.outstanding_amount <> 80000
    or payment_state.payment_state <> 'unpaid' then
    raise exception 'FAIL: exact Amount did not reach payment/outstanding state: %', payment_state;
  end if;
  raise notice 'PASS: 12,347 bricks at exact Amount ₹80,000 saves, reloads, totals, and remains outstanding exactly';

  select * into mixed_challan from public.create_challan(
    factory_id, date '2026-09-10', customer_id, null::uuid, null::numeric,
    jsonb_build_array(
      jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 10000,
        'pricing_mode', 'RATE', 'rate', 8000
      ),
      jsonb_build_object(
        'brick_type_id', brick_b_id, 'quantity', 12347,
        'pricing_mode', 'AMOUNT', 'amount', 80000
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', 'Exact agreement'
      ),
      jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 1,
        'particulars', 'Loading', 'amount', 2000
      )
    )
  );
  if mixed_challan.challan_total <> 162000
    or (select count(*) from public.challan_items
        where challan_id = mixed_challan.id and pricing_mode = 'RATE') <> 1
    or (select count(*) from public.challan_items
        where challan_id = mixed_challan.id and pricing_mode = 'AMOUNT') <> 1 then
    raise exception 'FAIL: mixed pricing or flexible lines total is wrong: %', mixed_challan;
  end if;
  raise notice 'PASS: mixed Rate/Amount rows, NOTE, and EXTRA_CHARGE total exactly once';

  select * into amount_challan from public.update_challan(
    factory_id, amount_challan.id, amount_challan.challan_date, customer_id,
    null::uuid, null::numeric,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 12347,
      'pricing_mode', 'RATE', 'rate', 6480
    )), '[]'::jsonb
  );
  if amount_challan.challan_total <> 80008.56 then
    raise exception 'FAIL: Amount-to-Rate edit produced % instead of 80008.56',
      amount_challan.challan_total;
  end if;

  select * into amount_challan from public.update_challan(
    factory_id, amount_challan.id, amount_challan.challan_date, customer_id,
    null::uuid, null::numeric,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 12347,
      'pricing_mode', 'AMOUNT', 'amount', '80000.00'
    )), '[]'::jsonb
  );
  if amount_challan.challan_total <> 80000
    or (select line_amount from public.challan_items
        where challan_id = amount_challan.id) <> 80000 then
    raise exception 'FAIL: Rate-to-Amount edit drifted from ₹80,000';
  end if;
  raise notice 'PASS: editing authority in either direction has no circular drift';

  perform pg_temp.expect_error(
    'item cannot supply both Rate and Amount', '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_id, amount_challan.id, '2026-09-10', customer_id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 12347,
        'pricing_mode', 'AMOUNT', 'rate', 6480, 'amount', 80000
      )), '[]'
    )
  );
  perform pg_temp.expect_error(
    'item cannot omit both Rate and Amount', '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_id, amount_challan.id, '2026-09-10', customer_id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 12347, 'pricing_mode', 'RATE'
      )), '[]'
    )
  );
  perform pg_temp.expect_error(
    'Amount row cannot use another factory brick type', 'P3004',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_id, amount_challan.id, '2026-09-10', customer_id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', other_brick_id, 'quantity', 12347,
        'pricing_mode', 'AMOUNT', 'amount', 80000
      )), '[]'
    )
  );
  perform pg_temp.expect_error(
    'authenticated factory cannot create an Amount row for another factory', '42501',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      other_factory_id, '2026-09-10', other_customer_id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', other_brick_id, 'quantity', 12347,
        'pricing_mode', 'AMOUNT', 'amount', 80000
      )), '[]'
    )
  );

  select * into customer_summary from public.get_customer_sales_summary(
    factory_id, customer_id
  );
  if customer_summary.total_active_sales <> 322000
    or customer_summary.total_outstanding <> 322000 then
    raise exception 'FAIL: customer aggregate did not preserve exact totals: %', customer_summary;
  end if;

  perform set_config('atlas_exact.locked_challan_id', amount_challan.id::text, true);
end;
$$;

reset role;
update public.challans
set is_locked = true
where id = current_setting('atlas_exact.locked_challan_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_exact.user_id'), true);

select pg_temp.expect_error(
  'payment-locked lifecycle still blocks pricing edits', 'P3005',
  format(
    'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
    current_setting('atlas_exact.factory_id'),
    current_setting('atlas_exact.locked_challan_id'),
    '2026-09-10', current_setting('atlas_exact.customer_id'),
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', current_setting('atlas_exact.brick_a_id')::uuid,
      'quantity', 12347, 'pricing_mode', 'AMOUNT', 'amount', 79999
    )), '[]'
  )
);

do $$
begin
  if (select line_amount from public.challan_items
      where challan_id = current_setting('atlas_exact.locked_challan_id')::uuid) <> 80000 then
    raise exception 'FAIL: rejected locked edit changed the exact Amount';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.challan_items'::regclass and relrowsecurity
  ) or has_function_privilege(
    'authenticated', 'public.insert_challan_items(uuid,uuid,jsonb)'::regprocedure, 'EXECUTE'
  ) then
    raise exception 'FAIL: RLS or private writer boundary changed';
  end if;
  raise notice 'PASS: locks, RLS, and private writer boundaries remain intact';
end;
$$;

rollback;
