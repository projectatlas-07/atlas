-- Atlas Chamber Transport T5 immutable weekly earning snapshot verifier.
-- Run after applying 20260818000004_create_transport_weekly_earning_foundation.sql.
-- Requires one existing public.factory_users row. All fixtures and mapping
-- changes are transactional and discarded by the final rollback.

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
        test_label, expected_sqlstate, sqlstate, sqlerrm;
    end if;
end;
$$;

create or replace function pg_temp.insert_transport_detail(
  p_factory_id uuid,
  p_parent_id uuid,
  p_worker_id uuid,
  p_week_start date,
  p_daily_entry_id uuid,
  p_crew_id uuid,
  p_work_date date,
  p_rate_id uuid,
  p_rate_snapshot numeric,
  p_paya_snapshot numeric,
  p_attendance_snapshot integer,
  p_pool_snapshot numeric,
  p_share_snapshot numeric
)
returns void
language sql
as $$
  insert into public.transport_weekly_earning_details (
    factory_id,
    transport_weekly_earning_id,
    transport_worker_id,
    week_start,
    transport_daily_entry_id,
    transport_crew_id,
    work_date,
    transport_crew_wage_rate_id,
    rate_per_paya_snapshot,
    paya_quantity_snapshot,
    attendance_count_snapshot,
    daily_crew_pool_snapshot,
    worker_daily_share_snapshot
  ) values (
    p_factory_id,
    p_parent_id,
    p_worker_id,
    p_week_start,
    p_daily_entry_id,
    p_crew_id,
    p_work_date,
    p_rate_id,
    p_rate_snapshot,
    p_paya_snapshot,
    p_attendance_snapshot,
    p_pool_snapshot,
    p_share_snapshot
  );
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'transport_weekly_earnings',
    'transport_weekly_earning_details'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class
      where oid = format('public.%I', table_name)::regclass
        and relrowsecurity
    ) then
      raise exception 'FAIL: RLS is not enabled on public.%', table_name;
    end if;

    if not has_table_privilege(
      'authenticated', format('public.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'UPDATE'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'DELETE'
    ) or has_table_privilege(
      'anon', format('public.%I', table_name), 'SELECT'
    ) then
      raise exception 'FAIL: immutable table grants are incorrect on public.%', table_name;
    end if;

    if (
      select count(*)
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = table_name
    ) <> 1 or not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
    ) then
      raise exception 'FAIL: public.% must have only its SELECT policy', table_name;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earnings'::regclass
      and conname = 'transport_weekly_earnings_worker_week_key'
      and contype = 'u'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earnings'::regclass
      and conname = 'transport_weekly_earnings_worker_factory_fkey'
      and contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earning_details'::regclass
      and conname = 'transport_weekly_earning_details_parent_identity_fkey'
      and contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earning_details'::regclass
      and conname = 'transport_weekly_earning_details_daily_entry_fkey'
      and contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earning_details'::regclass
      and conname = 'transport_weekly_earning_details_rate_factory_fkey'
      and contype = 'f'
  ) then
    raise exception 'FAIL: required T5 unique or composite foreign keys are missing';
  end if;

  raise notice 'PASS: T5 constraints, RLS, SELECT-only policies, and grants are present';
end;
$$;

do $$
declare
  production_calculator_definition text;
  daily_save_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_memberships'::regclass
      and conname = 'transport_crew_memberships_no_overlapping_dates'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_daily_entries'::regclass
      and conname = 'transport_daily_entries_factory_crew_date_key'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_daily_attendance'::regclass
      and conname = 'transport_daily_attendance_worker_day_key'
  ) or to_regprocedure(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'
  ) is null or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_wage_rates'::regclass
      and conname = 'transport_crew_wage_rates_no_overlapping_dates'
  ) or to_regprocedure(
    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'
  ) is null then
    raise exception 'FAIL: T1-T3 transport database foundations changed';
  end if;

  select pg_get_functiondef(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure
  ) into daily_save_definition;

  if daily_save_definition ilike '%transport_weekly_earning%' then
    raise exception 'FAIL: T2B daily-save RPC was coupled to T5 earnings';
  end if;

  if to_regclass('public.weekly_earnings') is null
    or to_regclass('public.production_weekly_earning_details') is null
    or to_regprocedure('public.resolve_production_wage_rate(uuid,uuid,date)') is null
    or to_regprocedure('public.calculate_production_wages(uuid,date)') is null then
    raise exception 'FAIL: production wage schema or behavior is missing';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid,date)'::regprocedure
  ) into production_calculator_definition;

  if production_calculator_definition not ilike '%resolve_production_wage_rate%'
    or production_calculator_definition ilike '%transport_weekly_%' then
    raise exception 'FAIL: production wage calculation behavior was modified';
  end if;

  raise notice 'PASS: T1-T4 scope and production weekly wage behavior remain intact';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  worker_a_id uuid := gen_random_uuid();
  worker_a_zero_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  membership_a_id uuid := gen_random_uuid();
  rate_a_id uuid := gen_random_uuid();
  rate_b_id uuid := gen_random_uuid();
  entry_a_before_id uuid := gen_random_uuid();
  entry_a_monday_id uuid := gen_random_uuid();
  entry_a_tuesday_id uuid := gen_random_uuid();
  entry_a_sunday_id uuid := gen_random_uuid();
  entry_a_after_id uuid := gen_random_uuid();
  entry_b_id uuid := gen_random_uuid();
  earning_a_id uuid := gen_random_uuid();
  earning_a_zero_id uuid := gen_random_uuid();
  earning_b_id uuid := gen_random_uuid();
  detail_a_monday_id uuid := gen_random_uuid();
  detail_a_sunday_id uuid := gen_random_uuid();
