-- Atlas Security 12B1: rollback-only runtime proof of public table/RLS tenant isolation.
-- Run only against confirmed Test Atlas Clean (nfqdtygpyycaxlaegvcf).

-- Persistent baselines and the coverage manifest deliberately live outside the
-- rolled-back fixture transaction so the post-ROLLBACK comparison is real.
create temporary table atlas_12b1_manifest on commit preserve rows as
select
  c.relname::text as table_name,
  exists (
    select 1
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = c.relname
      and columns.column_name = 'factory_id'
  ) as has_factory_id,
  c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') as anon_select_acl,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select_acl,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert_acl,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update_acl,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete_acl,
  exists (
    select 1 from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and policies.tablename = c.relname
      and policies.cmd in ('ALL', 'SELECT')
      and policies.roles = array['authenticated']::name[]
  ) as auth_select_policy,
  exists (
    select 1 from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and policies.tablename = c.relname
      and policies.cmd in ('ALL', 'INSERT')
      and policies.roles = array['authenticated']::name[]
  ) as auth_insert_policy,
  exists (
    select 1 from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and policies.tablename = c.relname
      and policies.cmd in ('ALL', 'UPDATE')
      and policies.roles = array['authenticated']::name[]
  ) as auth_update_policy,
  exists (
    select 1 from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and policies.tablename = c.relname
      and policies.cmd in ('ALL', 'DELETE')
      and policies.roles = array['authenticated']::name[]
  ) as auth_delete_policy
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p');

grant select on atlas_12b1_manifest to authenticated, anon;

create temporary table atlas_12b1_persistent_counts (
  table_name text primary key,
  row_count bigint not null
) on commit preserve rows;

do $$
declare
  covered_table record;
  persistent_count bigint;
begin
  if (select count(*) from atlas_12b1_manifest) <> 63 then
    raise exception 'FAIL: expected 63 public tables, found %',
      (select count(*) from atlas_12b1_manifest);
  end if;
  if exists (select 1 from atlas_12b1_manifest where not rls_enabled) then
    raise exception 'FAIL: coverage manifest includes a public table without RLS';
  end if;

  for covered_table in select table_name from atlas_12b1_manifest order by table_name loop
    execute pg_catalog.format('select count(*) from public.%I', covered_table.table_name)
      into persistent_count;
    insert into atlas_12b1_persistent_counts(table_name, row_count)
    values (covered_table.table_name, persistent_count);
  end loop;
  raise notice 'PASS [EXECUTED]: recorded pre-transaction persistent counts for 63/63 public tables';
end;
$$;

-- The hosted SQL endpoint begins a transaction for the submitted batch. Commit
-- only the session-local temp manifest/baseline so they survive the fixture
-- rollback; no persistent Atlas row is written before this point.
commit;

begin;

create function pg_temp.assert_identity(expected_user uuid, assertion_label text)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from expected_user then
    raise exception 'FAIL: % role/JWT mismatch: current_user %, auth.uid() %',
      assertion_label, current_user, auth.uid();
  end if;
end;
$$;

