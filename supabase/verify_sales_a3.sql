-- Atlas Sales correction A3 verifier.
-- Run after 20260831000028_enforce_challan_document_content.sql.
-- Requires one existing factory_users row. Every fixture is rolled back.

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
  legacy_challan_id uuid := gen_random_uuid();
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
      factory_a_id, format('Sales A3 Factory A %s', factory_a_id),
      'A3 brick manufacturer', 'Village A', 'Post A', 'Police A',
      'District A', 'State A', 'Legacy address A', '9000000001'
    ),
    (
      factory_b_id, format('Sales A3 Factory B %s', factory_b_id),
      'Other tenant', 'Village B', 'Post B', 'Police B',
      'District B', 'State B', 'Legacy address B', '9000000002'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'A3 Customer A', 'Customer address A', '9111111111'),
    (customer_b_id, factory_b_id, 'A3 Customer B', 'Customer address B', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'A3 Brick A'),
    (brick_b_id, factory_b_id, 'A3 Brick B');

  -- This models a pre-A1 Challan: its structured company snapshots remain NULL.
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    vehicle_number, tractor_labour_rate_snapshot
  ) values (
    legacy_challan_id, factory_a_id, 9000, date '2026-08-01', customer_a_id,
    'Historical customer', 'Historical destination', '9333333333',
    'Historical company', 'Historical description',
    'Historical company address', '9444444444', 'RJ14A39000', 0
  );
  perform public.insert_challan_items(
    factory_a_id,
    legacy_challan_id,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000)
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
    'Village B', 'Post B', 'Police B', 'District B', 'State B', 'RJ14A39001', 0
  );
  insert into public.challan_flexible_lines(
    factory_id, challan_id, line_type, line_category,
    order_index, particulars, amount
  ) values (
    factory_b_id, factory_b_challan_id, 'NOTE', 'NON_FINANCIAL',
    0, 'Factory B private note', 0
  );

  perform set_config('atlas_a3.user_id', test_user_id::text, true);
  perform set_config('atlas_a3.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_a3.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_a3.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_a3.customer_b_id', customer_b_id::text, true);
  perform set_config('atlas_a3.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_a3.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_a3.legacy_challan_id', legacy_challan_id::text, true);
  perform set_config('atlas_a3.factory_b_challan_id', factory_b_challan_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a3.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a3.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a3.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a3.customer_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_a3.customer_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a3.brick_a_id')::uuid;
  brick_b_id uuid := current_setting('atlas_a3.brick_b_id')::uuid;
  legacy_challan_id uuid := current_setting('atlas_a3.legacy_challan_id')::uuid;
  factory_b_challan_id uuid := current_setting('atlas_a3.factory_b_challan_id')::uuid;
  brick_only public.challans%rowtype;
  brick_note public.challans%rowtype;
  brick_extra public.challans%rowtype;
  note_only public.challans%rowtype;
  final_numbered public.challans%rowtype;
  payment_state record;
begin
  -- Existing clients still use the original six-argument brick-only signature.
  select * into brick_only
  from public.create_challan(
    factory_a_id, date '2026-08-31', customer_a_id, 'RJ14A30001', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1500, 'rate', 2000)
    )
  );
  if brick_only.challan_number <> 1
    or brick_only.challan_total <> 3000
    or (select count(*) from public.challan_items where challan_id = brick_only.id) <> 1
    or exists (select 1 from public.challan_flexible_lines where challan_id = brick_only.id) then
    raise exception 'FAIL: brick-only create changed';
  end if;
  raise notice 'PASS: brick-only Challan still creates through the backward-compatible RPC';

  select * into brick_note
  from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, 'RJ14A30002', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Brick plus delivery note')
    )
  );
  if brick_note.challan_number <> 2
    or brick_note.challan_total <> 2000
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = brick_note.id and line_type = 'NOTE' and amount = 0
    ) then
    raise exception 'FAIL: brick plus NOTE create changed';
  end if;
  raise notice 'PASS: brick plus NOTE creates with unchanged brick-only total';

  select * into brick_extra
  from public.create_challan(
    factory_a_id, date '2026-09-02', customer_a_id, 'RJ14A30003', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Loading charge', 'amount', 750)
    )
  );
  if brick_extra.challan_number <> 3
    or brick_extra.challan_total <> 2000
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = brick_extra.id
        and line_type = 'EXTRA_CHARGE'
        and line_category = 'OTHER_REVENUE'
        and amount = 750
    ) then
    raise exception 'FAIL: brick plus EXTRA_CHARGE create or A2 semantics changed';
  end if;
  raise notice 'PASS: brick plus EXTRA_CHARGE creates while challan_total remains brick-only';

  select * into note_only
  from public.create_challan(
    factory_a_id, date '2026-09-03', customer_a_id, 'RJ14A30004', 0,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'Customer requested delivery postponement')
    )
  );
  if note_only.challan_number <> 4
    or note_only.challan_total <> 0
    or exists (select 1 from public.challan_items where challan_id = note_only.id)
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = note_only.id
        and line_type = 'NOTE'
        and line_category = 'NON_FINANCIAL'
        and amount = 0
    )
    or note_only.company_village_snapshot <> 'Village A'
    or note_only.company_state_snapshot <> 'State A' then
    raise exception 'FAIL: meaningful NOTE-only create or A1 snapshot changed';
  end if;
  raise notice 'PASS: meaningful NOTE-only Challan creates with zero total and complete A1 company snapshots';

  perform pg_temp.expect_error(
    'completely empty Challan is rejected',
    'P3011',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-04', customer_a_id, 'RJ14A30005', '[]', '[]'
    )
  );
  perform pg_temp.expect_error(
    'EXTRA_CHARGE-only Challan is temporarily rejected until A4',
    'P3012',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-04', customer_a_id, 'RJ14A30005', '[]',
      jsonb_build_array(jsonb_build_object(
        'line_type', 'EXTRA_CHARGE', 'order_index', 0,
        'particulars', 'Unsafe pre-A4 charge', 'amount', 500
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'NOTE plus EXTRA_CHARGE without bricks is temporarily rejected until A4',
    'P3012',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-04', customer_a_id, 'RJ14A30005', '[]',
      jsonb_build_array(
        jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
          'particulars', 'A note'),
        jsonb_build_object('line_type', 'EXTRA_CHARGE', 'order_index', 1,
          'particulars', 'Unsafe pre-A4 charge', 'amount', 500)
      )::text
    )
  );
  perform pg_temp.expect_error(
    'A2 NOTE financial rules remain intact',
    '22023',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-04', customer_a_id, 'RJ14A30005',
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2000
      ))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', 'Bad note', 'amount', 500
      ))::text
    )
  );
  raise notice 'PASS: blank, unsafe financial-manual, and invalid A2 line content are rejected atomically';

  -- Omitted flexible lines preserve the NOTE. The final persisted state is NOTE-only.
  select * into brick_note
  from public.update_challan(
    factory_a_id, brick_note.id, date '2026-09-05', customer_a_id,
    'RJ14A30002', 450, '[]'::jsonb
  );
  if brick_note.challan_total <> 0
    or exists (select 1 from public.challan_items where challan_id = brick_note.id)
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = brick_note.id and line_type = 'NOTE'
    ) then
    raise exception 'FAIL: brick plus NOTE did not transition to NOTE-only';
  end if;
  raise notice 'PASS: omitted flexible-lines update preserves NOTE and allows brick plus NOTE to become NOTE-only';

  perform pg_temp.expect_error(
    'brick-only cannot transition to empty with explicit empty flexible lines',
    'P3011',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 450, %L::jsonb, %L::jsonb)',
      factory_a_id, brick_only.id, '2026-09-05', customer_a_id, 'RJ14A30001', '[]', '[]'
    )
  );
  perform pg_temp.expect_error(
    'omitted flexible lines cannot leave an EXTRA_CHARGE-only final state before A4',
    'P3012',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 450, %L::jsonb)',
      factory_a_id, brick_extra.id, '2026-09-05', customer_a_id, 'RJ14A30003', '[]'
    )
  );
  perform pg_temp.expect_error(
    'NOTE-only Challan cannot remove its final NOTE',
    'P3011',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, note_only.id, '2026-09-05', customer_a_id, 'RJ14A30004', '[]', '[]'
    )
  );

  if (select count(*) from public.challan_items where challan_id = brick_only.id) <> 1
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = brick_extra.id and line_type = 'EXTRA_CHARGE'
    )
    or not exists (
      select 1 from public.challan_flexible_lines
      where challan_id = note_only.id and line_type = 'NOTE'
    ) then
    raise exception 'FAIL: rejected update partially changed final document state';
  end if;
  raise notice 'PASS: empty and pre-A4 financial-manual updates roll back every partial content change';

  -- Failed creates did not consume a permanent number.
  select * into final_numbered
  from public.create_challan(
    factory_a_id, date '2026-09-06', customer_a_id, 'RJ14A30005', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000)
    ),
    jsonb_build_array(
      jsonb_build_object('line_type', 'NOTE', 'order_index', 0,
        'particulars', 'This note will be explicitly cleared')
    )
  );
  if final_numbered.challan_number <> 5 then
    raise exception 'FAIL: failed A3 creates consumed or changed permanent numbering';
  end if;

  select * into final_numbered
  from public.update_challan(
    factory_a_id, final_numbered.id, date '2026-09-06', customer_a_id,
    'RJ14A30005', 450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000)
    ),
    '[]'::jsonb
  );
  if final_numbered.challan_total <> 1000
    or exists (
      select 1 from public.challan_flexible_lines where challan_id = final_numbered.id
    ) then
    raise exception 'FAIL: explicit empty flexible array did not clear lines while bricks remained';
  end if;
  raise notice 'PASS: explicit empty flexible array clears lines only when final brick content remains valid';

  -- Current profile changes must never rewrite NOTE-only A1 snapshots.
  perform public.update_factory_printable_profile(
    factory_a_id,
    'Updated A3 Factory', 'Updated current description', 'New Village',
    'New Post', 'New Police', 'New District', 'New State', '9888888888'
  );
  select * into note_only
  from public.update_challan(
    factory_a_id, note_only.id, date '2026-09-07', customer_a_id,
    'RJ14A30004', 0, '[]'::jsonb, null
  );
  if note_only.company_name_snapshot like 'Updated A3%'
    or note_only.company_village_snapshot <> 'Village A'
    or note_only.company_state_snapshot <> 'State A' then
    raise exception 'FAIL: NOTE-only update rewrote its A1 company snapshots';
  end if;
  raise notice 'PASS: NOTE-only edits preserve immutable A1 company snapshots';

  -- A real legacy row remains editable through the original signature.
  perform public.update_challan(
    factory_a_id, legacy_challan_id, date '2026-08-02', customer_a_id,
    'RJ14A39000', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 1000)
    )
  );
  if (select challan_total from public.challans where id = legacy_challan_id) <> 2000
    or (select company_village_snapshot from public.challans where id = legacy_challan_id) is not null
    or (select company_address_snapshot from public.challans where id = legacy_challan_id)
      <> 'Historical company address' then
    raise exception 'FAIL: legacy Challan history or original update flow changed';
  end if;
  raise notice 'PASS: existing legacy Challans retain historical snapshots and still use normal brick updates';

  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, brick_extra.id);
  if payment_state.sale_total <> 2000
    or payment_state.total_paid <> 0
    or payment_state.outstanding_amount <> 2000
    or payment_state.payment_state <> 'unpaid'
    or brick_extra.challan_total <> 2000 then
    raise exception 'FAIL: A3 changed payment, outstanding, or brick-only total behavior';
  end if;
  raise notice 'PASS: challan_total, payments, outstanding, and Sales Register source values remain brick-only';

  if exists (
    select 1 from public.challan_flexible_lines
    where factory_id = factory_b_id or challan_id = factory_b_challan_id
  ) then
    raise exception 'FAIL: Factory A can read Factory B flexible content';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot create a combined-content Challan for Factory B',
    '42501',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_b_id, '2026-09-07', customer_b_id, 'RJ14A30006',
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_b_id, 'quantity', 1000, 'rate', 1000
      ))::text,
      '[]'
    )
  );
  raise notice 'PASS: cross-factory RLS and combined-content RPC authorization remain intact';

  select * into final_numbered
  from public.void_challan(factory_a_id, final_numbered.id);
  if final_numbered.status <> 'void' or final_numbered.voided_at is null then
    raise exception 'FAIL: existing void behavior changed';
  end if;
  perform pg_temp.expect_error(
    'void Challan cannot change content',
    'P3006',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 450, %L::jsonb, %L::jsonb)',
      factory_a_id, final_numbered.id, '2026-09-08', customer_a_id, 'RJ14A30005',
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
      ))::text,
      '[]'
    )
  );
  raise notice 'PASS: existing void rules and permanent numbered-row lifecycle remain unchanged';

  perform set_config('atlas_a3.brick_extra_id', brick_extra.id::text, true);
  perform set_config('atlas_a3.note_only_id', note_only.id::text, true);
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_a3.factory_a_id')::uuid;
  brick_extra_id uuid := current_setting('atlas_a3.brick_extra_id')::uuid;
  note_only_id uuid := current_setting('atlas_a3.note_only_id')::uuid;
  flexible_line_id uuid;
