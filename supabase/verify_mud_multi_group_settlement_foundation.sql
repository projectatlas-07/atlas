-- Mud Multi-Group Phase 3 rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260916000054.

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
  generated_group_1 uuid := gen_random_uuid();
  generated_group_2 uuid := gen_random_uuid();
  group_a_id uuid;
  group_b_id uuid;
  factory_b_group_id uuid := gen_random_uuid();
  legacy_rate_a_id uuid := gen_random_uuid();
  legacy_rate_b_id uuid := gen_random_uuid();
  trigger_withdrawal_id uuid := gen_random_uuid();
begin
  group_a_id := least(generated_group_1, generated_group_2);
  group_b_id := greatest(generated_group_1, generated_group_2);

  if (select count(*) from public.mud_accounting_states)
      <> (select count(*) from public.factories) then
    raise exception 'FAIL: an existing factory is missing its Mud accounting state';
  end if;

  perform set_config(
    'atlas_mud_phase3.baseline_state_hash',
    md5(coalesce((
      select string_agg(
        states.factory_id::text || ':' || states.accounting_mode::text,
        ',' order by states.factory_id
      )
      from public.mud_accounting_states as states
    ), '')), true
  );
  perform set_config(
    'atlas_mud_phase3.baseline_transition_count',
    (select count(*)::text from public.mud_accounting_mode_transitions), true
  );

  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then raise exception 'FAIL: verifier requires one factory_users row'; end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Mud Phase 3 Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Mud Phase 3 Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Mud Phase 3 Brick A'),
    (brick_b_id, factory_b_id, 'Mud Phase 3 Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (labourer_a_id, factory_a_id, 'Mud Phase 3 Labourer A', brick_a_id),
    (labourer_b_id, factory_b_id, 'Mud Phase 3 Labourer B', brick_b_id);

  insert into public.labour_groups(id, factory_id, name, member_count, is_active) values
    (group_a_id, factory_a_id, 'Group A', 1, true),
    (group_b_id, factory_a_id, 'Group B', 1, false),
    (factory_b_group_id, factory_b_id, 'Factory B Group', 1, true);

  insert into public.wage_rates(id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values
    (legacy_rate_a_id, factory_a_id, 'mud_supply', 100, date '2026-08-17'),
    (legacy_rate_b_id, factory_b_id, 'mud_supply', 50, date '2026-08-31');

  insert into public.weekly_earnings(
    factory_id, labour_group_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values
    (factory_a_id, group_a_id, date '2026-08-17', 10000, legacy_rate_a_id, 100, 1000),
    (factory_a_id, group_b_id, date '2026-08-24', 20000, legacy_rate_a_id, 100, 2000);

  insert into public.withdrawals(
    id, factory_id, labour_group_id, withdrawal_date, amount, note
  ) values
    (gen_random_uuid(), factory_a_id, group_a_id, date '2026-08-30', 500, 'Existing legacy withdrawal'),
    (trigger_withdrawal_id, factory_a_id, group_a_id, date '2026-09-02', 100, 'Future trigger context');

  insert into public.mud_group_terms(
    factory_id, labour_group_id, member_count, effective_from, effective_to
  ) values
    (factory_a_id, group_a_id, 6, date '2026-08-31', date '2026-09-03'),
    (factory_a_id, group_a_id, 8, date '2026-09-04', date '2026-09-05'),
    (factory_a_id, group_a_id, 1, date '2026-09-06', null),
    (factory_a_id, group_b_id, 9, date '2026-09-01', date '2026-09-05'),
    (factory_a_id, group_b_id, 1, date '2026-09-06', null),
    (factory_b_id, factory_b_group_id, 1, date '2026-08-31', null);

  insert into public.mud_group_rates(
    factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to
  ) values
    (factory_a_id, group_a_id, 100, date '2026-08-31', date '2026-09-04'),
    (factory_a_id, group_a_id, 110, date '2026-09-05', null),
    (factory_a_id, group_b_id, 120, date '2026-09-01', null),
    (factory_b_id, factory_b_group_id, 50, date '2026-08-31', null);

  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-08-31', 10000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-01', 100000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-02', 5),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-04', 170000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-05', 10000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-06', 5),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-07', 1000),
    (gen_random_uuid(), factory_b_id, labourer_b_id, brick_b_id, date '2026-08-31', 10000);

  perform set_config('atlas_mud_phase3.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_phase3.mapping_id', mapping_id::text, true);
  perform set_config('atlas_mud_phase3.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_mud_phase3.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_mud_phase3.group_a_id', group_a_id::text, true);
  perform set_config('atlas_mud_phase3.group_b_id', group_b_id::text, true);
  perform set_config('atlas_mud_phase3.factory_b_group_id', factory_b_group_id::text, true);
  perform set_config('atlas_mud_phase3.trigger_withdrawal_id', trigger_withdrawal_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_phase3.user_id'), true);

select pg_temp.expect_error(
  'authenticated users cannot create dormant settlements',
  '42501',
  format(
    'select * from public.create_mud_factory_settlement(%L::uuid,date %L,null,null)',
    current_setting('atlas_mud_phase3.factory_a_id'), '2026-09-02'
  )
);

do $$
declare
  factory_b_id uuid := current_setting('atlas_mud_phase3.factory_b_id')::uuid;
  factory_b_group_id uuid := current_setting('atlas_mud_phase3.factory_b_group_id')::uuid;
begin
  if exists (select 1 from public.mud_factory_settlements where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory B settlement rows leaked through RLS';
  end if;
  perform pg_temp.expect_error(
    'Mud settlement account reader is factory isolated',
    '42501',
    format(
      'select * from public.get_mud_group_settlement_account(%L::uuid,%L::uuid,date %L)',
      factory_b_id, factory_b_group_id, '2026-09-07'
    )
  );
  raise notice 'PASS: settlement tables and account reader are factory isolated';
end;
$$;

reset role;
set local role service_role;

select pg_temp.expect_error(
  'service role cannot bypass the atomic cutover authority to create a Legacy Opening',
  '42501',
  format(
    'select * from public.create_mud_legacy_opening(%L::uuid,date %L)',
    current_setting('atlas_mud_phase3.factory_a_id'), '2026-08-30'
  )
);
select pg_temp.expect_error(
  'service role cannot bypass settlement withdrawal authority to create a checkpoint',
  '42501',
  format(
    'select * from public.create_mud_factory_settlement(%L::uuid,date %L,null,null)',
    current_setting('atlas_mud_phase3.factory_a_id'), '2026-09-02'
  )
);

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_phase3.factory_a_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_phase3.group_a_id')::uuid;
  group_b_id uuid := current_setting('atlas_mud_phase3.group_b_id')::uuid;
  result record;
begin
  select * into result
  from public.create_mud_legacy_opening(factory_a_id, date '2026-08-30');
  if result.group_openings <> 2
    or (select locked_weekly_earned from public.mud_group_legacy_openings where factory_id = factory_a_id and labour_group_id = group_a_id) <> 1000
    or (select locked_weekly_earned from public.mud_group_legacy_openings where factory_id = factory_a_id and labour_group_id = group_b_id) <> 2000
    or exists (
      select 1 from public.mud_factory_settlement_days
      where factory_id = factory_a_id and work_date <= date '2026-08-30'
    ) then
    raise exception 'FAIL: compact Legacy Opening did not exactly preserve locked weekly totals';
  end if;
  raise notice 'PASS: private compact Legacy Opening helper exactly preserves locked weekly earnings';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_phase3.factory_a_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_phase3.group_a_id')::uuid;
  group_b_id uuid := current_setting('atlas_mud_phase3.group_b_id')::uuid;
  trigger_withdrawal_id uuid := current_setting('atlas_mud_phase3.trigger_withdrawal_id')::uuid;
  result record;
  account_a record;
  account_b record;
  withdrawals_before bigint;
begin
  select count(*) into withdrawals_before from public.withdrawals where factory_id = factory_a_id;

  select * into result
  from public.create_mud_factory_settlement(
    factory_a_id, date '2026-09-02', group_a_id, trigger_withdrawal_id
  );
  if result.previous_cutoff <> date '2026-08-30'
    or result.daily_snapshots <> 3 or result.group_snapshots <> 5 then
    raise exception 'FAIL: first post-opening settlement did not snapshot one-group then two-group dates';
  end if;
  if not exists (
    select 1 from public.mud_factory_settlements
    where factory_id = factory_a_id
      and settled_through = date '2026-09-02'
      and triggering_labour_group_id = group_a_id
      and triggering_withdrawal_id = trigger_withdrawal_id
  ) then
    raise exception 'FAIL: triggering group/withdrawal context was not stored';
  end if;
  if (select count(*) from public.mud_group_settlement_days where factory_id = factory_a_id and work_date = date '2026-08-31') <> 1
    or not exists (
      select 1 from public.mud_group_settlement_days
      where factory_id = factory_a_id and work_date = date '2026-08-31'
        and labour_group_id = group_a_id and allocated_production = 10000 and earned_amount = 1000
    )
    or not exists (
      select 1 from public.mud_group_settlement_days
      where factory_id = factory_a_id and work_date = date '2026-09-01'
        and labour_group_id = group_a_id and member_count = 6
        and allocated_production = 40000 and rate_per_1000_bricks = 100 and earned_amount = 4000
    )
    or not exists (
      select 1 from public.mud_group_settlement_days
      where factory_id = factory_a_id and work_date = date '2026-09-01'
        and labour_group_id = group_b_id and member_count = 9
        and allocated_production = 60000 and rate_per_1000_bricks = 120 and earned_amount = 7200
    ) then
    raise exception 'FAIL: one/two-group settlement allocation is wrong';
  end if;
  raise notice 'PASS: one-group and two-group dates freeze from the shared factory allocation pool';

  select * into result
  from public.create_mud_factory_settlement(factory_a_id, date '2026-09-06', null, null);
  if result.previous_cutoff <> date '2026-09-02'
    or result.daily_snapshots <> 4 or result.group_snapshots <> 8 then
    raise exception 'FAIL: advancing factory cutoff did not snapshot only new dates';
  end if;
  if not exists (
    select 1 from public.mud_group_settlement_days
    where factory_id = factory_a_id and work_date = date '2026-09-04'
      and labour_group_id = group_a_id and member_count = 8
      and allocated_production = 80000 and earned_amount = 8000
  ) or not exists (
    select 1 from public.mud_group_settlement_days
    where factory_id = factory_a_id and work_date = date '2026-09-05'
      and labour_group_id = group_a_id and rate_per_1000_bricks = 110
      and allocated_production = 4706 and earned_amount = 517.66
  ) then
    raise exception 'FAIL: dated member/rate changes were not snapshotted';
  end if;
  if not exists (
    select 1 from public.mud_group_settlement_days
    where factory_id = factory_a_id and work_date = date '2026-09-06'
      and labour_group_id = group_a_id and allocated_production = 3
  ) or (
    select sum(group_days.allocated_production)
    from public.mud_group_settlement_days as group_days
    where group_days.factory_id = factory_a_id and group_days.work_date = date '2026-09-06'
  ) <> 5 then
    raise exception 'FAIL: deterministic whole-brick remainder allocation was not preserved';
  end if;
  if exists (
    select 1
    from public.mud_factory_settlement_days as factory_days
    left join lateral (
      select sum(group_days.allocated_production) as allocated
      from public.mud_group_settlement_days as group_days
      where group_days.settlement_id = factory_days.settlement_id
        and group_days.factory_id = factory_days.factory_id
        and group_days.work_date = factory_days.work_date
    ) as totals on true
    where factory_days.factory_id = factory_a_id
      and totals.allocated <> factory_days.eligible_factory_production
  ) then
    raise exception 'FAIL: at least one settled date lost or duplicated Production';
  end if;
  raise notice 'PASS: advancing cutoff snapshots dated members/rates and exact whole-brick allocation';

  select * into result
  from public.create_mud_factory_settlement(factory_a_id, date '2026-09-06', group_b_id, null);
  if result.daily_snapshots <> 0 or result.group_snapshots <> 0
    or (select count(*) from public.mud_factory_settlement_days where factory_id = factory_a_id) <> 7
    or (select count(*) from public.mud_factory_settlement_days where factory_id = factory_a_id)
      <> (select count(distinct work_date) from public.mud_factory_settlement_days where factory_id = factory_a_id) then
    raise exception 'FAIL: equal cutoff repeated a settled date';
  end if;
  perform pg_temp.expect_error(
    'factory cutoff cannot move backward',
    'P2902',
    format(
      'select * from public.create_mud_factory_settlement(%L::uuid,date %L,null,null)',
      factory_a_id, '2026-09-05'
    )
  );
  raise notice 'PASS: equal cutoff writes zero daily earnings and backward cutoff is rejected';

  select * into account_a
  from public.calculate_mud_group_settlement_account(factory_a_id, group_a_id, date '2026-09-07');
  select * into account_b
  from public.calculate_mud_group_settlement_account(factory_a_id, group_b_id, date '2026-09-07');
  if account_a.settled_earned <> 14518.19
    or account_a.live_earned <> 55
    or account_a.total_withdrawn <> 600
    or account_a.available_balance <> 13973.19
    or account_a.latest_settlement_cutoff <> date '2026-09-06'
    or account_b.settled_earned <> 20635.88
    or account_b.live_earned <> 60
    or account_b.total_withdrawn <> 0
    or account_b.available_balance <> 20695.88 then
    raise exception 'FAIL: independent group settlement accounts are wrong: A %, B %', account_a, account_b;
  end if;
  if exists (
    select 1 from public.mud_group_settlement_days
    where factory_id = factory_a_id and work_date <= date '2026-08-30'
  ) or not exists (
    select 1 from public.mud_group_settlement_days
    where factory_id = factory_a_id and work_date = date '2026-08-31'
  ) then
    raise exception 'FAIL: live settlement dates do not start strictly after Legacy Opening cutoff';
  end if;
  if (select count(*) from public.withdrawals where factory_id = factory_a_id) <> withdrawals_before then
    raise exception 'FAIL: settlements rewrote existing withdrawals';
  end if;
  raise notice 'PASS: group account = opening + settled days + post-cutoff live - unchanged withdrawals';

end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_phase3.factory_a_id')::uuid;
  missing_rate_group_id uuid := gen_random_uuid();
begin
  insert into public.labour_groups(id, factory_id, name, member_count, is_active)
  values (missing_rate_group_id, factory_a_id, 'Missing Rate Group', 1, false);
  insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
  values (factory_a_id, missing_rate_group_id, 1, date '2026-09-08');
  perform set_config('atlas_mud_phase3.missing_rate_group_id', missing_rate_group_id::text, true);
  perform set_config(
    'atlas_mud_phase3.header_count',
    (select count(*)::text from public.mud_factory_settlements where factory_id = factory_a_id),
    true
  );
end;
$$;

reset role;
select pg_temp.expect_error(
  'missing group rate rolls back the whole settlement',
  'P2704',
  format(
    'select * from public.create_mud_factory_settlement(%L::uuid,date %L,null,null)',
    current_setting('atlas_mud_phase3.factory_a_id'), '2026-09-08'
  )
);
do $$
begin
  if (select count(*) from public.mud_factory_settlements where factory_id = current_setting('atlas_mud_phase3.factory_a_id')::uuid)
    <> current_setting('atlas_mud_phase3.header_count')::bigint then
    raise exception 'FAIL: missing-rate settlement left a partial header';
  end if;
end;
$$;

reset role;
delete from public.mud_group_terms
where factory_id = current_setting('atlas_mud_phase3.factory_a_id')::uuid
  and labour_group_id = current_setting('atlas_mud_phase3.missing_rate_group_id')::uuid;
update public.mud_group_terms set effective_to = date '2026-09-07'
where factory_id = current_setting('atlas_mud_phase3.factory_a_id')::uuid
  and effective_to is null;

reset role;
select pg_temp.expect_error(
  'missing active term rolls back the whole settlement',
  'P2701',
  format(
    'select * from public.create_mud_factory_settlement(%L::uuid,date %L,null,null)',
    current_setting('atlas_mud_phase3.factory_a_id'), '2026-09-08'
  )
);
do $$
begin
  if (select count(*) from public.mud_factory_settlements where factory_id = current_setting('atlas_mud_phase3.factory_a_id')::uuid)
    <> current_setting('atlas_mud_phase3.header_count')::bigint then
    raise exception 'FAIL: missing-term settlement left a partial header';
  end if;
  raise notice 'PASS: missing rate/term configuration rolls back every checkpoint row';
end;
$$;

reset role;

select pg_temp.expect_error(
  'settlement headers are immutable even to table owner',
  'P2901',
  format(
    'update public.mud_factory_settlements set settled_through = date %L where factory_id = %L::uuid',
    '2026-09-10', current_setting('atlas_mud_phase3.factory_a_id')
  )
);
select pg_temp.expect_error(
  'factory daily snapshots are immutable even to table owner',
  'P2901',
  format(
    'delete from public.mud_factory_settlement_days where factory_id = %L::uuid',
    current_setting('atlas_mud_phase3.factory_a_id')
  )
);
select pg_temp.expect_error(
  'group daily snapshots are immutable even to table owner',
  'P2901',
  format(
    'update public.mud_group_settlement_days set earned_amount = 0 where factory_id = %L::uuid',
    current_setting('atlas_mud_phase3.factory_a_id')
  )
);
select pg_temp.expect_error(
  'Legacy Openings are immutable even to table owner',
  'P2901',
  format(
    'delete from public.mud_group_legacy_openings where factory_id = %L::uuid',
    current_setting('atlas_mud_phase3.factory_a_id')
  )
);

do $$
declare
  factory_b_id uuid := current_setting('atlas_mud_phase3.factory_b_id')::uuid;
  mapping_id uuid := current_setting('atlas_mud_phase3.mapping_id')::uuid;
begin
  update public.factory_users set factory_id = factory_b_id, is_active = true where id = mapping_id;
  perform set_config(
    'atlas_mud_phase3.mud_function_hash',
    md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))), true
  );
  perform set_config(
    'atlas_mud_phase3.withdrawal_function_hash',
    md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))), true
  );
  perform set_config(
    'atlas_mud_phase3.production_function_hash',
    md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))), true
  );
  perform set_config(
    'atlas_mud_phase3.transport_function_hash',
    md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))), true
  );
  perform set_config('request.jwt.claim.sub', current_setting('atlas_mud_phase3.user_id'), true);
