-- Shared supplier role-separation verifier.
-- Run after 20260914000041_create_supplier_roles.sql.
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
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  supplier_b_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;
  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Supplier Role Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Supplier Role Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;
  insert into public.suppliers(id, factory_id, name)
  values (supplier_b_id, factory_b_id, 'Factory B Supplier');
  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (factory_b_id, supplier_b_id, 'COAL_SELLER', test_user_id);
  perform set_config('atlas_roles.user_id', test_user_id::text, true);
  perform set_config('atlas_roles.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_roles.factory_b_id', factory_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_roles.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_roles.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_roles.factory_b_id')::uuid;
  coal_only public.suppliers%rowtype;
  garage_only public.suppliers%rowtype;
  dual_coal public.suppliers%rowtype;
  dual_garage public.suppliers%rowtype;
  unused_supplier public.suppliers%rowtype;
  vehicle_row public.vehicles%rowtype;
  coal_name public.coal_reference_values%rowtype;
  coal_source public.coal_reference_values%rowtype;
  coal_record public.coal_purchase_detail;
  maintenance_record public.vehicle_maintenance_detail;
begin
  select * into coal_only from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Coal Only Traders', null, null
  );
  select * into garage_only from public.create_or_assign_supplier_role(
    factory_a_id, 'GARAGE', 'Garage Only Works', null, null
  );
  select * into dual_coal from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'ABC Dual Traders', 'Original Address', '9111111111'
  );
  select * into dual_garage from public.create_or_assign_supplier_role(
    factory_a_id, 'GARAGE', 'abc dual traders', 'Ignored New Address', '9222222222'
  );
  select * into unused_supplier from public.create_supplier(
    factory_a_id, 'Unclassified Supplier', null, null
  );

  if dual_coal.id <> dual_garage.id
    or (select count(*) from public.suppliers
        where factory_id = factory_a_id and lower(name) = 'abc dual traders') <> 1
    or (select count(*) from public.supplier_roles
        where factory_id = factory_a_id and supplier_id = dual_coal.id) <> 2 then
    raise exception 'FAIL: dual-role assignment duplicated the shared supplier UUID';
  end if;
  if dual_garage.address <> 'Original Address' or dual_garage.mobile <> '9111111111' then
    raise exception 'FAIL: assigning a second role silently rewrote supplier master details';
  end if;
  raise notice 'PASS: one same supplier UUID safely holds both roles without duplicate identity';

  if not exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'COAL_SELLER')
      where id = coal_only.id
    ) or exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'GARAGE')
      where id = coal_only.id
    ) then raise exception 'FAIL: Coal-only supplier filtering is wrong'; end if;
  if not exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'GARAGE')
      where id = garage_only.id
    ) or exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'COAL_SELLER')
      where id = garage_only.id
    ) then raise exception 'FAIL: Garage-only supplier filtering is wrong'; end if;
  if not exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'COAL_SELLER')
      where id = dual_coal.id
    ) or not exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'GARAGE')
      where id = dual_coal.id
    ) then raise exception 'FAIL: dual-role supplier is not present in both lists'; end if;
  if exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'COAL_SELLER')
      where id = unused_supplier.id
    ) or exists (
      select 1 from public.list_suppliers_by_role(factory_a_id, 'GARAGE')
      where id = unused_supplier.id
    ) then raise exception 'FAIL: unclassified unused supplier leaked into a module selector'; end if;
  raise notice 'PASS: Coal-only, Garage-only, dual-role, and unclassified filtering is exact';

  select * into vehicle_row from public.find_or_create_vehicle(
    factory_a_id, 'WB58 A 1234', false
  );
  select * into coal_name from public.create_coal_reference_value(
    factory_a_id, 'coal_name', 'Steam Coal'
  );
  select * into coal_source from public.create_coal_reference_value(
    factory_a_id, 'source_location', 'Raniganj'
  );
  select * into coal_record from public.create_coal_purchase(
    factory_a_id, date '2026-09-14', coal_only.id, coal_name.id, coal_source.id,
    null, 'WB 00 C 0001', 1, 1000, null, 0, 0, null
  );
  select * into maintenance_record from public.create_vehicle_maintenance(
    factory_a_id, date '2026-09-14', vehicle_row.id, garage_only.id,
    'Role verifier repair', 1000, 0, null
  );
  perform public.create_coal_purchase(
    factory_a_id, date '2026-09-14', dual_coal.id, coal_name.id, coal_source.id,
    null, 'WB 00 C 0002', 1, 1000, null, 0, 0, null
  );
  perform public.create_vehicle_maintenance(
    factory_a_id, date '2026-09-14', vehicle_row.id, dual_coal.id,
    'Dual role repair', 1000, 0, null
  );

  perform pg_temp.expect_error(
    'Garage-only supplier cannot create Coal Purchase', 'P4402',
    format(
      'select * from public.create_coal_purchase(%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,null,%L,1,1000,null,0,0,null)',
      factory_a_id, '2026-09-14', garage_only.id, coal_name.id, coal_source.id, 'WB 00 C 0003'
    )
  );
  perform pg_temp.expect_error(
    'Coal-only supplier cannot create Maintenance', 'P4403',
    format(
      'select * from public.create_vehicle_maintenance(%L::uuid,date %L,%L::uuid,%L::uuid,%L,1000,0,null)',
      factory_a_id, '2026-09-14', vehicle_row.id, coal_only.id, 'Denied repair'
    )
  );
  if (select count(*) from public.expense_records
      where id in (coal_record.id, maintenance_record.id)) <> 2 then
    raise exception 'FAIL: valid role writes duplicated or lost accounting obligations';
  end if;
  if not exists (select 1 from public.coal_purchases where id = coal_record.id)
    or not exists (select 1 from public.vehicle_maintenance_records where id = maintenance_record.id) then
    raise exception 'FAIL: existing module references no longer use shared supplier identity';
  end if;
  raise notice 'PASS: module writes enforce roles without changing financial identities';

  if exists (select 1 from public.supplier_roles where factory_id = factory_b_id) then
    raise exception 'FAIL: RLS exposed Factory B supplier roles';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot list Factory B roles', '42501',
    format('select * from public.list_suppliers_by_role(%L::uuid,''COAL_SELLER'')', factory_b_id)
  );
  perform pg_temp.expect_error(
    'Factory A cannot assign Factory B roles', '42501',
    format(
      'select * from public.create_or_assign_supplier_role(%L::uuid,''GARAGE'',%L,null,null)',
      factory_b_id, 'Denied Garage'
    )
  );
  raise notice 'PASS: supplier roles and module lists are factory-isolated';
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('authenticated', 'public.supplier_roles', 'INSERT')
    or has_table_privilege('authenticated', 'public.supplier_roles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.supplier_roles', 'DELETE') then
    raise exception 'FAIL: authenticated role has direct supplier-role mutation privileges';
  end if;
  raise notice 'PASS: supplier-role writes remain controlled and factory-authorized';
end;
$$;

rollback;

select 'PASS: Supplier Role verifier completed and rolled back all fixtures.' as result;
