-- Atlas Chamber Transport R1 assignment-model rework verifier.
-- Run after applying 20260818000007_replace_transport_memberships_with_assignments.sql.
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

do $$
declare
  assignment_rls boolean;
  save_definition text;
  calculator_definition text;
  balance_definition text;
  table_name text;
begin
  select relrowsecurity
    into assignment_rls
  from pg_catalog.pg_class
  where oid = 'public.transport_crew_assignments'::regclass;

  if not assignment_rls then
    raise exception 'FAIL: RLS is not enabled on transport_crew_assignments';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_assignments'::regclass
      and conname = 'transport_crew_assignments_worker_crew_key'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_assignments'::regclass
      and conname = 'transport_crew_assignments_worker_factory_fkey'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_assignments'::regclass
      and conname = 'transport_crew_assignments_crew_factory_fkey'
  ) then
    raise exception 'FAIL: assignment uniqueness or same-factory constraints are missing';
  end if;

  if not has_table_privilege(
    'authenticated', 'public.transport_crew_assignments', 'SELECT'
  ) or not has_table_privilege(
    'authenticated', 'public.transport_crew_assignments', 'INSERT'
  ) or not has_table_privilege(
    'authenticated', 'public.transport_crew_assignments', 'DELETE'
  ) or has_table_privilege(
    'authenticated', 'public.transport_crew_assignments', 'UPDATE'
  ) or has_table_privilege(
    'anon', 'public.transport_crew_assignments', 'SELECT, INSERT, UPDATE, DELETE'
  ) then
    raise exception 'FAIL: assignment grants are incorrect';
  end if;

  if not has_table_privilege(
    'authenticated', 'public.transport_crew_memberships', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.transport_crew_memberships', 'INSERT, UPDATE, DELETE'
  ) then
    raise exception 'FAIL: legacy membership history grants are incorrect';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.transport_daily_attendance'::regclass
      and tgname = 'transport_daily_attendance_validate_membership'
      and not tgisinternal
  ) or to_regprocedure(
    'public.validate_transport_daily_attendance_membership()'
  ) is not null then
    raise exception 'FAIL: legacy effective-date attendance validation still exists';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.transport_daily_attendance'::regclass
      and conname = 'transport_daily_attendance_worker_day_key'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.transport_daily_attendance'::regclass
      and conname = 'transport_daily_attendance_entry_worker_key'
  ) then
    raise exception 'FAIL: attendance uniqueness was not changed to entry + worker';
  end if;

  select lower(pg_get_functiondef(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure
  )) into save_definition;

  if save_definition not like '%transport_crew_assignments%'
    or save_definition not like '%transport_workers.is_active = true%'
    or save_definition not like '%saved_entry.id is not null%'
    or save_definition not like '%transport_daily_attendance.transport_daily_entry_id = saved_entry.id%'
    or save_definition like '%transport_crew_memberships%'
    or save_definition like '%already attend another crew%'
    or save_definition not like '%pg_advisory_xact_lock%'
    or not has_function_privilege(
      'authenticated',
      'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])',
      'EXECUTE'
    ) then
    raise exception 'FAIL: save RPC eligibility, history exception, locking, or grants are incorrect';
  end if;

  foreach table_name in array array[
    'transport_daily_entries',
    'transport_daily_attendance',
    'transport_weekly_earnings',
    'transport_weekly_earning_details'
  ] loop
    if has_table_privilege(
      'authenticated', format('public.%I', table_name), 'INSERT, UPDATE, DELETE'
    ) then
      raise exception 'FAIL: authenticated direct writes were enabled on public.%', table_name;
    end if;
  end loop;

  select lower(pg_get_functiondef(
    'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure
  )) into calculator_definition;
  select lower(pg_get_functiondef(
    'public.get_transport_worker_available_balance(uuid,uuid,date)'::regprocedure
  )) into balance_definition;

  if calculator_definition not like '%select distinct transport_daily_attendance.transport_worker_id%'
    or calculator_definition not like '%sum(%'
    or calculator_definition not like '%transport_weekly_earning_details%'
    or balance_definition not like '%transport_weekly_earnings%'
    or balance_definition like '%transport_crew_id%' then
    raise exception 'FAIL: worker-level weekly aggregation or balance source changed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earnings'::regclass
      and conname = 'transport_weekly_earnings_worker_week_key'
  ) then
    raise exception 'FAIL: one weekly earning per worker/week is not enforced';
  end if;

  raise notice 'PASS: R1 schema, grants, RPC definition, and financial foundations are correct';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  foreign_crew_id uuid := gen_random_uuid();
  worker_id uuid := gen_random_uuid();
  historical_worker_id uuid := gen_random_uuid();
  inactive_worker_id uuid := gen_random_uuid();
  unassigned_worker_id uuid := gen_random_uuid();
  current_legacy_worker_id uuid := gen_random_uuid();
  ended_legacy_worker_id uuid := gen_random_uuid();
  future_legacy_worker_id uuid := gen_random_uuid();
  foreign_worker_id uuid := gen_random_uuid();
  business_date date := (current_timestamp at time zone 'Asia/Kolkata')::date;
  rate_a_id uuid := gen_random_uuid();
  rate_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Transport R1 Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport R1 Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_crews (
    id, factory_id, name, work_direction
  ) values
    (crew_a_id, factory_a_id, 'R1 Crew A', 'FIELD_TO_KILN'),
    (crew_b_id, factory_a_id, 'R1 Crew B', 'KILN_TO_FIELD'),
    (foreign_crew_id, factory_b_id, 'R1 Foreign Crew', 'FIELD_TO_KILN');

  insert into public.transport_workers (
    id, factory_id, name, is_active
  ) values
    (worker_id, factory_a_id, 'R1 Multi-crew Worker', true),
    (historical_worker_id, factory_a_id, 'R1 Historical Worker', true),
    (inactive_worker_id, factory_a_id, 'R1 Inactive Worker', false),
    (unassigned_worker_id, factory_a_id, 'R1 Unassigned Worker', true),
    (current_legacy_worker_id, factory_a_id, 'R1 Current Legacy Worker', true),
    (ended_legacy_worker_id, factory_a_id, 'R1 Ended Legacy Worker', true),
    (future_legacy_worker_id, factory_a_id, 'R1 Future Legacy Worker', true),
    (foreign_worker_id, factory_b_id, 'R1 Foreign Worker', true);

  insert into public.transport_crew_memberships (
    factory_id, transport_worker_id, transport_crew_id,
    effective_from, effective_to
  ) values
    (factory_a_id, current_legacy_worker_id, crew_a_id,
      business_date - 10, null),
    (factory_a_id, ended_legacy_worker_id, crew_a_id,
      business_date - 10, business_date - 1),
    (factory_a_id, future_legacy_worker_id, crew_a_id,
      business_date + 1, null);

  -- Re-run the migration's conflict-safe transformation inside this rollback-only
  -- transaction so each business-date branch is verified with controlled fixtures.
  insert into public.transport_crew_assignments (
    factory_id, transport_worker_id, transport_crew_id
  )
  select distinct
    memberships.factory_id,
    memberships.transport_worker_id,
    memberships.transport_crew_id
  from public.transport_crew_memberships as memberships
  where memberships.effective_from <= business_date
    and (memberships.effective_to is null or memberships.effective_to >= business_date)
  on conflict (transport_worker_id, transport_crew_id) do nothing;

  if not exists (
    select 1 from public.transport_crew_assignments
    where transport_worker_id = current_legacy_worker_id
      and transport_crew_id = crew_a_id
  ) or exists (
    select 1 from public.transport_crew_assignments
    where transport_worker_id = ended_legacy_worker_id
  ) or exists (
    select 1 from public.transport_crew_assignments
    where transport_worker_id = future_legacy_worker_id
  ) then
    raise exception 'FAIL: current/ended/future legacy backfill behavior is incorrect';
  end if;

  insert into public.transport_crew_assignments (
    factory_id, transport_worker_id, transport_crew_id
  ) values
    (factory_a_id, worker_id, crew_a_id),
    (factory_a_id, worker_id, crew_b_id),
    (factory_a_id, historical_worker_id, crew_a_id),
    (factory_a_id, inactive_worker_id, crew_a_id),
    (factory_b_id, foreign_worker_id, foreign_crew_id);

  if (
    select count(*) from public.transport_crew_assignments
    where transport_worker_id = worker_id
  ) <> 2 then
    raise exception 'FAIL: one worker could not be assigned to two crews';
  end if;

  perform pg_temp.expect_error(
    'duplicate worker/crew assignment rejected',
    '23505',
    format(
      'insert into public.transport_crew_assignments (factory_id, transport_worker_id, transport_crew_id) values (%L,%L,%L)',
      factory_a_id, worker_id, crew_a_id
    )
  );

  perform pg_temp.expect_error(
    'cross-factory assignment rejected',
    '23503',
    format(
      'insert into public.transport_crew_assignments (factory_id, transport_worker_id, transport_crew_id) values (%L,%L,%L)',
      factory_a_id, foreign_worker_id, crew_a_id
    )
  );

  insert into public.transport_crew_wage_rates (
    id, factory_id, transport_crew_id, rate_per_paya, effective_from
  ) values
    (rate_a_id, factory_a_id, crew_a_id, 500, date '2026-07-01'),
    (rate_b_id, factory_a_id, crew_b_id, 300, date '2026-07-01');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.unmapped_user_id', gen_random_uuid()::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.worker_id', worker_id::text, true);
  perform set_config('atlas_test.historical_worker_id', historical_worker_id::text, true);
  perform set_config('atlas_test.inactive_worker_id', inactive_worker_id::text, true);
  perform set_config('atlas_test.unassigned_worker_id', unassigned_worker_id::text, true);

  raise notice 'PASS: backfill, multiple assignment, duplicate, and cross-factory fixtures verified';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  crew_a_entry_id uuid;
  crew_b_entry_id uuid;
  historical_entry_id uuid;
