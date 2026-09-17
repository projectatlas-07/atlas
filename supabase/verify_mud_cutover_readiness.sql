-- Mud Phase 4C rollback verifier. Run only on confirmed Test Atlas Clean.

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
  real_factory_id uuid;
  fixture_factory_id uuid := gen_random_uuid();
  brick_id uuid := gen_random_uuid();
  labourer_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
  group_b_id uuid := gen_random_uuid();
  wage_rate_id uuid := gen_random_uuid();
begin
  select states.factory_id into real_factory_id
  from public.mud_accounting_states as states
  where states.accounting_mode = 'SHADOW'
  order by states.factory_id
  limit 1;
  if real_factory_id is null then
    raise exception 'FAIL: Test Atlas Clean must have its real factory in SHADOW';
  end if;

  select users.id, users.user_id into mapping_id, test_user_id
  from public.factory_users as users
  where users.factory_id = real_factory_id and users.is_active = true
  order by users.created_at, users.id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: real SHADOW factory requires an active user mapping';
  end if;

  perform set_config('atlas_mud_cutover.mapping_id', mapping_id::text, true);
  perform set_config('atlas_mud_cutover.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_cutover.real_factory_id', real_factory_id::text, true);
  perform set_config('atlas_mud_cutover.fixture_factory_id', fixture_factory_id::text, true);
  perform set_config('atlas_mud_cutover.group_a_id', group_a_id::text, true);
  perform set_config('atlas_mud_cutover.group_b_id', group_b_id::text, true);
  perform set_config('atlas_mud_cutover.real_transition_count', (select count(*)::text from public.mud_accounting_mode_transitions as transitions where transitions.factory_id = real_factory_id), true);
  perform set_config('atlas_mud_cutover.baseline_settlements', (select count(*)::text from public.mud_factory_settlements), true);
  perform set_config('atlas_mud_cutover.baseline_openings', (select count(*)::text from public.mud_group_legacy_openings), true);
  perform set_config('atlas_mud_cutover.baseline_withdrawals', (select count(*)::text from public.withdrawals), true);
  perform set_config('atlas_mud_cutover.baseline_production_settlements', (select count(*)::text from public.production_earning_settlements), true);
  perform set_config('atlas_mud_cutover.baseline_transport_earnings', (select count(*)::text from public.transport_weekly_earnings), true);
  perform set_config('atlas_mud_cutover.production_function_hash', md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))), true);
  perform set_config('atlas_mud_cutover.transport_function_hash', md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))), true);
  perform set_config('atlas_mud_cutover.mud_wage_function_hash', md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))), true);
  perform set_config('atlas_mud_cutover.mud_withdrawal_function_hash', md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))), true);

  insert into public.factories(id, name, business_description, address, mobile)
  values (fixture_factory_id, format('Mud Cutover Preview %s', fixture_factory_id), 'Verifier', 'Verifier', '9000000021');
  insert into public.brick_types(id, factory_id, name)
  values (brick_id, fixture_factory_id, 'Cutover Preview Brick');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id)
  values (labourer_id, fixture_factory_id, 'Cutover Preview Labourer', brick_id);
  insert into public.labour_groups(id, factory_id, name, member_count, is_active) values
    (group_a_id, fixture_factory_id, 'Group A', 5, true),
    (group_b_id, fixture_factory_id, 'Group B', 4, false);
  insert into public.wage_rates(id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values (wage_rate_id, fixture_factory_id, 'mud_supply', 100, date '2026-08-24');
  insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from, effective_to) values
    (fixture_factory_id, group_b_id, 4, date '2026-08-24', date '2026-08-30'),
    (fixture_factory_id, group_a_id, 5, date '2026-08-31', null);
  insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from) values
    (fixture_factory_id, group_b_id, 100, date '2026-08-24'),
    (fixture_factory_id, group_a_id, 100, date '2026-08-31');
  insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  select gen_random_uuid(), fixture_factory_id, labourer_id, brick_id, date '2026-08-31' + days.day_offset, 1000
  from generate_series(0, 6) as days(day_offset);
  insert into public.weekly_earnings(factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount) values
    (fixture_factory_id, group_b_id, date '2026-08-24', 5000, wage_rate_id, 100, 500),
    (fixture_factory_id, group_a_id, date '2026-08-31', 7000, wage_rate_id, 100, 700);
  insert into public.withdrawals(id, factory_id, labour_group_id, withdrawal_date, amount) values
    (gen_random_uuid(), fixture_factory_id, group_b_id, date '2026-08-30', 100),
    (gen_random_uuid(), fixture_factory_id, group_a_id, date '2026-09-06', 200);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cutover.user_id'), true);

