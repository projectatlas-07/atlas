-- Mud Phase 5B1/5B2 rollback verifier. Run only on confirmed Test Atlas Clean.

create temporary table mud_phase5b1_baseline (
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
  settlement_day_count bigint not null,
  group_settlement_day_count bigint not null,
  opening_count bigint not null,
  transition_count bigint not null
) on commit preserve rows;

grant select, update on mud_phase5b1_baseline to authenticated;

insert into mud_phase5b1_baseline
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
  (select count(*) from public.mud_factory_settlement_days),
  (select count(*) from public.mud_group_settlement_days),
  (select count(*) from public.mud_group_legacy_openings),
  (select count(*) from public.mud_accounting_mode_transitions)
from public.factories as factories
join public.mud_accounting_states as states on states.factory_id = factories.id
join lateral (
  select factory_users.id, factory_users.user_id
  from public.factory_users
  where factory_users.factory_id = factories.id and factory_users.is_active
  order by factory_users.created_at, factory_users.id
  limit 1
) as users on true
where factories.name = 'Test Atlas Clean user'
  and states.accounting_mode = 'SHADOW';

do $$
begin
  if (select count(*) from mud_phase5b1_baseline) <> 1 then
    raise exception 'FAIL: expected exactly one real Test Atlas Clean SHADOW factory';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), false);
update mud_phase5b1_baseline
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
    raise exception 'FAIL: % expected SQLSTATE %, received % (%)',
      test_label, expected_sqlstate, sqlstate, sqlerrm;
  end if;
end;
$$;

-- Commit session-local baseline scaffolding only. All fixtures start below.
commit;
begin;

do $$
declare
  settlement_factory uuid := gen_random_uuid();
  shadow_factory uuid := gen_random_uuid();
  settlement_brick uuid := gen_random_uuid();
  shadow_brick uuid := gen_random_uuid();
  settlement_labourer uuid := gen_random_uuid();
  shadow_labourer uuid := gen_random_uuid();
  group_a uuid := gen_random_uuid();
  group_b uuid := gen_random_uuid();
  group_c uuid := gen_random_uuid();
  shadow_group uuid := gen_random_uuid();
  settlement_legacy_rate uuid := gen_random_uuid();
  shadow_legacy_rate uuid := gen_random_uuid();
begin
  perform set_config('mud5b1.settlement_factory', settlement_factory::text, true);
  perform set_config('mud5b1.shadow_factory', shadow_factory::text, true);
  perform set_config('mud5b1.group_a', group_a::text, true);
  perform set_config('mud5b1.group_b', group_b::text, true);
  perform set_config('mud5b1.group_c', group_c::text, true);
  perform set_config('mud5b1.shadow_group', shadow_group::text, true);
  perform set_config('mud5b1.settlement_labourer', settlement_labourer::text, true);
  perform set_config('mud5b1.settlement_brick', settlement_brick::text, true);
  perform set_config('mud5b1.shadow_labourer', shadow_labourer::text, true);
  perform set_config('mud5b1.withdrawal_1', gen_random_uuid()::text, true);
  perform set_config('mud5b1.withdrawal_2', gen_random_uuid()::text, true);
  perform set_config('mud5b1.withdrawal_3', gen_random_uuid()::text, true);

  insert into public.factories(id, name, business_description, address, mobile) values
    (settlement_factory, 'Mud Phase5B1 SETTLEMENT Fixture', 'Rollback verifier', 'Rollback verifier', '9000000061'),
    (shadow_factory, 'Mud Phase5B1 SHADOW Fixture', 'Rollback verifier', 'Rollback verifier', '9000000062');
  insert into public.brick_types(id, factory_id, name) values
    (settlement_brick, settlement_factory, 'Settlement Brick'),
    (shadow_brick, shadow_factory, 'Shadow Brick');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (settlement_labourer, settlement_factory, 'Settlement Production Labourer', settlement_brick),
    (shadow_labourer, shadow_factory, 'Shadow Production Labourer', shadow_brick);
  insert into public.labour_groups(id, factory_id, name, member_count, is_active) values
    (group_a, settlement_factory, 'Group A', 5, true),
    (group_b, settlement_factory, 'Group B', 5, false),
    (group_c, settlement_factory, 'Stopped Historical Group', 2, false),
    (shadow_group, shadow_factory, 'Shadow Legacy Group', 4, true);
  insert into public.wage_rates(id, factory_id, applies_to, rate_per_1000_bricks, effective_from) values
    (settlement_legacy_rate, settlement_factory, 'mud_supply', 100, date '2026-08-31'),
    (shadow_legacy_rate, shadow_factory, 'mud_supply', 100, date '2026-08-24');

  insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from, effective_to) values
    (settlement_factory, group_c, 2, date '2026-08-01', date '2026-08-30'),
    (settlement_factory, group_a, 5, date '2026-08-31', date '2026-09-06'),
    (settlement_factory, group_a, 5, date '2026-09-07', null),
    (settlement_factory, group_b, 5, date '2026-09-07', null),
    (shadow_factory, shadow_group, 4, date '2026-08-24', null);
  insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from) values
    (settlement_factory, group_c, 80, date '2026-08-01'),
    (settlement_factory, group_a, 100, date '2026-08-31'),
    (settlement_factory, group_b, 200, date '2026-09-07'),
    (shadow_factory, shadow_group, 100, date '2026-08-24');

  insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  select gen_random_uuid(), settlement_factory, settlement_labourer, settlement_brick,
    date '2026-08-31' + days.day_offset, 1000
  from generate_series(0, 6) as days(day_offset);
  insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity) values
    (gen_random_uuid(), settlement_factory, settlement_labourer, settlement_brick, date '2026-09-07', 93000),
    (gen_random_uuid(), settlement_factory, settlement_labourer, settlement_brick, date '2026-09-08', 93000),
    (gen_random_uuid(), settlement_factory, settlement_labourer, settlement_brick, date '2026-09-09', 10000),
    (gen_random_uuid(), settlement_factory, settlement_labourer, settlement_brick, date '2026-09-10', 10000),
    (gen_random_uuid(), settlement_factory, settlement_labourer, settlement_brick, date '2026-09-11', 10000);

  insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  select gen_random_uuid(), shadow_factory, shadow_labourer, shadow_brick,
    date '2026-08-24' + days.day_offset, 1000
  from generate_series(0, 13) as days(day_offset);
