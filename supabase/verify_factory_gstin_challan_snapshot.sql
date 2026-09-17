-- Factory GSTIN + Challan snapshot verifier.
-- Run on Test Atlas Clean after 20260913000036_add_factory_gstin_challan_snapshot.sql.
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
    police_station, district, state, address, mobile, gstin
  ) values
    (
      factory_a_id, format('GSTIN Factory A %s', factory_a_id), 'Brick manufacturer',
      'Village A', 'Post A', 'Police A', 'District A', 'State A',
      'Legacy address A', '9000000001', null
    ),
    (
      factory_b_id, format('GSTIN Factory B %s', factory_b_id), 'Brick manufacturer',
      'Village B', 'Post B', 'Police B', 'District B', 'State B',
      'Legacy address B', '9000000002', '19FACTORYB2345Z'
    );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'Customer A', 'Address A', '9111111111'),
    (customer_b_id, factory_b_id, 'Customer B', 'Address B', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Brick A'),
    (brick_b_id, factory_b_id, 'Brick B');

  -- This models a pre-migration row: no GSTIN is inferred or backfilled.
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot
  ) values (
    legacy_challan_id, factory_a_id, 'LEGACY-GSTIN', date '2026-09-01', customer_a_id,
    'Historical customer', 'Historical address', '9333333333',
    'Historical factory', 'Historical description', 'Historical factory address',
    '9444444444'
  );

  perform set_config('atlas_gstin.user_id', test_user_id::text, true);
  perform set_config('atlas_gstin.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_gstin.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_gstin.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_gstin.customer_b_id', customer_b_id::text, true);
  perform set_config('atlas_gstin.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_gstin.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_gstin.legacy_challan_id', legacy_challan_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_gstin.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_gstin.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_gstin.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_gstin.customer_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_gstin.customer_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_gstin.brick_a_id')::uuid;
  brick_b_id uuid := current_setting('atlas_gstin.brick_b_id')::uuid;
  legacy_challan_id uuid := current_setting('atlas_gstin.legacy_challan_id')::uuid;
  saved_profile public.factories%rowtype;
  challan_a public.challans%rowtype;
  challan_b public.challans%rowtype;
begin
  select * into saved_profile from public.update_factory_printable_profile(
    factory_a_id,
    'Factory A', 'Brick manufacturer', 'Village A', 'Post A', 'Police A',
    'District A', 'State A', '9000000001', ' 19abcde1234f1z5 '
  );
  if saved_profile.gstin <> '19ABCDE1234F1Z5' then
    raise exception 'FAIL: Factory Profile did not normalize GSTIN-A';
  end if;
  raise notice 'PASS: Factory Profile stores normalized optional GSTIN';

  select * into challan_a from public.create_challan(
    factory_a_id, 'GSTIN-A', date '2026-09-13', customer_a_id, null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id,
      'quantity', 1000,
      'pricing_mode', 'RATE',
      'rate', 2000
    )),
    '[]'::jsonb
  );
  if challan_a.company_gstin_snapshot <> '19ABCDE1234F1Z5'
    or challan_a.challan_total <> 2000 then
    raise exception 'FAIL: Challan A did not snapshot GSTIN-A or preserve totals';
  end if;

  perform public.update_factory_printable_profile(
    factory_a_id,
    'Factory A', 'Brick manufacturer', 'Village A', 'Post A', 'Police A',
    'District A', 'State A', '9000000001', '19zzzzz9999z1z9'
  );

  select * into challan_a
  from public.challans
  where id = challan_a.id;
  if challan_a.company_gstin_snapshot <> '19ABCDE1234F1Z5' then
    raise exception 'FAIL: changing Factory GSTIN rewrote Challan A';
  end if;
  raise notice 'PASS: Challan A retains GSTIN-A after Factory Profile changes';

  select * into challan_b from public.create_challan(
    factory_a_id, 'GSTIN-B', date '2026-09-14', customer_a_id, null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id,
      'quantity', 1000,
      'pricing_mode', 'RATE',
      'rate', 2500
    )),
    '[]'::jsonb
  );
  if challan_b.company_gstin_snapshot <> '19ZZZZZ9999Z1Z9'
    or challan_b.challan_total <> 2500 then
    raise exception 'FAIL: Challan B did not receive GSTIN-B or preserve totals';
  end if;
  raise notice 'PASS: Challan B receives GSTIN-B';

  if not exists (
    select 1 from public.challans
    where id = legacy_challan_id
      and company_gstin_snapshot is null
      and company_name_snapshot = 'Historical factory'
  ) then
    raise exception 'FAIL: legacy Challan received current Factory GSTIN';
  end if;
  raise notice 'PASS: legacy Challan keeps a null GSTIN snapshot';

  if exists (select 1 from public.factories where id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B GSTIN';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot write Factory B GSTIN',
    '42501',
    format(
      'select * from public.update_factory_printable_profile(%L::uuid, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
      factory_b_id, 'Forbidden Factory', 'Description', 'Village', 'Post',
      'Police', 'District', 'State', '9555555555', '19LEAKED1234F1Z5'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot create a Factory B Challan',
    '42501',
    format(
      'select * from public.create_challan(%L::uuid, %L, date %L, %L::uuid, null, null, jsonb_build_array(jsonb_build_object(%L, %L::uuid, %L, 1000, %L, %L, %L, 2000)), %L::jsonb)',
      factory_b_id, 'FORBIDDEN', '2026-09-14', customer_b_id,
      'brick_type_id', brick_b_id, 'quantity', 'pricing_mode', 'RATE', 'rate', '[]'
    )
  );
  raise notice 'PASS: Factory A cannot read or write Factory B GSTIN';

  perform set_config('atlas_gstin.challan_a_id', challan_a.id::text, true);
end;
$$;

reset role;

select pg_temp.expect_error(
  'GSTIN snapshot remains immutable even for a direct database update',
  'P3007',
  format(
    'update public.challans set company_gstin_snapshot = %L where id = %L::uuid',
    '19MUTATE1234F1Z5', current_setting('atlas_gstin.challan_a_id')
  )
);

rollback;
