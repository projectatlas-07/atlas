-- Atlas Sales correction A2 verifier.
-- Run after 20260831000027_create_challan_flexible_line_foundation.sql.
-- Requires one existing factory_users row. All fixtures and metadata probes roll back.

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
  challan_b_id uuid := gen_random_uuid();
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
      factory_a_id, format('Sales A2 Factory A %s', factory_a_id),
      'A2 brick manufacturer', 'Village A', 'Post A', 'Police A',
      'District A', 'State A', 'Legacy address A', '9000000001'
    ),
    (
      factory_b_id, format('Sales A2 Factory B %s', factory_b_id),
      'Other tenant', 'Village B', 'Post B', 'Police B',
      'District B', 'State B', 'Legacy address B', '9000000002'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'A2 Customer A', 'Customer address A', '9111111111'),
    (customer_b_id, factory_b_id, 'A2 Customer B', 'Customer address B', '9222222222');

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'A2 Brick A'),
    (brick_b_id, factory_b_id, 'A2 Brick B');

  -- A Factory B row proves RLS and parent/factory identity checks without using its RPC.
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    company_village_snapshot, company_post_office_snapshot,
    company_police_station_snapshot, company_district_snapshot,
    company_state_snapshot, vehicle_number, tractor_labour_rate_snapshot
  ) values (
    challan_b_id, factory_b_id, 9001, date '2026-08-31', customer_b_id,
    'A2 Customer B', 'Customer address B', '9222222222',
    'Sales A2 Factory B', 'Other tenant', 'Legacy address B', '9000000002',
    'Village B', 'Post B', 'Police B', 'District B', 'State B', 'RJ14A20002', 0
  );

  insert into public.challan_flexible_lines(
    factory_id, challan_id, line_type, line_category,
    order_index, particulars, amount
  ) values (
    factory_b_id, challan_b_id, 'NOTE', 'NON_FINANCIAL',
    0, 'Factory B private note', 0
  );

  perform set_config('atlas_a2.mapping_id', mapping_id::text, true);
  perform set_config('atlas_a2.user_id', test_user_id::text, true);
  perform set_config('atlas_a2.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_a2.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_a2.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_a2.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_a2.challan_b_id', challan_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a2.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a2.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a2.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a2.customer_a_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a2.brick_a_id')::uuid;
  challan_b_id uuid := current_setting('atlas_a2.challan_b_id')::uuid;
  legacy_flow_challan public.challans%rowtype;
  flexible_challan public.challans%rowtype;
  void_challan_row public.challans%rowtype;
  payment_state record;
  original_flexible_count bigint;
begin
  -- The original six-argument RPC remains callable and creates no artificial rows.
  select * into legacy_flow_challan
  from public.create_challan(
    factory_a_id,
    date '2026-08-31',
    customer_a_id,
    ' rj 14 a2 0001 ',
    450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1500, 'rate', 2000)
    )
  );

  if legacy_flow_challan.challan_number <> 1
    or legacy_flow_challan.challan_total <> 3000
    or exists (
      select 1 from public.challan_flexible_lines
      where challan_id = legacy_flow_challan.id
    ) then
    raise exception 'FAIL: existing create_challan flow changed or backfilled flexible rows';
  end if;
  raise notice 'PASS: existing create_challan flows without flexible lines still work and historical zero-line behavior is unchanged';

  -- A NOTE, direct amount, and calculated amount are saved in one atomic create.
  select * into flexible_challan
  from public.create_challan(
    factory_a_id,
    date '2026-09-01',
    customer_a_id,
    'RJ14A20002',
    500,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1500, 'rate', 2000)
    ),
    jsonb_build_array(
      jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0,
        'particulars', '  Deliver   before noon  '
      ),
      jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 1,
        'particulars', 'Loading charge', 'amount', 2000
      ),
      jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 2,
        'particulars', 'Handling charge', 'quantity', 2.5, 'rate', 400
      )
    )
  );

  if flexible_challan.challan_number <> 2
    or flexible_challan.challan_total <> 3000
    or flexible_challan.company_village_snapshot <> 'Village A'
    or flexible_challan.company_state_snapshot <> 'State A'
    or (select count(*) from public.challan_flexible_lines
        where challan_id = flexible_challan.id) <> 3 then
    raise exception 'FAIL: flexible-line create changed numbering, A1 snapshots, brick totals, or row count';
  end if;

  if not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = flexible_challan.id
        and line_type = 'NOTE'
        and line_category = 'NON_FINANCIAL'
        and order_index = 0
        and particulars = 'Deliver before noon'
        and quantity is null and rate is null and amount = 0
    )
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = flexible_challan.id
        and line_type = 'EXTRA_CHARGE'
        and line_category = 'OTHER_REVENUE'
        and order_index = 1
        and quantity is null and rate is null and amount = 2000
    )
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = flexible_challan.id
        and line_type = 'EXTRA_CHARGE'
        and line_category = 'OTHER_REVENUE'
        and order_index = 2
        and quantity = 2.5 and rate = 400 and amount = 1000
    ) then
    raise exception 'FAIL: NOTE or EXTRA_CHARGE semantics, categories, ordering, normalization, or authoritative math are wrong';
  end if;
  raise notice 'PASS: NOTE and both EXTRA_CHARGE modes store exact categories, deterministic order, and authoritative per-line amounts';

  -- The A2 overload replaces the whole collection, matching existing brick-item edits.
  select * into flexible_challan
  from public.update_challan(
    factory_a_id,
    flexible_challan.id,
    date '2026-09-01',
    customer_a_id,
    'RJ14A20002',
    500,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1500, 'rate', 2000)
    ),
    jsonb_build_array(
      jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Updated loading charge', 'amount', 750
      ),
      jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 3,
        'particulars', 'Updated delivery note'
      )
    )
  );
  if flexible_challan.challan_total <> 3000
    or (select count(*) from public.challan_flexible_lines
        where challan_id = flexible_challan.id) <> 2
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = flexible_challan.id
        and order_index = 0
        and particulars = 'Updated loading charge'
        and amount = 750
    )
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = flexible_challan.id
        and order_index = 3
        and particulars = 'Updated delivery note'
        and amount = 0
    ) then
    raise exception 'FAIL: A2 update did not atomically replace, edit, and remove flexible lines';
  end if;
  raise notice 'PASS: before payment lock flexible lines can be edited and removed by atomic collection replacement';

  -- Existing brick-only update signature must leave the new collection alone.
  select count(*) into original_flexible_count
  from public.challan_flexible_lines
  where challan_id = flexible_challan.id;

  select * into flexible_challan
  from public.update_challan(
    factory_a_id,
    flexible_challan.id,
    date '2026-09-02',
    customer_a_id,
    'RJ14A20002',
    550,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000)
    )
  );

  if flexible_challan.challan_total <> 4000
    or (select count(*) from public.challan_flexible_lines
        where challan_id = flexible_challan.id) <> original_flexible_count then
    raise exception 'FAIL: existing update_challan flow changed flexible rows or brick total behavior';
  end if;
  raise notice 'PASS: existing update_challan flows without flexible lines preserve the collection and retain brick-only totals';

  -- NULL from the A2 update overload is also the explicit backward-compatible preserve signal.
  perform public.update_challan(
    factory_a_id,
    flexible_challan.id,
    date '2026-09-03',
    customer_a_id,
    'RJ14A20002',
    550,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000)
    ),
    null
  );
  if (select count(*) from public.challan_flexible_lines
      where challan_id = flexible_challan.id) <> original_flexible_count then
    raise exception 'FAIL: NULL A2 update did not preserve flexible lines';
  end if;
  raise notice 'PASS: omitted A2 update collection preserves existing flexible lines';

  -- Every invalid replacement is one failed statement, so its brick and flexible changes roll back atomically.
  perform pg_temp.expect_error(
    'NOTE cannot contain a financial amount',
    '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan.id, '2026-09-03', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', 'Bad note', 'amount', 500
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'NOTE requires meaningful particulars',
    '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan.id, '2026-09-03', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', '   '
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'contradictory quantity rate and amount are rejected',
    '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan.id, '2026-09-03', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 0, 'particulars', 'Bad math',
        'quantity', 2, 'rate', 400, 'amount', 900
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'incomplete quantity and rate combinations are rejected',
    '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan.id, '2026-09-03', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 0, 'particulars', 'Incomplete',
        'quantity', 2, 'amount', 800
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'negative order_index is rejected',
    '22023',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan.id, '2026-09-03', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', -1, 'particulars', 'Bad order'
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'duplicate order_index within one Challan is rejected',
    '23505',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan.id, '2026-09-03', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(
        jsonb_build_object('line_type', 'NOTE', 'order_index', 0, 'particulars', 'First'),
        jsonb_build_object('line_type', 'NOTE', 'order_index', 0, 'particulars', 'Second')
      )::text
    )
  );

  if flexible_challan.challan_total <> (
      select challan_total from public.challans where id = flexible_challan.id
    )
    or (select count(*) from public.challan_flexible_lines
        where challan_id = flexible_challan.id) <> original_flexible_count then
    raise exception 'FAIL: an invalid atomic replacement partially changed the Challan';
  end if;
  raise notice 'PASS: invalid flexible line sets reject atomically without partial brick or flexible writes';

  -- The existing payment source of truth remains the brick-only challan_total.
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, flexible_challan.id);
  if payment_state.sale_total <> 4000
    or payment_state.total_paid <> 0
    or payment_state.outstanding_amount <> 4000
    or payment_state.payment_state <> 'unpaid' then
    raise exception 'FAIL: A2 changed customer payment or outstanding behavior';
  end if;
  raise notice 'PASS: existing Challan total, payment, outstanding, and Sales Register source values remain brick-only in A2';

  if exists (
    select 1 from public.challan_flexible_lines
    where factory_id = factory_b_id or challan_id = challan_b_id
  ) then
    raise exception 'FAIL: Factory A can read Factory B flexible lines';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot invoke a write for Factory B Challan',
    '42501',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_b_id, challan_b_id, '2026-09-03', customer_a_id, 'RJ14A20003',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 1, 'particulars', 'Forbidden'
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'authenticated clients cannot call the private flexible-line helper',
    '42501',
    format(
      'select public.replace_challan_flexible_lines(%L::uuid, %L::uuid, %L::jsonb)',
      factory_a_id, flexible_challan.id, '[]'
    )
  );
  perform pg_temp.expect_error(
    'authenticated clients cannot write flexible-line tables directly',
    '42501',
    format(
      'insert into public.challan_flexible_lines(factory_id, challan_id, line_type, line_category, order_index, particulars, amount) values (%L::uuid, %L::uuid, %L, %L, 99, %L, 0)',
      factory_a_id, flexible_challan.id, 'NOTE', 'NON_FINANCIAL', 'Forbidden direct write'
    )
  );
  raise notice 'PASS: flexible-line RLS, RPC authorization, and controlled writes isolate factories';

  -- A third normal create proves numbering remains sequential, then the old void flow remains intact.
  select * into void_challan_row
  from public.create_challan(
    factory_a_id,
    date '2026-09-04',
    customer_a_id,
    'RJ14A20003',
    0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2000)
    )
  );
  select * into void_challan_row
  from public.void_challan(factory_a_id, void_challan_row.id);
  if void_challan_row.challan_number <> 3
    or void_challan_row.status <> 'void'
    or void_challan_row.voided_at is null
    or void_challan_row.company_village_snapshot <> 'Village A' then
    raise exception 'FAIL: numbering, void, or company snapshot behavior changed';
  end if;
  raise notice 'PASS: existing numbering, void, and immutable A1 company snapshot behavior remains unchanged';

  perform set_config('atlas_a2.flexible_challan_id', flexible_challan.id::text, true);
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_a2.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a2.factory_b_id')::uuid;
  flexible_challan_id uuid := current_setting('atlas_a2.flexible_challan_id')::uuid;
  challan_b_id uuid := current_setting('atlas_a2.challan_b_id')::uuid;
  flexible_line_id uuid;
