-- Production Phase 2C cutover rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260915000050.

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
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  open_labourer_id uuid := 'f25c0000-0000-4000-8000-000000000101';
  settled_labourer_id uuid := 'f25c0000-0000-4000-8000-000000000202';
  factory_b_labourer_id uuid := 'f25c0000-0000-4000-8000-000000000303';
  historical_weekly_id uuid := gen_random_uuid();
  mud_group_id uuid := gen_random_uuid();
  mud_rate_id uuid := gen_random_uuid();
  cutoff_entry_id uuid := gen_random_uuid();
  post_cutoff_entry_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Cutover Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Cutover Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Cutover Brick A'),
    (brick_b_id, factory_b_id, 'Cutover Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (open_labourer_id, factory_a_id, 'Open Cutover Labourer', brick_a_id),
    (settled_labourer_id, factory_a_id, 'Settled Cutover Labourer', brick_a_id),
    (factory_b_labourer_id, factory_b_id, 'Factory B Cutover Labourer', brick_b_id);

  insert into public.production_wage_rates(
    factory_id, production_crew_id, labourer_id, rate_per_1000_bricks, effective_from
  ) values
    (factory_a_id, null, open_labourer_id, 500, date '2026-09-01'),
    (factory_a_id, null, settled_labourer_id, 800, date '2026-08-01'),
    (factory_b_id, null, factory_b_labourer_id, 900, date '2026-08-01');

  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, settled_labourer_id, brick_a_id, date '2026-08-17', 1000),
    (cutoff_entry_id, factory_a_id, settled_labourer_id, brick_a_id, date '2026-09-10', 1000),
    (post_cutoff_entry_id, factory_a_id, settled_labourer_id, brick_a_id, date '2026-09-11', 1000),
    (gen_random_uuid(), factory_b_id, factory_b_labourer_id, brick_b_id, date '2026-09-11', 1000);

  insert into public.weekly_earnings(
    id, factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  ) values (
    historical_weekly_id, factory_a_id, settled_labourer_id,
    date '2026-08-31', 1000, null, null, 700
  );
  insert into public.production_earning_settlements(
    factory_id, labourer_id, previous_settled_through, settled_through,
    total_quantity, total_earned, settlement_type
  ) values (
    factory_a_id, settled_labourer_id, null, date '2026-09-06',
    1000, 700, 'legacy_opening'
  );

  insert into public.labour_groups(id, factory_id, name, member_names)
  values (mud_group_id, factory_a_id, 'Cutover Mud Group', 'Mud Team');
  insert into public.wage_rates(
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (mud_rate_id, factory_a_id, 'mud_supply', 100, date '2026-08-17');

  perform set_config('atlas_cutover.user_id', test_user_id::text, true);
  perform set_config('atlas_cutover.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_cutover.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_cutover.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_cutover.open_labourer_id', open_labourer_id::text, true);
  perform set_config('atlas_cutover.settled_labourer_id', settled_labourer_id::text, true);
  perform set_config('atlas_cutover.factory_b_labourer_id', factory_b_labourer_id::text, true);
  perform set_config('atlas_cutover.historical_weekly_id', historical_weekly_id::text, true);
  perform set_config('atlas_cutover.mud_group_id', mud_group_id::text, true);
  perform set_config('atlas_cutover.cutoff_entry_id', cutoff_entry_id::text, true);
  perform set_config('atlas_cutover.post_cutoff_entry_id', post_cutoff_entry_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_cutover.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_cutover.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_cutover.factory_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_cutover.brick_a_id')::uuid;
  open_labourer_id uuid := current_setting('atlas_cutover.open_labourer_id')::uuid;
  settled_labourer_id uuid := current_setting('atlas_cutover.settled_labourer_id')::uuid;
  factory_b_labourer_id uuid := current_setting('atlas_cutover.factory_b_labourer_id')::uuid;
  historical_weekly_id uuid := current_setting('atlas_cutover.historical_weekly_id')::uuid;
  mud_group_id uuid := current_setting('atlas_cutover.mud_group_id')::uuid;
  cutoff_entry_id uuid := current_setting('atlas_cutover.cutoff_entry_id')::uuid;
  post_cutoff_entry_id uuid := current_setting('atlas_cutover.post_cutoff_entry_id')::uuid;
  new_entry_id uuid := gen_random_uuid();
  saved record;
  withdrawal record;
  account_before record;
  account_after record;
  mud_result record;
  open_rate_count bigint;
  historical_weekly_count bigint;
  historical_detail_count bigint;
  transport_entry_count bigint;
  transport_earning_count bigint;
begin
  select count(*) into historical_weekly_count from public.weekly_earnings;
  select count(*) into historical_detail_count from public.production_weekly_earning_details;
  select count(*) into transport_entry_count from public.transport_daily_entries;
  select count(*) into transport_earning_count from public.transport_weekly_earnings;

  select * into withdrawal from public.create_labourer_withdrawal(
    factory_a_id, settled_labourer_id, date '2026-09-12', date '2026-09-10', 100
  );
  if withdrawal.settled_through <> date '2026-09-10'
    or withdrawal.available_balance <> 2200 then
    raise exception 'FAIL: settlement foundation fixture did not settle through cutoff';
  end if;

  perform pg_temp.expect_error(
    'controlled save rejects Production on cutoff', 'P2520',
    format('select * from public.save_production_entry(%L::uuid,%L::uuid,%L::uuid,%L::uuid,date %L,1100)',
      factory_a_id, cutoff_entry_id, settled_labourer_id, brick_a_id, '2026-09-10')
  );
  perform pg_temp.expect_error(
    'controlled save rejects Production before cutoff', 'P2520',
    format('select * from public.save_production_entry(%L::uuid,%L::uuid,%L::uuid,%L::uuid,date %L,100)',
      factory_a_id, gen_random_uuid(), settled_labourer_id, brick_a_id, '2026-09-09')
  );
  if (select quantity from public.production_entries where id = cutoff_entry_id) <> 1000 then
    raise exception 'FAIL: rejected settled edit changed its Production quantity';
  end if;
  raise notice 'PASS: controlled save rejects inserts and edits on or before the cutoff';

  select count(*) into open_rate_count
  from public.production_wage_rates
  where factory_id = factory_a_id and labourer_id = open_labourer_id;
  perform pg_temp.expect_error(
    'multi-labourer settled rate update is atomic', 'P2521',
    format('select * from public.set_production_labourer_rates(%L::uuid,array[%L::uuid,%L::uuid],600,date %L)',
      factory_a_id, settled_labourer_id, open_labourer_id, '2026-09-09')
  );
  if (select count(*) from public.production_wage_rates
      where factory_id = factory_a_id and labourer_id = open_labourer_id) <> open_rate_count
    or not exists (
      select 1 from public.production_wage_rates
      where factory_id = factory_a_id and labourer_id = open_labourer_id
        and rate_per_1000_bricks = 500 and effective_to is null
    ) then
    raise exception 'FAIL: rejected multi-rate update left a partial open-labourer change';
  end if;
  raise notice 'PASS: one settled labourer rolls back the entire multi-labourer rate update';

  perform public.set_production_labourer_rates(
    factory_a_id, array[settled_labourer_id], 900, date '2026-09-11'
  );
  if not exists (
    select 1 from public.production_wage_rates
    where factory_id = factory_a_id and labourer_id = settled_labourer_id
      and rate_per_1000_bricks = 800 and effective_to = date '2026-09-10'
  ) or not exists (
    select 1 from public.production_wage_rates
    where factory_id = factory_a_id and labourer_id = settled_labourer_id
      and rate_per_1000_bricks = 900 and effective_from = date '2026-09-11'
      and effective_to is null
  ) then
    raise exception 'FAIL: post-cutoff rate replacement did not preserve the settled interval';
  end if;
  raise notice 'PASS: a post-cutoff rate safely closes and replaces the open rate period';

  select * into account_before from public.get_production_labourer_account(
    factory_a_id, settled_labourer_id, date '2026-09-15'
  );
  select * into saved from public.save_production_entry(
    factory_a_id, post_cutoff_entry_id, settled_labourer_id, brick_a_id,
    date '2026-09-11', 1200
  );
  if saved.id <> post_cutoff_entry_id or saved.quantity <> 1200 then
    raise exception 'FAIL: post-cutoff Production update returned the wrong row';
  end if;
  select * into account_after from public.get_production_labourer_account(
    factory_a_id, settled_labourer_id, date '2026-09-15'
  );
  if account_after.available_balance - account_before.available_balance <> 180 then
    raise exception 'FAIL: live balance did not immediately reflect the post-cutoff correction';
  end if;

  select * into saved from public.save_production_entry(
    factory_a_id, new_entry_id, settled_labourer_id, brick_a_id,
    date '2026-09-12', 500
  );
  select * into saved from public.save_production_entry(
    factory_a_id, new_entry_id, settled_labourer_id, brick_a_id,
    date '2026-09-12', 600
  );
  if saved.id <> new_entry_id or saved.quantity <> 600
    or (select count(*) from public.production_entries
        where factory_id = factory_a_id and labourer_id = settled_labourer_id
          and production_date = date '2026-09-12') <> 1 then
    raise exception 'FAIL: idempotent create retry did not preserve one daily record';
  end if;
  select * into account_after from public.get_production_labourer_account(
    factory_a_id, settled_labourer_id, date '2026-09-15'
  );
  if account_after.available_balance <> 3020 then
    raise exception 'FAIL: settled plus live account expected 3020 after post-cutoff saves, got %', account_after.available_balance;
  end if;
  raise notice 'PASS: post-cutoff create/update is idempotent and changes Available Balance immediately';

  perform pg_temp.expect_error(
    'legacy Production Calculate Wages is disabled', 'P2522',
    format('select * from public.calculate_production_wages(%L::uuid,date %L)', factory_a_id, '2026-09-07')
  );
  if (select count(*) from public.weekly_earnings) <> historical_weekly_count
    or (select count(*) from public.production_weekly_earning_details) <> historical_detail_count
    or not exists (
      select 1 from public.weekly_earnings
      where id = historical_weekly_id and quantity_used = 1000 and amount = 700
    ) then
    raise exception 'FAIL: disabled Production calculator changed historical weekly rows';
  end if;
  raise notice 'PASS: legacy Production weekly posting is disabled and historical rows stay unchanged';

  select * into mud_result from public.calculate_mud_supply_wages(
    factory_a_id, mud_group_id, date '2026-08-17'
  );
  if mud_result.groups_calculated <> 1 or mud_result.rows_skipped <> 0
    or (select quantity_used from public.weekly_earnings where id = mud_result.weekly_earning_id) <> 1000
    or (select amount from public.weekly_earnings where id = mud_result.weekly_earning_id) <> 100 then
    raise exception 'FAIL: Mud weekly calculation changed during Production cutover';
  end if;
  raise notice 'PASS: Mud Supply weekly calculation still posts the exact existing result';

  if (select count(*) from public.transport_daily_entries) <> transport_entry_count
    or (select count(*) from public.transport_weekly_earnings) <> transport_earning_count
    or to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)') is null then
    raise exception 'FAIL: Chamber Transport changed during Production cutover';
  end if;
  raise notice 'PASS: Chamber Transport data and wage authority remain unchanged';

  perform pg_temp.expect_error(
    'Factory A cannot save Factory B Production', '42501',
    format('select * from public.save_production_entry(%L::uuid,%L::uuid,%L::uuid,%L::uuid,date %L,100)',
      factory_b_id, gen_random_uuid(), factory_b_labourer_id, brick_a_id, '2026-09-12')
  );
  if exists (select 1 from public.production_entries where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B Production';
  end if;
  if has_table_privilege('authenticated', 'public.production_entries', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_entries', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_entries', 'DELETE') then
    raise exception 'FAIL: authenticated still has a direct Production mutation privilege';
  end if;
  raise notice 'PASS: Production RPC and table access remain factory-isolated with direct writes revoked';

  if position('production_account:' in pg_get_functiondef(
      'public.create_labourer_withdrawal(uuid,uuid,date,date,numeric)'::regprocedure
    )) = 0
    or position('production_account:' in pg_get_functiondef(
      'public.assert_production_date_is_unsettled(uuid,uuid,date)'::regprocedure
    )) = 0
    or position('production_account:' in pg_get_functiondef(
      'public.set_production_labourer_rates(uuid,uuid[],numeric,date)'::regprocedure
    )) = 0 then
    raise exception 'FAIL: settlement, Production save, and rate paths do not share the account lock';
  end if;
  raise notice 'PASS: settlement, Production save, and rate changes serialize on the same account lock';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_cutover.factory_a_id')::uuid;
  brick_a_id uuid := current_setting('atlas_cutover.brick_a_id')::uuid;
  settled_labourer_id uuid := current_setting('atlas_cutover.settled_labourer_id')::uuid;
  cutoff_entry_id uuid := current_setting('atlas_cutover.cutoff_entry_id')::uuid;
begin
  perform pg_temp.expect_error(
    'table trigger rejects direct settled insert', 'P2520',
    format('insert into public.production_entries(id,factory_id,labourer_id,brick_type_id,production_date,quantity) values (%L::uuid,%L::uuid,%L::uuid,%L::uuid,date %L,100)',
      gen_random_uuid(), factory_a_id, settled_labourer_id, brick_a_id, '2026-09-09')
  );
  perform pg_temp.expect_error(
    'table trigger rejects direct settled update', 'P2520',
    format('update public.production_entries set quantity = 1100 where id = %L::uuid', cutoff_entry_id)
  );
  perform pg_temp.expect_error(
    'table trigger rejects direct settled delete', 'P2520',
    format('delete from public.production_entries where id = %L::uuid', cutoff_entry_id)
  );
  if (select quantity from public.production_entries where id = cutoff_entry_id) <> 1000 then
    raise exception 'FAIL: direct settled mutation altered the protected entry';
  end if;
  raise notice 'PASS: database trigger blocks alternate insert, update, and delete paths on settled dates';
end;
$$;

select 'PASS: all Production cutover fixtures are transaction-local and will roll back' as result;
rollback;