begin
  select id, user_id
    into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Transport T5 Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T5 Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_workers (id, factory_id, name, is_active)
  values
    (worker_a_id, factory_a_id, 'T5 Factory A worker', true),
    (worker_a_zero_id, factory_a_id, 'T5 Factory A zero worker', true),
    (worker_b_id, factory_b_id, 'T5 Factory B worker', true);

  insert into public.transport_crews (id, factory_id, name, work_direction, is_active)
  values
    (crew_a_id, factory_a_id, 'T5 Factory A crew', 'FIELD_TO_KILN', true),
    (crew_b_id, factory_b_id, 'T5 Factory B crew', 'KILN_TO_FIELD', true);

  insert into public.transport_crew_memberships (
    id, factory_id, transport_worker_id, transport_crew_id,
    effective_from, effective_to
  ) values
    (membership_a_id, factory_a_id, worker_a_id, crew_a_id,
      date '2026-08-01', null),
    (gen_random_uuid(), factory_b_id, worker_b_id, crew_b_id,
      date '2026-08-01', null);

  insert into public.transport_crew_wage_rates (
    id, factory_id, transport_crew_id, rate_per_paya,
    effective_from, effective_to
  ) values
    (rate_a_id, factory_a_id, crew_a_id, 800.5, date '2026-08-01', null),
    (rate_b_id, factory_b_id, crew_b_id, 900.5, date '2026-08-01', null);

  insert into public.transport_daily_entries (
    id, factory_id, transport_crew_id, work_date, paya_quantity
  ) values
    (entry_a_before_id, factory_a_id, crew_a_id, date '2026-08-02', 8),
    (entry_a_monday_id, factory_a_id, crew_a_id, date '2026-08-03', 10.5),
    (entry_a_tuesday_id, factory_a_id, crew_a_id, date '2026-08-04', 11),
    (entry_a_sunday_id, factory_a_id, crew_a_id, date '2026-08-09', 12.25),
    (entry_a_after_id, factory_a_id, crew_a_id, date '2026-08-10', 9),
    (entry_b_id, factory_b_id, crew_b_id, date '2026-08-05', 15.5);

  insert into public.transport_daily_attendance (
    factory_id, transport_daily_entry_id, transport_crew_id,
    transport_worker_id, work_date
  ) values
    (factory_a_id, entry_a_monday_id, crew_a_id, worker_a_id, date '2026-08-03'),
    (factory_a_id, entry_a_sunday_id, crew_a_id, worker_a_id, date '2026-08-09'),
    (factory_b_id, entry_b_id, crew_b_id, worker_b_id, date '2026-08-05');

  insert into public.transport_weekly_earnings (
    id, factory_id, transport_worker_id, week_start, total_amount
  ) values
    (earning_a_id, factory_a_id, worker_a_id, date '2026-08-03', 1200.75),
    (earning_a_zero_id, factory_a_id, worker_a_zero_id, date '2026-08-03', 0),
    (earning_b_id, factory_b_id, worker_b_id, date '2026-08-03', 700.25);

  insert into public.transport_weekly_earning_details (
    id, factory_id, transport_weekly_earning_id, transport_worker_id,
    week_start, transport_daily_entry_id, transport_crew_id, work_date,
    transport_crew_wage_rate_id, rate_per_paya_snapshot,
    paya_quantity_snapshot, attendance_count_snapshot,
    daily_crew_pool_snapshot, worker_daily_share_snapshot
  ) values
    (detail_a_monday_id, factory_a_id, earning_a_id, worker_a_id,
      date '2026-08-03', entry_a_monday_id, crew_a_id, date '2026-08-03',
      rate_a_id, 800.5, 10.5, 2, 8405.25, 4202.625),
    (detail_a_sunday_id, factory_a_id, earning_a_id, worker_a_id,
      date '2026-08-03', entry_a_sunday_id, crew_a_id, date '2026-08-09',
      rate_a_id, 800.5, 12.25, 1, 9806.125, 9806.125),
    (gen_random_uuid(), factory_b_id, earning_b_id, worker_b_id,
      date '2026-08-03', entry_b_id, crew_b_id, date '2026-08-05',
      rate_b_id, 900.5, 15.5, 1, 13957.75, 13957.75);

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.worker_a_id', worker_a_id::text, true);
  perform set_config('atlas_test.worker_a_zero_id', worker_a_zero_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.membership_a_id', membership_a_id::text, true);
  perform set_config('atlas_test.rate_a_id', rate_a_id::text, true);
  perform set_config('atlas_test.rate_b_id', rate_b_id::text, true);
  perform set_config('atlas_test.entry_a_before_id', entry_a_before_id::text, true);
  perform set_config('atlas_test.entry_a_monday_id', entry_a_monday_id::text, true);
  perform set_config('atlas_test.entry_a_tuesday_id', entry_a_tuesday_id::text, true);
  perform set_config('atlas_test.entry_a_sunday_id', entry_a_sunday_id::text, true);
  perform set_config('atlas_test.entry_a_after_id', entry_a_after_id::text, true);
  perform set_config('atlas_test.entry_b_id', entry_b_id::text, true);
  perform set_config('atlas_test.earning_a_id', earning_a_id::text, true);
  perform set_config('atlas_test.earning_a_zero_id', earning_a_zero_id::text, true);
  perform set_config('atlas_test.earning_b_id', earning_b_id::text, true);
  perform set_config('atlas_test.detail_a_monday_id', detail_a_monday_id::text, true);
  perform set_config('atlas_test.detail_a_sunday_id', detail_a_sunday_id::text, true);

  raise notice 'PASS: Monday/zero/positive totals, decimal snapshots, and Monday/Sunday details accepted';
end;
$$;

select pg_temp.expect_error(
  'non-Monday parent week rejected',
  '23514',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L, %L, date ''2026-08-04'', 1)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.worker_a_zero_id')
  )
);