end;
$$;

set local role authenticated;

do $$
declare
  factory_b_id uuid := current_setting('atlas_mud_phase3.factory_b_id')::uuid;
  factory_b_group_id uuid := current_setting('atlas_mud_phase3.factory_b_group_id')::uuid;
  result record;
begin

  select * into result
  from public.calculate_mud_supply_wages(factory_b_id, factory_b_group_id, date '2026-08-31');
  if result.groups_calculated <> 1 or not exists (
    select 1 from public.weekly_earnings
    where factory_id = factory_b_id and labour_group_id = factory_b_group_id
      and week_start = date '2026-08-31' and amount = 500
  ) then
    raise exception 'FAIL: existing Calculate Mud Wage behavior changed';
  end if;

  select * into result
  from public.create_labour_group_withdrawal(
    factory_b_id, factory_b_group_id, date '2026-09-07', 100
  );
  if result.available_balance <> 400
    or exists (select 1 from public.mud_factory_settlements where factory_id = factory_b_id) then
    raise exception 'FAIL: legacy withdrawal behavior changed or created a dormant settlement';
  end if;
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_phase3.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_mud_phase3.factory_b_id')::uuid;
  preserved_state_hash text;
begin
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> current_setting('atlas_mud_phase3.mud_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))) <> current_setting('atlas_mud_phase3.withdrawal_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> current_setting('atlas_mud_phase3.production_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> current_setting('atlas_mud_phase3.transport_function_hash') then
    raise exception 'FAIL: Phase 3 changed an existing Mud, Production, or Chamber Transport function';
  end if;
  select md5(coalesce(string_agg(
    states.factory_id::text || ':' || states.accounting_mode::text,
    ',' order by states.factory_id
  ), '')) into preserved_state_hash
  from public.mud_accounting_states as states
  where states.factory_id not in (factory_a_id, factory_b_id);

  if (select accounting_mode from public.mud_accounting_states where factory_id = factory_a_id) <> 'LEGACY_WEEKLY'
    or (select accounting_mode from public.mud_accounting_states where factory_id = factory_b_id) <> 'LEGACY_WEEKLY'
    or exists (
      select 1 from public.mud_accounting_mode_transitions
      where factory_id in (factory_a_id, factory_b_id)
    )
    or (select count(*) from public.mud_accounting_mode_transitions)
      <> current_setting('atlas_mud_phase3.baseline_transition_count')::bigint
    or preserved_state_hash <> current_setting('atlas_mud_phase3.baseline_state_hash') then
    raise exception 'FAIL: settlement foundation changed fixture or pre-existing Mud accounting authority';
  end if;
  raise notice 'PASS: fixture factories remain LEGACY_WEEKLY; pre-existing SHADOW history and unrelated accounting are unchanged';
end;
$$;

rollback;

select 'PASS: Mud Multi-Group Phase 3 verifier completed and every settlement fixture was rolled back.' as result;