create function pg_temp.expect_block(
  assertion_label text,
  statement_to_run text,
  expected_states text[],
  block_cause text
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  execute statement_to_run;
  raise exception 'FAIL: % unexpectedly succeeded', assertion_label using errcode = 'P9999';
exception when others then
  if sqlstate = 'P9999' then raise; end if;
  if not (sqlstate = any(expected_states)) then
    raise exception 'FAIL: % returned unexpected SQLSTATE % (%)',
      assertion_label, sqlstate, sqlerrm;
  end if;
  raise notice 'PASS [EXECUTED] [%]: % blocked with SQLSTATE %',
    block_cause, assertion_label, sqlstate;
end;
$$;

-- Privileged fixture step 1: only synthetic users, factories, and memberships.
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if current_user = 'authenticated' or auth.uid() is not null then
    raise exception 'FAIL: privileged root fixture setup inherited authenticated identity';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('12b00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'atlas-12b1-a@example.invalid', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('12b00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'atlas-12b1-b@example.invalid', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.factories(
  id, name, business_description, village, post_office,
  police_station, district, state, mobile
)
values
  ('12b10000-0000-4000-8000-000000000001', 'Atlas 12B1 Factory A',
    'Verifier fixture', 'Village A', 'Post A', 'Station A', 'District A', 'State A', '1000000001'),
  ('12b10000-0000-4000-8000-000000000002', 'Atlas 12B1 Factory B',
    'Verifier fixture', 'Village B', 'Post B', 'Station B', 'District B', 'State B', '1000000002');

insert into public.factory_users(user_id, factory_id, is_active)
values
  ('12b00000-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', true),
  ('12b00000-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', true);

-- Use the real owning-user transition path to create one audited transition per tenant.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12b00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12b00000-0000-4000-8000-000000000001', 'Factory A Mud fixture');
select public.transition_mud_accounting_mode(
  '12b10000-0000-4000-8000-000000000001', 'SHADOW'::public.mud_accounting_mode
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12b00000-0000-4000-8000-000000000002', true);
select pg_temp.assert_identity('12b00000-0000-4000-8000-000000000002', 'Factory B Mud fixture');
select public.transition_mud_accounting_mode(
  '12b10000-0000-4000-8000-000000000002', 'SHADOW'::public.mud_accounting_mode
);

-- Privileged fixture step 2: valid synthetic business rows in FK dependency order.
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if current_user = 'authenticated' or auth.uid() is not null then
    raise exception 'FAIL: privileged business fixture setup inherited authenticated identity';
  end if;
end;
$$;

insert into public.brick_types(id, factory_id, name)
values
  ('12b20001-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Brick A'),
  ('12b20001-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Brick B');

insert into public.customers(id, factory_id, name, address, mobile)
values
  ('12b20002-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Customer A', 'Address A', '9000000001'),
  ('12b20002-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Customer B', 'Address B', '9000000002');

insert into public.vehicles(
  id, factory_id, vehicle_number, normalized_vehicle_number,
  delivery_wage_tracking_enabled, is_active
)
values
  ('12b20003-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', 'AT12A0001', 'AT12A0001', true, true),
  ('12b20003-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', 'AT12B0002', 'AT12B0002', true, true);

insert into public.suppliers(id, factory_id, name, address, mobile)
values
  ('12b20009-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Supplier A', 'Supplier Address A', '9111111111'),
  ('12b20009-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Supplier B', 'Supplier Address B', '9222222222');

insert into public.supplier_roles(id, factory_id, supplier_id, role, created_by)
values
  (pg_catalog.gen_random_uuid(), '12b10000-0000-4000-8000-000000000001', '12b20009-0000-4000-8000-000000000001', 'COAL_SELLER', '12b00000-0000-4000-8000-000000000001'),
  (pg_catalog.gen_random_uuid(), '12b10000-0000-4000-8000-000000000001', '12b20009-0000-4000-8000-000000000001', 'GARAGE', '12b00000-0000-4000-8000-000000000001'),
  (pg_catalog.gen_random_uuid(), '12b10000-0000-4000-8000-000000000001', '12b20009-0000-4000-8000-000000000001', 'FUEL_PUMP', '12b00000-0000-4000-8000-000000000001'),
  (pg_catalog.gen_random_uuid(), '12b10000-0000-4000-8000-000000000002', '12b20009-0000-4000-8000-000000000002', 'COAL_SELLER', '12b00000-0000-4000-8000-000000000002'),
  (pg_catalog.gen_random_uuid(), '12b10000-0000-4000-8000-000000000002', '12b20009-0000-4000-8000-000000000002', 'GARAGE', '12b00000-0000-4000-8000-000000000002'),
  (pg_catalog.gen_random_uuid(), '12b10000-0000-4000-8000-000000000002', '12b20009-0000-4000-8000-000000000002', 'FUEL_PUMP', '12b00000-0000-4000-8000-000000000002');

insert into public.labour_groups(id, factory_id, name, member_names, member_count)
values
  ('12b20014-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Group A', 'Member A', 1),
  ('12b20014-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Group B', 'Member B', 1);

insert into public.labourers(id, factory_id, name, production_origin_label)
values
  ('12b20015-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Labourer A', 'Origin A'),
  ('12b20015-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Labourer B', 'Origin B');

insert into public.production_crews(id, factory_id, name)
values
  ('12b20016-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Production Crew A'),
  ('12b20016-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Production Crew B');

insert into public.production_crew_assignments(
  id, factory_id, labourer_id, production_crew_id, effective_from
)
values
  ('12b20017-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20015-0000-4000-8000-000000000001', '12b20016-0000-4000-8000-000000000001', '2026-01-01'),
  ('12b20017-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20015-0000-4000-8000-000000000002', '12b20016-0000-4000-8000-000000000002', '2026-01-01');

insert into public.production_wage_rates(
  id, factory_id, production_crew_id, rate_per_1000_bricks, effective_from
)
values
  ('12b20019-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20016-0000-4000-8000-000000000001', 10, '2026-01-01'),
  ('12b20019-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20016-0000-4000-8000-000000000002', 10, '2026-01-01');

insert into public.wage_rates(id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
values
  ('12b2001a-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', 'production', 10, '2026-01-01'),
  ('12b2001a-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', 'production', 10, '2026-01-01');

insert into public.production_entries(id, factory_id, labourer_id, production_date, quantity)
values
  ('12b20018-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20015-0000-4000-8000-000000000001', '2026-01-05', 1000),
  ('12b20018-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20015-0000-4000-8000-000000000002', '2026-01-05', 1000);

insert into public.weekly_earnings(
  id, factory_id, labourer_id, week_start, quantity_used, amount
)
values
  ('12b2001b-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20015-0000-4000-8000-000000000001', '2026-01-05', 1000, 10),
  ('12b2001b-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20015-0000-4000-8000-000000000002', '2026-01-05', 1000, 10);

insert into public.production_weekly_earning_details(
  id, factory_id, weekly_earning_id, work_date, quantity_used,
  production_wage_rate_id, rate_per_1000_bricks, rate_source,
  production_crew_id, amount
)
values
  ('12b2001c-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b2001b-0000-4000-8000-000000000001', '2026-01-05', 1000, '12b20019-0000-4000-8000-000000000001', 10, 'crew_default', '12b20016-0000-4000-8000-000000000001', 10),
  ('12b2001c-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b2001b-0000-4000-8000-000000000002', '2026-01-05', 1000, '12b20019-0000-4000-8000-000000000002', 10, 'crew_default', '12b20016-0000-4000-8000-000000000002', 10);

insert into public.withdrawals(
  id, factory_id, labourer_id, withdrawal_date, amount, note
)
values
  ('12b2001d-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20015-0000-4000-8000-000000000001', '2026-01-06', 1, '12B1 withdrawal A'),
  ('12b2001d-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20015-0000-4000-8000-000000000002', '2026-01-06', 1, '12B1 withdrawal B');

insert into public.production_earning_settlements(
  id, factory_id, labourer_id, settled_through, total_quantity,
  total_earned, settlement_type
)
values
  ('12b2001e-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20015-0000-4000-8000-000000000001', '2026-01-05', 1000, 10, 'legacy_opening'),
  ('12b2001e-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20015-0000-4000-8000-000000000002', '2026-01-05', 1000, 10, 'legacy_opening');

insert into public.production_earning_settlement_details(
  id, settlement_id, factory_id, labourer_id, production_entry_id,
  work_date, quantity, production_wage_rate_id, rate_per_1000_bricks, earned_amount
)
values
  ('12b2001f-0000-4000-8000-000000000001', '12b2001e-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20015-0000-4000-8000-000000000001', '12b20018-0000-4000-8000-000000000001', '2026-01-05', 1000, '12b20019-0000-4000-8000-000000000001', 10, 10),
  ('12b2001f-0000-4000-8000-000000000002', '12b2001e-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20015-0000-4000-8000-000000000002', '12b20018-0000-4000-8000-000000000002', '2026-01-05', 1000, '12b20019-0000-4000-8000-000000000002', 10, 10);

insert into public.mud_group_terms(
  id, factory_id, labour_group_id, member_count, effective_from
)
values
  ('12b20021-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20014-0000-4000-8000-000000000001', 1, '2026-01-01'),
  ('12b20021-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20014-0000-4000-8000-000000000002', 1, '2026-01-01');

insert into public.mud_group_rates(
  id, factory_id, labour_group_id, rate_per_1000_bricks, effective_from
)
values
  ('12b20022-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20014-0000-4000-8000-000000000001', 10, '2026-01-01'),
  ('12b20022-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20014-0000-4000-8000-000000000002', 10, '2026-01-01');

insert into public.mud_factory_settlements(
  id, factory_id, settled_through, settlement_type
)
values
  ('12b20023-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', 'legacy_opening'),
  ('12b20023-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', 'legacy_opening');

insert into public.mud_factory_settlement_days(
  id, settlement_id, factory_id, work_date,
  eligible_factory_production, total_active_mud_members
)
values
  ('12b20024-0000-4000-8000-000000000001', '12b20023-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', 1000, 1),
  ('12b20024-0000-4000-8000-000000000002', '12b20023-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', 1000, 1);

insert into public.mud_group_legacy_openings(
  id, settlement_id, factory_id, labour_group_id, legacy_cutoff, locked_weekly_earned
)
values
  ('12b20026-0000-4000-8000-000000000001', '12b20023-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20014-0000-4000-8000-000000000001', '2026-01-04', 10),
  ('12b20026-0000-4000-8000-000000000002', '12b20023-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20014-0000-4000-8000-000000000002', '2026-01-04', 10);

insert into public.mud_group_settlement_days(
  id, settlement_id, factory_id, work_date, labour_group_id,
  mud_group_term_id, member_count, allocated_production,
  mud_group_rate_id, rate_per_1000_bricks, earned_amount
)
values
  ('12b20025-0000-4000-8000-000000000001', '12b20023-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', '12b20014-0000-4000-8000-000000000001', '12b20021-0000-4000-8000-000000000001', 1, 1000, '12b20022-0000-4000-8000-000000000001', 10, 10),
  ('12b20025-0000-4000-8000-000000000002', '12b20023-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', '12b20014-0000-4000-8000-000000000002', '12b20021-0000-4000-8000-000000000002', 1, 1000, '12b20022-0000-4000-8000-000000000002', 10, 10);

insert into public.soil_workers(id, factory_id, name)
values
  ('12b20027-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Soil Worker A'),
  ('12b20027-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Soil Worker B');

insert into public.soil_worker_trolley_rates(
  id, factory_id, soil_worker_id, rate_per_trolley, effective_from
)
values
  ('12b20028-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20027-0000-4000-8000-000000000001', 10, '2026-01-01'),
  ('12b20028-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20027-0000-4000-8000-000000000002', 10, '2026-01-01');

insert into public.soil_daily_trolley_entries(
  id, factory_id, soil_worker_id, work_date, trolley_quantity,
  soil_worker_trolley_rate_id, rate_per_trolley_snapshot, base_amount_snapshot
)
values
  ('12b20029-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20027-0000-4000-8000-000000000001', '2026-01-05', 1, '12b20028-0000-4000-8000-000000000001', 10, 10),
  ('12b20029-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20027-0000-4000-8000-000000000002', '2026-01-05', 1, '12b20028-0000-4000-8000-000000000002', 10, 10);

insert into public.soil_earnings(
  id, factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date,
  event_type, event_sequence, amount, trolley_quantity_snapshot,
  rate_per_trolley_snapshot, previous_base_amount_snapshot, source_base_amount_snapshot
)
values
  ('12b2002a-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20027-0000-4000-8000-000000000001', '12b20029-0000-4000-8000-000000000001', '2026-01-05', 'BASE', 1, 10, 1, 10, 0, 10),
  ('12b2002a-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20027-0000-4000-8000-000000000002', '12b20029-0000-4000-8000-000000000002', '2026-01-05', 'BASE', 1, 10, 1, 10, 0, 10);

insert into public.soil_financial_adjustments(
  id, factory_id, soil_worker_id, adjustment_type, adjustment_date, amount, reason
)
values
  ('12b2002b-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20027-0000-4000-8000-000000000001', 'ADDITION', '2026-01-06', 1, '12B1 adjustment A'),
  ('12b2002b-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20027-0000-4000-8000-000000000002', 'ADDITION', '2026-01-06', 1, '12B1 adjustment B');

insert into public.soil_payments(id, factory_id, soil_worker_id, payment_date, amount)
values
  ('12b2002c-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20027-0000-4000-8000-000000000001', '2026-01-06', 1),
  ('12b2002c-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20027-0000-4000-8000-000000000002', '2026-01-06', 1);

insert into public.staff_categories(id, factory_id, name)
values
  ('12b2002d-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Staff Category A'),
  ('12b2002d-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Staff Category B');

insert into public.staff_workers(
  id, factory_id, name, staff_category_id, reference_salary
)
values
  ('12b2002e-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Staff Worker A', '12b2002d-0000-4000-8000-000000000001', 100),
  ('12b2002e-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Staff Worker B', '12b2002d-0000-4000-8000-000000000002', 100);

insert into public.staff_payments(id, factory_id, staff_worker_id, payment_date, amount, note)
values
  ('12b2002f-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b2002e-0000-4000-8000-000000000001', '2026-01-06', 1, '12B1 staff payment A'),
  ('12b2002f-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b2002e-0000-4000-8000-000000000002', '2026-01-06', 1, '12B1 staff payment B');

insert into public.transport_workers(id, factory_id, name)
values
  ('12b20030-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Transport Worker A'),
  ('12b20030-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Transport Worker B'),
  ('12b20031-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Extra Worker A'),
  ('12b20031-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Extra Worker B');

insert into public.transport_crews(id, factory_id, name)
values
  ('12b20032-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Transport Crew A'),
  ('12b20032-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Transport Crew B'),
  ('12b20033-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1 Extra Crew A'),
  ('12b20033-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1 Extra Crew B');

insert into public.transport_crew_assignments(
  id, factory_id, transport_worker_id, transport_crew_id
)
values
  ('12b20034-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20030-0000-4000-8000-000000000001', '12b20032-0000-4000-8000-000000000001'),
  ('12b20034-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20030-0000-4000-8000-000000000002', '12b20032-0000-4000-8000-000000000002');

insert into public.transport_crew_memberships(
  id, factory_id, transport_worker_id, transport_crew_id, effective_from
)
values
  ('12b20035-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20030-0000-4000-8000-000000000001', '12b20032-0000-4000-8000-000000000001', '2026-01-01'),
  ('12b20035-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20030-0000-4000-8000-000000000002', '12b20032-0000-4000-8000-000000000002', '2026-01-01');

insert into public.transport_crew_wage_rates(
  id, factory_id, transport_crew_id, rate_per_paya, effective_from
)
values
  ('12b20036-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20032-0000-4000-8000-000000000001', 10, '2026-01-01'),
  ('12b20036-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20032-0000-4000-8000-000000000002', 10, '2026-01-01');

insert into public.transport_daily_entries(
  id, factory_id, transport_crew_id, work_date, paya_quantity
)
values
  ('12b20037-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20032-0000-4000-8000-000000000001', '2026-01-05', 1),
  ('12b20037-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20032-0000-4000-8000-000000000002', '2026-01-05', 1);

insert into public.transport_daily_attendance(
  id, factory_id, transport_daily_entry_id, transport_crew_id,
  transport_worker_id, work_date
)
values
  ('12b20038-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20037-0000-4000-8000-000000000001', '12b20032-0000-4000-8000-000000000001', '12b20030-0000-4000-8000-000000000001', '2026-01-05'),
  ('12b20038-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20037-0000-4000-8000-000000000002', '12b20032-0000-4000-8000-000000000002', '12b20030-0000-4000-8000-000000000002', '2026-01-05');

insert into public.transport_weekly_earnings(
  id, factory_id, transport_worker_id, week_start, total_amount
)
values
  ('12b20039-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20030-0000-4000-8000-000000000001', '2026-01-05', 10),
  ('12b20039-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20030-0000-4000-8000-000000000002', '2026-01-05', 10);

insert into public.transport_weekly_earning_details(
  id, factory_id, transport_weekly_earning_id, transport_worker_id,
  week_start, transport_daily_entry_id, transport_crew_id, work_date,
  transport_crew_wage_rate_id, rate_per_paya_snapshot, paya_quantity_snapshot,
  attendance_count_snapshot, daily_crew_pool_snapshot, worker_daily_share_snapshot
)
values
  ('12b2003a-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20039-0000-4000-8000-000000000001', '12b20030-0000-4000-8000-000000000001', '2026-01-05', '12b20037-0000-4000-8000-000000000001', '12b20032-0000-4000-8000-000000000001', '2026-01-05', '12b20036-0000-4000-8000-000000000001', 10, 1, 1, 10, 10),
  ('12b2003a-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20039-0000-4000-8000-000000000002', '12b20030-0000-4000-8000-000000000002', '2026-01-05', '12b20037-0000-4000-8000-000000000002', '12b20032-0000-4000-8000-000000000002', '2026-01-05', '12b20036-0000-4000-8000-000000000002', 10, 1, 1, 10, 10);

insert into public.transport_withdrawals(
  id, factory_id, transport_worker_id, withdrawal_date, amount
)
values
  ('12b2003b-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20030-0000-4000-8000-000000000001', '2026-01-06', 1),
  ('12b2003b-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20030-0000-4000-8000-000000000002', '2026-01-06', 1);

insert into public.challans(
  id, factory_id, challan_number, challan_date, customer_id,
  customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
  company_name_snapshot, company_business_description_snapshot,
  company_address_snapshot, company_mobile_snapshot,
  vehicle_id, vehicle_number_snapshot, delivery_wage_applicable_snapshot,
  trip_labour_wage, challan_total, status, is_locked
)
values
  ('12b20004-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12B1-A', '2026-01-05', '12b20002-0000-4000-8000-000000000001', '12B1 Customer A', 'Address A', '9000000001', 'Factory A', 'Brick manufacturing', 'Address A', '9000000001', '12b20003-0000-4000-8000-000000000001', 'AT12A0001', true, 10, 0, 'active', false),
  ('12b20004-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12B1-B', '2026-01-05', '12b20002-0000-4000-8000-000000000002', '12B1 Customer B', 'Address B', '9000000002', 'Factory B', 'Brick manufacturing', 'Address B', '9000000002', '12b20003-0000-4000-8000-000000000002', 'AT12B0002', true, 10, 0, 'active', false);

insert into public.challan_items(
  id, factory_id, challan_id, brick_type_id, brick_particulars_snapshot,
  quantity, rate_per_1000_bricks, pricing_unit, line_amount,
  line_position, pricing_mode
)
values
  ('12b20005-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20004-0000-4000-8000-000000000001', '12b20001-0000-4000-8000-000000000001', '12B1 Brick A', 1000, 10, 'PER_1000_BRICKS', 10, 1, 'RATE'),
  ('12b20005-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20004-0000-4000-8000-000000000002', '12b20001-0000-4000-8000-000000000002', '12B1 Brick B', 1000, 10, 'PER_1000_BRICKS', 10, 1, 'RATE');

insert into public.challan_flexible_lines(
  id, factory_id, challan_id, line_type, line_category,
  order_index, particulars, amount
)
values
  ('12b20006-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20004-0000-4000-8000-000000000001', 'NOTE', 'NON_FINANCIAL', 0, '12B1 note A', 0),
  ('12b20006-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20004-0000-4000-8000-000000000002', 'NOTE', 'NON_FINANCIAL', 0, '12B1 note B', 0);

insert into public.customer_payments(
  id, factory_id, customer_id, payment_date, amount, note,
  customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot,
  company_name_snapshot, company_business_description_snapshot,
  company_address_snapshot, company_mobile_snapshot, payment_mode
)
values
  ('12b20007-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20002-0000-4000-8000-000000000001', '2026-01-06', 10, '12B1 payment A', '12B1 Customer A', 'Address A', '9000000001', 'Factory A', 'Brick manufacturing', 'Address A', '9000000001', 'cash'),
  ('12b20007-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20002-0000-4000-8000-000000000002', '2026-01-06', 10, '12B1 payment B', '12B1 Customer B', 'Address B', '9000000002', 'Factory B', 'Brick manufacturing', 'Address B', '9000000002', 'cash');

insert into public.customer_payment_methods(factory_id, payment_id, mode, split_amount)
values
  ('12b10000-0000-4000-8000-000000000001', '12b20007-0000-4000-8000-000000000001', 'cash', 10),
  ('12b10000-0000-4000-8000-000000000002', '12b20007-0000-4000-8000-000000000002', 'cash', 10);

insert into public.customer_payment_allocations(
  id, factory_id, payment_id, challan_id, allocated_amount
)
values
  ('12b20008-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20007-0000-4000-8000-000000000001', '12b20004-0000-4000-8000-000000000001', 10),
  ('12b20008-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20007-0000-4000-8000-000000000002', '12b20004-0000-4000-8000-000000000002', 10);

insert into public.coal_reference_values(id, factory_id, kind, display_value, created_by)
values
  ('12b2000f-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', 'coal_name', '12B1 Coal A', '12b00000-0000-4000-8000-000000000001'),
  ('12b20010-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', 'source_location', '12B1 Source A', '12b00000-0000-4000-8000-000000000001'),
  ('12b2000f-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', 'coal_name', '12B1 Coal B', '12b00000-0000-4000-8000-000000000002'),
  ('12b20010-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', 'source_location', '12B1 Source B', '12b00000-0000-4000-8000-000000000002');

insert into public.expense_records(
  id, factory_id, business_date, kind, supplier_id,
  counterparty_name_snapshot, description, total_amount, status, is_locked, created_by
)
values
  ('12b2000b-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', 'purchase', '12b20009-0000-4000-8000-000000000001', '12B1 Supplier A', 'Coal purchase A', 10, 'active', true, '12b00000-0000-4000-8000-000000000001'),
  ('12b2000c-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', 'expense', '12b20009-0000-4000-8000-000000000001', '12B1 Supplier A', 'Fuel purchase A', 10, 'active', true, '12b00000-0000-4000-8000-000000000001'),
  ('12b2000d-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', 'expense', '12b20009-0000-4000-8000-000000000001', '12B1 Supplier A', 'Maintenance A', 10, 'active', true, '12b00000-0000-4000-8000-000000000001'),
  ('12b2000e-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-05', 'expense', '12b20009-0000-4000-8000-000000000001', '12B1 Supplier A', 'Generic expense A', 10, 'active', true, '12b00000-0000-4000-8000-000000000001'),
  ('12b2000b-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', 'purchase', '12b20009-0000-4000-8000-000000000002', '12B1 Supplier B', 'Coal purchase B', 10, 'active', true, '12b00000-0000-4000-8000-000000000002'),
  ('12b2000c-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', 'expense', '12b20009-0000-4000-8000-000000000002', '12B1 Supplier B', 'Fuel purchase B', 10, 'active', true, '12b00000-0000-4000-8000-000000000002'),
  ('12b2000d-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', 'expense', '12b20009-0000-4000-8000-000000000002', '12B1 Supplier B', 'Maintenance B', 10, 'active', true, '12b00000-0000-4000-8000-000000000002'),
  ('12b2000e-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-05', 'expense', '12b20009-0000-4000-8000-000000000002', '12B1 Supplier B', 'Generic expense B', 10, 'active', true, '12b00000-0000-4000-8000-000000000002');

insert into public.coal_purchases(
  id, factory_id, coal_name_reference_id, source_reference_id,
  coal_name_snapshot, source_location_snapshot, vehicle_number_snapshot,
  quantity, rate, coal_amount, separate_freight_amount, created_by
)
values
  ('12b2000b-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b2000f-0000-4000-8000-000000000001', '12b20010-0000-4000-8000-000000000001', '12B1 Coal A', '12B1 Source A', 'AT12A0001', 1, 10, 10, 0, '12b00000-0000-4000-8000-000000000001'),
  ('12b2000b-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b2000f-0000-4000-8000-000000000002', '12b20010-0000-4000-8000-000000000002', '12B1 Coal B', '12B1 Source B', 'AT12B0002', 1, 10, 10, 0, '12b00000-0000-4000-8000-000000000002');

insert into public.vehicle_fuel_records(
  id, factory_id, vehicle_id, vehicle_number_snapshot, fuel_time,
  fuel_type, litres, rate_per_litre, created_by
)
values
  ('12b2000c-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20003-0000-4000-8000-000000000001', 'AT12A0001', '10:00', 'DIESEL', 1, 10, '12b00000-0000-4000-8000-000000000001'),
  ('12b2000c-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20003-0000-4000-8000-000000000002', 'AT12B0002', '10:00', 'DIESEL', 1, 10, '12b00000-0000-4000-8000-000000000002');

insert into public.vehicle_maintenance_records(
  id, factory_id, vehicle_id, vehicle_number_snapshot, work_description, created_by
)
values
  ('12b2000d-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20003-0000-4000-8000-000000000001', 'AT12A0001', '12B1 maintenance A', '12b00000-0000-4000-8000-000000000001'),
  ('12b2000d-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20003-0000-4000-8000-000000000002', 'AT12B0002', '12B1 maintenance B', '12b00000-0000-4000-8000-000000000002');

insert into public.expense_payments(
  id, factory_id, payment_date, amount, payment_mode, note, created_by
)
values
  ('12b20011-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-06', 10, 'cash', '12B1 expense payment A', '12b00000-0000-4000-8000-000000000001'),
  ('12b20011-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-06', 10, 'cash', '12B1 expense payment B', '12b00000-0000-4000-8000-000000000002');

insert into public.expense_payment_allocations(
  id, factory_id, payment_id, expense_record_id, allocated_amount
)
values
  ('12b20012-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20011-0000-4000-8000-000000000001', '12b2000e-0000-4000-8000-000000000001', 10),
  ('12b20012-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20011-0000-4000-8000-000000000002', '12b2000e-0000-4000-8000-000000000002', 10);

insert into public.cash_book_initializations(
  factory_id, start_date, opening_balance, created_by
)
values
  ('12b10000-0000-4000-8000-000000000001', '2026-01-01', 0, '12b00000-0000-4000-8000-000000000001'),
  ('12b10000-0000-4000-8000-000000000002', '2026-01-01', 0, '12b00000-0000-4000-8000-000000000002');

insert into public.cash_book_manual_entries(
  id, factory_id, business_date, direction, amount,
  payment_mode, party_details, note, status, created_by
)
values
  ('12b20013-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '2026-01-02', 'in', 1, 'cash', '12B1 party A', '12B1 cash A', 'active', '12b00000-0000-4000-8000-000000000001'),
  ('12b20013-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '2026-01-02', 'in', 1, 'cash', '12B1 party B', '12B1 cash B', 'active', '12b00000-0000-4000-8000-000000000002');

insert into public.vehicle_wage_payments(
  id, factory_id, vehicle_id, payment_date, amount, note, created_by
)
values
  ('12b2003c-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b20003-0000-4000-8000-000000000001', '2026-01-06', 1, '12B1 wage payment A', '12b00000-0000-4000-8000-000000000001'),
  ('12b2003c-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b20003-0000-4000-8000-000000000002', '2026-01-06', 1, '12B1 wage payment B', '12b00000-0000-4000-8000-000000000002');

insert into public.vehicle_wage_payment_reversals(
  id, factory_id, payment_id, reversal_date, reason, created_by
)
values
  ('12b2003d-0000-4000-8000-000000000001', '12b10000-0000-4000-8000-000000000001', '12b2003c-0000-4000-8000-000000000001', '2026-01-07', '12B1 reversal A', '12b00000-0000-4000-8000-000000000001'),
  ('12b2003d-0000-4000-8000-000000000002', '12b10000-0000-4000-8000-000000000002', '12b2003c-0000-4000-8000-000000000002', '2026-01-07', '12B1 reversal B', '12b00000-0000-4000-8000-000000000002');

-- For each table: run User A's positive control, reset to privileged authority
-- to prove the B fixture is non-empty, then immediately switch back to User A
-- for the paired cross-factory negative assertion.
do $$
declare
  covered_table record;
  own_count bigint;
  fixture_count bigint;
  foreign_count bigint;
  proven_count integer := 0;
begin
  for covered_table in select table_name, has_factory_id from atlas_12b1_manifest order by table_name loop
    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '12b00000-0000-4000-8000-000000000001', true
    );
    perform pg_temp.assert_identity(
      '12b00000-0000-4000-8000-000000000001',
      covered_table.table_name || ' positive SELECT'
    );

    if covered_table.table_name = 'factories' then
      select count(*) into own_count from public.factories
      where id = '12b10000-0000-4000-8000-000000000001';
    elsif covered_table.table_name = 'factory_users' then
      select count(*) into own_count from public.factory_users
      where user_id = '12b00000-0000-4000-8000-000000000001';
    else
      execute pg_catalog.format(
        'select count(*) from public.%I where factory_id = $1',
        covered_table.table_name
      ) into own_count using '12b10000-0000-4000-8000-000000000001'::uuid;
    end if;

    if own_count < 1 then
      raise exception 'FAIL: % positive control returned zero rows; table is NOT PROVEN',
        covered_table.table_name;
    end if;

    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    if current_user = 'authenticated' or auth.uid() is not null then
      raise exception 'FAIL: % Factory B proof inherited authenticated identity',
        covered_table.table_name;
    end if;

    if covered_table.table_name = 'factories' then
      select count(*) into fixture_count from public.factories
      where id = '12b10000-0000-4000-8000-000000000002';
    elsif covered_table.table_name = 'factory_users' then
      select count(*) into fixture_count from public.factory_users
      where user_id = '12b00000-0000-4000-8000-000000000002';
    else
      execute pg_catalog.format(
        'select count(*) from public.%I where factory_id = $1',
        covered_table.table_name
      ) into fixture_count using '12b10000-0000-4000-8000-000000000002'::uuid;
    end if;

    if fixture_count < 1 then
      raise exception 'FAIL: Factory B fixture for % is empty; table is NOT PROVEN',
        covered_table.table_name;
    end if;

    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '12b00000-0000-4000-8000-000000000001', true
    );
    perform pg_temp.assert_identity(
      '12b00000-0000-4000-8000-000000000001',
      covered_table.table_name || ' cross-factory SELECT'
    );

    if covered_table.table_name = 'factories' then
      select count(*) into foreign_count from public.factories
      where id = '12b10000-0000-4000-8000-000000000002';
    elsif covered_table.table_name = 'factory_users' then
      select count(*) into foreign_count from public.factory_users
      where user_id = '12b00000-0000-4000-8000-000000000002';
    else
      execute pg_catalog.format(
        'select count(*) from public.%I where factory_id = $1',
        covered_table.table_name
      ) into foreign_count using '12b10000-0000-4000-8000-000000000002'::uuid;
    end if;

    if foreign_count <> 0 then
      raise exception 'FAIL: cross-factory SELECT exposed % row(s) from %',
        foreign_count, covered_table.table_name;
    end if;
    proven_count := proven_count + 1;

    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  end loop;

  if proven_count <> 63 then
    raise exception 'FAIL: SELECT sweep proved % tables, expected 63', proven_count;
  end if;
  raise notice 'PASS [EXECUTED]: paired User A positive, non-empty B, and cross-factory negative controls passed for 63/63 tables';
end;
$$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12b00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12b00000-0000-4000-8000-000000000001', 'direct-write sweep');

-- Prove the live ACL+policy intersection. Only these direct writes are intended.
do $$
declare
  actual text[];
  expected text[] := array[
    'labour_groups:INSERT', 'labour_groups:UPDATE',
    'labourers:INSERT', 'labourers:UPDATE',
    'production_crews:INSERT', 'production_crews:UPDATE',
    'staff_categories:INSERT',
    'transport_crew_assignments:DELETE', 'transport_crew_assignments:INSERT',
    'transport_crews:INSERT', 'transport_crews:UPDATE',
    'transport_workers:INSERT', 'transport_workers:UPDATE'
  ];
begin
  select array_agg(operation order by operation) into actual
  from (
    select table_name || ':INSERT' as operation
    from atlas_12b1_manifest where auth_insert_acl and auth_insert_policy
    union all
    select table_name || ':UPDATE'
    from atlas_12b1_manifest where auth_update_acl and auth_update_policy
    union all
    select table_name || ':DELETE'
    from atlas_12b1_manifest where auth_delete_acl and auth_delete_policy
  ) as operations;
  select array_agg(value order by value) into expected from unnest(expected) as value;
  if actual is distinct from expected then
    raise exception 'FAIL: direct-write coverage manifest changed; actual % expected %', actual, expected;
  end if;
  raise notice 'PASS [EXECUTED]: unavailable direct operations asserted by live ACL+policy intersection for every table';
end;
$$;

-- Direct INSERT/UPDATE tests for labour_groups.
insert into public.labour_groups(factory_id, name, member_names, member_count, is_active)
values ('12b10000-0000-4000-8000-000000000001', '12B1 Direct Group A', 'Member A', 1, false);
select pg_temp.expect_block(
  'labour_groups Factory B INSERT',
  $$insert into public.labour_groups(factory_id,name,member_names,member_count,is_active)
    values ('12b10000-0000-4000-8000-000000000002','12B1 Forbidden Group B','Member B',1,false)$$,
  array['42501'], 'BLOCKED-BY-RLS'
);
do $$
declare affected bigint;
begin
  update public.labour_groups set name = '12B1 Group A Updated'
  where id = '12b20014-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: labour_groups Factory A UPDATE positive control'; end if;
  update public.labour_groups set name = '12B1 Forbidden Group B Updated'
  where id = '12b20014-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: labour_groups Factory B UPDATE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: labour_groups Factory B UPDATE';
end;
$$;

-- Direct INSERT/UPDATE tests for labourers.
insert into public.labourers(factory_id, name, production_origin_label)
values ('12b10000-0000-4000-8000-000000000001', '12B1 Direct Labourer A', 'Origin A');
select pg_temp.expect_block(
  'labourers Factory B INSERT',
  $$insert into public.labourers(factory_id,name,production_origin_label)
    values ('12b10000-0000-4000-8000-000000000002','12B1 Forbidden Labourer B','Origin B')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);
do $$
declare affected bigint;
begin
  update public.labourers set name = '12B1 Labourer A Updated'
  where id = '12b20015-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: labourers Factory A UPDATE positive control'; end if;
  update public.labourers set name = '12B1 Forbidden Labourer B Updated'
  where id = '12b20015-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: labourers Factory B UPDATE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: labourers Factory B UPDATE';
end;
$$;

-- Direct INSERT/UPDATE tests for production_crews.
insert into public.production_crews(factory_id, name)
values ('12b10000-0000-4000-8000-000000000001', '12B1 Direct Production Crew A');
select pg_temp.expect_block(
  'production_crews Factory B INSERT',
  $$insert into public.production_crews(factory_id,name)
    values ('12b10000-0000-4000-8000-000000000002','12B1 Forbidden Production Crew B')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);
do $$
declare affected bigint;
begin
  update public.production_crews set name = '12B1 Production Crew A Updated'
  where id = '12b20016-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: production_crews Factory A UPDATE positive control'; end if;
  update public.production_crews set name = '12B1 Forbidden Production Crew B Updated'
  where id = '12b20016-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: production_crews Factory B UPDATE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: production_crews Factory B UPDATE';
end;
$$;

-- staff_categories exposes direct INSERT only; UPDATE is blocked by ACL despite a policy.
insert into public.staff_categories(factory_id, name)
values ('12b10000-0000-4000-8000-000000000001', '12B1 Direct Staff Category A');
select pg_temp.expect_block(
  'staff_categories Factory B INSERT',
  $$insert into public.staff_categories(factory_id,name)
    values ('12b10000-0000-4000-8000-000000000002','12B1 Forbidden Staff Category B')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);

-- Direct INSERT/UPDATE tests for transport_workers and transport_crews.
insert into public.transport_workers(factory_id, name)
values ('12b10000-0000-4000-8000-000000000001', '12B1 Direct Transport Worker A');
select pg_temp.expect_block(
  'transport_workers Factory B INSERT',
  $$insert into public.transport_workers(factory_id,name)
    values ('12b10000-0000-4000-8000-000000000002','12B1 Forbidden Transport Worker B')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);
do $$
declare affected bigint;
begin
  update public.transport_workers set name = '12B1 Transport Worker A Updated'
  where id = '12b20030-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: transport_workers Factory A UPDATE positive control'; end if;
  update public.transport_workers set name = '12B1 Forbidden Transport Worker B Updated'
  where id = '12b20030-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: transport_workers Factory B UPDATE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: transport_workers Factory B UPDATE';
end;
$$;

insert into public.transport_crews(factory_id, name)
values ('12b10000-0000-4000-8000-000000000001', '12B1 Direct Transport Crew A');
select pg_temp.expect_block(
  'transport_crews Factory B INSERT',
  $$insert into public.transport_crews(factory_id,name)
    values ('12b10000-0000-4000-8000-000000000002','12B1 Forbidden Transport Crew B')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);
do $$
declare affected bigint;
begin
  update public.transport_crews set name = '12B1 Transport Crew A Updated'
  where id = '12b20032-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: transport_crews Factory A UPDATE positive control'; end if;
  update public.transport_crews set name = '12B1 Forbidden Transport Crew B Updated'
  where id = '12b20032-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: transport_crews Factory B UPDATE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: transport_crews Factory B UPDATE';
end;
$$;

-- transport_crew_assignments supports direct INSERT and DELETE.
insert into public.transport_crew_assignments(
  factory_id, transport_worker_id, transport_crew_id
)
values (
  '12b10000-0000-4000-8000-000000000001',
  '12b20031-0000-4000-8000-000000000001',
  '12b20033-0000-4000-8000-000000000001'
);

select pg_temp.expect_block(
  'transport_crew_assignments Factory B INSERT',
  $$insert into public.transport_crew_assignments(factory_id,transport_worker_id,transport_crew_id)
    values ('12b10000-0000-4000-8000-000000000002','12b20031-0000-4000-8000-000000000002','12b20033-0000-4000-8000-000000000002')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);

do $$
declare affected bigint;
begin
  delete from public.transport_crew_assignments
  where factory_id = '12b10000-0000-4000-8000-000000000001'
    and transport_worker_id = '12b20031-0000-4000-8000-000000000001'
    and transport_crew_id = '12b20033-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: transport assignment Factory A DELETE positive control'; end if;

  delete from public.transport_crew_assignments
  where id = '12b20034-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: transport assignment Factory B DELETE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: transport_crew_assignments Factory B DELETE';
end;
$$;

-- Identifier mixing: A factory with B children reaches composite-FK protection;
-- B factory with A children is rejected first by RLS.
select pg_temp.expect_block(
  'transport assignment Factory A plus Factory B child IDs',
  $$insert into public.transport_crew_assignments(factory_id,transport_worker_id,transport_crew_id)
    values ('12b10000-0000-4000-8000-000000000001','12b20031-0000-4000-8000-000000000002','12b20033-0000-4000-8000-000000000002')$$,
  array['23503'], 'OTHER-EXPECTED-BLOCK'
);
select pg_temp.expect_block(
  'transport assignment Factory B plus Factory A child IDs',
  $$insert into public.transport_crew_assignments(factory_id,transport_worker_id,transport_crew_id)
    values ('12b10000-0000-4000-8000-000000000002','12b20031-0000-4000-8000-000000000001','12b20033-0000-4000-8000-000000000001')$$,
  array['42501'], 'BLOCKED-BY-RLS'
);

-- factory_users has broad ACLs but only a SELECT policy. Direct authority changes fail closed.
select pg_temp.expect_block(
  'factory_users direct Factory B membership acquisition',
  $$insert into public.factory_users(user_id,factory_id,is_active)
    values ('12b00000-0000-4000-8000-000000000001','12b10000-0000-4000-8000-000000000002',true)$$,
  array['42501'], 'BLOCKED-BY-RLS'
);
do $$
declare affected bigint;
begin
  update public.factory_users
  set factory_id = '12b10000-0000-4000-8000-000000000002'
  where user_id = '12b00000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: factory_users direct UPDATE affected % rows', affected; end if;

  delete from public.factory_users
  where user_id = '12b00000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: factory_users cross-factory DELETE affected % rows', affected; end if;
  raise notice 'PASS [EXECUTED] [ZERO-ROWS-AFFECTED]: factory_users direct UPDATE/DELETE';
end;
$$;

-- Inactive membership: deactivate through privileged fixture authority, then fail closed.
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if current_user = 'authenticated' or auth.uid() is not null then
    raise exception 'FAIL: inactive-member fixture step inherited authenticated identity';
  end if;
  update public.factory_users set is_active = false
  where user_id = '12b00000-0000-4000-8000-000000000001';
  if not found then raise exception 'FAIL: could not deactivate synthetic User A'; end if;
end;
$$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '12b00000-0000-4000-8000-000000000001', true);
select pg_temp.assert_identity('12b00000-0000-4000-8000-000000000001', 'inactive-member sweep');
do $$
declare visible_count bigint;
begin
  select count(*) into visible_count from public.factories
  where id = '12b10000-0000-4000-8000-000000000001';
  if visible_count <> 0 then raise exception 'FAIL: inactive user can read factory root'; end if;

  select count(*) into visible_count from public.customers
  where factory_id = '12b10000-0000-4000-8000-000000000001';
  if visible_count <> 0 then raise exception 'FAIL: inactive user can read direct-read tenant data'; end if;

  update public.labour_groups set name = '12B1 Inactive Forbidden Update'
  where id = '12b20014-0000-4000-8000-000000000001';
  get diagnostics visible_count = row_count;
  if visible_count <> 0 then raise exception 'FAIL: inactive user updated writable tenant data'; end if;

  raise notice 'PASS [EXECUTED]: inactive member cannot read factory/customer rows or update labour_groups';
end;
$$;
select pg_temp.expect_block(
  'inactive member labour_groups INSERT',
  $$insert into public.labour_groups(factory_id,name,member_names,member_count,is_active)
    values ('12b10000-0000-4000-8000-000000000001','12B1 Inactive Insert','Member',1,false)$$,
  array['42501'], 'BLOCKED-BY-RLS'
);

-- anon sweep: every public tenant table must return zero or deny SELECT by ACL.
reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare
  covered_table record;
  visible_count bigint;
  acl_blocks integer := 0;
  rls_zeroes integer := 0;
begin
  if current_user <> 'anon' or auth.uid() is not null then
    raise exception 'FAIL: anon sweep role/JWT mismatch';
  end if;

  for covered_table in select table_name, has_factory_id from atlas_12b1_manifest order by table_name loop
    begin
      if covered_table.table_name = 'factories' then
        select count(*) into visible_count from public.factories
        where id in (
          '12b10000-0000-4000-8000-000000000001',
          '12b10000-0000-4000-8000-000000000002'
        );
      elsif covered_table.table_name = 'factory_users' then
        select count(*) into visible_count from public.factory_users
        where user_id in (
          '12b00000-0000-4000-8000-000000000001',
          '12b00000-0000-4000-8000-000000000002'
        );
      else
        execute pg_catalog.format(
          'select count(*) from public.%I where factory_id in ($1,$2)',
          covered_table.table_name
        ) into visible_count using
          '12b10000-0000-4000-8000-000000000001'::uuid,
          '12b10000-0000-4000-8000-000000000002'::uuid;
      end if;

      if visible_count <> 0 then
        raise exception 'FAIL: anon read % synthetic row(s) from %',
          visible_count, covered_table.table_name;
      end if;
      rls_zeroes := rls_zeroes + 1;
    exception when insufficient_privilege then
      acl_blocks := acl_blocks + 1;
    end;
  end loop;

  if acl_blocks + rls_zeroes <> 63 then
    raise exception 'FAIL: anon sweep covered % tables, expected 63', acl_blocks + rls_zeroes;
  end if;
  raise notice 'PASS [EXECUTED]: anon 63-table sweep: % BLOCKED-BY-ACL, % zero rows through RLS',
    acl_blocks, rls_zeroes;
end;
$$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
rollback;

-- Persistent post-ROLLBACK proof. Any mismatch exits non-zero.
do $$
declare
  covered_table record;
  ending_count bigint;
  mismatches text[] := array[]::text[];
begin
  for covered_table in
    select manifest.table_name, baseline.row_count
    from atlas_12b1_manifest as manifest
    join atlas_12b1_persistent_counts as baseline using (table_name)
    order by manifest.table_name
  loop
    execute pg_catalog.format('select count(*) from public.%I', covered_table.table_name)
      into ending_count;
    if ending_count <> covered_table.row_count then
      mismatches := array_append(
        mismatches,
        pg_catalog.format('%s before=%s after=%s',
          covered_table.table_name, covered_table.row_count, ending_count)
      );
    end if;
  end loop;

  if cardinality(mismatches) > 0 then
    raise exception 'FAIL: rollback changed persistent table counts: %', mismatches;
  end if;
  raise notice 'PASS [EXECUTED]: post-ROLLBACK counts match for 63/63 public tables';
end;
$$;

select
  63 as inventoried_tables,
  63 as executed_and_passed,
  0 as not_exercised,
  63 as authenticated_positive_selects,
  63 as cross_factory_negative_selects,
  63 as anon_tables_checked,
  (select count(*) from atlas_12b1_manifest where not anon_select_acl) as anon_blocked_by_acl,
  (select count(*) from atlas_12b1_manifest where anon_select_acl) as anon_zero_rows_through_rls,
  13 as intended_direct_write_operations,
  13 as direct_write_positive_controls,
  7 as direct_write_negatives_blocked_by_rls,
  6 as direct_write_negatives_zero_rows,
  2 as identifier_mixing_checks,
  true as inactive_member_failed_closed,
  63 as persistent_count_pairs_compared,
  0 as persistent_count_mismatches,
  true as persistent_counts_match;

drop table atlas_12b1_persistent_counts;
drop table atlas_12b1_manifest;
