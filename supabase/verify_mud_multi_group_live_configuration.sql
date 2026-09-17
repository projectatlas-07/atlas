-- Mud Multi-Group Phase 2 rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260916000053.

begin;

create or replace function pg_temp.expect_error(test_label text, expected_sqlstate text, statement_to_test text)
returns void language plpgsql as $$
begin
  execute statement_to_test;
  raise exception 'FAIL: % unexpectedly succeeded', test_label using errcode = 'P9999';
exception when others then
  if sqlstate = expected_sqlstate then
    raise notice 'PASS: %', test_label;
  else
    raise exception 'FAIL: % expected SQLSTATE %, received % (%)', test_label, expected_sqlstate, sqlstate, sqlerrm;
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
  labourer_a_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  missing_rate_group_id uuid := gen_random_uuid();
  factory_b_group_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.mud_accounting_states)
      <> (select count(*) from public.factories)
    or exists (
      select 1
      from public.factories
      left join public.mud_accounting_states
        on mud_accounting_states.factory_id = factories.id
      where mud_accounting_states.factory_id is null
    ) then
    raise exception 'FAIL: an existing factory is missing its Mud accounting state';
  end if;
  raise notice 'PASS: every existing factory has one valid Mud accounting state; prior audited transitions are allowed';

  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then raise exception 'FAIL: verifier requires one factory_users row'; end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Mud Phase 2 Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Mud Phase 2 Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  if not exists (select 1 from public.mud_accounting_states where factory_id = factory_a_id and accounting_mode = 'LEGACY_WEEKLY')
    or not exists (select 1 from public.mud_accounting_states where factory_id = factory_b_id and accounting_mode = 'LEGACY_WEEKLY') then
    raise exception 'FAIL: new factories did not automatically initialize LEGACY_WEEKLY';
  end if;
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Mud Phase 2 Brick A'),
    (brick_b_id, factory_b_id, 'Mud Phase 2 Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (labourer_a_id, factory_a_id, 'Mud Phase 2 Labourer A', brick_a_id),
    (labourer_b_id, factory_b_id, 'Mud Phase 2 Labourer B', brick_b_id);
  insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity) values
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-08-31', 12345),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-10', 100000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-12', 170000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-18', 12345),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-20', 5),
    (gen_random_uuid(), factory_b_id, labourer_b_id, brick_b_id, date '2026-09-10', 9999);
  insert into public.wage_rates(factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values (factory_a_id, 'mud_supply', 30, date '2026-08-31');

  insert into public.labour_groups(id, factory_id, name, member_count, is_active)
  values
    (missing_rate_group_id, factory_a_id, 'Missing Rate Group', 1, false),
    (factory_b_group_id, factory_b_id, 'Factory B Group', 2, true);
  insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
  values (factory_b_id, factory_b_group_id, 2, date '2026-09-01');
  insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from)
  values (factory_b_id, factory_b_group_id, 999, date '2026-09-01');

  perform set_config('atlas_mud_phase2.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_phase2.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_mud_phase2.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_mud_phase2.missing_rate_group_id', missing_rate_group_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_phase2.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_phase2.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_mud_phase2.factory_b_id')::uuid;
  missing_rate_group_id uuid := current_setting('atlas_mud_phase2.missing_rate_group_id')::uuid;
  group_a_id uuid;
  group_b_id uuid;
  lower_group_id uuid;
  result record;
  weekly_count bigint;
  withdrawal_count bigint;
  settlement_count bigint;
  settlement_detail_count bigint;
  transport_daily_count bigint;
  transport_earning_count bigint;
  mud_function_before text;
  withdrawal_function_before text;
  production_function_before text;
  transport_function_before text;
begin
  select count(*) into weekly_count from public.weekly_earnings;
  select count(*) into withdrawal_count from public.withdrawals;
  select count(*) into settlement_count from public.production_earning_settlements;
  select count(*) into settlement_detail_count from public.production_earning_settlement_details;
  select count(*) into transport_daily_count from public.transport_daily_entries;
  select count(*) into transport_earning_count from public.transport_weekly_earnings;
  mud_function_before := md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)')));
  withdrawal_function_before := md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)')));
  production_function_before := md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)')));
  transport_function_before := md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)')));

  group_a_id := public.create_mud_group(factory_a_id, 'Group A', 6, date '2026-08-31', 100, date '2026-08-31');
  group_b_id := public.create_mud_group(factory_a_id, 'Group B', 9, date '2026-09-01', 120, date '2026-09-01');
  if (select count(*) from public.labour_groups where factory_id = factory_a_id and is_active) <> 1
    or not exists (select 1 from public.labour_groups where id = group_a_id and is_active)
    or not exists (select 1 from public.labour_groups where id = group_b_id and not is_active) then
    raise exception 'FAIL: create group did not preserve exactly one legacy weekly marker';
  end if;
  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'LEGACY_WEEKLY'
    or exists (select 1 from public.mud_accounting_mode_transitions where factory_id = factory_a_id) then
    raise exception 'FAIL: configuration operation changed financial accounting mode';
  end if;
  if (select count(*) from public.get_mud_group_configuration(factory_a_id, date '2026-09-10') where is_earning) <> 2 then
    raise exception 'FAIL: two created groups are not simultaneously earning from terms';
  end if;
  raise notice 'PASS: first and second groups are created atomically; terms overlap while the legacy marker stays singular';

  select * into result from public.get_mud_group_daily_allocation(factory_a_id, date '2026-08-31');
  if result.labour_group_id <> group_a_id or result.allocated_production <> 12345 or result.earned_amount <> 1234.5 then
    raise exception 'FAIL: one-group live allocation is wrong';
  end if;
  if not exists (select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-10') where labour_group_id = group_a_id and member_count = 6 and allocated_production = 40000 and rate_per_1000_bricks = 100 and earned_amount = 4000)
    or not exists (select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-10') where labour_group_id = group_b_id and member_count = 9 and allocated_production = 60000 and rate_per_1000_bricks = 120 and earned_amount = 7200)
    or (select sum(allocated_production) from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-10')) <> 100000 then
    raise exception 'FAIL: 6:9 multi-group allocation is wrong';
  end if;
  raise notice 'PASS: one-group and 6:9 multi-group allocation preserve exact eligible Production';

  perform public.set_mud_group_member_count(factory_a_id, group_a_id, 7, date '2026-09-15');
  perform public.set_mud_group_member_count(factory_a_id, group_a_id, 8, date '2026-09-12');
  if not exists (select 1 from public.mud_group_terms where labour_group_id = group_a_id and member_count = 6 and effective_from = date '2026-08-31' and effective_to = date '2026-09-11')
    or not exists (select 1 from public.mud_group_terms where labour_group_id = group_a_id and member_count = 8 and effective_from = date '2026-09-12' and effective_to = date '2026-09-14')
    or not exists (select 1 from public.mud_group_terms where labour_group_id = group_a_id and member_count = 7 and effective_from = date '2026-09-15' and effective_to is null) then
    raise exception 'FAIL: member-count changes did not split and preserve history';
  end if;
  perform public.set_mud_group_rate(factory_a_id, group_a_id, 110, date '2026-09-15');
  perform public.set_mud_group_rate(factory_a_id, group_a_id, 105, date '2026-09-12');
  if not exists (select 1 from public.mud_group_rates where labour_group_id = group_a_id and rate_per_1000_bricks = 100 and effective_from = date '2026-08-31' and effective_to = date '2026-09-11')
    or not exists (select 1 from public.mud_group_rates where labour_group_id = group_a_id and rate_per_1000_bricks = 105 and effective_from = date '2026-09-12' and effective_to = date '2026-09-14')
    or not exists (select 1 from public.mud_group_rates where labour_group_id = group_a_id and rate_per_1000_bricks = 110 and effective_from = date '2026-09-15' and effective_to is null) then
    raise exception 'FAIL: group-rate changes did not split and preserve history';
  end if;
  if not exists (select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-12') where labour_group_id = group_a_id and member_count = 8 and allocated_production = 80000 and rate_per_1000_bricks = 105 and earned_amount = 8400)
    or not exists (select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-12') where labour_group_id = group_b_id and allocated_production = 90000 and earned_amount = 10800) then
    raise exception 'FAIL: backdated member/rate configuration did not drive date-specific allocation';
  end if;
  raise notice 'PASS: normal and backdated member/rate changes split exact non-overlapping periods';

  perform public.stop_mud_group_earning(factory_a_id, group_b_id, date '2026-09-18');
  select * into result from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-18');
  if result.labour_group_id <> group_a_id or result.allocated_production <> 12345 then
    raise exception 'FAIL: stopped group still participated in allocation';
  end if;
  perform public.restart_mud_group_earning(factory_a_id, group_b_id, 1, date '2026-09-20');
  perform public.set_mud_group_member_count(factory_a_id, group_a_id, 1, date '2026-09-20');
  lower_group_id := least(group_a_id, group_b_id);
  if (select sum(allocated_production) from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-20')) <> 5
    or not exists (select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-20') where labour_group_id = lower_group_id and allocated_production = 3) then
    raise exception 'FAIL: restarted equal groups did not use deterministic UUID remainder allocation';
  end if;
  if (select sum(allocated_production) from public.get_mud_group_range_allocation(factory_a_id, date '2026-09-10', date '2026-09-20'))
    <> (select sum(eligible_factory_production) from (select distinct production_date, eligible_factory_production from public.get_mud_group_range_allocation(factory_a_id, date '2026-09-10', date '2026-09-20')) as days) then
    raise exception 'FAIL: range allocation lost or duplicated Production';
  end if;
  if (select earned_amount / member_count from public.get_mud_group_range_allocation(factory_a_id, date '2026-09-10', date '2026-09-10') where labour_group_id = group_a_id) <> (4000::numeric / 6) then
    raise exception 'FAIL: informational daily per-member share is wrong';
  end if;
  raise notice 'PASS: stop/restart, range aggregation, deterministic remainder, and informational per-member math are correct';

  perform pg_temp.expect_error('no group coverage fails explicitly', 'P2701', format('select * from public.get_mud_group_daily_allocation(%L::uuid,date %L)', factory_a_id, '2026-08-30'));
  perform pg_temp.expect_error('restart without rate coverage fails explicitly', 'P2817', format('select public.restart_mud_group_earning(%L::uuid,%L::uuid,1,date %L)', factory_a_id, missing_rate_group_id, '2026-09-21'));
  perform pg_temp.expect_error('direct term mutation is forbidden', '42501', format('insert into public.mud_group_terms(factory_id,labour_group_id,member_count,effective_from) values (%L::uuid,%L::uuid,1,date %L)', factory_a_id, missing_rate_group_id, '2026-09-21'));
  perform pg_temp.expect_error('other factory configuration is isolated', '42501', format('select * from public.get_mud_group_configuration(%L::uuid,date %L)', factory_b_id, '2026-09-10'));

  perform pg_temp.expect_error('second new group cannot use legacy Calculate Wages', 'P0001', format('select * from public.calculate_mud_supply_wages(%L::uuid,%L::uuid,date %L)', factory_a_id, group_b_id, '2026-08-31'));
  select * into result from public.calculate_mud_supply_wages(factory_a_id, group_a_id, date '2026-08-31');
  if result.groups_calculated <> 1
    or not exists (select 1 from public.weekly_earnings where factory_id = factory_a_id and labour_group_id = group_a_id and week_start = date '2026-08-31' and quantity_used = 12345 and rate_used = 30 and amount = 370.35) then
    raise exception 'FAIL: legacy weekly Calculate Wages changed';
  end if;
  perform pg_temp.expect_error('second new group has no legacy financial balance', 'P0001', format('select * from public.create_labour_group_withdrawal(%L::uuid,%L::uuid,date %L,1)', factory_a_id, group_b_id, '2026-09-20'));
  if (select count(*) from public.weekly_earnings) <> weekly_count + 1
    or (select count(*) from public.withdrawals) <> withdrawal_count
    or (select count(*) from public.production_earning_settlements) <> settlement_count
    or (select count(*) from public.production_earning_settlement_details) <> settlement_detail_count
    or (select count(*) from public.transport_daily_entries) <> transport_daily_count
    or (select count(*) from public.transport_weekly_earnings) <> transport_earning_count then
    raise exception 'FAIL: live configuration changed legacy withdrawals, Production settlement, or Chamber Transport data';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> mud_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))) <> withdrawal_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> production_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> transport_function_before then
    raise exception 'FAIL: an existing Mud, Production, or Chamber Transport function changed';
  end if;
  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'LEGACY_WEEKLY' then
    raise exception 'FAIL: live configuration moved accounting out of LEGACY_WEEKLY';
  end if;
  raise notice 'PASS: legacy weekly accounting, withdrawals/balance inputs, Production settlement, and Chamber Transport remain unchanged';

  perform pg_temp.expect_error('mode cannot skip LEGACY_WEEKLY to SETTLEMENT', 'P2802', format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', factory_a_id, 'SETTLEMENT'));
  perform public.transition_mud_accounting_mode(factory_a_id, 'SHADOW');
  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'SHADOW'
    or not exists (select 1 from public.mud_accounting_mode_transitions where factory_id = factory_a_id and old_mode = 'LEGACY_WEEKLY' and new_mode = 'SHADOW' and actor = auth.uid()) then
    raise exception 'FAIL: controlled forward transition was not audited';
  end if;
  perform pg_temp.expect_error('mode cannot reverse SHADOW to LEGACY_WEEKLY', 'P2802', format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', factory_a_id, 'LEGACY_WEEKLY'));
  perform pg_temp.expect_error('transition history is immutable to clients', '42501', format('delete from public.mud_accounting_mode_transitions where factory_id = %L::uuid', factory_a_id));
  raise notice 'PASS: transition authority is forward-only, actor-audited, and history is client-immutable';
end;
$$;

rollback;

select 'PASS: Mud Multi-Group Phase 2 verifier completed and every fixture/transition was rolled back.' as result;
