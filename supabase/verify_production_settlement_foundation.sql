-- Production settlement foundation rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260915000049.

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
  legacy_labourer_id uuid := gen_random_uuid();
  live_labourer_id uuid := gen_random_uuid();
  missing_rate_labourer_id uuid := gen_random_uuid();
  factory_b_labourer_id uuid := gen_random_uuid();
  legacy_weekly_id uuid := gen_random_uuid();
  old_withdrawal_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Settlement Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Settlement Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Settlement Brick A'),
    (brick_b_id, factory_b_id, 'Settlement Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (legacy_labourer_id, factory_a_id, 'Legacy Settlement Labourer', brick_a_id),
    (live_labourer_id, factory_a_id, 'Live Settlement Labourer', brick_a_id),
    (missing_rate_labourer_id, factory_a_id, 'Missing Rate Labourer', brick_a_id),
    (factory_b_labourer_id, factory_b_id, 'Factory B Labourer', brick_b_id);

  insert into public.production_wage_rates(
    factory_id, production_crew_id, labourer_id, rate_per_1000_bricks, effective_from
  ) values
    (factory_a_id, null, legacy_labourer_id, 800, date '2026-08-01'),
    (factory_a_id, null, live_labourer_id, 500, date '2026-08-01'),
    (factory_b_id, null, factory_b_labourer_id, 900, date '2026-08-01');

  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, legacy_labourer_id, brick_a_id, date '2026-08-31', 1000),
    (gen_random_uuid(), factory_a_id, legacy_labourer_id, brick_a_id, date '2026-09-08', 1000),
    (gen_random_uuid(), factory_a_id, legacy_labourer_id, brick_a_id, date '2026-09-10', 500),
    (gen_random_uuid(), factory_a_id, legacy_labourer_id, brick_a_id, date '2026-09-12', 1000),
    (gen_random_uuid(), factory_a_id, live_labourer_id, brick_a_id, date '2026-09-09', 2000),
    (gen_random_uuid(), factory_a_id, missing_rate_labourer_id, brick_a_id, date '2026-09-09', 1000),
    (gen_random_uuid(), factory_b_id, factory_b_labourer_id, brick_b_id, date '2026-09-09', 1000);

  insert into public.weekly_earnings(
    id, factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  ) values (
    legacy_weekly_id, factory_a_id, legacy_labourer_id, date '2026-08-31', 1000, null, null, 700
  );
  insert into public.withdrawals(
    id, factory_id, labourer_id, withdrawal_date, amount
  ) values (
    old_withdrawal_id, factory_a_id, legacy_labourer_id, date '2026-09-05', 100
  );

  -- Reproduce the migration-time compact opening for this transaction-local
  -- fixture; the real migration runs the same aggregation before this verifier.
  insert into public.production_earning_settlements(
    factory_id, labourer_id, previous_settled_through, settled_through,
    total_quantity, total_earned, settlement_type, withdrawal_id
  )
  select
    weekly.factory_id, weekly.labourer_id, null, max(weekly.week_start + 6),
    sum(weekly.quantity_used)::bigint, sum(weekly.amount), 'legacy_opening', null
  from public.weekly_earnings as weekly
  where weekly.id = legacy_weekly_id
  group by weekly.factory_id, weekly.labourer_id;

  perform set_config('atlas_settlement.user_id', test_user_id::text, true);
  perform set_config('atlas_settlement.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_settlement.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_settlement.legacy_labourer_id', legacy_labourer_id::text, true);
  perform set_config('atlas_settlement.live_labourer_id', live_labourer_id::text, true);
  perform set_config('atlas_settlement.missing_rate_labourer_id', missing_rate_labourer_id::text, true);
  perform set_config('atlas_settlement.factory_b_labourer_id', factory_b_labourer_id::text, true);
  perform set_config('atlas_settlement.legacy_weekly_id', legacy_weekly_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_settlement.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_settlement.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_settlement.factory_b_id')::uuid;
  legacy_labourer_id uuid := current_setting('atlas_settlement.legacy_labourer_id')::uuid;
  live_labourer_id uuid := current_setting('atlas_settlement.live_labourer_id')::uuid;
  missing_rate_labourer_id uuid := current_setting('atlas_settlement.missing_rate_labourer_id')::uuid;
  factory_b_labourer_id uuid := current_setting('atlas_settlement.factory_b_labourer_id')::uuid;
  legacy_weekly_id uuid := current_setting('atlas_settlement.legacy_weekly_id')::uuid;
  account record;
  first_withdrawal record;
  second_withdrawal record;
  later_withdrawal record;
  before_settlement_count bigint;
  before_detail_count bigint;
  before_withdrawal_count bigint;
  weekly_count bigint;
  weekly_detail_count bigint;
  mud_group_count bigint;
  transport_earning_count bigint;
  soil_earning_count bigint;
  staff_payment_count bigint;
begin
  select count(*) into weekly_count from public.weekly_earnings;
  select count(*) into weekly_detail_count from public.production_weekly_earning_details;
  select count(*) into mud_group_count from public.labour_groups;
  select count(*) into transport_earning_count from public.transport_weekly_earnings;
  select count(*) into soil_earning_count from public.soil_earnings;
  select count(*) into staff_payment_count from public.staff_payments;

  select * into account from public.get_production_labourer_account(
    factory_a_id, legacy_labourer_id, date '2026-09-15'
  );
  if account.settled_earned <> 700 or account.live_earned <> 2000
    or account.total_withdrawn <> 100 or account.available_balance <> 2600
    or account.latest_settlement_cutoff <> date '2026-09-06' then
    raise exception 'FAIL: legacy plus live account expected 700 + 2000 - 100 = 2600, got %', row_to_json(account);
  end if;
  raise notice 'PASS: Legacy Opening uses the stored weekly total and excludes pre-cutoff Production from live earnings';

  perform public.save_production_entry(
    factory_a_id,
    (select id from public.production_entries
      where factory_id = factory_a_id and labourer_id = legacy_labourer_id
        and production_date = date '2026-09-08'),
    legacy_labourer_id,
    (select assigned_brick_type_id from public.labourers where id = legacy_labourer_id),
    date '2026-09-08',
    2000
  );
  select * into account from public.get_production_labourer_account(
    factory_a_id, legacy_labourer_id, date '2026-09-15'
  );
  if account.live_earned <> 2800 or account.available_balance <> 3400 then
    raise exception 'FAIL: unsettled Production correction did not update live balance';
  end if;
  raise notice 'PASS: Production corrections update live earnings before settlement';

  select * into account from public.get_production_labourer_account(
    factory_a_id, live_labourer_id, date '2026-09-15'
  );
  if account.settled_earned <> 0 or account.live_earned <> 1000
    or account.available_balance <> 1000 or account.latest_settlement_cutoff is not null then
    raise exception 'FAIL: labourer without weekly history did not start fully live';
  end if;
  raise notice 'PASS: a second labourer without weekly earnings starts fully live';

  select * into first_withdrawal from public.create_labourer_withdrawal(
    factory_a_id, legacy_labourer_id, date '2026-09-10', date '2026-09-09', 1000
  );
  if first_withdrawal.withdrawal_amount <> 1000
    or first_withdrawal.available_balance <> 1600
    or first_withdrawal.settled_through <> date '2026-09-09'
    or (select total_quantity from public.production_earning_settlements where id = first_withdrawal.settlement_id) <> 2000
    or (select total_earned from public.production_earning_settlements where id = first_withdrawal.settlement_id) <> 1600
    or (select count(*) from public.production_earning_settlement_details where settlement_id = first_withdrawal.settlement_id) <> 1 then
    raise exception 'FAIL: chosen-cutoff partial withdrawal snapshot is wrong';
  end if;
  raise notice 'PASS: a partial withdrawal freezes the entire chosen period and leaves the protected remainder';

  perform pg_temp.expect_error(
    'controlled save rejects a settled Production edit', 'P2520',
    format(
      'select * from public.save_production_entry(%L::uuid,%L::uuid,%L::uuid,%L::uuid,date %L,3000)',
      factory_a_id,
      (select id from public.production_entries
        where factory_id = factory_a_id and labourer_id = legacy_labourer_id
          and production_date = date '2026-09-08'),
      legacy_labourer_id,
      (select assigned_brick_type_id from public.labourers where id = legacy_labourer_id),
      '2026-09-08'
    )
  );
  if (select quantity from public.production_entries
      where factory_id = factory_a_id and labourer_id = legacy_labourer_id
        and production_date = date '2026-09-08') <> 2000 then
    raise exception 'FAIL: rejected settled Production edit changed its quantity';
  end if;
  select * into account from public.get_production_labourer_account(
    factory_a_id, legacy_labourer_id, date '2026-09-15'
  );
  if account.settled_earned <> 2300 or account.live_earned <> 1200
    or account.available_balance <> 2400 then
    raise exception 'FAIL: settled period changed after underlying Production edit';
  end if;
  raise notice 'PASS: settled Production is protected while later Production stays live';

  select * into second_withdrawal from public.create_labourer_withdrawal(
    factory_a_id, legacy_labourer_id, date '2026-09-10', date '2026-09-09', 200
  );
  if second_withdrawal.available_balance <> 1400
    or (select total_earned from public.production_earning_settlements where id = second_withdrawal.settlement_id) <> 0
    or exists (select 1 from public.production_earning_settlement_details where settlement_id = second_withdrawal.settlement_id) then
    raise exception 'FAIL: same-day second withdrawal did not use protected balance with zero new settlement';
  end if;
  raise notice 'PASS: same-day second withdrawal succeeds with zero new settled earnings';

  select * into later_withdrawal from public.create_labourer_withdrawal(
    factory_a_id, legacy_labourer_id, date '2026-09-12', date '2026-09-11', 500
  );
  if later_withdrawal.available_balance <> 1700
    or (select total_earned from public.production_earning_settlements where id = later_withdrawal.settlement_id) <> 400
    or (select work_date from public.production_earning_settlement_details where settlement_id = later_withdrawal.settlement_id) <> date '2026-09-10' then
    raise exception 'FAIL: later withdrawal did not snapshot only the newly settled date';
  end if;
  raise notice 'PASS: later withdrawal advances the cutoff and snapshots only the unresolved period';

  perform pg_temp.expect_error(
    'future withdrawal rejected', 'P2502',
    format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,((now() at time zone ''Asia/Kolkata'')::date + 1),((now() at time zone ''Asia/Kolkata'')::date),1)', factory_a_id, legacy_labourer_id)
  );
  perform pg_temp.expect_error(
    'backdated withdrawal rejected', 'P2505',
    format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,1)', factory_a_id, legacy_labourer_id, '2026-09-11', '2026-09-11')
  );
  perform pg_temp.expect_error(
    'backdated cutoff rejected', 'P2504',
    format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,1)', factory_a_id, legacy_labourer_id, '2026-09-12', '2026-09-10')
  );

  select count(*) into before_settlement_count from public.production_earning_settlements;
  select count(*) into before_detail_count from public.production_earning_settlement_details;
  select count(*) into before_withdrawal_count from public.withdrawals;
  perform pg_temp.expect_error(
    'missing direct rate rolls back', 'P2402',
    format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,1)', factory_a_id, missing_rate_labourer_id, '2026-09-15', '2026-09-14')
  );
  perform pg_temp.expect_error(
    'overdraw rolls back', 'P0001',
    format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,1001)', factory_a_id, live_labourer_id, '2026-09-15', '2026-09-14')
  );
  if (select count(*) from public.production_earning_settlements) <> before_settlement_count
    or (select count(*) from public.production_earning_settlement_details) <> before_detail_count
    or (select count(*) from public.withdrawals) <> before_withdrawal_count then
    raise exception 'FAIL: rejected withdrawal left partial settlement, detail, or withdrawal rows';
  end if;
  raise notice 'PASS: missing-rate and overdraw failures roll back every financial row';

  perform pg_temp.expect_error(
    'Factory A cannot read Factory B Production account', '42501',
    format('select * from public.get_production_labourer_account(%L::uuid,%L::uuid,date %L)', factory_b_id, factory_b_labourer_id, '2026-09-15')
  );
  perform pg_temp.expect_error(
    'Factory A cannot withdraw from Factory B Production account', '42501',
    format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,1)', factory_b_id, factory_b_labourer_id, '2026-09-15', '2026-09-14')
  );
  if exists (select 1 from public.production_earning_settlements where factory_id = factory_b_id)
    or exists (select 1 from public.production_earning_settlement_details where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B Production settlements';
  end if;
  raise notice 'PASS: account reads, settlement reads, and withdrawals are factory-isolated';

  if (select count(*) from public.weekly_earnings) <> weekly_count
    or (select count(*) from public.production_weekly_earning_details) <> weekly_detail_count
    or not exists (
      select 1 from public.weekly_earnings
      where id = legacy_weekly_id and week_start = date '2026-08-31'
        and quantity_used = 1000 and amount = 700
    ) then
    raise exception 'FAIL: existing weekly Production financial history changed';
  end if;
  if (select count(*) from public.labour_groups) <> mud_group_count
    or (select count(*) from public.transport_weekly_earnings) <> transport_earning_count
    or (select count(*) from public.soil_earnings) <> soil_earning_count
    or (select count(*) from public.staff_payments) <> staff_payment_count
    or to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)') is null
    or to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)') is null then
    raise exception 'FAIL: another wage module changed or lost its wage function';
  end if;
  raise notice 'PASS: weekly Production history, Mud, Chamber Transport, Soil, and Staff remain unchanged';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_settlement.factory_a_id')::uuid;
  legacy_labourer_id uuid := current_setting('atlas_settlement.legacy_labourer_id')::uuid;
  target_settlement_id uuid;
  detail_id uuid;