end;
$$;

-- Build the SETTLEMENT fixture only through normal weekly, SHADOW, readiness,
-- and Phase 5A cutover authorities.
update public.factory_users
set factory_id = current_setting('mud5b1.settlement_factory')::uuid
where id = (select mapping_id from mud_phase5b1_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
select * from public.calculate_mud_supply_wages(
  current_setting('mud5b1.settlement_factory')::uuid,
  current_setting('mud5b1.group_a')::uuid,
  date '2026-08-31'
);
select * from public.transition_mud_accounting_mode(
  current_setting('mud5b1.settlement_factory')::uuid, 'SHADOW'
);
select * from public.execute_mud_settlement_cutover(
  current_setting('mud5b1.settlement_factory')::uuid, date '2026-09-06'
);

do $$
declare result record;
begin
  select * into result from public.create_mud_settlement_withdrawal(
    current_setting('mud5b1.settlement_factory')::uuid,
    current_setting('mud5b1.withdrawal_1')::uuid,
    current_setting('mud5b1.group_a')::uuid,
    date '2026-09-09', date '2026-09-08', 4000
  );
  if result.previous_cutoff <> date '2026-09-06'
    or result.settled_through <> date '2026-09-08'
    or result.daily_snapshots <> 2 or result.group_snapshots <> 4
    or result.settled_earned <> 10000 or result.total_withdrawn <> 4000
    or result.settled_available_balance <> 6000 or result.was_replayed then
    raise exception 'FAIL: first advancing partial withdrawal is wrong: %', row_to_json(result);
  end if;
  if not exists (
    select 1 from public.mud_factory_settlements
    where id = result.settlement_id
      and triggering_labour_group_id = current_setting('mud5b1.group_a')::uuid
      and triggering_withdrawal_id = current_setting('mud5b1.withdrawal_1')::uuid
  ) then raise exception 'FAIL: first checkpoint lacks triggering group/withdrawal metadata'; end if;
  if (select count(*) from public.mud_group_settlement_days where settlement_id = result.settlement_id and labour_group_id = current_setting('mud5b1.group_b')::uuid) <> 2
    or (select sum(earned_amount) from public.mud_group_settlement_days where settlement_id = result.settlement_id and labour_group_id = current_setting('mud5b1.group_b')::uuid) <> 18600 then
    raise exception 'FAIL: advancing cutoff did not settle Group B factory-wide';
  end if;
  raise notice 'PASS: first partial withdrawal leaves remaining protected balance is 6000 and settles both groups';
end;
$$;

do $$
declare before_withdrawals bigint; before_settlements bigint; before_days bigint; result record;
begin
  select count(*) into before_withdrawals from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_settlements from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_days from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select * into result from public.create_mud_settlement_withdrawal(
    current_setting('mud5b1.settlement_factory')::uuid,
    current_setting('mud5b1.withdrawal_1')::uuid,
    current_setting('mud5b1.group_a')::uuid,
    date '2026-09-09', date '2026-09-08', 4000
  );
  if not result.was_replayed
    or (select count(*) from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_withdrawals
    or (select count(*) from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_settlements
    or (select count(*) from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_days then
    raise exception 'FAIL: exact duplicate retry created financial or snapshot rows';
  end if;
  raise notice 'PASS: duplicate retry is idempotent';
end;
$$;

select pg_temp.expect_error(
  'same client identity with different amount is rejected', 'P3304',
  format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,4001)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.withdrawal_1'),
    current_setting('mud5b1.group_a'), '2026-09-09', '2026-09-08')
);

do $$
declare result record;
begin
  select * into result from public.create_mud_settlement_withdrawal(
    current_setting('mud5b1.settlement_factory')::uuid,
    current_setting('mud5b1.withdrawal_2')::uuid,
    current_setting('mud5b1.group_a')::uuid,
    date '2026-09-09', date '2026-09-08', 2000
  );
  if result.previous_cutoff <> date '2026-09-08' or result.settled_through <> date '2026-09-08'
    or result.daily_snapshots <> 0 or result.group_snapshots <> 0
    or result.settled_available_balance <> 4000 then
    raise exception 'FAIL: same-cutoff partial withdrawal is wrong: %', row_to_json(result);
  end if;
  raise notice 'PASS: same-cutoff checkpoint has zero daily snapshots and leaves 4000';
end;
$$;

do $$
declare result record; account record;
begin
  select * into result from public.create_mud_settlement_withdrawal(
    current_setting('mud5b1.settlement_factory')::uuid,
    current_setting('mud5b1.withdrawal_3')::uuid,
    current_setting('mud5b1.group_a')::uuid,
    date '2026-09-11', date '2026-09-10', 1000
  );
  if result.previous_cutoff <> date '2026-09-08' or result.daily_snapshots <> 2
    or result.group_snapshots <> 4 or result.settled_earned <> 11000
    or result.total_withdrawn <> 7000 or result.settled_available_balance <> 4000 then
    raise exception 'FAIL: later advancing withdrawal is wrong: %', row_to_json(result);
  end if;
  select * into account from public.get_mud_group_settlement_account(
    current_setting('mud5b1.settlement_factory')::uuid,
    current_setting('mud5b1.group_a')::uuid, date '2026-09-11'
  );
  if account.settled_earned <> 11000 or account.live_earned <> 500
    or account.total_earned <> 11500 or account.total_withdrawn <> 7000
    or account.available_balance <> 4500 or account.latest_settlement_cutoff <> date '2026-09-10' then
    raise exception 'FAIL: displayed SETTLEMENT account formula is wrong: %', row_to_json(account);
  end if;
  raise notice 'PASS: later cutoff snapshots only newly uncovered dates and display adds post-cutoff live earning';
end;
$$;

do $$
declare before_withdrawals bigint; before_settlements bigint; before_days bigint;
begin
  select count(*) into before_withdrawals from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_settlements from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_days from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  perform pg_temp.expect_error(
    'live earnings and Group B surplus cannot fund Group A', 'P3303',
    format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,4500)',
      current_setting('mud5b1.settlement_factory'), gen_random_uuid(), current_setting('mud5b1.group_a'),
      '2026-09-11', '2026-09-10')
  );
  if (select count(*) from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_withdrawals
    or (select count(*) from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_settlements
    or (select count(*) from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_days then
    raise exception 'FAIL: overdraw left a withdrawal, checkpoint, or day snapshot';
  end if;
  raise notice 'PASS: Group A cannot consume Group B balance or unsafe live earnings';
end;
$$;

select pg_temp.expect_error(
  'backward cutoff is rejected', 'P2902',
  format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,1)',
    current_setting('mud5b1.settlement_factory'), gen_random_uuid(), current_setting('mud5b1.group_a'),
    '2026-09-11', '2026-09-09')
);
select pg_temp.expect_error(
  'cutoff must precede withdrawal', 'P3301',
  format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,1)',
    current_setting('mud5b1.settlement_factory'), gen_random_uuid(), current_setting('mud5b1.group_a'),
    '2026-09-11', '2026-09-11')
);

