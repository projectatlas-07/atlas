-- Direct Production labourer rates rollback verifier.
-- Run on confirmed Test Atlas Clean after 20260915000048_simplify_production_labourer_rates.sql.

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
  labourer_a1_id uuid := gen_random_uuid();
  labourer_a2_id uuid := gen_random_uuid();
  labourer_a3_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Direct Rate Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Direct Rate Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Direct Rate Brick A'),
    (brick_b_id, factory_b_id, 'Direct Rate Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (labourer_a1_id, factory_a_id, 'Direct Labourer A1', brick_a_id),
    (labourer_a2_id, factory_a_id, 'Direct Labourer A2', brick_a_id),
    (labourer_a3_id, factory_a_id, 'Missing Rate Labourer', brick_a_id),
    (labourer_b_id, factory_b_id, 'Direct Labourer B', brick_b_id);
  insert into public.production_wage_rates(
    factory_id, production_crew_id, labourer_id, rate_per_1000_bricks, effective_from
  ) values (factory_b_id, null, labourer_b_id, 999, date '2026-09-01');
  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_a_id, date '2026-09-05', 10000),
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_a_id, date '2026-09-12', 10000),
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_a_id, date '2026-09-20', 10000),
    (gen_random_uuid(), factory_a_id, labourer_a3_id, brick_a_id, date '2026-09-08', 1000);

  perform set_config('atlas_direct_rate.user_id', test_user_id::text, true);
  perform set_config('atlas_direct_rate.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_direct_rate.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_direct_rate.labourer_a1_id', labourer_a1_id::text, true);
  perform set_config('atlas_direct_rate.labourer_a2_id', labourer_a2_id::text, true);
  perform set_config('atlas_direct_rate.labourer_a3_id', labourer_a3_id::text, true);
  perform set_config('atlas_direct_rate.labourer_b_id', labourer_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_direct_rate.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_direct_rate.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_direct_rate.factory_b_id')::uuid;
  labourer_a1_id uuid := current_setting('atlas_direct_rate.labourer_a1_id')::uuid;
  labourer_a2_id uuid := current_setting('atlas_direct_rate.labourer_a2_id')::uuid;
  labourer_a3_id uuid := current_setting('atlas_direct_rate.labourer_a3_id')::uuid;
  labourer_b_id uuid := current_setting('atlas_direct_rate.labourer_b_id')::uuid;
  created_count integer;
  weekly_count bigint;
  weekly_detail_count bigint;
  withdrawal_count bigint;
  production_crew_count bigint;
  production_assignment_count bigint;
  transport_crew_count bigint;
  transport_worker_count bigint;
  transport_daily_count bigint;
begin
  select count(*) into weekly_count from public.weekly_earnings;
  select count(*) into weekly_detail_count from public.production_weekly_earning_details;
  select count(*) into withdrawal_count from public.withdrawals;
  select count(*) into production_crew_count from public.production_crews;
  select count(*) into production_assignment_count from public.production_crew_assignments;
  select count(*) into transport_crew_count from public.transport_crews;
  select count(*) into transport_worker_count from public.transport_workers;
  select count(*) into transport_daily_count from public.transport_daily_entries;

  select count(*) into created_count
  from public.set_production_labourer_rates(
    factory_a_id, array[labourer_a1_id, labourer_a2_id], 800, date '2026-09-01'
  );
  if created_count <> 2 then
    raise exception 'FAIL: multi-select rate setting did not create two direct histories';
  end if;
  raise notice 'PASS: one atomic call sets the same direct rate for multiple selected labourers';

  perform public.set_production_labourer_rates(
    factory_a_id, array[labourer_a1_id], 900, date '2026-09-15'
  );
  perform public.set_production_labourer_rates(
    factory_a_id, array[labourer_a1_id], 850, date '2026-09-10'
  );
  if (select count(*) from public.production_wage_rates
      where factory_id = factory_a_id and labourer_id = labourer_a1_id) <> 3
    or not exists (select 1 from public.production_wage_rates where factory_id = factory_a_id and labourer_id = labourer_a1_id and rate_per_1000_bricks = 800 and effective_from = date '2026-09-01' and effective_to = date '2026-09-09')
    or not exists (select 1 from public.production_wage_rates where factory_id = factory_a_id and labourer_id = labourer_a1_id and rate_per_1000_bricks = 850 and effective_from = date '2026-09-10' and effective_to = date '2026-09-14')
    or not exists (select 1 from public.production_wage_rates where factory_id = factory_a_id and labourer_id = labourer_a1_id and rate_per_1000_bricks = 900 and effective_from = date '2026-09-15' and effective_to is null) then
    raise exception 'FAIL: effective-dated or backdated rate history is wrong';
  end if;
  raise notice 'PASS: backdated insertion preserves three non-overlapping historical rate periods';

  perform public.set_production_labourer_origin(factory_a_id, labourer_a1_id, '  Jharkhand  ');
  if (select production_origin_label from public.labourers where id = labourer_a1_id) <> 'Jharkhand' then
    raise exception 'FAIL: optional origin was not normalized and persisted';
  end if;
  perform public.set_production_labourer_origin(factory_a_id, labourer_a2_id, null);
  raise notice 'PASS: optional origin persists independently and accepts blank state';

  if exists (select 1 from public.production_wage_rates where factory_id = factory_b_id)
    or exists (select 1 from public.production_entries where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B Production data';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot set Factory B labourer rates', '42501',
    format('select * from public.set_production_labourer_rates(%L::uuid,array[%L::uuid],700,date %L)', factory_b_id, labourer_b_id, '2026-09-15')
  );
  perform pg_temp.expect_error(
    'Factory A cannot change Factory B origin', '42501',
    format('select * from public.set_production_labourer_origin(%L::uuid,%L::uuid,%L)', factory_b_id, labourer_b_id, 'Forbidden')
  );
  raise notice 'PASS: Production reads, direct-rate writes, and origin writes are factory-isolated';

  perform pg_temp.expect_error(
    'continuous Production account rejects a missing direct rate instead of using zero', 'P2402',
    format('select * from public.get_production_labourer_account(%L::uuid,%L::uuid,date %L)',
      factory_a_id, labourer_a3_id, '2026-09-15')
  );
  perform pg_temp.expect_error(
    'legacy Calculate Wages is disabled after the Production settlement cutover', 'P2522',
    format('select * from public.calculate_production_wages(%L::uuid,date %L)', factory_a_id, '2026-09-07')
  );
  if (select count(*) from public.weekly_earnings) <> weekly_count
    or (select count(*) from public.production_weekly_earning_details) <> weekly_detail_count
    or (select count(*) from public.withdrawals) <> withdrawal_count then
    raise exception 'FAIL: rejected live account read or retired calculator rewrote financial rows';
  end if;
  raise notice 'PASS: live missing-rate reads fail explicitly and retired Calculate Wages cannot write';

  if (select count(*) from public.production_crews) <> production_crew_count
    or (select count(*) from public.production_crew_assignments) <> production_assignment_count
    or (select count(*) from public.transport_crews) <> transport_crew_count
    or (select count(*) from public.transport_workers) <> transport_worker_count
    or (select count(*) from public.transport_daily_entries) <> transport_daily_count then
    raise exception 'FAIL: Production Legacy crews or Chamber Transport data changed';
  end if;
  if to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)') is null then
    raise exception 'FAIL: Chamber Transport wage function is missing';
  end if;
  raise notice 'PASS: Production Legacy crew records and Chamber Transport data/functions are untouched';

  -- Keep the missing-rate fixture identifier live so this block proves all fixtures are valid.
  if labourer_a3_id is null then raise exception 'FAIL: missing-rate fixture absent'; end if;
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_direct_rate.factory_a_id')::uuid;
  labourer_a1_id uuid := current_setting('atlas_direct_rate.labourer_a1_id')::uuid;
  total_production numeric;
  total_earned numeric;
