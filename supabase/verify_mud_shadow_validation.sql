-- Mud Multi-Group Phase 4 rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260916000055.

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
  group_a_id uuid := gen_random_uuid();
  group_b_id uuid := gen_random_uuid();
  legacy_rate_100_id uuid := gen_random_uuid();
  legacy_rate_120_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.mud_accounting_states)
      <> (select count(*) from public.factories) then
    raise exception 'FAIL: an existing factory is missing its Mud accounting state';
  end if;

  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then raise exception 'FAIL: verifier requires one factory_users row'; end if;

  perform set_config('atlas_mud_shadow.baseline_settlements', (select count(*)::text from public.mud_factory_settlements), true);
  perform set_config('atlas_mud_shadow.baseline_openings', (select count(*)::text from public.mud_group_legacy_openings), true);
  perform set_config('atlas_mud_shadow.baseline_withdrawals', (select count(*)::text from public.withdrawals), true);
  perform set_config('atlas_mud_shadow.baseline_production_settlements', (select count(*)::text from public.production_earning_settlements), true);
  perform set_config('atlas_mud_shadow.baseline_transport_earnings', (select count(*)::text from public.transport_weekly_earnings), true);
  perform set_config('atlas_mud_shadow.production_function_hash', md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))), true);
  perform set_config('atlas_mud_shadow.transport_function_hash', md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))), true);
  perform set_config('atlas_mud_shadow.mud_wage_function_hash', md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))), true);
  perform set_config('atlas_mud_shadow.mud_withdrawal_function_hash', md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))), true);

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Mud Shadow Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Mud Shadow Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Mud Shadow Brick A'),
    (brick_b_id, factory_b_id, 'Mud Shadow Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (labourer_a_id, factory_a_id, 'Mud Shadow Labourer A', brick_a_id),
    (labourer_b_id, factory_b_id, 'Mud Shadow Labourer B', brick_b_id);
  insert into public.labour_groups(id, factory_id, name, member_count, is_active) values
    (group_a_id, factory_a_id, 'Shadow Group A', 5, true),
    (group_b_id, factory_b_id, 'Shadow Group B', 5, true);

  insert into public.wage_rates(
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from, effective_to
  ) values
    (legacy_rate_100_id, factory_a_id, 'mud_supply', 100, date '2026-08-17', date '2026-09-09'),
    (legacy_rate_120_id, factory_a_id, 'mud_supply', 120, date '2026-09-10', null);

  insert into public.mud_group_terms(
    factory_id, labour_group_id, member_count, effective_from
  ) values (factory_a_id, group_a_id, 5, date '2026-08-24');
  insert into public.mud_group_rates(
    factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to
  ) values
    (factory_a_id, group_a_id, 100, date '2026-08-24', date '2026-09-09'),
    (factory_a_id, group_a_id, 120, date '2026-09-10', null);

  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  )
  select
    gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id,
    date '2026-08-17' + generated.day_offset, 1000
  from generate_series(0, 27) as generated(day_offset);

  -- Explicitly malformed locked rows prove that SHADOW reports failures and
  -- mismatches rather than changing or silently replacing legacy authority.
  insert into public.weekly_earnings(
    factory_id, labour_group_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values
    (factory_a_id, group_a_id, date '2026-08-17', 7000, legacy_rate_100_id, 100, 700),
    (factory_a_id, group_a_id, date '2026-08-24', 7000, legacy_rate_100_id, 100, 701);

  perform set_config('atlas_mud_shadow.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_shadow.mapping_id', mapping_id::text, true);
  perform set_config('atlas_mud_shadow.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_mud_shadow.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_mud_shadow.group_a_id', group_a_id::text, true);
  perform set_config('atlas_mud_shadow.group_b_id', group_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_shadow.user_id'), true);

select pg_temp.expect_error(
  'comparison is unavailable before SHADOW transition',
  'P3001',
  format(
    'select * from public.get_mud_shadow_weekly_comparisons(%L::uuid,date %L,date %L)',
    current_setting('atlas_mud_shadow.factory_a_id'), '2026-08-17', '2026-09-07'
  )
);

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_shadow.factory_a_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_shadow.group_a_id')::uuid;
  result record;
begin
  select * into result
  from public.calculate_mud_supply_wages(factory_a_id, group_a_id, date '2026-08-31');
  if result.groups_calculated <> 1 then
    raise exception 'FAIL: constant-rate legacy weekly earning was not created';
  end if;
  select * into result
  from public.calculate_mud_supply_wages(factory_a_id, group_a_id, date '2026-09-07');
  if result.groups_calculated <> 1 then
    raise exception 'FAIL: rate-change legacy weekly earning was not created';
  end if;

  perform public.transition_mud_accounting_mode(factory_a_id, 'SHADOW');
  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'SHADOW'
    or not exists (
      select 1 from public.mud_accounting_mode_transitions
      where factory_id = factory_a_id
        and old_mode = 'LEGACY_WEEKLY'
        and new_mode = 'SHADOW'
        and actor = auth.uid()
    ) then
    raise exception 'FAIL: selected factory did not enter audited SHADOW mode';
  end if;
  raise notice 'PASS: selected factory entered SHADOW with authenticated actor audit';
end;
$$;

select pg_temp.expect_error(
  'SHADOW cannot reverse to LEGACY_WEEKLY',
  'P2802',
  format(
    'select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)',
    current_setting('atlas_mud_shadow.factory_a_id'), 'LEGACY_WEEKLY'
  )
);
select pg_temp.expect_error(
  'other factory SHADOW readout is isolated',
  '42501',
  format(
    'select * from public.get_mud_shadow_weekly_comparisons(%L::uuid,date %L,date %L)',
    current_setting('atlas_mud_shadow.factory_b_id'), '2026-08-31', '2026-08-31'
  )
);

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_shadow.factory_a_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_shadow.group_a_id')::uuid;
  row_count integer;
  comparison record;
  withdrawal_result record;
begin
  select count(*) into row_count
  from public.get_mud_shadow_weekly_comparisons(
    factory_a_id, date '2026-08-17', date '2026-09-07'
  );
  if row_count <> 4 then
    raise exception 'FAIL: expected four explicit SHADOW comparison cases, received %', row_count;
  end if;

  select * into comparison
  from public.get_mud_shadow_weekly_comparisons(
    factory_a_id, date '2026-08-17', date '2026-09-07'
  ) where week_start = date '2026-08-17';
  if comparison.status <> 'CONFIGURATION_ERROR'
    or comparison.legacy_earning <> 700
    or comparison.new_engine_earning is not null
    or comparison.difference is not null then
    raise exception 'FAIL: missing term was not reported as a non-financial configuration failure';
  end if;

  select * into comparison
  from public.get_mud_shadow_weekly_comparisons(
    factory_a_id, date '2026-08-17', date '2026-09-07'
  ) where week_start = date '2026-08-24';
  if comparison.status <> 'UNEXPECTED_MISMATCH'
    or comparison.legacy_earning <> 701
    or comparison.new_engine_earning <> 700
    or comparison.difference <> -1 then
    raise exception 'FAIL: constant-rate unexpected mismatch was not exposed exactly';
  end if;

  select * into comparison
  from public.get_mud_shadow_weekly_comparisons(
    factory_a_id, date '2026-08-17', date '2026-09-07'
  ) where week_start = date '2026-08-31';
  if comparison.status <> 'PARITY_OK'
    or comparison.legacy_earning <> 700
    or comparison.new_engine_earning <> 700
    or comparison.difference <> 0 then
    raise exception 'FAIL: constant-rate parity did not match exactly';
  end if;
  raise notice 'PASS: parity_tests legacy 700 = new 700 exactly';

  select * into comparison
  from public.get_mud_shadow_weekly_comparisons(
    factory_a_id, date '2026-08-17', date '2026-09-07'
  ) where week_start = date '2026-09-07';
  if comparison.status <> 'EXPECTED_RATE_CHANGE_DIFFERENCE'
    or comparison.legacy_earning <> 700
    or comparison.new_engine_earning <> 780
    or comparison.difference <> 80 then
    raise exception 'FAIL: mid-week rate result did not match hand calculation';
  end if;
  raise notice 'PASS: mud_rate_change_correctness_tests legacy 700, new 780, hand-calculated 780';

  select * into withdrawal_result
  from public.create_labour_group_withdrawal(
    factory_a_id, group_a_id, date '2026-09-14', 100
  );
  if withdrawal_result.available_balance <> 2701 then
    raise exception 'FAIL: SHADOW withdrawal stopped using legacy weekly balance';
  end if;
  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'SHADOW' then
    raise exception 'FAIL: legacy financial action changed SHADOW mode';
  end if;
  raise notice 'PASS: legacy Calculate Mud Wage and withdrawal balance remain authoritative in SHADOW';
end;
$$;

reset role;
update public.factory_users
set factory_id = current_setting('atlas_mud_shadow.factory_b_id')::uuid, is_active = true
where id = current_setting('atlas_mud_shadow.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_shadow.user_id'), true);
select pg_temp.expect_error(
  'LEGACY_WEEKLY cannot skip directly to SETTLEMENT',
  'P2802',
  format(
    'select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)',
    current_setting('atlas_mud_shadow.factory_b_id'), 'SETTLEMENT'
  )
);

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_shadow.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_mud_shadow.factory_b_id')::uuid;
begin
  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'SHADOW'
    or (select accounting_mode from public.mud_accounting_states where factory_id = factory_b_id) <> 'LEGACY_WEEKLY' then
    raise exception 'FAIL: mode transition escaped the one selected SHADOW factory';
  end if;
  if (select count(*) from public.mud_factory_settlements) <> current_setting('atlas_mud_shadow.baseline_settlements')::bigint
    or (select count(*) from public.mud_group_legacy_openings) <> current_setting('atlas_mud_shadow.baseline_openings')::bigint then
    raise exception 'FAIL: SHADOW created a settlement or Legacy Opening';
  end if;
  if (select count(*) from public.withdrawals) <> current_setting('atlas_mud_shadow.baseline_withdrawals')::bigint + 1 then
    raise exception 'FAIL: SHADOW changed withdrawals outside the one explicit legacy fixture withdrawal';
  end if;
  if (select count(*) from public.production_earning_settlements) <> current_setting('atlas_mud_shadow.baseline_production_settlements')::bigint
    or (select count(*) from public.transport_weekly_earnings) <> current_setting('atlas_mud_shadow.baseline_transport_earnings')::bigint
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> current_setting('atlas_mud_shadow.production_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> current_setting('atlas_mud_shadow.transport_function_hash') then
    raise exception 'FAIL: SHADOW changed Production or Chamber Transport';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> current_setting('atlas_mud_shadow.mud_wage_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))) <> current_setting('atlas_mud_shadow.mud_withdrawal_function_hash') then
    raise exception 'FAIL: SHADOW redefined legacy Mud financial authority';
  end if;
  raise notice 'PASS: no settlements/openings/SETTLEMENT mode; unrelated accounting is unchanged';
end;
$$;

rollback;

select 'PASS: Mud Multi-Group Phase 4 SHADOW verifier completed and every fixture was rolled back.' as result;