begin
  select id into flexible_line_id
  from public.challan_flexible_lines
  where challan_id = flexible_challan_id
  order by order_index
  limit 1;

  perform pg_temp.expect_error(
    'factory_id cannot disagree with the parent Challan',
    'P3003',
    format(
      'insert into public.challan_flexible_lines(factory_id, challan_id, line_type, line_category, order_index, particulars, amount) values (%L::uuid, %L::uuid, %L, %L, 10, %L, 0)',
      factory_a_id, challan_b_id, 'NOTE', 'NON_FINANCIAL', 'Cross-factory parent'
    )
  );

  update public.challans
  set is_locked = true
  where id = flexible_challan_id and factory_id = factory_a_id;

  perform pg_temp.expect_error(
    'privileged direct flexible-line update cannot bypass payment lock',
    'P3005',
    format(
      'update public.challan_flexible_lines set particulars = %L where id = %L::uuid',
      'Changed after lock', flexible_line_id
    )
  );
  perform pg_temp.expect_error(
    'privileged direct flexible-line delete cannot bypass payment lock',
    'P3005',
    format(
      'delete from public.challan_flexible_lines where id = %L::uuid',
      flexible_line_id
    )
  );
  raise notice 'PASS: parent composite identity and trigger-level payment-lock protections cannot be bypassed';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a2.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a2.factory_a_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a2.customer_a_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a2.brick_a_id')::uuid;
  flexible_challan_id uuid := current_setting('atlas_a2.flexible_challan_id')::uuid;
