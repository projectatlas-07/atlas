-- Run this entire file in the Supabase SQL Editor after applying Module 2.8B.2.
-- It requires one existing public.factory_users row. Every fixture and mapping
-- change is discarded by the final rollback.

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
  raise exception 'FAIL: % unexpectedly succeeded', test_label
    using errcode = 'P9999';
exception
  when others then
    if sqlstate = expected_sqlstate then
      raise notice 'PASS: %', test_label;
    else
      raise exception 'FAIL: % expected SQLSTATE %, received % (%)',
        test_label,
        expected_sqlstate,
        sqlstate,
        sqlerrm;
    end if;
end;
$$;

do $$
declare
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  factory_user_mapping_id uuid;
  test_user_id uuid;
  factory_a_brick_type_id uuid := gen_random_uuid();
  factory_b_brick_type_id uuid := gen_random_uuid();
  labourer_a1_id uuid := gen_random_uuid();
  labourer_a2_id uuid := gen_random_uuid();
  placeholder_a_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
  group_b_id uuid := gen_random_uuid();
  factory_b_group_id uuid := gen_random_uuid();
  mud_rate_a_id uuid := gen_random_uuid();
  mud_rate_b_id uuid := gen_random_uuid();
  production_rate_a_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  week_x date;
  week_y date;
begin
  current_week_start := business_today - (extract(isodow from business_today)::integer - 1);
  week_y := current_week_start - 7;
  week_x := current_week_start - 14;

  select id, user_id
    into factory_user_mapping_id, test_user_id
    from public.factory_users
    order by created_at
    limit 1
    for update;

  if test_user_id is null then
    raise exception 'FAIL: prerequisite missing: create an authenticated user with a factory_users mapping before running this script';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Module 2.8B.2 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.8B.2 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = factory_user_mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (factory_a_brick_type_id, factory_a_id, 'Module 2.8B.2 Factory A brick type'),
    (factory_b_brick_type_id, factory_b_id, 'Module 2.8B.2 Factory B brick type');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active, is_placeholder)
  values
    (labourer_a1_id, factory_a_id, 'Module 2.8B.2 labourer A1', factory_a_brick_type_id, true, false),
    (labourer_a2_id, factory_a_id, 'Module 2.8B.2 labourer A2', factory_a_brick_type_id, false, false),
    (placeholder_a_id, factory_a_id, 'Module 2.8B.2 placeholder A', factory_a_brick_type_id, true, true),
    (labourer_b_id, factory_b_id, 'Module 2.8B.2 labourer B', factory_b_brick_type_id, true, false);

  insert into public.labour_groups (id, factory_id, name, member_count, is_active)
  values
    (group_a_id, factory_a_id, 'Module 2.8B.2 Group A', 8, true),
    (group_b_id, factory_a_id, 'Module 2.8B.2 Group B', 6, false),
    (factory_b_group_id, factory_b_id, 'Module 2.8B.2 Factory B group', 5, true);

  insert into public.wage_rates (id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values
    (mud_rate_a_id, factory_a_id, 'mud_supply', 230, week_x),
    (production_rate_a_id, factory_a_id, 'production', 520, week_x),
    (mud_rate_b_id, factory_b_id, 'mud_supply', 200, week_x);

  insert into public.production_entries (id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  values
    (gen_random_uuid(), factory_a_id, labourer_a1_id, factory_a_brick_type_id, week_x, 60000),
    (gen_random_uuid(), factory_a_id, labourer_a2_id, factory_a_brick_type_id, week_x + 1, 40000),
    (gen_random_uuid(), factory_a_id, placeholder_a_id, factory_a_brick_type_id, week_x + 2, 99999),
    (gen_random_uuid(), factory_a_id, labourer_a1_id, factory_a_brick_type_id, week_y, 70000),
    (gen_random_uuid(), factory_a_id, labourer_a2_id, factory_a_brick_type_id, week_y + 1, 30000),
    (gen_random_uuid(), factory_b_id, labourer_b_id, factory_b_brick_type_id, week_x, 50000);

  insert into public.weekly_earnings (
    factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values
    (factory_a_id, labourer_a1_id, week_x, 60000, production_rate_a_id, 520, 31200),
    (factory_a_id, labourer_a2_id, week_x, 40000, production_rate_a_id, 520, 20800);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.factory_user_mapping_id', factory_user_mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.group_a_id', group_a_id::text, true);
  perform set_config('atlas_test.group_b_id', group_b_id::text, true);
  perform set_config('atlas_test.factory_b_group_id', factory_b_group_id::text, true);
  perform set_config('atlas_test.mud_rate_a_id', mud_rate_a_id::text, true);
  perform set_config('atlas_test.week_x', week_x::text, true);
  perform set_config('atlas_test.week_y', week_y::text, true);

  raise notice 'PASS: rollback-only two-factory, two-week fixtures created with two labourer earnings for week X';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  group_a_result record;
  group_b_same_week_result record;
  group_b_new_week_result record;
  original_earning public.weekly_earnings%rowtype;
  original_earning_after_switch public.weekly_earnings%rowtype;
  new_week_earning public.weekly_earnings%rowtype;
begin
  select *
    into group_a_result
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.group_a_id')::uuid,
      current_setting('atlas_test.week_x')::date
    );

  select *
    into original_earning
    from public.weekly_earnings
    where id = group_a_result.weekly_earning_id;

  if group_a_result.groups_calculated <> 1
    or group_a_result.rows_skipped <> 0
    or original_earning.labour_group_id <> current_setting('atlas_test.group_a_id')::uuid
    or original_earning.quantity_used <> 100000
    or original_earning.rate_used <> 230
    or original_earning.amount <> 23000 then
    raise exception 'FAIL: Group A week X earning was not calculated correctly';
  end if;

  update public.labour_groups
  set is_active = false
  where id = current_setting('atlas_test.group_a_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  update public.labour_groups
  set is_active = true
  where id = current_setting('atlas_test.group_b_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  select *
    into group_b_same_week_result
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.group_b_id')::uuid,
      current_setting('atlas_test.week_x')::date
    );

  select *
    into original_earning_after_switch
    from public.weekly_earnings
    where id = original_earning.id;

  if group_b_same_week_result.weekly_earning_id <> original_earning.id
    or group_b_same_week_result.groups_calculated <> 0
    or group_b_same_week_result.rows_skipped <> 1
    or original_earning_after_switch.labour_group_id <> current_setting('atlas_test.group_a_id')::uuid
    or original_earning_after_switch.quantity_used <> original_earning.quantity_used
    or original_earning_after_switch.wage_rate_id <> original_earning.wage_rate_id
    or original_earning_after_switch.rate_used <> original_earning.rate_used
    or original_earning_after_switch.amount <> original_earning.amount
    or original_earning_after_switch.calculated_at <> original_earning.calculated_at then
    raise exception 'FAIL: Group B same-week attempt did not preserve and skip Group A earning';
  end if;

  if (
    select count(*)
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = current_setting('atlas_test.week_x')::date
      and labour_group_id is not null
  ) <> 1 then
    raise exception 'FAIL: more than one group earning exists for Factory A week X';
  end if;

  select *
    into group_b_new_week_result
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.group_b_id')::uuid,
      current_setting('atlas_test.week_y')::date
    );

  select *
    into new_week_earning
    from public.weekly_earnings
    where id = group_b_new_week_result.weekly_earning_id;

  if group_b_new_week_result.groups_calculated <> 1
    or group_b_new_week_result.rows_skipped <> 0
    or new_week_earning.labour_group_id <> current_setting('atlas_test.group_b_id')::uuid
    or new_week_earning.week_start <> current_setting('atlas_test.week_y')::date
    or new_week_earning.quantity_used <> 100000
    or new_week_earning.amount <> 23000 then
    raise exception 'FAIL: Group B could not calculate the legitimate new week';
  end if;

  if (
    select count(*)
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = current_setting('atlas_test.week_x')::date
      and labourer_id is not null
  ) <> 2 then
    raise exception 'FAIL: labourer earnings for the same factory/week were affected';
  end if;

  raise notice 'PASS: Group A remains the sole week X owner, Group B skips week X, Group B earns week Y, and labourer earnings remain valid';
end;
$$;

reset role;

do $$
begin
  perform pg_temp.expect_error(
    'database index rejects a second direct group earning for Factory A week X',
    '23505',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.group_b_id')::uuid,
        current_setting('atlas_test.week_x')::date,
        100000,
        current_setting('atlas_test.mud_rate_a_id')::uuid,
        230,
        23000
      )
    $sql$
  );

  update public.factory_users
  set factory_id = current_setting('atlas_test.factory_b_id')::uuid,
      is_active = true
  where id = current_setting('atlas_test.factory_user_mapping_id')::uuid;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_b_result record;
  factory_b_earning public.weekly_earnings%rowtype;