begin
  select settlements.id, details.id
  into target_settlement_id, detail_id
  from public.production_earning_settlements settlements
  join public.production_earning_settlement_details details
    on details.settlement_id = settlements.id
  where settlements.factory_id = factory_a_id
    and settlements.labourer_id = legacy_labourer_id
    and settlements.settlement_type = 'withdrawal'
  order by details.work_date, details.id
  limit 1;

  if target_settlement_id is null or detail_id is null then
    raise exception 'FAIL: expected a withdrawal settlement with daily detail';
  end if;

  perform pg_temp.expect_error(
    'settlement header update rejected', 'P2501',
    format('update public.production_earning_settlements set total_earned = total_earned + 1 where id = %L::uuid', target_settlement_id)
  );
  perform pg_temp.expect_error(
    'settlement header delete rejected', 'P2501',
    format('delete from public.production_earning_settlements where id = %L::uuid', target_settlement_id)
  );
  perform pg_temp.expect_error(
    'settlement detail update rejected', 'P2501',
    format('update public.production_earning_settlement_details set earned_amount = earned_amount + 1 where id = %L::uuid', detail_id)
  );
  perform pg_temp.expect_error(
    'settlement detail delete rejected', 'P2501',
    format('delete from public.production_earning_settlement_details where id = %L::uuid', detail_id)
  );
  raise notice 'PASS: settlement headers and daily detail snapshots are immutable';
end;
$$;

select 'PASS: all Production settlement fixtures are transaction-local and will roll back' as result;
rollback;