begin
  perform pg_temp.expect_error(
    'normal edit flow cannot replace flexible lines after payment lock',
    'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 550, %L::jsonb, %L::jsonb)',
      factory_a_id, flexible_challan_id, '2026-09-05', customer_a_id, 'RJ14A20002',
      jsonb_build_array(jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', 'Locked change'
      ))::text
    )
  );
  raise notice 'PASS: flexible lines are immutable through normal edit flows after payment lock';
end;
$$;

reset role;

do $$
declare
  flexible_table oid := 'public.challan_flexible_lines'::regclass;
  create_old oid := to_regprocedure('public.create_challan(uuid,date,uuid,text,numeric,jsonb)');
  create_new oid := to_regprocedure('public.create_challan(uuid,date,uuid,text,numeric,jsonb,jsonb)');
  update_old oid := to_regprocedure('public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb)');
  update_new oid := to_regprocedure('public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb,jsonb)');
  helper oid := to_regprocedure('public.replace_challan_flexible_lines(uuid,uuid,jsonb)');
begin
  if create_old is null or create_new is null or update_old is null or update_new is null
    or helper is null then
    raise exception 'FAIL: original or A2 RPC signatures are missing';
  end if;

  if not exists (
      select 1 from pg_class where oid = flexible_table and relrowsecurity
    )
    or not has_table_privilege('authenticated', flexible_table, 'SELECT')
    or has_table_privilege('authenticated', flexible_table, 'INSERT')
    or has_table_privilege('authenticated', flexible_table, 'UPDATE')
    or has_table_privilege('authenticated', flexible_table, 'DELETE')
    or not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'challan_flexible_lines'
        and policyname = 'Authenticated users can read their factory Sales Challan flexible lines'
        and cmd = 'SELECT'
    ) then
    raise exception 'FAIL: flexible-line RLS or table grants are not locked down';
  end if;

  if exists (
      select 1 from pg_proc
      where oid in (create_new, update_new, helper)
        and (
          not prosecdef
          or coalesce(array_to_string(proconfig, ','), '')
            not like '%search_path=pg_catalog, public%'
        )
    )
    or has_function_privilege('anon', helper, 'EXECUTE')
    or has_function_privilege('authenticated', helper, 'EXECUTE')
    or has_function_privilege('anon', create_new, 'EXECUTE')
    or has_function_privilege('anon', update_new, 'EXECUTE')
    or not has_function_privilege('authenticated', create_new, 'EXECUTE')
    or not has_function_privilege('authenticated', update_new, 'EXECUTE') then
    raise exception 'FAIL: A2 function security, search_path, or grants are wrong';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = flexible_table
      and not t.tgisinternal
      and p.proname = 'recalculate_challan_total'
  ) then
    raise exception 'FAIL: flexible lines were connected to challan_total before A4';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = flexible_table
      and not t.tgisinternal
      and p.proname = 'guard_challan_flexible_line_mutation'
  ) then
    raise exception 'FAIL: flexible-line lifecycle guard trigger is missing';
  end if;

  raise notice 'PASS: A2 schema, RLS, controlled RPCs, fixed search_path, grants, and deliberate A4 total boundary are correct';
end;
$$;

do $$
begin
  raise notice 'Atlas Sales A2 flexible-line verifier completed: NOTE and EXTRA_CHARGE foundation is ready; A3/A4/A5 remain unimplemented.';
end;
$$;

rollback;