do $$
declare readiness record;
begin
  select * into readiness
  from public.get_mud_cutover_readiness(current_setting('atlas_mud_cutover.real_factory_id')::uuid);
  if readiness.readiness_status <> 'BLOCKED'
    or readiness.reason not like 'SHADOW certification is not READY:%' then
    raise exception 'FAIL: uncertified real factory did not return BLOCKED: %', row_to_json(readiness);
  end if;
  raise notice 'PASS: uncertified Test Atlas Clean factory is BLOCKED';
end;
$$;

select pg_temp.expect_error(
  'cutover preview is factory isolated',
  '42501',
  format('select * from public.get_mud_cutover_readiness(%L::uuid)', current_setting('atlas_mud_cutover.fixture_factory_id'))
);

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cutover.fixture_factory_id')::uuid
where id = current_setting('atlas_mud_cutover.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cutover.user_id'), true);
select * from public.transition_mud_accounting_mode(current_setting('atlas_mud_cutover.fixture_factory_id')::uuid, 'SHADOW');

do $$
declare
  fixture_factory_id uuid := current_setting('atlas_mud_cutover.fixture_factory_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_cutover.group_a_id')::uuid;
  group_b_id uuid := current_setting('atlas_mud_cutover.group_b_id')::uuid;
  header record;
  group_a record;
  group_b record;
  row_count integer;
  settlement_count bigint;
  opening_count bigint;
begin
  select count(*) into settlement_count from public.mud_factory_settlements where factory_id = fixture_factory_id;
  select count(*) into opening_count from public.mud_group_legacy_openings where factory_id = fixture_factory_id;

  select count(*) into row_count from public.get_mud_cutover_readiness(fixture_factory_id);
  if row_count <> 2 then
    raise exception 'FAIL: READY preview did not return every existing Mud group';
  end if;
  select * into header from public.get_mud_cutover_readiness(fixture_factory_id) limit 1;
  if header.readiness_status <> 'READY_FOR_CUTOVER'
    or header.certification_week <> date '2026-08-31'
    or header.final_legacy_week_start <> date '2026-08-31'
    or header.final_legacy_week_end <> date '2026-09-06'
    or header.proposed_legacy_cutoff <> date '2026-09-06'
    or header.settlement_start_date <> date '2026-09-07' then
    raise exception 'FAIL: READY boundary preview is incorrect: %', row_to_json(header);
  end if;

  select * into group_a from public.get_mud_cutover_readiness(fixture_factory_id) where labour_group_id = group_a_id;
  select * into group_b from public.get_mud_cutover_readiness(fixture_factory_id) where labour_group_id = group_b_id;
  if group_a.legacy_locked_earning_total <> 700 or group_a.existing_withdrawals <> 200
    or group_a.proposed_opening_amount <> 700 or group_a.resulting_balance <> 500
    or group_b.legacy_locked_earning_total <> 500 or group_b.existing_withdrawals <> 100
    or group_b.proposed_opening_amount <> 500 or group_b.resulting_balance <> 400 then
    raise exception 'FAIL: per-group preview totals are not exact';
  end if;
  if (select count(*) from public.mud_factory_settlements where factory_id = fixture_factory_id) <> settlement_count
    or (select count(*) from public.mud_group_legacy_openings where factory_id = fixture_factory_id) <> opening_count then
    raise exception 'FAIL: preview created a settlement or Legacy Opening';
  end if;
  raise notice 'PASS: READY preview has exact Sunday-Monday boundary and exact per-group totals without writes';
end;
$$;

reset role;

do $$
declare readiness record;
begin
  select * into readiness
  from public.calculate_mud_cutover_readiness(
    current_setting('atlas_mud_cutover.fixture_factory_id')::uuid,
    date '2026-09-05'
  );
  if readiness.readiness_status <> 'BLOCKED'
    or readiness.reason not like 'Mud cutover must use%' then
    raise exception 'FAIL: incorrect Saturday boundary was not blocked: %', row_to_json(readiness);
  end if;
  raise notice 'PASS: incorrect week boundary is BLOCKED';
end;
$$;