begin
  select sum(entries.quantity), sum(entries.quantity * resolved.rate_per_1000_bricks / 1000)
  into total_production, total_earned
  from public.production_entries as entries
  cross join lateral public.resolve_production_wage_rate(
    entries.factory_id, entries.labourer_id, entries.production_date
  ) as resolved
  where entries.factory_id = factory_a_id
    and entries.labourer_id = labourer_a1_id
    and entries.production_date between date '2026-09-01' and date '2026-09-30';
  if total_production <> 30000 or total_earned <> 25500 then
    raise exception 'FAIL: multi-rate range expected 30000 produced and 25500 earned, got % and %', total_production, total_earned;
  end if;
  raise notice 'PASS: daily Production resolves 800, 850, and 900 across the range for 30000 produced and 25500 earned';

  update public.labourers set production_origin_label = 'Bengal' where id = labourer_a1_id;
  if (select sum(entries.quantity * resolved.rate_per_1000_bricks / 1000)
      from public.production_entries as entries
      cross join lateral public.resolve_production_wage_rate(entries.factory_id, entries.labourer_id, entries.production_date) as resolved
      where entries.factory_id = factory_a_id and entries.labourer_id = labourer_a1_id
        and entries.production_date between date '2026-09-01' and date '2026-09-30') <> total_earned then
    raise exception 'FAIL: origin changed Production wage math';
  end if;
  raise notice 'PASS: origin changes do not affect direct-rate wage calculation';
end;
$$;

select 'PASS: all direct Production rate fixtures are transaction-local and will roll back' as result;
rollback;