select pg_temp.expect_error(
  'negative parent total rejected',
  '23514',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L, %L, date ''2026-08-17'', -1)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.worker_a_zero_id')
  )
);

select pg_temp.expect_error(
  'NaN parent total rejected',
  '23514',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L, %L, date ''2026-08-17'', ''NaN''::numeric)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.worker_a_zero_id')
  )
);

select pg_temp.expect_error(
  'duplicate worker/week parent rejected',
  '23505',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L, %L, date ''2026-08-03'', 1)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.worker_a_id')
  )
);

select pg_temp.expect_error(
  'cross-factory parent worker rejected',
  '23503',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L, %L, date ''2026-08-17'', 1)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.worker_b_id')
  )
);

select pg_temp.expect_error(
  'zero detail rate rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,0,11,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'negative detail rate rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,-1,11,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'zero detail paya rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,0,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'negative detail paya rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,-1,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'zero attendance rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,0,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'zero daily pool rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,0,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'negative daily pool rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,-1,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'zero worker share rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,8805.5,0)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'negative worker share rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,8805.5,-1)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'NaN rate snapshot rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,''NaN''::numeric,11,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'NaN paya snapshot rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,''NaN''::numeric,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'NaN pool snapshot rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,''NaN''::numeric,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'NaN worker share snapshot rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,8805.5,''NaN''::numeric)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'detail worker must match parent worker', '23503',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_zero_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'cross-factory parent/detail relationship rejected', '23503',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-05'',%L,900.5,15.5,1,13957.75,13957.75)',
    current_setting('atlas_test.factory_b_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_b_id'), current_setting('atlas_test.entry_b_id'),
    current_setting('atlas_test.crew_b_id'), current_setting('atlas_test.rate_b_id')
  )
);