begin
  select id into flexible_line_id
  from public.challan_flexible_lines
  where challan_id = brick_extra_id
  limit 1;

  update public.challans
  set is_locked = true
  where id in (brick_extra_id, note_only_id) and factory_id = factory_a_id;

  perform pg_temp.expect_error(
    'privileged flexible-line mutation cannot bypass payment lock',
    'P3005',
    format(
      'update public.challan_flexible_lines set particulars = %L where id = %L::uuid',
      'Forbidden locked edit', flexible_line_id
    )
  );
  perform pg_temp.expect_error(
    'privileged brick-line mutation cannot bypass payment lock',
    'P3005',
    format(
      'delete from public.challan_items where challan_id = %L::uuid',
      brick_extra_id
    )
  );
  raise notice 'PASS: trigger-level payment lock still protects brick and flexible content';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a3.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a3.factory_a_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a3.customer_a_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a3.brick_a_id')::uuid;
  brick_extra_id uuid := current_setting('atlas_a3.brick_extra_id')::uuid;
  note_only_id uuid := current_setting('atlas_a3.note_only_id')::uuid;
begin
  perform pg_temp.expect_error(
    'payment-locked Challan cannot change content type through normal RPC',
    'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 450, %L::jsonb, %L::jsonb)',
      factory_a_id, brick_extra_id, '2026-09-08', customer_a_id, 'RJ14A30003',
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2000
      ))::text,
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', 'Forbidden change'
      ))::text
    )
  );
  perform pg_temp.expect_error(
    'locked NOTE-only manual Challan cannot change its note content',
    'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, %L::jsonb, %L::jsonb)',
      factory_a_id, note_only_id, '2026-09-08', customer_a_id, 'RJ14A30004',
      '[]',
      jsonb_build_array(jsonb_build_object(
        'line_type', 'NOTE', 'order_index', 0, 'particulars', 'Forbidden manual change'
      ))::text
    )
  );
  raise notice 'PASS: payment-locked Challans remain immutable, including NOTE-only manual content, through A3 RPCs';