reset role;
savepoint missing_rate_case;
update public.mud_group_rates set effective_to = date '2026-09-10'
where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
do $$
declare before_withdrawals bigint; before_settlements bigint; before_days bigint;
begin
  select count(*) into before_withdrawals from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_settlements from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_days from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  perform pg_temp.expect_error(
    'missing group rate aborts advancing withdrawal', 'P2704',
    format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,1)',
      current_setting('mud5b1.settlement_factory'), gen_random_uuid(), current_setting('mud5b1.group_a'),
      '2026-09-12', '2026-09-11')
  );
  if (select count(*) from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_withdrawals
    or (select count(*) from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_settlements
    or (select count(*) from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_days then
    raise exception 'FAIL: missing rate left partial financial/snapshot rows';
  end if;
  raise notice 'PASS: missing rate rollback removed withdrawal, checkpoint, and snapshots';
end;
$$;
reset role;
rollback to savepoint missing_rate_case;

savepoint missing_term_case;
update public.mud_group_terms set effective_to = date '2026-09-10'
where factory_id = current_setting('mud5b1.settlement_factory')::uuid
  and effective_to is null;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
do $$
declare before_withdrawals bigint; before_settlements bigint; before_days bigint;
begin
  select count(*) into before_withdrawals from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_settlements from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  select count(*) into before_days from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid;
  perform pg_temp.expect_error(
    'missing group term aborts advancing withdrawal', 'P2701',
    format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,1)',
      current_setting('mud5b1.settlement_factory'), gen_random_uuid(), current_setting('mud5b1.group_a'),
      '2026-09-12', '2026-09-11')
  );
  if (select count(*) from public.withdrawals where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_withdrawals
    or (select count(*) from public.mud_factory_settlements where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_settlements
    or (select count(*) from public.mud_factory_settlement_days where factory_id = current_setting('mud5b1.settlement_factory')::uuid) <> before_days then
    raise exception 'FAIL: missing term left partial financial/snapshot rows';
  end if;
  raise notice 'PASS: missing term rollback removed withdrawal, checkpoint, and snapshots';
end;
$$;
reset role;
rollback to savepoint missing_term_case;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
select pg_temp.expect_error(
  'legacy withdrawal is blocked in SETTLEMENT', 'P3305',
  format('select * from public.create_labour_group_withdrawal(%L::uuid,%L::uuid,date %L,1)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.group_a'), '2026-09-11')
);
select pg_temp.expect_error(
  'Calculate Mud Wage is blocked in SETTLEMENT', 'P3305',
  format('select * from public.calculate_mud_supply_wages(%L::uuid,%L::uuid,date %L)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.group_a'), '2026-08-24')
);
reset role;

-- Phase 5B2 protections use only the rollback fixture. The latest cutoff is
-- 10 Sep after the advancing withdrawals above.
select pg_temp.expect_error(
  'settled Production insert', 'P3306',
  format('insert into public.production_entries(id,factory_id,labourer_id,brick_type_id,production_date,quantity) values (%L::uuid,%L::uuid,%L::uuid,%L::uuid,date %L,1)',
    gen_random_uuid(), current_setting('mud5b1.settlement_factory'),
    current_setting('mud5b1.settlement_labourer'), current_setting('mud5b1.settlement_brick'), '2026-09-10')
);
select pg_temp.expect_error(
  'settled Production update', 'P3306',
  format('update public.production_entries set quantity = quantity + 1 where factory_id = %L::uuid and production_date = date %L',
    current_setting('mud5b1.settlement_factory'), '2026-09-10')
);
select pg_temp.expect_error(
  'settled Production delete', 'P3306',
  format('delete from public.production_entries where factory_id = %L::uuid and production_date = date %L',
    current_setting('mud5b1.settlement_factory'), '2026-09-10')
);
do $$
begin
  raise notice 'PASS: settled Production insert, update, and delete are blocked';
end;
$$;

do $$
declare inserted_id uuid := gen_random_uuid();
begin
  update public.production_entries
  set quantity = quantity + 1
  where factory_id = current_setting('mud5b1.settlement_factory')::uuid
    and production_date = date '2026-09-11';
  if not found then raise exception 'FAIL: post-cutoff Production update found no row'; end if;

  insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  values (inserted_id, current_setting('mud5b1.settlement_factory')::uuid,
    current_setting('mud5b1.settlement_labourer')::uuid,
    current_setting('mud5b1.settlement_brick')::uuid, date '2026-09-12', 1);
  delete from public.production_entries where id = inserted_id;
  if found then
    raise notice 'PASS: post-cutoff Production insert, update, and delete succeed';
  else
    raise exception 'FAIL: post-cutoff Production delete found no row';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
select pg_temp.expect_error(
  'settled member-count split', 'P3310',
  format('select public.set_mud_group_member_count(%L::uuid,%L::uuid,7,date %L)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.group_a'), '2026-09-10')
);
select pg_temp.expect_error(
  'settled group stop', 'P3310',
  format('select public.stop_mud_group_earning(%L::uuid,%L::uuid,date %L)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.group_a'), '2026-09-10')
);
select pg_temp.expect_error(
  'settled group restart', 'P3310',
  format('select public.restart_mud_group_earning(%L::uuid,%L::uuid,7,date %L)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.group_c'), '2026-09-10')
);
select pg_temp.expect_error(
  'settled new group', 'P3310',
  format('select public.create_mud_group(%L::uuid,%L,3,date %L,90,date %L)',
    current_setting('mud5b1.settlement_factory'), 'Backdated Group', '2026-09-10', '2026-09-10')
);
do $$
begin
  raise notice 'PASS: settled Mud group term changes are blocked';