begin
  select *
    into factory_b_result
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_b_id')::uuid,
      current_setting('atlas_test.factory_b_group_id')::uuid,
      current_setting('atlas_test.week_x')::date
    );

  select *
    into factory_b_earning
    from public.weekly_earnings
    where id = factory_b_result.weekly_earning_id;

  if factory_b_result.groups_calculated <> 1
    or factory_b_result.rows_skipped <> 0
    or factory_b_earning.factory_id <> current_setting('atlas_test.factory_b_id')::uuid
    or factory_b_earning.labour_group_id <> current_setting('atlas_test.factory_b_group_id')::uuid
    or factory_b_earning.week_start <> current_setting('atlas_test.week_x')::date
    or factory_b_earning.quantity_used <> 50000
    or factory_b_earning.rate_used <> 200
    or factory_b_earning.amount <> 10000 then
    raise exception 'FAIL: Factory B could not independently calculate week X';
  end if;

  raise notice 'PASS: another factory independently stores its own group earning for the same week';
end;
$$;

reset role;

do $$
declare
  function_definition text;
  index_definition text;
begin
  select pg_get_functiondef('public.calculate_mud_supply_wages(uuid, uuid, date)'::regprocedure)
    into function_definition;

  select indexdef
    into index_definition
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'weekly_earnings_one_group_per_factory_week_idx';

  if index_definition is null
    or position('UNIQUE INDEX' in upper(index_definition)) = 0
    or position('(FACTORY_ID, WEEK_START)' in upper(index_definition)) = 0
    or position('LABOUR_GROUP_ID IS NOT NULL' in upper(index_definition)) = 0 then
    raise exception 'FAIL: one-group-earning-per-factory/week index is missing or incorrect';
  end if;

  if position('pg_advisory_xact_lock' in function_definition) = 0
    or position('ON CONFLICT (FACTORY_ID, WEEK_START)' in upper(function_definition)) = 0 then
    raise exception 'FAIL: RPC is missing factory/week locking or conflict-safe insertion';
  end if;

  raise notice 'PASS: factory/week advisory locking, conflict handling, and the partial unique index protect concurrent calls';
end;
$$;

rollback;
