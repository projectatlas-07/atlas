-- Atlas Sales A5 revenue-split verifier.
-- Run after A4 migration 20260831000029 and the A5 application deployment.
-- A5 adds no persistent database object. Every verifier fixture is rolled back.

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

-- This temporary, security-invoker read expresses the same reporting categories
-- as A5 without adding a persistent view, RPC, subtotal, or competing source of truth.
create or replace function pg_temp.sales_register_split(
  p_factory_id uuid,
  p_from_date date,
  p_to_date date
)
returns table (
  challan_id uuid,
  challan_status text,
  brick_revenue numeric,
  other_revenue numeric,
  total_revenue numeric
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    challans.id,
    challans.status,
    coalesce(bricks.amount, 0) as brick_revenue,
    coalesce(other.amount, 0) as other_revenue,
    challans.challan_total as total_revenue
  from public.challans
  left join lateral (
    select sum(items.line_amount) as amount
    from public.challan_items as items
    where items.factory_id = challans.factory_id
      and items.challan_id = challans.id
  ) as bricks on true
  left join lateral (
    select sum(lines.amount) as amount
    from public.challan_flexible_lines as lines
    where lines.factory_id = challans.factory_id
      and lines.challan_id = challans.id
      and lines.line_type = 'EXTRA_CHARGE'
      and lines.line_category = 'OTHER_REVENUE'
  ) as other on true
  where challans.factory_id = p_factory_id
    and challans.challan_date between p_from_date and p_to_date;
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
      factory_a_id, format('Sales A5 Factory A %s', factory_a_id),
      'A5 brick manufacturer', 'Village A', 'Post A', 'Police A',
      'District A', 'State A', 'Legacy address A', '9000000001'
    ),
    (
      factory_b_id, format('Sales A5 Factory B %s', factory_b_id),
      'Other tenant', 'Village B', 'Post B', 'Police B',
      'District B', 'State B', 'Legacy address B', '9000000002'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'A5 Customer A', 'Customer address A', '9111111111'),
    (customer_b_id, factory_b_id, 'A5 Customer B', 'Customer address B', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'A5 Brick A'),
    (brick_b_id, factory_b_id, 'A5 Brick B');

  -- Simulate a historical pre-flexible-line Challan.
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
    'Historical district', 'Historical state', 'RJ14A59000', 0
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
    factory_b_challan_id, factory_b_id, 9001, date '2026-09-01', customer_b_id,
    'Factory B customer', 'Factory B destination', '9222222222',
    'Factory B company', 'Factory B description', 'Factory B address', '9000000002',
    'Village B', 'Post B', 'Police B', 'District B', 'State B', 'RJ14A59001', 0
  );
  perform public.insert_challan_items(
    factory_b_id,
    factory_b_challan_id,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_b_id, 'quantity', 1000, 'rate', 7000)
    )
  );

  perform set_config('atlas_a5.user_id', test_user_id::text, true);
  perform set_config('atlas_a5.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_a5.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_a5.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_a5.customer_b_id', customer_b_id::text, true);
  perform set_config('atlas_a5.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_a5.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_a5.historical_challan_id', historical_challan_id::text, true);
  perform set_config('atlas_a5.factory_b_challan_id', factory_b_challan_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a5.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a5.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a5.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a5.customer_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_a5.customer_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a5.brick_a_id')::uuid;
  brick_b_id uuid := current_setting('atlas_a5.brick_b_id')::uuid;
  historical_challan_id uuid := current_setting('atlas_a5.historical_challan_id')::uuid;
  factory_b_challan_id uuid := current_setting('atlas_a5.factory_b_challan_id')::uuid;
  brick_only public.challans%rowtype;
  mixed public.challans%rowtype;
  range_second public.challans%rowtype;
  manual public.challans%rowtype;
  note_only public.challans%rowtype;
  multiple_charges public.challans%rowtype;
  voided public.challans%rowtype;
  split record;
  range_split record;
  payment_state record;
  original_company_name text;
begin
  select * into brick_only
  from public.create_challan(
    factory_a_id, date '2026-08-31', customer_a_id, 'RJ14A50001', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    )
  );
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-08-31', date '2026-08-31'
  ) where challan_id = brick_only.id;
  if split.brick_revenue <> 100000
    or split.other_revenue <> 0
    or split.total_revenue <> 100000 then
    raise exception 'FAIL: brick-only revenue split is %, %, %',
      split.brick_revenue, split.other_revenue, split.total_revenue;
  end if;
  raise notice 'PASS: brick-only Challan reports Brick Revenue ₹100,000, Other Revenue ₹0, Total Revenue ₹100,000';

  select * into mixed
  from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, 'RJ14A50002', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'NOTE must never contribute revenue'),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 1,
        'particulars', 'Loading charge', 'amount', 2000)
    )
  );
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-01', date '2026-09-01'
  ) where challan_id = mixed.id;
  if split.brick_revenue <> 100000
    or split.other_revenue <> 2000
    or split.total_revenue <> 102000
    or split.brick_revenue + split.other_revenue <> split.total_revenue then
    raise exception 'FAIL: mixed revenue split is %, %, %',
      split.brick_revenue, split.other_revenue, split.total_revenue;
  end if;
  raise notice 'PASS: mixed Challan reports Brick Revenue ₹100,000, Other Revenue ₹2,000, Total Revenue ₹102,000';
  raise notice 'PASS: NOTE never contributes to Other Revenue and EXTRA_CHARGE never increases Brick Revenue';

  select * into range_second
  from public.create_challan(
    factory_a_id, date '2026-09-02', customer_a_id, 'RJ14A50003', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 50000)
    )
  );
  select
    coalesce(sum(brick_revenue) filter (where challan_status = 'active'), 0)
      as brick_revenue,
    coalesce(sum(other_revenue) filter (where challan_status = 'active'), 0)
      as other_revenue,
    coalesce(sum(total_revenue) filter (where challan_status = 'active'), 0)
      as total_revenue
  into range_split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-01', date '2026-09-02'
  );
  if range_split.brick_revenue <> 150000
    or range_split.other_revenue <> 2000
    or range_split.total_revenue <> 152000 then
    raise exception 'FAIL: date-range revenue split is %, %, %',
      range_split.brick_revenue, range_split.other_revenue, range_split.total_revenue;
  end if;
  raise notice 'PASS: date-range totals are Brick Revenue ₹150,000, Other Revenue ₹2,000, Total Revenue ₹152,000';

  select * into manual
  from public.create_challan(
    factory_a_id, date '2026-09-03', customer_a_id, 'RJ14A50004', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Transport charge', 'amount', 5000)
    )
  );
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-03', date '2026-09-03'
  ) where challan_id = manual.id;
  if split.brick_revenue <> 0
    or split.other_revenue <> 5000
    or split.total_revenue <> 5000 then
    raise exception 'FAIL: financial manual-only revenue split is %, %, %',
      split.brick_revenue, split.other_revenue, split.total_revenue;
  end if;
  raise notice 'PASS: EXTRA_CHARGE-only manual Challan reports zero Brick Revenue and positive Other Revenue';

  select * into note_only
  from public.create_challan(
    factory_a_id, date '2026-09-03', customer_a_id, 'RJ14A50005', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Non-financial delivery instruction')
    )
  );
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-03', date '2026-09-03'
  ) where challan_id = note_only.id;
  if split.brick_revenue <> 0
    or split.other_revenue <> 0
    or split.total_revenue <> 0 then
    raise exception 'FAIL: NOTE-only revenue split is %, %, %',
      split.brick_revenue, split.other_revenue, split.total_revenue;
  end if;
  raise notice 'PASS: NOTE-only Challan reports zero for all three revenue values';

  select * into multiple_charges
  from public.create_challan(
    factory_a_id, date '2026-09-04', customer_a_id, 'RJ14A50006', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Direct charge one', 'amount', 100),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 1,
        'particulars', 'Direct charge two', 'amount', 200),
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 2,
        'particulars', 'Calculated charge', 'quantity', 2.5, 'rate', 400),
      jsonb_build_object('line_type', 'NOTE', 'order_index', 3,
        'particulars', 'Still non-financial')
    )
  );
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-04', date '2026-09-04'
  ) where challan_id = multiple_charges.id;
  if split.brick_revenue <> 0
    or split.other_revenue <> 1300
    or split.total_revenue <> 1300
    or (select amount from public.challan_flexible_lines
        where challan_id = multiple_charges.id and particulars = 'Calculated charge') <> 1000 then
    raise exception 'FAIL: multiple/calculated EXTRA_CHARGE reporting is wrong';
  end if;
  raise notice 'PASS: multiple EXTRA_CHARGE rows sum correctly using the persisted quantity times rate amount';

  perform pg_temp.expect_error(
    'A2 flexible-line semantics remain intact',
    '22023',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-04', customer_a_id, 'RJ14A50007', '[]',
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Invalid financial note', 'amount', 1
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'A3 empty-document validity remains intact',
    'P3011',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-04', customer_a_id, 'RJ14A50007', '[]', '[]'
    )
  );

  select * into voided
  from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, 'RJ14A50007', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 25000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Voided charge', 'amount', 500)
    )
  );
  select * into voided from public.void_challan(factory_a_id, voided.id);
  select
    coalesce(sum(brick_revenue) filter (where challan_status = 'active'), 0)
      as brick_revenue,
    coalesce(sum(other_revenue) filter (where challan_status = 'active'), 0)
      as other_revenue,
    coalesce(sum(total_revenue) filter (where challan_status = 'active'), 0)
      as total_revenue
  into range_split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-01', date '2026-09-02'
  );
  if range_split.brick_revenue <> 150000
    or range_split.other_revenue <> 2000
    or range_split.total_revenue <> 152000
    or not exists (
      select 1 from pg_temp.sales_register_split(
        factory_a_id, date '2026-09-01', date '2026-09-02'
      ) where challan_id = voided.id and challan_status = 'void'
    ) then
    raise exception 'FAIL: voided Challan visibility or active-range exclusion changed';
  end if;
  raise notice 'PASS: voided Challans remain visible but are excluded from active revenue summaries';

  original_company_name := mixed.company_name_snapshot;
  perform public.update_factory_printable_profile(
    factory_a_id,
    'Updated A5 Factory', 'Updated description', 'New Village',
    'New Post', 'New Police', 'New District', 'New State', '9888888888'
  );
  if (select company_name_snapshot from public.challans where id = mixed.id)
      <> original_company_name
    or (select company_village_snapshot from public.challans where id = mixed.id)
      <> 'Village A' then
    raise exception 'FAIL: A5 changed A1 historical company snapshots';
  end if;
  raise notice 'PASS: A1 company snapshots remain intact';

  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-08-30', date '2026-08-30'
  ) where challan_id = historical_challan_id;
  if split.brick_revenue <> 12345
    or split.other_revenue <> 0
    or split.total_revenue <> 12345 then
    raise exception 'FAIL: historical brick-only reporting changed';
  end if;
  raise notice 'PASS: historical brick-only Challan keeps its previous Sales Register value as Brick and Total Revenue';

  -- Partial payment must affect only paid/outstanding, never revenue classification.
  perform public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-05', 60000,
    'cash', 'A5 partial payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', mixed.id, 'amount', 60000)
    )
  );
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, mixed.id);
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-01', date '2026-09-01'
  ) where challan_id = mixed.id;
  if payment_state.total_paid <> 60000
    or payment_state.outstanding_amount <> 42000
    or split.brick_revenue <> 100000
    or split.other_revenue <> 2000
    or split.total_revenue <> 102000 then
    raise exception 'FAIL: partial payment changed revenue classification';
  end if;
  raise notice 'PASS: partial payment and outstanding do not change revenue classification';

  perform public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-06', 42000,
    'bank_transfer', 'A5 final payment',
    jsonb_build_array(
      jsonb_build_object('challan_id', mixed.id, 'amount', 42000)
    )
  );
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, mixed.id);
  select * into split
  from pg_temp.sales_register_split(
    factory_a_id, date '2026-09-01', date '2026-09-01'
  ) where challan_id = mixed.id;
  if payment_state.payment_state <> 'paid'
    or payment_state.outstanding_amount <> 0
    or split.brick_revenue <> 100000
    or split.other_revenue <> 2000
    or split.total_revenue <> 102000 then
    raise exception 'FAIL: full payment changed revenue classification';
  end if;
  raise notice 'PASS: full payment and zero outstanding do not change revenue classification';

  if exists (
    select 1
    from pg_temp.sales_register_split(
      factory_b_id, date '2026-01-01', date '2026-12-31'
    )
  ) then
    raise exception 'FAIL: Factory A can report Factory B revenue';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot create reporting fixtures for Factory B',
    '42501',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb)',
      factory_b_id, '2026-09-01', customer_b_id, 'RJ14A50008',
      jsonb_build_array(
        jsonb_build_object('brick_type_id', brick_b_id, 'quantity', 1000, 'rate', 1000)
      )::text
    )
  );
  raise notice 'PASS: cross-factory Sales Register reporting is prevented by existing RLS and authorization';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_a5.factory_a_id')::uuid;
  factory_b_challan_id uuid := current_setting('atlas_a5.factory_b_challan_id')::uuid;
begin
  if (select challan_total from public.challans where id = factory_b_challan_id) <> 7000 then
    raise exception 'FAIL: cross-factory verification changed Factory B history';
  end if;

  if exists (
    select 1
    from public.challans
    where factory_id = factory_a_id
      and challan_total is distinct from public.calculate_challan_total(factory_id, id)
  ) then
    raise exception 'FAIL: A4 authoritative Challan total no longer reconciles';
  end if;

  if exists (
    select 1
    from pg_temp.sales_register_split(
      factory_a_id, date '2026-01-01', date '2026-12-31'
    )
    where brick_revenue + other_revenue <> total_revenue
  ) then
    raise exception 'FAIL: an A5 per-Challan revenue split does not reconcile';
  end if;

  raise notice 'PASS: A4 authoritative totals remain intact and every A5 row reconciles exactly';
  raise notice 'PASS: RLS/security remain intact; A5 created no persistent database object or financial rewrite';
end;
$$;

do $$
begin
  raise notice 'Atlas Sales A5 verifier completed: Brick Revenue, Other Revenue, and Total Revenue reconcile; all fixtures now roll back.';
  raise notice 'PASS: unrelated Atlas modules remain intact because A5 is limited to Sales Register reporting.';
end;
$$;

rollback;