end;
$$;

select pg_temp.expect_error(
  'settled group rate', 'P3311',
  format('select public.set_mud_group_rate(%L::uuid,%L::uuid,150,date %L)',
    current_setting('mud5b1.settlement_factory'), current_setting('mud5b1.group_a'), '2026-09-10')
);
do $$
begin
  raise notice 'PASS: settled Mud rates are blocked';
end;
$$;

select public.set_mud_group_member_count(
  current_setting('mud5b1.settlement_factory')::uuid,
  current_setting('mud5b1.group_a')::uuid, 7, date '2026-09-11'
);
select public.stop_mud_group_earning(
  current_setting('mud5b1.settlement_factory')::uuid,
  current_setting('mud5b1.group_a')::uuid, date '2026-09-12'
);
select public.restart_mud_group_earning(
  current_setting('mud5b1.settlement_factory')::uuid,
  current_setting('mud5b1.group_a')::uuid, 8, date '2026-09-13'
);
select public.create_mud_group(
  current_setting('mud5b1.settlement_factory')::uuid,
  'Future Group', 3, date '2026-09-13', 90, date '2026-09-13'
);
do $$
begin
  raise notice 'PASS: post-cutoff Mud group changes succeed';
end;
$$;

select public.set_mud_group_rate(
  current_setting('mud5b1.settlement_factory')::uuid,
  current_setting('mud5b1.group_a')::uuid, 150, date '2026-09-11'
);
do $$
begin
  raise notice 'PASS: post-cutoff Mud rates succeed';
