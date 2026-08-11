-- Run this entire file in the Supabase SQL Editor after applying Module 2.4E.
-- It requires one existing public.factory_users row. The final rollback removes
-- every fixture row and restores the selected user's original factory mapping.

begin;

create temporary table module_2_4e_verification_context (ready boolean);

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
  raise exception 'FAIL: % unexpectedly succeeded', test_label;
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
  brick_type_id uuid := gen_random_uuid();
  active_labourer_id uuid := gen_random_uuid();
  inactive_labourer_id uuid := gen_random_uuid();
  placeholder_labourer_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  completed_week_start date;
begin
  current_week_start := business_today - (extract(isodow from business_today)::integer - 1);
  completed_week_start := current_week_start - 7;

  select user_id
    into test_user_id
    from public.factory_users
    order by created_at
    limit 1
    for update;

  if test_user_id is null then
    raise exception 'FAIL: prerequisite missing: create an authenticated user with a factory_users mapping before running this script';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Module 2.4E verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.4E verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where user_id = test_user_id;

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_id, factory_a_id, 'Module 2.4E verification brick type');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active, is_placeholder)
  values
    (active_labourer_id, factory_a_id, 'Module 2.4E active labourer', brick_type_id, true, false),
    (inactive_labourer_id, factory_a_id, 'Module 2.4E inactive labourer', brick_type_id, false, false),
    (placeholder_labourer_id, factory_a_id, 'Module 2.4E placeholder labourer', brick_type_id, true, true);

  insert into public.production_entries (id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  values
    (gen_random_uuid(), factory_a_id, active_labourer_id, brick_type_id, completed_week_start, 1000),
    (gen_random_uuid(), factory_a_id, active_labourer_id, brick_type_id, completed_week_start + 3, 500),
    (gen_random_uuid(), factory_a_id, inactive_labourer_id, brick_type_id, completed_week_start + 2, 2000),
    (gen_random_uuid(), factory_a_id, placeholder_labourer_id, brick_type_id, completed_week_start + 1, 999),
    (gen_random_uuid(), factory_a_id, active_labourer_id, brick_type_id, completed_week_start - 1, 300),
    (gen_random_uuid(), factory_a_id, active_labourer_id, brick_type_id, current_week_start, 400);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.active_labourer_id', active_labourer_id::text, true);
  perform set_config('atlas_test.inactive_labourer_id', inactive_labourer_id::text, true);
  perform set_config('atlas_test.placeholder_labourer_id', placeholder_labourer_id::text, true);
  perform set_config('atlas_test.current_week_start', current_week_start::text, true);
  perform set_config('atlas_test.completed_week_start', completed_week_start::text, true);

  raise notice 'PASS: rollback-only Factory A/B test fixtures created';
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
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date + 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'current week is rejected',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.current_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'future week is rejected',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.current_week_start')::date + 7
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'missing production rate is rejected',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );
end;
$$;

reset role;

do $$
begin
  insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values (
    current_setting('atlas_test.factory_a_id')::uuid,
    'production',
    520,
    current_setting('atlas_test.completed_week_start')::date - 7
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  first_run record;
  second_run record;
  active_earning public.weekly_earnings%rowtype;
  inactive_earning public.weekly_earnings%rowtype;
  active_earning_after_rerun public.weekly_earnings%rowtype;
begin
  select *
    into first_run
    from public.calculate_production_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if first_run.labourers_calculated <> 2 or first_run.rows_skipped <> 0 then
    raise exception 'FAIL: completed-week calculation returned calculated %, skipped %', first_run.labourers_calculated, first_run.rows_skipped;
  end if;

  select *
    into active_earning
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.active_labourer_id')::uuid
      and week_start = current_setting('atlas_test.completed_week_start')::date;

  select *
    into inactive_earning
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.inactive_labourer_id')::uuid
      and week_start = current_setting('atlas_test.completed_week_start')::date;

  if active_earning.quantity_used <> 1500
    or active_earning.rate_used <> 520
    or active_earning.amount <> 780
    or inactive_earning.quantity_used <> 2000
    or inactive_earning.amount <> 1040 then
    raise exception 'FAIL: stored weekly earning snapshots do not match production quantities and rate';
  end if;

  if active_earning.wage_rate_id <> (
    select id
    from public.wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'production'
  ) then
    raise exception 'FAIL: weekly earning did not snapshot the resolved wage-rate ID';
  end if;

  if exists (
    select 1
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.placeholder_labourer_id')::uuid
      and week_start = current_setting('atlas_test.completed_week_start')::date
  ) then
    raise exception 'FAIL: placeholder labourer received an earning';
  end if;

  select *
    into second_run
    from public.calculate_production_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if second_run.labourers_calculated <> 0 or second_run.rows_skipped <> 2 then
    raise exception 'FAIL: rerun returned calculated %, skipped %', second_run.labourers_calculated, second_run.rows_skipped;
  end if;

  select *
    into active_earning_after_rerun
    from public.weekly_earnings
    where id = active_earning.id;

  if active_earning_after_rerun.factory_id <> active_earning.factory_id
    or active_earning_after_rerun.labourer_id <> active_earning.labourer_id
    or active_earning_after_rerun.week_start <> active_earning.week_start
    or active_earning_after_rerun.quantity_used <> active_earning.quantity_used
    or active_earning_after_rerun.wage_rate_id <> active_earning.wage_rate_id
    or active_earning_after_rerun.rate_used <> active_earning.rate_used
    or active_earning_after_rerun.amount <> active_earning.amount
    or active_earning_after_rerun.calculated_at <> active_earning.calculated_at then
    raise exception 'FAIL: rerun changed an existing locked earning snapshot';
  end if;

  raise notice 'PASS: completed production week stores correct immutable earnings and reruns safely';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'Factory A user cannot calculate Factory B',
    '42501',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_b_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot directly INSERT weekly_earnings',
    '42501',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      )
      select
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.active_labourer_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date,
        1,
        wage_rates.id,
        1,
        1
      from public.wage_rates
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    $sql$
  );
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous users cannot execute calculate_production_wages',
    '42501',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
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
begin
  select pg_get_functiondef('public.calculate_production_wages(uuid, date)'::regprocedure)
    into function_definition;

  if position('pg_advisory_xact_lock' in function_definition) = 0 then
    raise exception 'FAIL: calculate_production_wages does not use a transaction-level advisory lock';
  end if;

  raise notice 'PASS: calculate_production_wages uses a transaction-level advisory lock';
end;
$$;

rollback;