begin
  select daily_entry_id into crew_a_entry_id
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-08-04',
    1,
    array[current_setting('atlas_test.worker_id')::uuid]
  );

  select daily_entry_id into crew_b_entry_id
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    date '2026-08-04',
    1,
    array[current_setting('atlas_test.worker_id')::uuid]
  );

  if crew_a_entry_id is null or crew_b_entry_id is null
    or crew_a_entry_id = crew_b_entry_id then
    raise exception 'FAIL: same worker could not attend two crews on one date';
  end if;

  perform pg_temp.expect_error(
    'duplicate worker input within one daily entry rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid,%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-04',
      current_setting('atlas_test.worker_id'),
      current_setting('atlas_test.worker_id')
    )
  );

  perform pg_temp.expect_error(
    'unassigned worker cannot be newly added',
    '23514',
    format(
      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-06',
      current_setting('atlas_test.unassigned_worker_id')
    )
  );

  perform pg_temp.expect_error(
    'inactive assigned worker cannot be newly added',
    '23514',
    format(
      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-06',
      current_setting('atlas_test.inactive_worker_id')
    )
  );

  select daily_entry_id into historical_entry_id
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-08-05',
    1,
    array[current_setting('atlas_test.historical_worker_id')::uuid]
  );

  delete from public.transport_crew_assignments
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and transport_worker_id = current_setting('atlas_test.historical_worker_id')::uuid
    and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid;

  update public.transport_workers
  set is_active = false
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and id = current_setting('atlas_test.historical_worker_id')::uuid;

  perform public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-08-05',
    1.5,
    array[current_setting('atlas_test.historical_worker_id')::uuid]
  );

  if not exists (
    select 1 from public.transport_daily_attendance
    where transport_daily_entry_id = historical_entry_id
      and transport_worker_id = current_setting('atlas_test.historical_worker_id')::uuid
  ) then
    raise exception 'FAIL: historical saved attendance was lost after unassignment/deactivation';
  end if;

  perform pg_temp.expect_error(
    'historical exception cannot add worker to a different entry',
    '23514',
    format(
      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-08-06',
      current_setting('atlas_test.historical_worker_id')
    )
  );

  perform set_config('atlas_test.crew_a_entry_id', crew_a_entry_id::text, true);
  raise notice 'PASS: multi-crew attendance, current eligibility, and exact-entry historical preservation verified';
