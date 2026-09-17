-- Mud Phase 5A adversarial verifier. Run only on confirmed Test Atlas Clean.
-- Every fixture and every financial/mode effect is enclosed by the one BEGIN/ROLLBACK.

create temporary table mud_phase5a_baseline (
  real_factory_id uuid not null,
  real_user_id uuid not null,
  mapping_id uuid not null,
  real_mode text not null,
  real_transition_count bigint not null,
  real_settlement_count bigint not null,
  real_opening_count bigint not null,
  real_weekly_count bigint not null,
  real_withdrawal_count bigint not null,
  real_configuration_hash text not null,
  real_certification jsonb,
  factory_count bigint not null,
  group_count bigint not null,
  term_count bigint not null,
  rate_count bigint not null,
  production_count bigint not null,
  weekly_count bigint not null,
  withdrawal_count bigint not null,
  settlement_count bigint not null,
  opening_count bigint not null,
  transition_count bigint not null
) on commit preserve rows;

grant select, update on mud_phase5a_baseline to authenticated;

insert into mud_phase5a_baseline
select
  factories.id,
  users.user_id,
  users.id,
  states.accounting_mode::text,
  (select count(*) from public.mud_accounting_mode_transitions where factory_id = factories.id),
  (select count(*) from public.mud_factory_settlements where factory_id = factories.id),
  (select count(*) from public.mud_group_legacy_openings where factory_id = factories.id),
  (select count(*) from public.weekly_earnings where factory_id = factories.id and labour_group_id is not null and labourer_id is null),
  (select count(*) from public.withdrawals where factory_id = factories.id and labour_group_id is not null and labourer_id is null),
  md5(concat_ws('|',
    coalesce((select string_agg(row_to_json(groups)::text, ',' order by groups.id) from public.labour_groups as groups where groups.factory_id = factories.id), ''),
    coalesce((select string_agg(row_to_json(terms)::text, ',' order by terms.id) from public.mud_group_terms as terms where terms.factory_id = factories.id), ''),
    coalesce((select string_agg(row_to_json(rates)::text, ',' order by rates.id) from public.mud_group_rates as rates where rates.factory_id = factories.id), '')
  )),
  null::jsonb,
  (select count(*) from public.factories),
  (select count(*) from public.labour_groups),
  (select count(*) from public.mud_group_terms),
  (select count(*) from public.mud_group_rates),
  (select count(*) from public.production_entries),
  (select count(*) from public.weekly_earnings),
  (select count(*) from public.withdrawals),
  (select count(*) from public.mud_factory_settlements),
  (select count(*) from public.mud_group_legacy_openings),
  (select count(*) from public.mud_accounting_mode_transitions)
from public.factories as factories
join public.mud_accounting_states as states on states.factory_id = factories.id
join lateral (
  select factory_users.id, factory_users.user_id
  from public.factory_users
  where factory_users.factory_id = factories.id and factory_users.is_active = true
  order by factory_users.created_at, factory_users.id
  limit 1
) as users on true
where factories.name = 'Test Atlas Clean user'
  and states.accounting_mode = 'SHADOW';

do $$
begin
  if (select count(*) from mud_phase5a_baseline) <> 1 then
    raise exception 'FAIL: expected exactly one real Test Atlas Clean SHADOW factory';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), false);
update mud_phase5a_baseline
set real_certification = (
  select row_to_json(certification)::jsonb
  from public.get_mud_shadow_certification_status(real_factory_id) as certification
);
reset role;

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

-- Commit only session-local baseline scaffolding. No fixture exists yet. The
-- complete lifecycle below is the single transaction that ends in ROLLBACK.
commit;

begin;

do $$
declare
  cutover_definition text := pg_get_functiondef(to_regprocedure('public.execute_mud_settlement_cutover(uuid,date)'));
  opening_definition text := pg_get_functiondef(to_regprocedure('public.create_mud_legacy_opening(uuid,date)'));
begin
  if cutover_definition ~* '\m(commit|rollback)\M'
    or cutover_definition ~* '(dblink|postgres_fdw|autonomous)'
    or opening_definition ~* '\m(commit|rollback)\M'
    or opening_definition ~* '(dblink|postgres_fdw|autonomous)' then
    raise exception 'FAIL: cutover lifecycle contains a transaction escape';
  end if;
  if cutover_definition not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or opening_definition not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.create_mud_factory_settlement(uuid,date,uuid,uuid)'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%' then
    raise exception 'FAIL: cutover/opening/checkpoint do not share the factory Mud accounting lock';
  end if;
  raise notice 'PASS: functions have no COMMIT/autonomous path and share the transaction-scoped factory lock';
