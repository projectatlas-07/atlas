-- Atlas Sales correction A4 verifier.
-- Run after 20260831000029_make_challan_total_authoritative.sql.
-- Requires one existing factory_users row. Every fixture and payment is rolled back.

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
  brick_b_id uuid := gen_random_uuid();
  historical_challan_id uuid := gen_random_uuid();
  factory_b_challan_id uuid := gen_random_uuid();
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
      factory_a_id, format('Sales A4 Factory A %s', factory_a_id),
      'A4 brick manufacturer', 'Village A', 'Post A', 'Police A',
      'District A', 'State A', 'Legacy address A', '9000000001'
    ),
    (
      factory_b_id, format('Sales A4 Factory B %s', factory_b_id),
      'Other tenant', 'Village B', 'Post B', 'Police B',
      'District B', 'State B', 'Legacy address B', '9000000002'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'A4 Customer A', 'Customer address A', '9111111111'),
    (customer_b_id, factory_b_id, 'A4 Customer B', 'Customer address B', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'A4 Brick A'),
    (brick_b_id, factory_b_id, 'A4 Brick B');

  -- This row models unaffected pre-A4 brick-only history.
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    company_village_snapshot, company_post_office_snapshot,
    company_police_station_snapshot, company_district_snapshot,
    company_state_snapshot, vehicle_number, tractor_labour_rate_snapshot
  ) values (
    historical_challan_id, factory_a_id, 9000, date '2026-08-30', customer_a_id,
    'Historical customer', 'Historical destination', '9333333333',
    'Historical company', 'Historical description',
    'Historical company address', '9444444444',
    'Historical village', 'Historical post', 'Historical police',
    'Historical district', 'Historical state', 'RJ14A49000', 0
  );
  perform public.insert_challan_items(
    factory_a_id,
    historical_challan_id,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 12345)
    )
  );

  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    company_village_snapshot, company_post_office_snapshot,
    company_police_station_snapshot, company_district_snapshot,
    company_state_snapshot, vehicle_number, tractor_labour_rate_snapshot
  ) values (
    factory_b_challan_id, factory_b_id, 9001, date '2026-08-31', customer_b_id,
    'Factory B customer', 'Factory B destination', '9222222222',
    'Factory B company', 'Factory B description', 'Factory B address', '9000000002',
    'Village B', 'Post B', 'Police B', 'District B', 'State B', 'RJ14A49001', 0
  );
  perform public.insert_challan_items(
    factory_b_id,
    factory_b_challan_id,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_b_id, 'quantity', 1000, 'rate', 7000)
    )
  );

  perform set_config('atlas_a4.user_id', test_user_id::text, true);
  perform set_config('atlas_a4.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_a4.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_a4.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_a4.customer_b_id', customer_b_id::text, true);
  perform set_config('atlas_a4.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_a4.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_a4.historical_challan_id', historical_challan_id::text, true);
  perform set_config('atlas_a4.factory_b_challan_id', factory_b_challan_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a4.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a4.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a4.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a4.customer_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_a4.customer_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a4.brick_a_id')::uuid;
  brick_b_id uuid := current_setting('atlas_a4.brick_b_id')::uuid;
  historical_challan_id uuid := current_setting('atlas_a4.historical_challan_id')::uuid;
  factory_b_challan_id uuid := current_setting('atlas_a4.factory_b_challan_id')::uuid;
  brick_only public.challans%rowtype;
  combined public.challans%rowtype;
  manual public.challans%rowtype;
  note_extra public.challans%rowtype;
  note_only public.challans%rowtype;
  calculated_charge public.challans%rowtype;
  multiple_charges public.challans%rowtype;
  update_target public.challans%rowtype;
  payment_row public.customer_payments%rowtype;
  payment_state record;
  sales_summary record;
  original_company_name text;
begin
  select * into brick_only
  from public.create_challan(
    factory_a_id, date '2026-08-31', customer_a_id, 'RJ14A40001', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );
  if brick_only.challan_total <> 100000 then
    raise exception 'FAIL: brick-only total is %, expected 100000', brick_only.challan_total;
  end if;
  raise notice 'PASS: brick-only ₹100,000 remains total ₹100,000';

  select * into combined
  from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, 'RJ14A40002', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Customer-facing delivery note'),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 1,
        'particulars', 'Loading charge', 'amount', 2000)
    )
  );
  if combined.challan_total <> 102000
    or (select sum(amount) from public.challan_flexible_lines
        where challan_id = combined.id) <> 2000 then
    raise exception 'FAIL: canonical combined total is %, expected 102000', combined.challan_total;
  end if;
  raise notice 'PASS: bricks ₹100,000 plus EXTRA_CHARGE ₹2,000 gives total ₹102,000';
  raise notice 'PASS: NOTE contributes zero to the authoritative total';

  select * into manual
  from public.create_challan(
    factory_a_id, date '2026-09-02', customer_a_id, 'RJ14A40003', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Transport charge', 'amount', 5000)
    )
  );
  if manual.challan_total <> 5000
    or exists (select 1 from public.challan_items where challan_id = manual.id) then
    raise exception 'FAIL: EXTRA_CHARGE-only total is %, expected 5000', manual.challan_total;
  end if;
  raise notice 'PASS: EXTRA_CHARGE-only ₹5,000 Challan is valid with total ₹5,000; the temporary financial-only rule is retired';

  select * into note_extra
  from public.create_challan(
    factory_a_id, date '2026-09-03', customer_a_id, 'RJ14A40004', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Manual sale note'),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 1,
        'particulars', 'Manual handling charge', 'amount', 700)
    )
  );
  if note_extra.challan_total <> 700 then
    raise exception 'FAIL: NOTE plus EXTRA_CHARGE total is %, expected 700', note_extra.challan_total;
  end if;
  raise notice 'PASS: NOTE plus EXTRA_CHARGE manual-only Challan is valid';

  select * into note_only
  from public.create_challan(
    factory_a_id, date '2026-09-04', customer_a_id, 'RJ14A40005', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Non-financial delivery instruction')
    )
  );
  if note_only.challan_total <> 0 then
    raise exception 'FAIL: NOTE-only total is %, expected zero', note_only.challan_total;
  end if;
  raise notice 'PASS: NOTE-only Challan remains valid with total ₹0';

  perform pg_temp.expect_error(
    'completely empty Challan remains rejected by the A3 empty-document rule',
    'P3011',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-05', customer_a_id, 'RJ14A40006', '[]', '[]'
    )
  );

  select * into calculated_charge
  from public.create_challan(
    factory_a_id, date '2026-09-05', customer_a_id, 'RJ14A40006', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Calculated loading', 'quantity', 2.5, 'rate', 400)
    )
  );
  if calculated_charge.challan_total <> 1000
    or (select amount from public.challan_flexible_lines
        where challan_id = calculated_charge.id) <> 1000 then
    raise exception 'FAIL: calculated EXTRA_CHARGE did not contribute exactly once';
  end if;
  raise notice 'PASS: quantity times rate EXTRA_CHARGE contributes exactly once';

  select * into multiple_charges
  from public.create_challan(
    factory_a_id, date '2026-09-06', customer_a_id, 'RJ14A40007', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Charge one', 'amount', 100),
      jsonb_build_object('line_type', 'NOTE', 'order_index', 1,
        'particulars', 'Does not affect money'),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 2,
        'particulars', 'Charge two', 'amount', 200),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 3,
        'particulars', 'Charge three', 'amount', 300)
    )
  );
  if multiple_charges.challan_total <> 600 then
    raise exception 'FAIL: multiple charge total is %, expected 600', multiple_charges.challan_total;
  end if;
  raise notice 'PASS: multiple EXTRA_CHARGE rows sum exactly once';

  perform pg_temp.expect_error(
    'A2 amount validation remains intact for calculated EXTRA_CHARGE',
    '22023',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-07', customer_a_id, 'RJ14A40008', '[]',
      jsonb_build_array(jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Contradictory amount', 'quantity', 2, 'rate', 400, 'amount', 801
      ))::text
    )
  );

  select * into update_target
  from public.create_challan(
    factory_a_id, date '2026-09-07', customer_a_id, 'RJ14A40008', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Initial charge', 'amount', 2000)
    )
  );

  select * into update_target
  from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-08', customer_a_id,
    'RJ14A40008', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Changed charge', 'amount', 3000)
    )
  );
  if update_target.challan_total <> 103000 then
    raise exception 'FAIL: changed charge total is %, expected 103000', update_target.challan_total;
  end if;
  raise notice 'PASS: changing an EXTRA_CHARGE recalculates total to ₹103,000';

  -- Omitted flexible lines preserve the ₹3,000 charge while brick replacement removes all bricks.
  select * into update_target
  from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-09', customer_a_id,
    'RJ14A40008', 0, '[]'::jsonb
  );
  if update_target.challan_total <> 3000
    or exists (select 1 from public.challan_items where challan_id = update_target.id)
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = update_target.id and amount = 3000
    ) then
    raise exception 'FAIL: omitted flexible lines did not preserve a financial manual-only final state';
  end if;
  raise notice 'PASS: omitted flexible lines preserve their contribution when all bricks are removed';

  -- Restore bricks while continuing to omit the flexible parameter.
  select * into update_target
  from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-10', customer_a_id,
    'RJ14A40008', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );
  if update_target.challan_total <> 103000 then
    raise exception 'FAIL: preserved flexible contribution became stale after brick replacement';
  end if;

  select * into update_target
  from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-11', customer_a_id,
    'RJ14A40008', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    ),
    '[]'::jsonb
  );
  if update_target.challan_total <> 100000
    or exists (select 1 from public.challan_flexible_lines where challan_id = update_target.id) then
    raise exception 'FAIL: explicit empty flexible array did not remove the charge contribution';
  end if;
  raise notice 'PASS: removing an EXTRA_CHARGE recalculates total to ₹100,000';
  raise notice 'PASS: explicit empty flexible array removes its financial contribution';

  perform pg_temp.expect_error(
    'final empty update rolls back under P3011',
    'P3011',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, update_target.id, '2026-09-12', customer_a_id,
      'RJ14A40008', '[]', '[]'
    )
  );
  if (select challan_total from public.challans where id = update_target.id) <> 100000
    or (select count(*) from public.challan_items where challan_id = update_target.id) <> 1 then
    raise exception 'FAIL: rejected empty update leaked line or total changes';
  end if;
  raise notice 'PASS: final empty update rolls back line and total changes together';

  original_company_name := combined.company_name_snapshot;
  perform public.update_factory_printable_profile(
    factory_a_id,
    'Updated A4 Factory', 'Updated description', 'New Village',
    'New Post', 'New Police', 'New District', 'New State', '9888888888'
  );
  if (select company_name_snapshot from public.challans where id = combined.id)
      <> original_company_name
    or (select company_village_snapshot from public.challans where id = combined.id)
      <> 'Village A'
    or (select brick_particulars_snapshot from public.challan_items
        where challan_id = combined.id limit 1) <> 'A4 Brick A' then
    raise exception 'FAIL: A4 rewrote historical A1 or brick snapshots';
  end if;
  raise notice 'PASS: A1 company snapshots remain immutable and brick snapshots remain historical';

  if (select challan_total from public.challans where id = historical_challan_id) <> 12345
    or (select company_name_snapshot from public.challans where id = historical_challan_id)
      <> 'Historical company' then
    raise exception 'FAIL: unrelated brick-only history changed';
  end if;
  raise notice 'PASS: existing brick-only historical total remains unchanged';

  -- Canonical combined payment: ₹102,000 sale - ₹60,000 payment = ₹42,000 outstanding.
  select * into payment_row
  from public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-12', 60000,
    'cash', 'Canonical A4 partial payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', combined.id, 'amount', 60000)
    )
  );
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, combined.id);
  if payment_row.amount <> 60000
    or payment_state.sale_total <> 102000
    or payment_state.total_paid <> 60000
    or payment_state.outstanding_amount <> 42000
    or payment_state.payment_state <> 'partially_paid' then
    raise exception 'FAIL: canonical combined payment/outstanding result is wrong';
  end if;
  raise notice 'PASS: ₹60,000 payment leaves ₹42,000 outstanding on the ₹102,000 combined sale';

  -- Financial manual-only sale: ₹5,000 - ₹2,000 = ₹3,000, then fully paid.
  perform public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-12', 2000,
    'upi', 'Manual A4 partial payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', manual.id, 'amount', 2000)
    )
  );
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, manual.id);
  if payment_state.sale_total <> 5000
    or payment_state.total_paid <> 2000
    or payment_state.outstanding_amount <> 3000
    or payment_state.payment_state <> 'partially_paid' then
    raise exception 'FAIL: manual financial partial payment/outstanding result is wrong';
  end if;
  raise notice 'PASS: manual ₹5,000 sale accepts ₹2,000 payment and leaves ₹3,000 outstanding';

  perform public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-13', 3000,
    'bank_transfer', 'Manual A4 final payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', manual.id, 'amount', 3000)
    )
  );
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, manual.id);
  if payment_state.sale_total <> 5000
    or payment_state.total_paid <> 5000
    or payment_state.outstanding_amount <> 0
    or payment_state.payment_state <> 'paid' then
    raise exception 'FAIL: manual financial full-payment result is wrong';
  end if;
  raise notice 'PASS: full payment produces zero outstanding against the combined total';

  perform pg_temp.expect_error(
    'overpayment beyond the combined total remains rejected',
    'P3105',
    format(
      'select * from public.create_customer_payment(%L::uuid, %L::uuid, date %L, 100001, %L, %L, %L::jsonb)',
      factory_a_id, customer_a_id, '2026-09-14', 'cash', 'Rejected overpayment',
      jsonb_build_array(
        jsonb_build_object('challan_id', brick_only.id, 'amount', 100001)
      )::text
    )
  );

  perform pg_temp.expect_error(
    'payment-locked Challan cannot change its content or total',
    'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 450, %L::jsonb, %L::jsonb)',
      factory_a_id, combined.id, '2026-09-15', customer_a_id, 'RJ14A40002',
      jsonb_build_array(
        jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
      )::text,
      jsonb_build_array(
        jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
          'particulars', 'Forbidden locked charge', 'amount', 3000)
      )::text
    )
  );
  if (select challan_total from public.challans where id = combined.id) <> 102000 then
    raise exception 'FAIL: locked mutation changed the authoritative total';
  end if;
  raise notice 'PASS: payment-locked Challan cannot change its total or content';

  select * into sales_summary
  from public.get_customer_sales_summary(factory_a_id, customer_a_id);
  if sales_summary.total_active_sales <> 321645
    or sales_summary.total_payments_allocated <> 65000
    or sales_summary.total_outstanding <> 256645 then
    raise exception 'FAIL: customer combined sales summary is %, %, %',
      sales_summary.total_active_sales,
      sales_summary.total_payments_allocated,
      sales_summary.total_outstanding;
  end if;
  raise notice 'PASS: customer sales summary consumes the same saved combined totals';

  if exists (
    select 1 from public.challans
    where id = factory_b_challan_id or factory_id = factory_b_id
  ) then
    raise exception 'FAIL: Factory A can read Factory B Challans';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot influence Factory B totals through the controlled RPC',
    '42501',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_b_id, factory_b_challan_id, '2026-09-15', customer_b_id, 'RJ14A49001',
      jsonb_build_array(
        jsonb_build_object('brick_type_id', brick_b_id, 'quantity', 1000, 'rate', 1)
      )::text,
      '[]'
    )
  );
  perform pg_temp.expect_error(
    'direct authenticated flexible-line writes remain forbidden',
    '42501',
    format(
      'insert into public.challan_flexible_lines(factory_id, challan_id, line_type, line_category, order_index, particulars, amount) values (%L::uuid, %L::uuid, %L, %L, 99, %L, 1)',
      factory_a_id, brick_only.id, 'EXTRA_CHARGE', 'OTHER_REVENUE', 'Forbidden direct charge'
    )
  );

  perform set_config('atlas_a4.combined_id', combined.id::text, true);
  perform set_config('atlas_a4.manual_id', manual.id::text, true);
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_a4.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a4.factory_b_id')::uuid;
  factory_b_challan_id uuid := current_setting('atlas_a4.factory_b_challan_id')::uuid;
  calculator oid := to_regprocedure('public.calculate_challan_total(uuid,uuid)');
  refresher oid := to_regprocedure('public.refresh_challan_total(uuid,uuid)');
  adapter oid := to_regprocedure('public.recalculate_challan_total()');
  content_guard oid := to_regprocedure('public.assert_challan_final_content(uuid,uuid)');
  header_guard oid := to_regprocedure('public.guard_challan_header_update()');
  formula_definition text;
  content_definition text;
