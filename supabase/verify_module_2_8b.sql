-- Run this entire file in the Supabase SQL Editor after applying Module 2.8B.
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
  test_user_id uuid;
  factory_user_mapping_id uuid;
  factory_a_brick_type_id uuid := gen_random_uuid();
  active_labourer_id uuid := gen_random_uuid();
  inactive_labourer_id uuid := gen_random_uuid();
  placeholder_labourer_id uuid := gen_random_uuid();
  active_group_id uuid := gen_random_uuid();
  inactive_group_id uuid := gen_random_uuid();
  factory_b_group_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  completed_week_start date;
begin
  current_week_start := business_today - (extract(isodow from business_today)::integer - 1);
  completed_week_start := current_week_start - 7;

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
    (factory_a_id, format('Module 2.8B verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.8B verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = factory_user_mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values (factory_a_brick_type_id, factory_a_id, 'Module 2.8B verification brick type');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active, is_placeholder)
  values
    (active_labourer_id, factory_a_id, 'Module 2.8B active labourer', factory_a_brick_type_id, true, false),
    (inactive_labourer_id, factory_a_id, 'Module 2.8B inactive labourer', factory_a_brick_type_id, false, false),
    (placeholder_labourer_id, factory_a_id, 'Module 2.8B placeholder labourer', factory_a_brick_type_id, true, true);

  insert into public.labour_groups (id, factory_id, name, member_names, member_count, is_active)
  values
    (active_group_id, factory_a_id, 'Module 2.8B active group', 'Eight members', 8, true),
    (inactive_group_id, factory_a_id, 'Module 2.8B inactive group', null, null, false),
    (factory_b_group_id, factory_b_id, 'Module 2.8B Factory B group', 'Five members', 5, true);

  insert into public.production_entries (id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  values
    (gen_random_uuid(), factory_a_id, active_labourer_id, factory_a_brick_type_id, completed_week_start, 40000),
    (gen_random_uuid(), factory_a_id, active_labourer_id, factory_a_brick_type_id, completed_week_start + 6, 20000),
    (gen_random_uuid(), factory_a_id, inactive_labourer_id, factory_a_brick_type_id, completed_week_start + 3, 40000),
    (gen_random_uuid(), factory_a_id, placeholder_labourer_id, factory_a_brick_type_id, completed_week_start + 2, 99999),
    (gen_random_uuid(), factory_a_id, active_labourer_id, factory_a_brick_type_id, completed_week_start - 1, 11111),
    (gen_random_uuid(), factory_a_id, active_labourer_id, factory_a_brick_type_id, current_week_start, 22222);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.active_group_id', active_group_id::text, true);
  perform set_config('atlas_test.inactive_group_id', inactive_group_id::text, true);
  perform set_config('atlas_test.factory_b_group_id', factory_b_group_id::text, true);
  perform set_config('atlas_test.current_week_start', current_week_start::text, true);
  perform set_config('atlas_test.completed_week_start', completed_week_start::text, true);

  raise notice 'PASS: rollback-only mud-supply fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'non-Monday week_start is rejected',
    '22023',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date + 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'current week is rejected',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.current_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'future week is rejected',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.current_week_start')::date + 7
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'inactive labour group is not eligible',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.inactive_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A cannot calculate a Factory B labour group',
    '42501',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.factory_b_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'missing mud-supply rate is rejected',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );
end;
$$;

reset role;

do $$
declare
  mud_rate_id uuid := gen_random_uuid();
  overlapping_mud_rate_id uuid := gen_random_uuid();
begin
  insert into public.wage_rates (id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values
    (
      mud_rate_id,
      current_setting('atlas_test.factory_a_id')::uuid,
      'mud_supply',
      230,
      current_setting('atlas_test.completed_week_start')::date
    ),
    (
      overlapping_mud_rate_id,
      current_setting('atlas_test.factory_a_id')::uuid,
      'mud_supply',
      240,
      current_setting('atlas_test.completed_week_start')::date
    );
  perform set_config('atlas_test.mud_rate_id', mud_rate_id::text, true);
  perform set_config('atlas_test.overlapping_mud_rate_id', overlapping_mud_rate_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'overlapping mud-supply rates are rejected',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );
end;
$$;

reset role;

delete from public.wage_rates
where id = current_setting('atlas_test.overlapping_mud_rate_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  first_run record;
  second_run record;
  stored_earning public.weekly_earnings%rowtype;
  stored_earning_after_rerun public.weekly_earnings%rowtype;
begin
  select *
    into first_run
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.active_group_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if first_run.groups_calculated <> 1 or first_run.rows_skipped <> 0 then
    raise exception 'FAIL: first run returned calculated %, skipped %', first_run.groups_calculated, first_run.rows_skipped;
  end if;

  select *
    into stored_earning
    from public.weekly_earnings
    where id = first_run.weekly_earning_id;

  if stored_earning.factory_id <> current_setting('atlas_test.factory_a_id')::uuid
    or stored_earning.labourer_id is not null
    or stored_earning.labour_group_id <> current_setting('atlas_test.active_group_id')::uuid
    or stored_earning.week_start <> current_setting('atlas_test.completed_week_start')::date
    or stored_earning.quantity_used <> 100000
    or stored_earning.wage_rate_id <> current_setting('atlas_test.mud_rate_id')::uuid
    or stored_earning.rate_used <> 230
    or stored_earning.amount <> 23000 then
    raise exception 'FAIL: stored group earning snapshot is incorrect';
  end if;

  update public.labour_groups
  set is_active = false
  where id = current_setting('atlas_test.active_group_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  select *
    into second_run
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.active_group_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if second_run.weekly_earning_id <> stored_earning.id
    or second_run.groups_calculated <> 0
    or second_run.rows_skipped <> 1 then
    raise exception 'FAIL: rerun did not return the existing locked earning as skipped';
  end if;

  select *
    into stored_earning_after_rerun
    from public.weekly_earnings
    where id = stored_earning.id;

  if stored_earning_after_rerun.quantity_used <> stored_earning.quantity_used
    or stored_earning_after_rerun.wage_rate_id <> stored_earning.wage_rate_id
    or stored_earning_after_rerun.rate_used <> stored_earning.rate_used
    or stored_earning_after_rerun.amount <> stored_earning.amount
    or stored_earning_after_rerun.calculated_at <> stored_earning.calculated_at then
    raise exception 'FAIL: rerun changed the immutable group earning snapshot';
  end if;

  raise notice 'PASS: group earning stores quantity 100000, rate 230, amount 23000, excludes placeholder production, includes inactive labourer production, ignores member count, and reruns safely after group deactivation';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'authenticated users cannot directly INSERT weekly_earnings',
    '42501',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date - 7,
        1,
        current_setting('atlas_test.mud_rate_id')::uuid,
        1,
        1
      )
    $sql$
  );
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous users cannot execute calculate_mud_supply_wages',
    '42501',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_group_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );
end;
$$;

reset role;

do $$
declare
  function_definition text;
  group_unique_index text;
begin
  select pg_get_functiondef('public.calculate_mud_supply_wages(uuid, uuid, date)'::regprocedure)
    into function_definition;

  select indexdef
    into group_unique_index
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'weekly_earnings_factory_labour_group_week_key';

  if position('pg_advisory_xact_lock' in function_definition) = 0
    or position('ON CONFLICT' in upper(function_definition)) = 0 then
    raise exception 'FAIL: RPC is missing transaction locking or conflict-safe insertion';
  end if;

  if position('member_count' in function_definition) > 0 then
    raise exception 'FAIL: member_count influences the authoritative stored earning';
  end if;

  if group_unique_index is null
    or position('UNIQUE INDEX' in upper(group_unique_index)) = 0
    or position('LABOUR_GROUP_ID IS NOT NULL' in upper(group_unique_index)) = 0 then
    raise exception 'FAIL: group weekly-earning uniqueness index is missing or incorrect';
  end if;

  raise notice 'PASS: advisory locking, conflict-safe insertion, and the unique group/week index protect concurrent calls from duplicates';
end;
$$;

rollback;