end;
$$;

do $$
declare
  fixture text;
  factory_id uuid;
  brick_id uuid;
  labourer_id uuid;
  group_a_id uuid;
  group_b_id uuid;
  wage_rate_id uuid;
begin
  foreach fixture in array array['happy', 'rate_change', 'group_stop', 'multi_member', 'invalid_next_day'] loop
    factory_id := gen_random_uuid();
    brick_id := gen_random_uuid();
    labourer_id := gen_random_uuid();
    group_a_id := gen_random_uuid();
    group_b_id := gen_random_uuid();
    wage_rate_id := gen_random_uuid();

    perform set_config('mud5a.' || fixture || '.factory', factory_id::text, true);
    perform set_config('mud5a.' || fixture || '.group_a', group_a_id::text, true);
    perform set_config('mud5a.' || fixture || '.group_b', group_b_id::text, true);

    insert into public.factories(id, name, business_description, address, mobile)
    values (factory_id, 'Mud Phase5A Fixture ' || fixture, 'Rollback verifier', 'Rollback verifier',
      case fixture
        when 'happy' then '9000000051'
        when 'rate_change' then '9000000052'
        when 'group_stop' then '9000000053'
        when 'multi_member' then '9000000054'
        else '9000000055'
      end);
    insert into public.brick_types(id, factory_id, name)
    values (brick_id, factory_id, 'Verifier Brick');
    insert into public.labourers(id, factory_id, name, assigned_brick_type_id)
    values (labourer_id, factory_id, 'Verifier Production Labourer', brick_id);
    insert into public.labour_groups(id, factory_id, name, member_count, is_active) values
      (group_a_id, factory_id, 'Group A', 5, true),
      (group_b_id, factory_id, 'Group B', 5, false);
    insert into public.wage_rates(id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
    values (wage_rate_id, factory_id, 'mud_supply', 100, date '2026-08-31');
    insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity)
    select gen_random_uuid(), factory_id, labourer_id, brick_id,
      date '2026-08-31' + days.day_offset,
      case when fixture = 'multi_member' then 1001 else 1000 end
    from generate_series(0, 6) as days(day_offset);

    if fixture = 'happy' then
      insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
      values (factory_id, group_a_id, 5, date '2026-08-31');
      insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from)
      values (factory_id, group_a_id, 100, date '2026-08-31');
    elsif fixture = 'rate_change' then
      insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
      values (factory_id, group_a_id, 5, date '2026-08-31');
      insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to) values
        (factory_id, group_a_id, 100, date '2026-08-31', date '2026-09-02'),
        (factory_id, group_a_id, 120, date '2026-09-03', null);
    elsif fixture = 'group_stop' then
      insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from, effective_to)
      values (factory_id, group_a_id, 5, date '2026-08-31', date '2026-09-02');
      insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from)
      values (factory_id, group_a_id, 100, date '2026-08-31');
    elsif fixture = 'multi_member' then
      insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from, effective_to) values
        (factory_id, group_a_id, 5, date '2026-08-31', date '2026-09-02'),
        (factory_id, group_a_id, 6, date '2026-09-03', null),
        (factory_id, group_b_id, 5, date '2026-08-31', null);
      insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from) values
        (factory_id, group_a_id, 100, date '2026-08-31'),
        (factory_id, group_b_id, 100, date '2026-08-31');
    else
      insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from, effective_to)
      values (factory_id, group_a_id, 5, date '2026-08-31', date '2026-09-06');
      insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to)
      values (factory_id, group_a_id, 100, date '2026-08-31', date '2026-09-06');
    end if;
  end loop;
end;
$$;

-- Every fixture creates its locked legacy week through the normal RPC, then
-- enters SHADOW through the normal audited state-machine authority.
do $$
declare fixture text;
begin
  foreach fixture in array array['happy', 'rate_change', 'group_stop', 'multi_member', 'invalid_next_day'] loop
    update public.factory_users
    set factory_id = current_setting('mud5a.' || fixture || '.factory')::uuid
    where id = (select mapping_id from mud_phase5a_baseline);
    perform set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
    execute 'set local role authenticated';
    perform public.calculate_mud_supply_wages(
      current_setting('mud5a.' || fixture || '.factory')::uuid,
      current_setting('mud5a.' || fixture || '.group_a')::uuid,
      date '2026-08-31'
    );
    perform public.transition_mud_accounting_mode(
      current_setting('mud5a.' || fixture || '.factory')::uuid,
      'SHADOW'
    );
    execute 'reset role';
  end loop;