end;
$$;

reset role;

do $$
declare
  create_old oid := to_regprocedure('public.create_challan(uuid,date,uuid,text,numeric,jsonb)');
  create_combined oid := to_regprocedure('public.create_challan(uuid,date,uuid,text,numeric,jsonb,jsonb)');
  update_old oid := to_regprocedure('public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb)');
  update_combined oid := to_regprocedure('public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb,jsonb)');
  content_guard oid := to_regprocedure('public.assert_challan_final_content(uuid,uuid)');
  create_helper oid := to_regprocedure('public.create_challan_with_final_content(uuid,date,uuid,text,numeric,jsonb,jsonb)');
  update_helper oid := to_regprocedure('public.update_challan_with_final_content(uuid,uuid,date,uuid,text,numeric,jsonb,jsonb,boolean)');
begin
  if create_old is null or create_combined is null
    or update_old is null or update_combined is null
    or content_guard is null or create_helper is null or update_helper is null then
    raise exception 'FAIL: A3 public signatures or private final-content helpers are missing';
  end if;

  if exists (
      select 1 from pg_proc
      where oid in (
        create_old, create_combined, update_old, update_combined,
        content_guard, create_helper, update_helper
      )
        and (
          not prosecdef
          or coalesce(array_to_string(proconfig, ','), '')
            not like '%search_path=pg_catalog, public%'
        )
    )
    or has_function_privilege('anon', content_guard, 'EXECUTE')
    or has_function_privilege('authenticated', content_guard, 'EXECUTE')
    or has_function_privilege('anon', create_helper, 'EXECUTE')
    or has_function_privilege('authenticated', create_helper, 'EXECUTE')
    or has_function_privilege('anon', update_helper, 'EXECUTE')
    or has_function_privilege('authenticated', update_helper, 'EXECUTE')
    or not has_function_privilege('authenticated', create_old, 'EXECUTE')
    or not has_function_privilege('authenticated', create_combined, 'EXECUTE')
    or not has_function_privilege('authenticated', update_old, 'EXECUTE')
    or not has_function_privilege('authenticated', update_combined, 'EXECUTE') then
    raise exception 'FAIL: A3 SECURITY DEFINER, fixed search_path, or execute grants are wrong';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.challan_flexible_lines'::regclass
      and not t.tgisinternal
      and p.proname = 'recalculate_challan_total'
  ) then
    raise exception 'FAIL: A3 prematurely connected flexible amounts to challan_total';
  end if;

  raise notice 'PASS: A3 controlled RPCs, private helpers, fixed search_path, grants, and deliberate A4 boundary are correct';
end;
$$;

do $$
begin
  raise notice 'Atlas Sales A3 final-content verifier completed: NOTE-only is valid; financial manual-only remains blocked until A4.';
end;
$$;

rollback;
