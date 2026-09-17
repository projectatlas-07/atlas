-- Mud Supply Phase 1 rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260915000051.

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
  labourer_a_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Mud Range Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Mud Range Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Mud Range Brick A'),
    (brick_b_id, factory_b_id, 'Mud Range Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (labourer_a_id, factory_a_id, 'Mud Range Labourer A', brick_a_id),
    (labourer_b_id, factory_b_id, 'Mud Range Labourer B', brick_b_id);
  insert into public.labour_groups(id, factory_id, name, member_names, member_count)
  values (group_a_id, factory_a_id, 'Mud Range Group A', 'Member 1, Member 2', 2);
  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-01', 1000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-10', 2000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-15', 3000),
    (gen_random_uuid(), factory_b_id, labourer_b_id, brick_b_id, date '2026-09-10', 9999);
  insert into public.wage_rates(
    factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (factory_b_id, 'mud_supply', 999, date '2026-08-01');

  perform set_config('atlas_mud_range.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_range.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_mud_range.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_mud_range.group_a_id', group_a_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_range.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_range.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_mud_range.factory_b_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_range.group_a_id')::uuid;
  saved public.wage_rates%rowtype;
  mud_result record;
  eligible_quantity numeric;
  live_earned numeric;
  weekly_count bigint;
  withdrawal_count bigint;
  settlement_count bigint;
  settlement_detail_count bigint;
  production_rate_count bigint;
  transport_daily_count bigint;
  transport_earning_count bigint;
  mud_function_before text;
  production_function_before text;
  transport_function_before text;
begin
  select count(*) into weekly_count from public.weekly_earnings;
  select count(*) into withdrawal_count from public.withdrawals;
  select count(*) into settlement_count from public.production_earning_settlements;
  select count(*) into settlement_detail_count from public.production_earning_settlement_details;
  select count(*) into production_rate_count from public.production_wage_rates;
  select count(*) into transport_daily_count from public.transport_daily_entries;
  select count(*) into transport_earning_count from public.transport_weekly_earnings;
  mud_function_before := md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)')));
  production_function_before := md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)')));
  transport_function_before := md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)')));

  select * into saved from public.set_mud_supply_rate(factory_a_id, 30, date '2026-08-31');
  if saved.applies_to <> 'mud_supply' or saved.rate_per_1000_bricks <> 30
    or saved.effective_from <> date '2026-08-31' or saved.effective_to is not null then
    raise exception 'FAIL: initial Mud rate was not created as one open effective period';
  end if;
  raise notice 'PASS: one simple call creates a factory-level effective-dated Mud rate';

  perform public.set_mud_supply_rate(factory_a_id, 40, date '2026-09-01');
  perform public.set_mud_supply_rate(factory_a_id, 50, date '2026-09-15');
  perform public.set_mud_supply_rate(factory_a_id, 45, date '2026-09-10');
  if (select count(*) from public.wage_rates
      where factory_id = factory_a_id and applies_to = 'mud_supply') <> 4
    or not exists (select 1 from public.wage_rates where factory_id = factory_a_id and applies_to = 'mud_supply' and rate_per_1000_bricks = 30 and effective_from = date '2026-08-31' and effective_to = date '2026-08-31')
    or not exists (select 1 from public.wage_rates where factory_id = factory_a_id and applies_to = 'mud_supply' and rate_per_1000_bricks = 40 and effective_from = date '2026-09-01' and effective_to = date '2026-09-09')
    or not exists (select 1 from public.wage_rates where factory_id = factory_a_id and applies_to = 'mud_supply' and rate_per_1000_bricks = 45 and effective_from = date '2026-09-10' and effective_to = date '2026-09-14')
    or not exists (select 1 from public.wage_rates where factory_id = factory_a_id and applies_to = 'mud_supply' and rate_per_1000_bricks = 50 and effective_from = date '2026-09-15' and effective_to is null) then
    raise exception 'FAIL: normal and backdated Mud rate changes did not preserve exact non-overlapping periods';
  end if;
  raise notice 'PASS: normal and backdated changes preserve all effective-dated Mud rate periods';

  perform pg_temp.expect_error(
    'duplicate Mud effective date is rejected', 'P2601',
    format('select * from public.set_mud_supply_rate(%L::uuid,60,date %L)', factory_a_id, '2026-09-10')
  );

  select coalesce(sum(entries.quantity), 0),
    coalesce(sum((entries.quantity::numeric / 1000) * rates.rate_per_1000_bricks), 0)
  into eligible_quantity, live_earned
  from public.production_entries as entries
  join public.wage_rates as rates
    on rates.factory_id = entries.factory_id
    and rates.applies_to = 'mud_supply'
    and rates.effective_from <= entries.production_date
    and (rates.effective_to is null or rates.effective_to >= entries.production_date)
  where entries.factory_id = factory_a_id
    and entries.production_date between date '2026-09-01' and date '2026-09-30';
  if eligible_quantity <> 6000 or live_earned <> 280 then
    raise exception 'FAIL: daily eligible Production and effective-rate earnings are wrong (% / %)', eligible_quantity, live_earned;
  end if;
  raise notice 'PASS: authoritative daily Production resolves 40, 45, and 50 rates for total live earnings of 280';

  if exists (select 1 from public.wage_rates where factory_id = factory_b_id)
    or exists (select 1 from public.production_entries where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory B Mud rates or Production leaked through RLS';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot set a Factory B Mud rate', '42501',
    format('select * from public.set_mud_supply_rate(%L::uuid,60,date %L)', factory_b_id, '2026-09-20')
  );
  raise notice 'PASS: Mud rate reads, writes, and eligible Production remain factory-isolated';

  if (select count(*) from public.weekly_earnings) <> weekly_count
    or (select count(*) from public.withdrawals) <> withdrawal_count then
    raise exception 'FAIL: rate setting changed weekly Mud earnings or group withdrawals';
  end if;
  select * into mud_result
  from public.calculate_mud_supply_wages(factory_a_id, group_a_id, date '2026-08-31');
  if mud_result.groups_calculated <> 1 or mud_result.rows_skipped <> 0
    or not exists (
      select 1 from public.weekly_earnings
      where factory_id = factory_a_id and labour_group_id = group_a_id
        and week_start = date '2026-08-31' and quantity_used = 1000
        and rate_used = 30 and amount = 30
    ) then
    raise exception 'FAIL: existing weekly Mud calculation behavior changed';
  end if;
  raise notice 'PASS: existing weekly Mud accounting still uses the Monday rate and locks one group earning';

  if (select count(*) from public.withdrawals) <> withdrawal_count
    or (select count(*) from public.production_earning_settlements) <> settlement_count
    or (select count(*) from public.production_earning_settlement_details) <> settlement_detail_count
    or (select count(*) from public.production_wage_rates) <> production_rate_count
    or (select count(*) from public.transport_daily_entries) <> transport_daily_count
    or (select count(*) from public.transport_weekly_earnings) <> transport_earning_count then
    raise exception 'FAIL: Mud rate work changed withdrawals, Production settlement, or Chamber Transport data';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> mud_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> production_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> transport_function_before then
    raise exception 'FAIL: an existing Mud, Production, or Chamber Transport accounting function changed';
  end if;
  raise notice 'PASS: group withdrawals, Production settlement, and Chamber Transport data/functions are unchanged';
end;
$$;

rollback;

select 'PASS: Mud Supply Phase 1 verifier completed and every fixture was rolled back.' as result;
