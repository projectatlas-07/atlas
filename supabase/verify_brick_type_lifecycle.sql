-- Run against Test Atlas Clean after 20261002000070. All fixtures roll back.

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
  factory_b_brick_type_id uuid := gen_random_uuid();
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
    id, name, business_description, village, post_office,
    police_station, district, state, address, mobile
  ) values
    (
      factory_a_id, format('Brick Type verifier A %s', factory_a_id),
      'Brick maker', 'Village A', 'Post A', 'Police A', 'District A',
      'West Bengal', 'Verifier address A', '9000000001'
    ),
    (
      factory_b_id, format('Brick Type verifier B %s', factory_b_id),
      'Brick maker', 'Village B', 'Post B', 'Police B', 'District B',
      'West Bengal', 'Verifier address B', '9000000002'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_a_id, factory_a_id, 'Verifier Customer', 'Customer address', '9111111111');

  insert into public.brick_types(id, factory_id, name)
  values (factory_b_brick_type_id, factory_b_id, 'Factory B Brick');

  perform set_config('atlas_brick_type.user_id', test_user_id::text, true);
  perform set_config('atlas_brick_type.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_brick_type.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_brick_type.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_brick_type.factory_b_type_id', factory_b_brick_type_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_brick_type.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_brick_type.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_brick_type.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_brick_type.customer_a_id')::uuid;
  factory_b_type_id uuid := current_setting('atlas_brick_type.factory_b_type_id')::uuid;
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  used_type public.brick_types%rowtype;
  unused_type public.brick_types%rowtype;
  report_type public.brick_types%rowtype;
  saved_challan public.challans%rowtype;
  report_challan public.challans%rowtype;
  deleted_id uuid;
  reported_quantity bigint;
begin
  select * into used_type
  from public.create_brick_type(factory_a_id, '  Standard Brick  ');
  select * into unused_type
  from public.create_brick_type(factory_a_id, 'Unused Brick');

  if used_type.name <> 'Standard Brick'
    or used_type.ever_used
    or not used_type.is_active
    or unused_type.ever_used then
    raise exception 'FAIL: new Brick Types did not start active and never-used';
  end if;
  raise notice 'PASS: new Brick Types start active with ever_used=false';

  select * into used_type
  from public.rename_brick_type(factory_a_id, used_type.id, '  Premium Brick  ');
  if used_type.name <> 'Premium Brick' or used_type.ever_used then
    raise exception 'FAIL: rename changed identity or usage state';
  end if;

  select * into used_type
  from public.set_brick_type_active(factory_a_id, used_type.id, false);
  if used_type.is_active or used_type.ever_used then
    raise exception 'FAIL: deactivation changed identity or usage state';
  end if;
  select * into used_type
  from public.set_brick_type_active(factory_a_id, used_type.id, true);
  if not used_type.is_active or used_type.ever_used then
    raise exception 'FAIL: reactivation changed identity or usage state';
  end if;
  raise notice 'PASS: rename/deactivate/reactivate preserve UUID and usage state';

  select * into saved_challan
  from public.create_challan(
    factory_a_id,
    null,
    business_today,
    customer_a_id,
    null,
    null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', used_type.id,
      'quantity', 1000,
      'pricing_mode', 'RATE',
      'rate', 2000
    )),
    '[]'::jsonb
  );

  select * into used_type
  from public.brick_types
  where id = used_type.id and factory_id = factory_a_id;
  if not used_type.ever_used then
    raise exception 'FAIL: successfully saved Challan did not mark ever_used';
  end if;
  raise notice 'PASS: first successfully saved Challan item sets ever_used=true';

  perform public.update_challan(
    factory_a_id,
    saved_challan.id,
    null,
    business_today,
    customer_a_id,
    null,
    null,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'line_type', 'NOTE',
      'order_index', 0,
      'particulars', 'Brick row corrected out'
    ))
  );

  if exists (
    select 1 from public.challan_items
    where factory_id = factory_a_id and brick_type_id = used_type.id
  ) or not (
    select ever_used from public.brick_types
    where factory_id = factory_a_id and id = used_type.id
  ) then
    raise exception 'FAIL: correction/removal reset durable usage';
  end if;

  perform public.void_challan(factory_a_id, saved_challan.id);
  if not (
    select ever_used from public.brick_types
    where factory_id = factory_a_id and id = used_type.id
  ) then
    raise exception 'FAIL: voiding reset durable usage';
  end if;
  raise notice 'PASS: correction/removal and voiding never reset ever_used';

  perform pg_temp.expect_error(
    'used Brick Type cannot be permanently deleted',
    'P3401',
    format(
      'select public.delete_unused_brick_type(%L::uuid, %L::uuid)',
      factory_a_id, used_type.id
    )
  );

  select public.delete_unused_brick_type(factory_a_id, unused_type.id)
  into deleted_id;
  if deleted_id <> unused_type.id or exists (
    select 1 from public.brick_types
    where factory_id = factory_a_id and id = unused_type.id
  ) then
    raise exception 'FAIL: unused Brick Type was not deleted exactly once';
  end if;
  raise notice 'PASS: guarded RPC deletes only an unused Brick Type';

  perform pg_temp.expect_error(
    'cross-factory lifecycle mutation is denied',
    '42501',
    format(
      'select * from public.rename_brick_type(%L::uuid, %L::uuid, %L)',
      factory_b_id, factory_b_type_id, 'Denied rename'
    )
  );
  perform pg_temp.expect_error(
    'foreign Brick Type cannot be addressed through the caller factory',
    'P3400',
    format(
      'select * from public.rename_brick_type(%L::uuid, %L::uuid, %L)',
      factory_a_id, factory_b_type_id, 'Denied rename'
    )
  );

  select * into report_type
  from public.create_brick_type(factory_a_id, 'Report Brick');
  select * into report_challan
  from public.create_challan(
    factory_a_id,
    'REPORT-1',
    business_today,
    customer_a_id,
    null,
    null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', report_type.id,
      'quantity', 2500,
      'pricing_mode', 'RATE',
      'rate', 2000
    )),
    '[]'::jsonb
  );

  select sum(items.quantity)::bigint into reported_quantity
  from public.challan_items as items
  join public.challans
    on challans.id = items.challan_id
    and challans.factory_id = items.factory_id
  where items.factory_id = factory_a_id
    and items.brick_type_id = report_type.id
    and challans.challan_date between business_today and business_today
    and challans.status = 'active';

  if report_challan.id is null or reported_quantity <> 2500 then
    raise exception 'FAIL: ID/date/status/quantity reporting path is incomplete';
  end if;
  raise notice 'PASS: Brick Type ID, quantity, active status, and Challan date support reporting';

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('labourers', 'production_entries')
      and column_name in ('brick_type_id', 'assigned_brick_type_id')
  ) then
    raise exception 'FAIL: Production regained a Brick Type dependency';
  end if;
  raise notice 'PASS: Production remains independent of Brick Types';
end;
$$;

reset role;

select pg_temp.expect_error(
  'ever_used cannot return to false',
  'P3403',
  format(
    'update public.brick_types set ever_used = false where factory_id = %L::uuid and ever_used',
    current_setting('atlas_brick_type.factory_a_id')
  )
);

rollback;