end;
$$;
reset role;

-- A separate SHADOW fixture proves both legacy financial paths remain unchanged.
update public.factory_users set factory_id = current_setting('mud5b1.shadow_factory')::uuid
where id = (select mapping_id from mud_phase5b1_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
select * from public.calculate_mud_supply_wages(
  current_setting('mud5b1.shadow_factory')::uuid,
  current_setting('mud5b1.shadow_group')::uuid, date '2026-08-24'
);
select * from public.transition_mud_accounting_mode(current_setting('mud5b1.shadow_factory')::uuid, 'SHADOW');
do $$
declare withdrawal_result record; wage_result record;
begin
  select * into withdrawal_result from public.create_labour_group_withdrawal(
    current_setting('mud5b1.shadow_factory')::uuid,
    current_setting('mud5b1.shadow_group')::uuid, date '2026-08-31', 100
  );
  select * into wage_result from public.calculate_mud_supply_wages(
    current_setting('mud5b1.shadow_factory')::uuid,
    current_setting('mud5b1.shadow_group')::uuid, date '2026-08-31'
  );
  if withdrawal_result.available_balance <> 600 or wage_result.groups_calculated <> 1 then
    raise exception 'FAIL: SHADOW legacy withdrawal or Calculate Mud Wage behavior changed';
  end if;
  raise notice 'PASS: legacy paths still work in SHADOW';
end;
$$;
reset role;

update public.production_entries
set quantity = quantity + 1
where factory_id = current_setting('mud5b1.shadow_factory')::uuid
  and production_date = date '2026-08-24';
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
select public.set_mud_group_member_count(
  current_setting('mud5b1.shadow_factory')::uuid,
  current_setting('mud5b1.shadow_group')::uuid, 5, date '2026-09-07'
);
select public.set_mud_group_rate(
  current_setting('mud5b1.shadow_factory')::uuid,
  current_setting('mud5b1.shadow_group')::uuid, 110, date '2026-09-07'
);
do $$
begin
  raise notice 'PASS: SHADOW fixture remains editable';
end;
$$;
reset role;

-- Static concurrency proof under the rollback-only constraint.
do $$
begin
  if pg_get_functiondef(to_regprocedure('public.create_mud_settlement_withdrawal(uuid,uuid,uuid,date,date,numeric)'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.create_mud_factory_settlement(uuid,date,uuid,uuid)'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.assert_production_date_is_unsettled(uuid,uuid,date)'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.protect_mud_group_term_settled_date()'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%'
    or pg_get_functiondef(to_regprocedure('public.protect_mud_group_rate_settled_date()'))
      not like '%pg_advisory_xact_lock%mud_factory_settlement%' then
    raise exception 'FAIL: protected writers do not share one factory lock';
  end if;
  raise notice 'PASS: all protected writers share the Mud factory lock';
end;
$$;

-- Restore mapping and prove the real Test Atlas factory remains unchanged.
update public.factory_users set factory_id = (select real_factory_id from mud_phase5b1_baseline)
where id = (select mapping_id from mud_phase5b1_baseline);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select real_user_id::text from mud_phase5b1_baseline), true);
do $$
declare baseline mud_phase5b1_baseline%rowtype; current_certification jsonb;
begin
  select * into baseline from mud_phase5b1_baseline;
  if baseline.real_mode <> 'SHADOW'
    or baseline.real_settlement_count <> 0
    or baseline.real_opening_count <> 0
    or exists (
      select 1 from public.mud_accounting_mode_transitions
      where factory_id = baseline.real_factory_id and new_mode = 'SETTLEMENT'
    ) then
    raise exception 'FAIL: real Test Atlas baseline is not SHADOW with zero settlement state';
  end if;
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
  raise notice 'PASS: real Test Atlas factory remains SHADOW with zero settlement state';
end;
$$;
reset role;

rollback;

do $$
declare baseline mud_phase5b1_baseline%rowtype; configuration_hash text;
begin
  select * into baseline from mud_phase5b1_baseline;
  select md5(concat_ws('|',
    coalesce((select string_agg(row_to_json(groups)::text, ',' order by groups.id) from public.labour_groups as groups where groups.factory_id = baseline.real_factory_id), ''),
    coalesce((select string_agg(row_to_json(terms)::text, ',' order by terms.id) from public.mud_group_terms as terms where terms.factory_id = baseline.real_factory_id), ''),
    coalesce((select string_agg(row_to_json(rates)::text, ',' order by rates.id) from public.mud_group_rates as rates where rates.factory_id = baseline.real_factory_id), '')
  )) into configuration_hash;

  if exists (select 1 from public.factories where name like 'Mud Phase5B1 % Fixture')
    or (select count(*) from public.factories) <> baseline.factory_count
    or (select count(*) from public.labour_groups) <> baseline.group_count
    or (select count(*) from public.mud_group_terms) <> baseline.term_count
    or (select count(*) from public.mud_group_rates) <> baseline.rate_count
    or (select count(*) from public.production_entries) <> baseline.production_count
    or (select count(*) from public.weekly_earnings) <> baseline.weekly_count
    or (select count(*) from public.withdrawals) <> baseline.withdrawal_count
    or (select count(*) from public.mud_factory_settlements) <> baseline.settlement_count
    or (select count(*) from public.mud_factory_settlement_days) <> baseline.settlement_day_count
    or (select count(*) from public.mud_group_settlement_days) <> baseline.group_settlement_day_count
    or (select count(*) from public.mud_group_legacy_openings) <> baseline.opening_count
    or (select count(*) from public.mud_accounting_mode_transitions) <> baseline.transition_count
    or configuration_hash <> baseline.real_configuration_hash then
    raise exception 'FAIL: Phase 5B1 rollback leaked fixture, financial, snapshot, audit, or configuration state';
  end if;
  raise notice 'PASS: Phase 5B2 outer rollback restored every baseline count and real configuration hash';
end;
$$;

drop table mud_phase5b1_baseline;

select 'PASS: Mud Phase 5B2 settlement runtime verifier completed; every fixture was rolled back.' as result;
