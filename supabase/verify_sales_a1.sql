-- Atlas Sales correction A1 verifier.
-- Run after 20260830000026_add_structured_challan_company_profile.sql.
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
  customer_a_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  legacy_challan_id uuid := gen_random_uuid();
  locked_legacy_challan_id uuid := gen_random_uuid();
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
    id, name, business_description, address, mobile
  ) values
    (factory_a_id, format('Sales A1 Factory A %s', factory_a_id),
      'Legacy description A', 'Historical generic address A', '9000000001'),
    (factory_b_id, format('Sales A1 Factory B %s', factory_b_id),
      'Legacy description B', 'Historical generic address B', '9000000002');

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_a_id, factory_a_id, 'A1 Customer', 'Customer address', '9111111111');
  insert into public.brick_types(id, factory_id, name)
  values (brick_a_id, factory_a_id, 'A1 Brick');

  -- These rows model Challans that already existed when A1 was applied. Their new
  -- structured columns deliberately remain null; no current profile is backfilled.
  insert into public.challans(
    id, factory_id, challan_number, challan_date, customer_id,
    customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
    company_name_snapshot, company_business_description_snapshot,
    company_address_snapshot, company_mobile_snapshot,
    vehicle_number, tractor_labour_rate_snapshot, is_locked
  ) values
    (
      legacy_challan_id, factory_a_id, 9001, date '2026-08-01', customer_a_id,
      'Historical customer', 'Historical delivery address', '9111111111',
      'Historical company', 'Historical brick maker',
      'Historical company address', '9222222222', 'RJ14AA9001', 0, false
    ),
    (
      locked_legacy_challan_id, factory_a_id, 9002, date '2026-08-02', customer_a_id,
      'Locked historical customer', 'Locked delivery address', '9333333333',
      'Locked historical company', 'Locked historical description',
      'Locked historical company address', '9444444444', 'RJ14AA9002', 0, true
    );

  perform set_config('atlas_a1.mapping_id', mapping_id::text, true);
  perform set_config('atlas_a1.user_id', test_user_id::text, true);
  perform set_config('atlas_a1.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_a1.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_a1.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_a1.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_a1.legacy_challan_id', legacy_challan_id::text, true);
  perform set_config('atlas_a1.locked_legacy_challan_id', locked_legacy_challan_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_a1.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_a1.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_a1.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_a1.customer_a_id')::uuid;
  brick_a_id uuid := current_setting('atlas_a1.brick_a_id')::uuid;
  legacy_challan_id uuid := current_setting('atlas_a1.legacy_challan_id')::uuid;
  locked_legacy_challan_id uuid := current_setting('atlas_a1.locked_legacy_challan_id')::uuid;
  saved_profile public.factories%rowtype;
  first_challan public.challans%rowtype;
  second_challan public.challans%rowtype;
  legacy_challan public.challans%rowtype;
begin
  select * into saved_profile from public.update_factory_printable_profile(
    factory_a_id,
    '  Atlas   Structured Bricks  ',
    '  Quality Brick Manufacturer & Suppliers  ',
    '  Rampur  ',
    '  Rampur   Head  ',
    '  Kotwali  ',
    '  Jaipur  ',
    '  Rajasthan  ',
    '  90000 00001  '
  );

  if saved_profile.name <> 'Atlas Structured Bricks'
    or saved_profile.business_description <> 'Quality Brick Manufacturer & Suppliers'
    or saved_profile.village <> 'Rampur'
    or saved_profile.post_office <> 'Rampur Head'
    or saved_profile.police_station <> 'Kotwali'
    or saved_profile.district <> 'Jaipur'
    or saved_profile.state <> 'Rajasthan'
    or saved_profile.mobile <> '90000 00001'
    or saved_profile.address <> 'Historical generic address A' then
    raise exception 'FAIL: structured factory profile did not normalize or legacy address was overwritten';
  end if;
  raise notice 'PASS: factory saves all structured company fields while preserving generic address';

  if exists (select 1 from public.factories where id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B profile';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot update Factory B structured profile',
    '42501',
    format(
      'select * from public.update_factory_printable_profile(%L::uuid, %L, %L, %L, %L, %L, %L, %L, %L)',
      factory_b_id, 'Forbidden Company', 'Forbidden description', 'Village B',
      'Post B', 'Police B', 'District B', 'State B', '9555555555'
    )
  );
  raise notice 'PASS: factory profile RLS and controlled write authorization isolate tenants';

  select * into first_challan from public.create_challan(
    factory_a_id,
    date '2026-08-30',
    customer_a_id,
    ' rj 14 a1 0001 ',
    450,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1500, 'rate', 2000)
    )
  );

  if first_challan.challan_number <> 1
    or first_challan.challan_total <> 3000
    or first_challan.company_name_snapshot <> 'Atlas Structured Bricks'
    or first_challan.company_business_description_snapshot
      <> 'Quality Brick Manufacturer & Suppliers'
    or first_challan.company_village_snapshot <> 'Rampur'
    or first_challan.company_post_office_snapshot <> 'Rampur Head'
    or first_challan.company_police_station_snapshot <> 'Kotwali'
    or first_challan.company_district_snapshot <> 'Jaipur'
    or first_challan.company_state_snapshot <> 'Rajasthan'
    or first_challan.company_mobile_snapshot <> '90000 00001'
    or first_challan.company_address_snapshot
      <> 'Historical generic address A' then
    raise exception 'FAIL: new Challan did not snapshot the authoritative structured profile or preserve numbering/math';
  end if;
  raise notice 'PASS: new Challan snapshots the current structured company profile with unchanged numbering and totals';

  perform public.update_factory_printable_profile(
    factory_a_id,
    'Atlas Bricks Updated Today',
    'Updated current description',
    'New Village',
    'New Post Office',
    'New Police Station',
    'New District',
    'New State',
    '9888888888'
  );

  select * into first_challan
  from public.update_challan(
    factory_a_id,
    first_challan.id,
    date '2026-08-31',
    customer_a_id,
    'RJ14A10001',
    500,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 2000, 'rate', 2000)
    )
  );

  if first_challan.company_name_snapshot <> 'Atlas Structured Bricks'
    or first_challan.company_village_snapshot <> 'Rampur'
    or first_challan.company_state_snapshot <> 'Rajasthan'
    or first_challan.company_mobile_snapshot <> '90000 00001'
    or first_challan.challan_number <> 1
    or first_challan.challan_total <> 4000 then
    raise exception 'FAIL: editing a Challan replaced its company snapshot or changed numbering/math';
  end if;
  raise notice 'PASS: profile changes and permitted Challan edits do not replace the original company snapshot';

  select * into second_challan from public.create_challan(
    factory_a_id,
    date '2026-09-01',
    customer_a_id,
    'RJ14A10002',
    500,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 2500)
    )
  );

  if second_challan.challan_number <> 2
    or second_challan.company_name_snapshot <> 'Atlas Bricks Updated Today'
    or second_challan.company_village_snapshot <> 'New Village'
    or second_challan.company_state_snapshot <> 'New State' then
    raise exception 'FAIL: later Challan did not receive the next number and latest profile snapshot';
  end if;

  select * into second_challan
  from public.void_challan(factory_a_id, second_challan.id);
  if second_challan.status <> 'void' or second_challan.voided_at is null then
    raise exception 'FAIL: existing void behavior changed';
  end if;
  raise notice 'PASS: create, edit, void, and per-factory sequential numbering remain intact';

  select * into legacy_challan
  from public.challans
  where id = legacy_challan_id;
  if legacy_challan.company_name_snapshot <> 'Historical company'
    or legacy_challan.company_address_snapshot <> 'Historical company address'
    or legacy_challan.company_mobile_snapshot <> '9222222222'
    or legacy_challan.company_village_snapshot is not null
    or legacy_challan.company_post_office_snapshot is not null
    or legacy_challan.company_police_station_snapshot is not null
    or legacy_challan.company_district_snapshot is not null
    or legacy_challan.company_state_snapshot is not null then
    raise exception 'FAIL: legacy Challan was rewritten or assigned fake structured history';
  end if;
  raise notice 'PASS: legacy Challan stays readable from its original legacy snapshots without current-profile backfill';

  if not exists (
    select 1 from public.challans
    where id = locked_legacy_challan_id
      and is_locked
      and company_name_snapshot = 'Locked historical company'
      and company_address_snapshot = 'Locked historical company address'
      and company_village_snapshot is null
      and company_state_snapshot is null
  ) then
    raise exception 'FAIL: payment-locked historical Challan was rewritten';
  end if;
  perform pg_temp.expect_error(
    'payment-locked historical Challan still cannot be edited',
    'P3005',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L, 0, jsonb_build_array(jsonb_build_object(%L, %L::uuid, %L, 1000, %L, 2000)))',
      factory_a_id, locked_legacy_challan_id, '2026-09-01', customer_a_id,
      'RJ14AA9002', 'brick_type_id', brick_a_id, 'quantity', 'rate'
    )
  );
  raise notice 'PASS: payment lock rules remain unchanged and locked historical snapshots are untouched';

  perform set_config('atlas_a1.first_challan_id', first_challan.id::text, true);
  perform set_config('atlas_a1.second_challan_id', second_challan.id::text, true);