select pg_temp.expect_error(
  'detail date before parent week rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-02'',%L,800.5,8,1,6404,6404)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_before_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'detail date after parent week rejected', '23514',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-10'',%L,800.5,9,1,7204.5,7204.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_after_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'duplicate daily contribution rejected', '23505',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-03'',%L,800.5,10.5,2,8405.25,4202.625)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_monday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

do $$
begin
  update public.transport_daily_entries
  set paya_quantity = 99
  where id = current_setting('atlas_test.entry_a_monday_id')::uuid;

  update public.transport_crew_wage_rates
  set rate_per_paya = 999
  where id = current_setting('atlas_test.rate_a_id')::uuid;

  delete from public.transport_daily_attendance
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  update public.transport_crew_memberships
  set effective_to = date '2026-08-02'
  where id = current_setting('atlas_test.membership_a_id')::uuid;

  update public.transport_workers
  set is_active = false
  where id = current_setting('atlas_test.worker_a_id')::uuid;

  update public.transport_crews
  set is_active = false
  where id = current_setting('atlas_test.crew_a_id')::uuid;

  if not exists (
    select 1
    from public.transport_weekly_earnings
    where id = current_setting('atlas_test.earning_a_id')::uuid
      and total_amount = 1200.75
  ) or not exists (
    select 1
    from public.transport_weekly_earning_details
    where id = current_setting('atlas_test.detail_a_monday_id')::uuid
      and rate_per_paya_snapshot = 800.5
      and paya_quantity_snapshot = 10.5
      and attendance_count_snapshot = 2
      and daily_crew_pool_snapshot = 8405.25
      and worker_daily_share_snapshot = 4202.625
  ) or not exists (
    select 1
    from public.transport_weekly_earning_details
    where id = current_setting('atlas_test.detail_a_sunday_id')::uuid
      and rate_per_paya_snapshot = 800.5
      and paya_quantity_snapshot = 12.25
      and attendance_count_snapshot = 1
      and daily_crew_pool_snapshot = 9806.125
      and worker_daily_share_snapshot = 9806.125
  ) then
    raise exception 'FAIL: source changes altered locked snapshot values';
  end if;

  if not exists (
    select 1
    from public.transport_daily_entries
    where id = current_setting('atlas_test.entry_a_monday_id')::uuid
      and paya_quantity = 99
  ) or not exists (
    select 1
    from public.transport_crew_wage_rates
    where id = current_setting('atlas_test.rate_a_id')::uuid
      and rate_per_paya = 999
  ) or not exists (
    select 1
    from public.transport_crew_memberships
    where id = current_setting('atlas_test.membership_a_id')::uuid
      and effective_to = date '2026-08-02'
  ) or not exists (
    select 1
    from public.transport_workers
    where id = current_setting('atlas_test.worker_a_id')::uuid
      and is_active = false
  ) or not exists (
    select 1
    from public.transport_crews
    where id = current_setting('atlas_test.crew_a_id')::uuid
      and is_active = false
  ) or exists (
    select 1
    from public.transport_daily_attendance
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: historical-independence source mutations were not applied';
  end if;

  raise notice 'PASS: snapshots survive rate/paya/attendance, active-status, and membership changes';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if (
    select count(*)
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) <> 2 or (
    select count(*)
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) <> 2 then
    raise exception 'FAIL: Factory A cannot read its own T5 rows';
  end if;

  if exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) or exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A can read Factory B T5 rows';
  end if;

  raise notice 'PASS: authenticated T5 reads are factory-scoped';
end;
$$;

select pg_temp.expect_error(
  'authenticated weekly earning insert denied', '42501',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L,%L,date ''2026-08-17'',1)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.worker_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated weekly earning update denied', '42501',
  format(
    'update public.transport_weekly_earnings set total_amount = 1 where id = %L',
    current_setting('atlas_test.earning_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated weekly earning delete denied', '42501',
  format(
    'delete from public.transport_weekly_earnings where id = %L',
    current_setting('atlas_test.earning_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated detail insert denied', '42501',
  format(
    'select pg_temp.insert_transport_detail(%L,%L,%L,date ''2026-08-03'',%L,%L,date ''2026-08-04'',%L,800.5,11,1,8805.5,8805.5)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.earning_a_id'),
    current_setting('atlas_test.worker_a_id'), current_setting('atlas_test.entry_a_tuesday_id'),
    current_setting('atlas_test.crew_a_id'), current_setting('atlas_test.rate_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated detail update denied', '42501',
  format(
    'update public.transport_weekly_earning_details set worker_daily_share_snapshot = 1 where id = %L',
    current_setting('atlas_test.detail_a_monday_id')
  )
);

select pg_temp.expect_error(
  'authenticated detail delete denied', '42501',
  format(
    'delete from public.transport_weekly_earning_details where id = %L',
    current_setting('atlas_test.detail_a_monday_id')
  )
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select pg_temp.expect_error(
  'anonymous weekly earning access denied',
  '42501',
  'select * from public.transport_weekly_earnings'
);

select pg_temp.expect_error(
  'anonymous detail access denied',
  '42501',
  'select * from public.transport_weekly_earning_details'
);

reset role;

rollback;
