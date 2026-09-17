-- Mud Multi-Group Phase 1 rollback verifier.
-- Run only on confirmed Test Atlas Clean after migration 20260915000052.

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
  group_a_id uuid := '00000000-0000-0000-0000-000000000101';
  group_b_id uuid := '00000000-0000-0000-0000-000000000202';
  group_missing_rate_id uuid := '00000000-0000-0000-0000-000000000303';
  factory_b_group_id uuid := '00000000-0000-0000-0000-000000000404';
begin
  if exists (
    select 1
    from public.labour_groups as groups
    where groups.is_active
      and not exists (
        select 1
        from public.mud_group_terms as terms
        where terms.factory_id = groups.factory_id
          and terms.labour_group_id = groups.id
          and terms.member_count = groups.member_count
          and terms.effective_from = coalesce(
            (select min(rates.effective_from)
             from public.wage_rates as rates
             where rates.factory_id = groups.factory_id
               and rates.applies_to = 'mud_supply'),
            (now() at time zone 'Asia/Kolkata')::date
          )
          and terms.effective_to is null
      )
  ) then
    raise exception 'FAIL: a current active Mud group was not backfilled exactly';
  end if;
  if exists (
    select 1
    from public.wage_rates as legacy
    join public.labour_groups as groups
      on groups.factory_id = legacy.factory_id and groups.is_active
    where legacy.applies_to = 'mud_supply'
      and not exists (
        select 1
        from public.mud_group_rates as rates
        where rates.factory_id = legacy.factory_id
          and rates.labour_group_id = groups.id
          and rates.rate_per_1000_bricks = legacy.rate_per_1000_bricks
          and rates.effective_from = legacy.effective_from
          and rates.effective_to is not distinct from legacy.effective_to
          and rates.created_at = legacy.created_at
      )
  ) then
    raise exception 'FAIL: existing factory Mud rate history was not copied exactly';
  end if;
  raise notice 'PASS: real Test Atlas Clean active-group term and Mud rate backfill is exact';

  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Mud Multi Group Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Mud Multi Group Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Mud Multi Group Brick A'),
    (brick_b_id, factory_b_id, 'Mud Multi Group Brick B');
  insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values
    (labourer_a_id, factory_a_id, 'Mud Multi Group Labourer A', brick_a_id),
    (labourer_b_id, factory_b_id, 'Mud Multi Group Labourer B', brick_b_id);
  insert into public.labour_groups(id, factory_id, name, member_names, member_count, is_active) values
    (group_a_id, factory_a_id, 'Mud Group A', 'A1-A6', 6, true),
    (group_b_id, factory_a_id, 'Mud Group B', 'B1-B9', 9, false),
    (group_missing_rate_id, factory_a_id, 'Mud Group Missing Rate', 'C1', 1, false),
    (factory_b_group_id, factory_b_id, 'Factory B Mud Group', 'D1-D2', 2, true);

  perform pg_temp.expect_error(
    'legacy one-active-group constraint remains enforced', '23505',
    format(
      'insert into public.labour_groups(factory_id,name,member_count,is_active) values (%L::uuid,%L,1,true)',
      factory_a_id, 'Forbidden second legacy active group'
    )
  );

  insert into public.mud_group_terms(
    factory_id, labour_group_id, member_count, effective_from, effective_to
  ) values
    (factory_a_id, group_a_id, 6, date '2026-08-31', date '2026-09-14'),
    (factory_a_id, group_a_id, 7, date '2026-09-15', date '2026-09-19'),
    (factory_a_id, group_a_id, 1, date '2026-09-20', null),
    (factory_a_id, group_b_id, 9, date '2026-09-01', date '2026-09-19'),
    (factory_a_id, group_b_id, 1, date '2026-09-20', null),
    (factory_a_id, group_missing_rate_id, 1, date '2026-09-21', null),
    (factory_b_id, factory_b_group_id, 2, date '2026-09-01', null);
  insert into public.mud_group_rates(
    factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to
  ) values
    (factory_a_id, group_a_id, 100, date '2026-08-31', date '2026-09-14'),
    (factory_a_id, group_a_id, 110, date '2026-09-15', null),
    (factory_a_id, group_b_id, 120, date '2026-09-01', null),
    (factory_b_id, factory_b_group_id, 999, date '2026-09-01', null);

  perform pg_temp.expect_error(
    'same-group member terms cannot overlap', '23P01',
    format(
      'insert into public.mud_group_terms(factory_id,labour_group_id,member_count,effective_from,effective_to) values (%L::uuid,%L::uuid,8,date %L,date %L)',
      factory_a_id, group_a_id, '2026-09-14', '2026-09-16'
    )
  );
  perform pg_temp.expect_error(
    'same-group Mud rates cannot overlap', '23P01',
    format(
      'insert into public.mud_group_rates(factory_id,labour_group_id,rate_per_1000_bricks,effective_from,effective_to) values (%L::uuid,%L::uuid,105,date %L,date %L)',
      factory_a_id, group_a_id, '2026-09-14', '2026-09-16'
    )
  );
  perform pg_temp.expect_error(
    'non-positive group rate is rejected', '23514',
    format(
      'insert into public.mud_group_rates(factory_id,labour_group_id,rate_per_1000_bricks,effective_from) values (%L::uuid,%L::uuid,0,date %L)',
      factory_a_id, group_missing_rate_id, '2026-01-01'
    )
  );
  perform pg_temp.expect_error(
    'group configuration cannot cross factories', '23503',
    format(
      'insert into public.mud_group_terms(factory_id,labour_group_id,member_count,effective_from) values (%L::uuid,%L::uuid,1,date %L)',
      factory_b_id, group_a_id, '2026-01-01'
    )
  );
  raise notice 'PASS: different groups overlap structurally while same-group periods and cross-factory rows fail closed';

  insert into public.production_entries(
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-08-31', 12345),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-10', 100000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-15', 160000),
    (gen_random_uuid(), factory_a_id, labourer_a_id, brick_a_id, date '2026-09-20', 5),
    (gen_random_uuid(), factory_b_id, labourer_b_id, brick_b_id, date '2026-09-10', 9999);
  insert into public.wage_rates(
    factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (factory_a_id, 'mud_supply', 30, date '2026-08-31');

  perform set_config('atlas_mud_multi.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_multi.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_mud_multi.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_mud_multi.group_a_id', group_a_id::text, true);
  perform set_config('atlas_mud_multi.group_b_id', group_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_multi.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_mud_multi.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_mud_multi.factory_b_id')::uuid;
  group_a_id uuid := current_setting('atlas_mud_multi.group_a_id')::uuid;
  group_b_id uuid := current_setting('atlas_mud_multi.group_b_id')::uuid;
  allocation record;
  group_count bigint;
  total_allocated bigint;
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

  select * into allocation
  from public.get_mud_group_daily_allocation(factory_a_id, date '2026-08-31');
  if allocation.labour_group_id <> group_a_id
    or allocation.allocated_production <> 12345
    or allocation.earned_amount <> 1234.5 then
    raise exception 'FAIL: one-group allocation did not receive all Production: %', row_to_json(allocation);
  end if;
  raise notice 'PASS: one configured group receives all 12,345 eligible bricks';

  select count(*), sum(rows.allocated_production)
  into group_count, total_allocated
  from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-10') as rows;
  if group_count <> 2 or total_allocated <> 100000
    or not exists (
      select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-10')
      where labour_group_id = group_a_id and member_count = 6
        and allocated_production = 40000 and rate_per_1000_bricks = 100 and earned_amount = 4000
    )
    or not exists (
      select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-10')
      where labour_group_id = group_b_id and member_count = 9
        and allocated_production = 60000 and rate_per_1000_bricks = 120 and earned_amount = 7200
    ) then
    raise exception 'FAIL: 6:9 two-group allocation is wrong';
  end if;
  raise notice 'PASS: 100,000 bricks allocate 40,000/60,000 and earn 4,000/7,200';

  if not exists (
      select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-15')
      where labour_group_id = group_a_id and member_count = 7
        and allocated_production = 70000 and rate_per_1000_bricks = 110 and earned_amount = 7700
    )
    or not exists (
      select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-15')
      where labour_group_id = group_b_id and member_count = 9
        and allocated_production = 90000 and rate_per_1000_bricks = 120 and earned_amount = 10800
    ) then
    raise exception 'FAIL: effective-dated member or rate change was not resolved by work date';
  end if;
  raise notice 'PASS: effective-dated member-count and group-rate changes resolve independently by date';

  select count(*), sum(rows.allocated_production)
  into group_count, total_allocated
  from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-20') as rows;
  if group_count <> 2 or total_allocated <> 5
    or not exists (
      select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-20')
      where labour_group_id = group_a_id and allocated_production = 3
    )
    or not exists (
      select 1 from public.get_mud_group_daily_allocation(factory_a_id, date '2026-09-20')
      where labour_group_id = group_b_id and allocated_production = 2
    ) then
    raise exception 'FAIL: largest-remainder allocation did not conserve 5 bricks with UUID tie-break';
  end if;
  raise notice 'PASS: awkward 5-brick split is exact and deterministic (lower UUID gets 3, other gets 2)';

  perform pg_temp.expect_error(
    'date without active Mud group coverage fails explicitly', 'P2701',
    format('select * from public.get_mud_group_daily_allocation(%L::uuid,date %L)', factory_a_id, '2026-08-30')
  );
  perform pg_temp.expect_error(
    'active group without a group rate fails explicitly', 'P2704',
    format('select * from public.get_mud_group_daily_allocation(%L::uuid,date %L)', factory_a_id, '2026-09-21')
  );

  if exists (select 1 from public.mud_group_terms where factory_id = factory_b_id)
    or exists (select 1 from public.mud_group_rates where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory B Mud configuration leaked through RLS';
  end if;
  perform pg_temp.expect_error(
    'Factory A user cannot calculate Factory B allocation', '42501',
    format('select * from public.get_mud_group_daily_allocation(%L::uuid,date %L)', factory_b_id, '2026-09-10')
  );
  raise notice 'PASS: Mud configuration reads and allocation RPC are factory-isolated';

  select * into allocation
  from public.calculate_mud_supply_wages(factory_a_id, group_a_id, date '2026-08-31');
  if allocation.groups_calculated <> 1 or allocation.rows_skipped <> 0
    or not exists (
      select 1 from public.weekly_earnings
      where factory_id = factory_a_id and labour_group_id = group_a_id
        and week_start = date '2026-08-31' and quantity_used = 12345
        and rate_used = 30 and amount = 370.35
    ) then
    raise exception 'FAIL: existing weekly Mud accounting behavior changed';
  end if;
  if (select count(*) from public.weekly_earnings) <> weekly_count + 1
    or (select count(*) from public.withdrawals) <> withdrawal_count
    or (select count(*) from public.production_earning_settlements) <> settlement_count
    or (select count(*) from public.production_earning_settlement_details) <> settlement_detail_count
    or (select count(*) from public.production_wage_rates) <> production_rate_count
    or (select count(*) from public.transport_daily_entries) <> transport_daily_count
    or (select count(*) from public.transport_weekly_earnings) <> transport_earning_count then
    raise exception 'FAIL: dormant Mud foundation changed existing accounting data';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> mud_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> production_function_before
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> transport_function_before then
    raise exception 'FAIL: an existing Mud, Production, or Chamber Transport accounting function changed';
  end if;
  raise notice 'PASS: old weekly Mud calculation remains active; withdrawals, Production settlement, and Chamber Transport are unchanged';
end;
$$;

rollback;

select 'PASS: Mud Multi-Group Phase 1 verifier completed and every fixture was rolled back.' as result;