end;
$$;

-- Happy path: exact parity/readiness, all negative boundaries first, then one
-- complete cutover with gross opening and immutable actor audit.
update public.factory_users
set factory_id = current_setting('mud5a.happy.factory')::uuid
where id = (select mapping_id from mud_phase5a_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);

select pg_temp.expect_error(
  'direct SHADOW to SETTLEMENT cannot bypass atomic cutover', 'P3201',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)',
    current_setting('mud5a.happy.factory'), 'SETTLEMENT')
);
select pg_temp.expect_error(
  'mid-week Saturday cutoff is rejected before opening', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)',
    current_setting('mud5a.happy.factory'), '2026-09-05')
);

reset role;
savepoint post_cutoff_withdrawal_case;
insert into public.withdrawals(id, factory_id, labour_group_id, withdrawal_date, amount)
values (gen_random_uuid(), current_setting('mud5a.happy.factory')::uuid,
  current_setting('mud5a.happy.group_a')::uuid, date '2026-09-07', 1);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
select pg_temp.expect_error(
  'post-cutoff legacy withdrawal rejects cutover', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)',
    current_setting('mud5a.happy.factory'), '2026-09-06')
);
reset role;
rollback to savepoint post_cutoff_withdrawal_case;

savepoint unreconciled_case;
insert into public.withdrawals(id, factory_id, labour_group_id, withdrawal_date, amount)
values (gen_random_uuid(), current_setting('mud5a.happy.factory')::uuid,
  current_setting('mud5a.happy.group_a')::uuid, date '2026-09-06', 701);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
select pg_temp.expect_error(
  'unreconciled legacy balance rejects cutover', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)',
    current_setting('mud5a.happy.factory'), '2026-09-06')
);
reset role;
rollback to savepoint unreconciled_case;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
do $$
declare certification record; readiness record; result record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('mud5a.happy.factory')::uuid);
  select * into readiness from public.get_mud_cutover_readiness(current_setting('mud5a.happy.factory')::uuid) limit 1;
  if certification.certification_status <> 'READY' or certification.parity_status <> 'PARITY_OK'
    or certification.legacy_earning <> 700 or certification.new_engine_earning <> 700
    or readiness.readiness_status <> 'READY_FOR_CUTOVER' then
    raise exception 'FAIL: happy fixture was not READY with exact 700 parity';
  end if;

  select * into result from public.execute_mud_settlement_cutover(
    current_setting('mud5a.happy.factory')::uuid, date '2026-09-06'
  );
  if result.final_legacy_week_start <> date '2026-08-31'
    or result.legacy_cutoff <> date '2026-09-06'
    or result.settlement_start_date <> date '2026-09-07'
    or result.group_openings <> 2
    or result.actor <> auth.uid()
    or (select accounting_mode from public.mud_accounting_states where factory_id = current_setting('mud5a.happy.factory')::uuid) <> 'SETTLEMENT'
    or (select locked_weekly_earned from public.mud_group_legacy_openings where factory_id = current_setting('mud5a.happy.factory')::uuid and labour_group_id = current_setting('mud5a.happy.group_a')::uuid) <> 700
    or (select locked_weekly_earned from public.mud_group_legacy_openings where factory_id = current_setting('mud5a.happy.factory')::uuid and labour_group_id = current_setting('mud5a.happy.group_b')::uuid) <> 0
    or not exists (select 1 from public.mud_accounting_mode_transitions where id = result.transition_audit_id and actor = auth.uid()) then
    raise exception 'FAIL: happy cutover did not create exact opening/boundary/mode/audit';
  end if;
  raise notice 'PASS: happy path produced gross openings 700/0, Sunday cutoff, Monday start, SETTLEMENT mode, and actor audit';
end;
$$;

select pg_temp.expect_error(
  'duplicate cutover is rejected', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)',
    current_setting('mud5a.happy.factory'), '2026-09-06')
);
do $$
begin
  if (select count(*) from public.mud_factory_settlements where factory_id = current_setting('mud5a.happy.factory')::uuid) <> 1
    or (select count(*) from public.mud_group_legacy_openings where factory_id = current_setting('mud5a.happy.factory')::uuid) <> 2
    or (select count(*) from public.mud_accounting_mode_transitions where factory_id = current_setting('mud5a.happy.factory')::uuid and new_mode = 'SETTLEMENT') <> 1 then
    raise exception 'FAIL: duplicate attempt created duplicate cutover state';
  end if;
  raise notice 'PASS: duplicate attempt left one header, two per-group openings, and one SETTLEMENT audit';