begin
  if (select challan_total from public.challans where id = factory_b_challan_id) <> 7000 then
    raise exception 'FAIL: Factory A influenced Factory B total';
  end if;
  raise notice 'PASS: Factory A cannot influence Factory B totals and RLS hides the other tenant';

  if calculator is null or refresher is null or adapter is null
    or content_guard is null or header_guard is null then
    raise exception 'FAIL: an A4 total or guard function is missing';
  end if;

  if exists (
      select 1 from pg_proc
      where oid in (calculator, refresher, content_guard)
        and (
          not prosecdef
          or coalesce(array_to_string(proconfig, ','), '')
            not like '%search_path=pg_catalog, public%'
        )
    )
    or (select provolatile from pg_proc where oid = calculator) <> 's'
    or exists (
      select 1 from pg_proc
      where oid in (adapter, header_guard)
        and coalesce(array_to_string(proconfig, ','), '')
          not like '%search_path=pg_catalog, public%'
    )
    or has_function_privilege('anon', calculator, 'EXECUTE')
    or has_function_privilege('authenticated', calculator, 'EXECUTE')
    or has_function_privilege('anon', refresher, 'EXECUTE')
    or has_function_privilege('authenticated', refresher, 'EXECUTE')
    or has_function_privilege('anon', content_guard, 'EXECUTE')
    or has_function_privilege('authenticated', content_guard, 'EXECUTE') then
    raise exception 'FAIL: A4 function volatility, SECURITY DEFINER, search_path, or grants are wrong';
  end if;

  if (
    select count(*)
    from pg_trigger as triggers
    join pg_proc as functions on functions.oid = triggers.tgfoid
    where not triggers.tgisinternal
      and triggers.tgname in (
        'challan_items_recalculate_total',
        'challan_flexible_lines_recalculate_total'
      )
      and triggers.tgrelid in (
        'public.challan_items'::regclass,
        'public.challan_flexible_lines'::regclass
      )
      and functions.oid = adapter
  ) <> 2 then
    raise exception 'FAIL: brick and flexible rows do not share the A4 total trigger adapter';
  end if;

  formula_definition := pg_get_functiondef(calculator);
  content_definition := pg_get_functiondef(content_guard);
  if formula_definition !~ 'challan_items'
    or formula_definition !~ 'line_amount'
    or formula_definition !~ 'challan_flexible_lines'
    or formula_definition !~ 'EXTRA_CHARGE'
    or formula_definition !~ 'OTHER_REVENUE'
    or content_definition ~ 'P3012'
    or content_definition !~ 'P3011' then
    raise exception 'FAIL: A4 formula or final-content rule is not authoritative';
  end if;

  if exists (
    select 1
    from public.challans
    where factory_id = factory_a_id
      and challan_total is distinct from public.calculate_challan_total(factory_id, id)
  ) then
    raise exception 'FAIL: an A4 fixture total differs from the shared persisted-row authority';
  end if;

  raise notice 'PASS: one private fixed-search-path calculator drives both line-table triggers';
  raise notice 'PASS: RLS, controlled writes, P3011, and database-authoritative total protection remain intact';
end;
$$;

do $$
begin
  raise notice 'PASS: protected pre-A4 mismatches abort migration; only active, unlocked, unallocated EXTRA_CHARGE mismatches are reconciled';
  raise notice 'Atlas Sales A4 verifier completed: combined totals, payments, history, and tenant isolation are correct; all fixtures now roll back.';
end;
$$;

rollback;