end;
$$;

do $$
begin
  if exists (
    select 1 from public.transport_crew_assignments
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A can read Factory B assignments';
  end if;

  perform pg_temp.expect_error(
    'authenticated direct daily-entry insert denied',
    '42501',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L,%L,date %L,1)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-07'
    )
  );

  raise notice 'PASS: factory isolation and operational direct-write restriction verified';
end;
$$;

do $$
declare
  summary record;
  balance record;
begin
  select * into summary
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    date '2026-08-03'
  );

  if (
    select count(*) from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid
      and week_start = date '2026-08-03'
  ) <> 1 or not exists (
    select 1 from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid
      and week_start = date '2026-08-03'
      and total_amount = 800
  ) or (
    select count(*) from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid
      and week_start = date '2026-08-03'
      and work_date = date '2026-08-04'
  ) <> 2 then
    raise exception 'FAIL: same-day crew shares did not aggregate to one worker earning with two details';
  end if;

  if not exists (
    select 1 from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
      and worker_daily_share_snapshot = 500
  ) or not exists (
    select 1 from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_b_id')::uuid
      and worker_daily_share_snapshot = 300
  ) then
    raise exception 'FAIL: independent crew/day financial details are incorrect';
  end if;

  select * into balance
  from public.get_transport_worker_available_balance(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.worker_id')::uuid,
    date '2026-08-10'
  );

  if balance.total_earned <> 800
    or balance.total_withdrawn <> 0
    or balance.available_balance <> 800 then
    raise exception 'FAIL: worker-level available balance did not retain the combined earning';
  end if;

  perform public.create_transport_worker_withdrawal(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.worker_id')::uuid,
    date '2026-08-10',
    100
  );

  select * into balance
  from public.get_transport_worker_available_balance(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.worker_id')::uuid,
    date '2026-08-10'
  );

  if balance.total_earned <> 800
    or balance.total_withdrawn <> 100
    or balance.available_balance <> 700 then
    raise exception 'FAIL: withdrawal did not remain worker-level';
  end if;

  raise notice 'PASS: weekly total 800, two details, one earning, and worker-level balance/withdrawal verified';
end;
$$;

reset role;

select pg_temp.expect_error(
  'same worker twice in the same persisted entry rejected',
  '23505',
  format(
    'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L,%L,%L,%L,date %L)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_entry_id'),
    current_setting('atlas_test.crew_a_id'),
    current_setting('atlas_test.worker_id'),
    '2026-08-04'
  )
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select pg_temp.expect_error(
  'anonymous assignment read rejected',
  '42501',
  'select * from public.transport_crew_assignments'
);

select pg_temp.expect_error(
  'anonymous daily save RPC rejected',
  '42501',
  format(
    'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id'),
    '2026-08-08',
    current_setting('atlas_test.worker_id')
  )
);

reset role;
rollback;