savepoint unreconciled_case;
insert into public.withdrawals(id, factory_id, labour_group_id, withdrawal_date, amount)
values (
  gen_random_uuid(),
  current_setting('atlas_mud_cutover.fixture_factory_id')::uuid,
  current_setting('atlas_mud_cutover.group_a_id')::uuid,
  date '2026-09-06',
  600
);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cutover.user_id'), true);
do $$
declare readiness record;
begin
  select * into readiness from public.get_mud_cutover_readiness(current_setting('atlas_mud_cutover.fixture_factory_id')::uuid);
  if readiness.readiness_status <> 'BLOCKED'
    or readiness.reason not like '%cannot reconcile:%'
    or readiness.resulting_balance <> -100 then
    raise exception 'FAIL: unreconciled legacy group did not block exactly: %', row_to_json(readiness);
  end if;
  raise notice 'PASS: withdrawals exceeding locked earnings are BLOCKED';
end;
$$;
reset role;
rollback to savepoint unreconciled_case;

savepoint duplicate_case;
do $$
declare settlement_id uuid := gen_random_uuid();
begin
  insert into public.mud_factory_settlements(id, factory_id, previous_cutoff, settled_through, settlement_type)
  values (settlement_id, current_setting('atlas_mud_cutover.fixture_factory_id')::uuid, null, date '2026-09-06', 'legacy_opening');
  insert into public.mud_group_legacy_openings(settlement_id, factory_id, labour_group_id, legacy_cutoff, locked_weekly_earned)
  values (settlement_id, current_setting('atlas_mud_cutover.fixture_factory_id')::uuid, current_setting('atlas_mud_cutover.group_a_id')::uuid, date '2026-09-06', 700);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cutover.user_id'), true);
do $$
declare readiness record;
begin
  select * into readiness from public.get_mud_cutover_readiness(current_setting('atlas_mud_cutover.fixture_factory_id')::uuid);
  if readiness.readiness_status <> 'BLOCKED'
    or readiness.reason not like 'A Mud settlement already exists%' then
    raise exception 'FAIL: existing settlement/opening did not block duplicate cutover: %', row_to_json(readiness);
  end if;
  raise notice 'PASS: existing settlement and Legacy Opening block duplicate cutover';
end;
$$;
reset role;
rollback to savepoint duplicate_case;

update public.factory_users set factory_id = current_setting('atlas_mud_cutover.real_factory_id')::uuid
where id = current_setting('atlas_mud_cutover.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cutover.user_id'), true);

do $$
declare readiness record;
begin
  select * into readiness from public.get_mud_cutover_readiness(current_setting('atlas_mud_cutover.real_factory_id')::uuid);
  if readiness.readiness_status <> 'BLOCKED' then
    raise exception 'FAIL: rollback fixtures changed real factory readiness';
  end if;
  raise notice 'PASS: fixture readiness did not leak into the real factory';
end;
$$;

reset role;

do $$
declare real_factory_id uuid := current_setting('atlas_mud_cutover.real_factory_id')::uuid;
begin
  if (select accounting_mode from public.mud_accounting_states where factory_id = real_factory_id) <> 'SHADOW'
    or (select count(*) from public.mud_accounting_mode_transitions where factory_id = real_factory_id) <> current_setting('atlas_mud_cutover.real_transition_count')::bigint
    or exists (select 1 from public.mud_accounting_states where accounting_mode = 'SETTLEMENT') then
    raise exception 'FAIL: preview changed the real mode/audit or created SETTLEMENT mode';
  end if;
  if (select count(*) from public.mud_factory_settlements) <> current_setting('atlas_mud_cutover.baseline_settlements')::bigint
    or (select count(*) from public.mud_group_legacy_openings) <> current_setting('atlas_mud_cutover.baseline_openings')::bigint
    or (select count(*) from public.withdrawals) <> current_setting('atlas_mud_cutover.baseline_withdrawals')::bigint + 2 then
    raise exception 'FAIL: preview changed financial rows outside rollback fixtures';
  end if;
  if (select count(*) from public.production_earning_settlements) <> current_setting('atlas_mud_cutover.baseline_production_settlements')::bigint
    or (select count(*) from public.transport_weekly_earnings) <> current_setting('atlas_mud_cutover.baseline_transport_earnings')::bigint
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> current_setting('atlas_mud_cutover.production_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> current_setting('atlas_mud_cutover.transport_function_hash') then
    raise exception 'FAIL: Production or Chamber Transport changed';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> current_setting('atlas_mud_cutover.mud_wage_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))) <> current_setting('atlas_mud_cutover.mud_withdrawal_function_hash') then
    raise exception 'FAIL: legacy Mud accounting authority changed';
  end if;
  raise notice 'PASS: no real financial write, transition, Production change, or Chamber Transport change';
end;
$$;

rollback;

select 'PASS: Mud Phase 4C cutover readiness verifier completed and every fixture was rolled back.' as result;