end;
$$;

reset role;

do $$
declare
  required_column text;
  create_definition text;
  update_definition text;
  guard_definition text;
begin
  foreach required_column in array array[
    'village', 'post_office', 'police_station', 'district', 'state'
  ] loop
    if not exists (
      select 1 from pg_attribute
      where attrelid = 'public.factories'::regclass
        and attname = required_column
        and not attisdropped
    ) then
      raise exception 'FAIL: factories.% is missing', required_column;
    end if;
  end loop;

  foreach required_column in array array[
    'company_village_snapshot', 'company_post_office_snapshot',
    'company_police_station_snapshot', 'company_district_snapshot',
    'company_state_snapshot'
  ] loop
    if not exists (
      select 1 from pg_attribute
      where attrelid = 'public.challans'::regclass
        and attname = required_column
        and not attisdropped
        and not attnotnull
    ) then
      raise exception 'FAIL: nullable legacy-compatible challans.% is missing', required_column;
    end if;
  end loop;

  if to_regprocedure(
      'public.update_factory_printable_profile(uuid,text,text,text,text,text,text,text,text)'
    ) is null
    or not has_function_privilege(
      'authenticated',
      'public.update_factory_printable_profile(uuid,text,text,text,text,text,text,text,text)'::regprocedure,
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.update_factory_printable_profile(uuid,text,text,text,text,text,text,text,text)'::regprocedure,
      'EXECUTE'
    ) then
    raise exception 'FAIL: structured profile RPC signature or grants are unsafe';
  end if;

  if has_table_privilege('authenticated', 'public.factories', 'UPDATE')
    or not (select relrowsecurity from pg_class where oid = 'public.factories'::regclass) then
    raise exception 'FAIL: factory profile bypasses controlled writes or factory RLS';
  end if;

  create_definition := pg_get_functiondef(
    'public.create_challan(uuid,date,uuid,text,numeric,jsonb)'::regprocedure
  );
  update_definition := pg_get_functiondef(
    'public.update_challan(uuid,uuid,date,uuid,text,numeric,jsonb)'::regprocedure
  );
  guard_definition := pg_get_functiondef(
    'public.guard_challan_header_update()'::regprocedure
  );

  if create_definition !~ 'company_village_snapshot'
    or create_definition !~ 'factory_profile.village'
    or create_definition ~ 'p_company_.*snapshot'
    or update_definition ~ 'company_village_snapshot[[:space:]]*='
    or guard_definition !~ 'company_village_snapshot is distinct from old.company_village_snapshot' then
    raise exception 'FAIL: authoritative creation, edit preservation, or immutable snapshot guard is missing';
  end if;

  if (select last_challan_number from public.challan_number_counters
      where factory_id = current_setting('atlas_a1.factory_a_id')::uuid) <> 2 then
    raise exception 'FAIL: A1 changed the Challan counter sequence';
  end if;

  raise notice 'PASS: A1 schema, RLS, controlled RPC, immutable snapshots, and counter invariants are present';
end;
$$;

rollback;