end;
$$;
reset role;

-- Mid-week rate change: legacy Monday rate = 700; daily 3*100 + 4*120 = 780.
update public.factory_users set factory_id = current_setting('mud5a.rate_change.factory')::uuid
where id = (select mapping_id from mud_phase5a_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
do $$
declare comparison record; certification record;
begin
  select * into comparison from public.get_mud_shadow_weekly_comparisons(
    current_setting('mud5a.rate_change.factory')::uuid, date '2026-08-31', date '2026-08-31'
  );
  select * into certification from public.get_mud_shadow_certification_status(current_setting('mud5a.rate_change.factory')::uuid);
  if comparison.status <> 'EXPECTED_RATE_CHANGE_DIFFERENCE'
    or comparison.legacy_earning <> 700 or comparison.new_engine_earning <> 780
    or certification.certification_status <> 'WAITING_FOR_COMPLETED_WEEK' then
    raise exception 'FAIL: rate-change fixture did not prove legacy 700, daily/hand 780, blocked certification';
  end if;
  raise notice 'PASS: rate-change legacy 700 != daily 780 = hand calculation; certification blocked';
end;
$$;
select pg_temp.expect_error('rate-change cutover is rejected', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)', current_setting('mud5a.rate_change.factory'), '2026-09-06'));
reset role;

-- Group stop: missing Thu-Sun term coverage must be CONFIGURATION_ERROR.
update public.factory_users set factory_id = current_setting('mud5a.group_stop.factory')::uuid
where id = (select mapping_id from mud_phase5a_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('mud5a.group_stop.factory')::uuid);
  if certification.certification_status <> 'CONFIGURATION_ERROR' then
    raise exception 'FAIL: group stop was not CONFIGURATION_ERROR: %', row_to_json(certification);
  end if;
  raise notice 'PASS: group stopping mid-week blocks certification';
end;
$$;
select pg_temp.expect_error('group-stop cutover is rejected', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)', current_setting('mud5a.group_stop.factory'), '2026-09-06'));
reset role;

-- Multi-group plus member-count change: daily allocations remain exact, while
-- the deliberately strict single-group parity gate rejects certification.
update public.factory_users set factory_id = current_setting('mud5a.multi_member.factory')::uuid
where id = (select mapping_id from mud_phase5a_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
do $$
declare certification record; bad_days integer; a_member_counts integer;
begin
  select count(*) into bad_days
  from (
    select allocation.production_date
    from public.get_mud_group_range_allocation(
      current_setting('mud5a.multi_member.factory')::uuid, date '2026-08-31', date '2026-09-06'
    ) as allocation
    group by allocation.production_date
    having sum(allocation.allocated_production) <> 1001
  ) as failures;
  select count(distinct allocation.member_count) into a_member_counts
  from public.get_mud_group_range_allocation(
    current_setting('mud5a.multi_member.factory')::uuid, date '2026-08-31', date '2026-09-06'
  ) as allocation
  where allocation.labour_group_id = current_setting('mud5a.multi_member.group_a')::uuid;
  select * into certification from public.get_mud_shadow_certification_status(current_setting('mud5a.multi_member.factory')::uuid);
  if bad_days <> 0 or a_member_counts <> 2 or certification.certification_status <> 'CONFIGURATION_ERROR' then
    raise exception 'FAIL: multi-group/member-change allocation or strict certification result is wrong';
  end if;
  raise notice 'PASS: all seven 1001-brick days allocate exactly; member change observed; single-group certification blocked';
end;
$$;
select pg_temp.expect_error('multi-group/member-change cutover is rejected', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)', current_setting('mud5a.multi_member.factory'), '2026-09-06'));
reset role;

-- Exact weekly parity alone is insufficient if next Monday has no term/rate.
update public.factory_users set factory_id = current_setting('mud5a.invalid_next_day.factory')::uuid
where id = (select mapping_id from mud_phase5a_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
do $$
declare certification record; readiness record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('mud5a.invalid_next_day.factory')::uuid);
  select * into readiness from public.get_mud_cutover_readiness(current_setting('mud5a.invalid_next_day.factory')::uuid) limit 1;
  if certification.certification_status <> 'READY'
    or readiness.readiness_status <> 'BLOCKED'
    or readiness.reason not like 'Mud configuration is invalid on settlement start:%' then
    raise exception 'FAIL: invalid next-Monday configuration did not block ready parity week';
  end if;
  raise notice 'PASS: READY parity cannot bypass missing next-Monday member/rate configuration';
end;
$$;
select pg_temp.expect_error('invalid next-Monday configuration rejects cutover', 'P3200',
  format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)', current_setting('mud5a.invalid_next_day.factory'), '2026-09-06'));
reset role;

-- Restore the real mapping inside the fixture transaction and prove the real
-- factory remained byte-for-byte unchanged before the outer rollback.
update public.factory_users set factory_id = (select real_factory_id from mud_phase5a_baseline)
where id = (select mapping_id from mud_phase5a_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5a_baseline), true);
do $$
declare baseline mud_phase5a_baseline%rowtype; current_certification jsonb;
begin
  select * into baseline from mud_phase5a_baseline;
  select row_to_json(certification)::jsonb into current_certification
  from public.get_mud_shadow_certification_status(baseline.real_factory_id) as certification;
  if (select accounting_mode::text from public.mud_accounting_states where factory_id = baseline.real_factory_id) <> baseline.real_mode
    or (select count(*) from public.mud_accounting_mode_transitions where factory_id = baseline.real_factory_id) <> baseline.real_transition_count
    or (select count(*) from public.mud_factory_settlements where factory_id = baseline.real_factory_id) <> baseline.real_settlement_count
    or (select count(*) from public.mud_group_legacy_openings where factory_id = baseline.real_factory_id) <> baseline.real_opening_count
    or (select count(*) from public.weekly_earnings where factory_id = baseline.real_factory_id and labour_group_id is not null and labourer_id is null) <> baseline.real_weekly_count
    or (select count(*) from public.withdrawals where factory_id = baseline.real_factory_id and labour_group_id is not null and labourer_id is null) <> baseline.real_withdrawal_count
    or current_certification is distinct from baseline.real_certification then
    raise exception 'FAIL: real Test Atlas factory changed inside fixture transaction';
  end if;
  raise notice 'PASS: real factory is still SHADOW with its original certification and zero cutover effects';
end;
$$;
reset role;

rollback;

-- This runs after the fixture rollback and is the leakage proof.
do $$
declare baseline mud_phase5a_baseline%rowtype; configuration_hash text;
begin
  select * into baseline from mud_phase5a_baseline;
  select md5(concat_ws('|',
    coalesce((select string_agg(row_to_json(groups)::text, ',' order by groups.id) from public.labour_groups as groups where groups.factory_id = baseline.real_factory_id), ''),
    coalesce((select string_agg(row_to_json(terms)::text, ',' order by terms.id) from public.mud_group_terms as terms where terms.factory_id = baseline.real_factory_id), ''),
    coalesce((select string_agg(row_to_json(rates)::text, ',' order by rates.id) from public.mud_group_rates as rates where rates.factory_id = baseline.real_factory_id), '')
  )) into configuration_hash;

  if exists (select 1 from public.factories where name like 'Mud Phase5A Fixture %')
    or (select count(*) from public.factories) <> baseline.factory_count
    or (select count(*) from public.labour_groups) <> baseline.group_count
    or (select count(*) from public.mud_group_terms) <> baseline.term_count
    or (select count(*) from public.mud_group_rates) <> baseline.rate_count
    or (select count(*) from public.production_entries) <> baseline.production_count
    or (select count(*) from public.weekly_earnings) <> baseline.weekly_count
    or (select count(*) from public.withdrawals) <> baseline.withdrawal_count
    or (select count(*) from public.mud_factory_settlements) <> baseline.settlement_count
    or (select count(*) from public.mud_group_legacy_openings) <> baseline.opening_count
    or (select count(*) from public.mud_accounting_mode_transitions) <> baseline.transition_count
    or (select accounting_mode::text from public.mud_accounting_states where factory_id = baseline.real_factory_id) <> baseline.real_mode
    or configuration_hash <> baseline.real_configuration_hash then
    raise exception 'FAIL: rollback leaked fixture, financial, audit, transition, Production, group, rate, or term state';
  end if;
  raise notice 'PASS: outer rollback restored every baseline count and the real factory configuration hash';
end;
$$;

drop table mud_phase5a_baseline;

select 'PASS: Mud Phase 5A atomic cutover adversarial verifier completed; every fixture was rolled back.' as result;
