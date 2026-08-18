-- Atlas Chamber Transport T2A daily work and attendance verifier.
-- Run after applying 20260818000001_create_transport_daily_foundation.sql.
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
  table_name text;
  required_constraint text;
begin
  foreach table_name in array array[
    'transport_daily_entries',
    'transport_daily_attendance'
  ] loop
    if not (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = format('public.%I', table_name)::regclass
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
    ) then
      raise exception 'FAIL: authenticated privileges are incorrect on public.%', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'FAIL: anon has privileges on public.%', table_name;
    end if;

    if (select count(*)
        from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = table_name) <> 1 then
      raise exception 'FAIL: public.% does not have exactly one SELECT policy', table_name;
    end if;
  end loop;

  foreach required_constraint in array array[
    'transport_daily_entries_id_parent_key',
    'transport_daily_entries_factory_crew_date_key',
    'transport_daily_entries_paya_quantity_check',
    'transport_daily_entries_crew_factory_fkey',
    'transport_daily_attendance_id_factory_key',
    'transport_daily_attendance_worker_day_key',
    'transport_daily_attendance_parent_fkey',
    'transport_daily_attendance_worker_factory_fkey'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = required_constraint
        and connamespace = 'public'::regnamespace
    ) then
      raise exception 'FAIL: required T2A constraint % is missing', required_constraint;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.transport_daily_attendance'::regclass
      and tgname = 'transport_daily_attendance_validate_membership'
      and tgisinternal = false
      and tgconstraint <> 0
      and tgdeferrable = false
  ) then
    raise exception 'FAIL: immediate attendance membership constraint trigger is missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.validate_transport_daily_attendance_membership()'::regprocedure,
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.validate_transport_daily_attendance_membership()'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'FAIL: attendance trigger function is directly executable by application roles';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.transport_daily_entries'::regclass
      and attname = 'paya_quantity'
      and atttypid = 'numeric'::regtype
      and attnum > 0
      and not attisdropped
  ) then
    raise exception 'FAIL: paya_quantity is not stored as numeric';
  end if;

  raise notice 'PASS: T2A schema, constraints, trigger, RLS, and read-only grants are present';
end;
$$;

do $$
declare
  production_calculator_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_memberships'::regclass
      and conname = 'transport_crew_memberships_no_overlapping_dates'
  ) then
    raise exception 'FAIL: T1A membership overlap constraint was changed or removed';
  end if;

  if to_regclass('public.production_wage_rates') is null
    or to_regclass('public.production_weekly_earning_details') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.weekly_earnings') is null
    or to_regprocedure('public.resolve_production_wage_rate(uuid,uuid,date)') is null
    or to_regprocedure('public.calculate_production_wages(uuid,date)') is null then
    raise exception 'FAIL: existing production wage tables or functions are missing';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid,date)'::regprocedure
  ) into production_calculator_definition;

  if production_calculator_definition not ilike '%resolve_production_wage_rate%'
    or production_calculator_definition ilike '%transport_daily_%' then
    raise exception 'FAIL: production wage calculation logic was changed by T2A';
  end if;

  raise notice 'PASS: T1A membership and existing production wage foundations remain intact';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_a_other_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  worker_start_id uuid := gen_random_uuid();
  worker_end_id uuid := gen_random_uuid();
  worker_open_id uuid := gen_random_uuid();
  worker_before_id uuid := gen_random_uuid();
  worker_after_id uuid := gen_random_uuid();
  worker_other_crew_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
  worker_b_other_id uuid := gen_random_uuid();
  entry_integer_id uuid := gen_random_uuid();
  entry_decimal_id uuid := gen_random_uuid();
  entry_other_crew_id uuid := gen_random_uuid();
  entry_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Transport T2A Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T2A Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_crews (
    id, factory_id, name, work_direction
  ) values
    (crew_a_id, factory_a_id, 'T2A Factory A field crew', 'FIELD_TO_KILN'),
    (crew_a_other_id, factory_a_id, 'T2A Factory A kiln crew', 'KILN_TO_FIELD'),
    (crew_b_id, factory_b_id, 'T2A Factory B field crew', 'FIELD_TO_KILN');

  insert into public.transport_workers (id, factory_id, name, is_active)
  values
    (worker_start_id, factory_a_id, 'T2A starts on work date', true),
    (worker_end_id, factory_a_id, 'T2A ends on work date', true),
    (worker_open_id, factory_a_id, 'T2A inactive historical worker', false),
    (worker_before_id, factory_a_id, 'T2A future member', true),
    (worker_after_id, factory_a_id, 'T2A former member', true),
    (worker_other_crew_id, factory_a_id, 'T2A other crew member', true),
    (worker_b_id, factory_b_id, 'T2A Factory B worker', true),
    (worker_b_other_id, factory_b_id, 'T2A Factory B other worker', true);

  insert into public.transport_crew_memberships (
    factory_id, transport_worker_id, transport_crew_id,
    effective_from, effective_to
  ) values
    (factory_a_id, worker_start_id, crew_a_id, date '2026-01-10', null),
    (factory_a_id, worker_end_id, crew_a_id, date '2026-01-01', date '2026-01-10'),
    (factory_a_id, worker_open_id, crew_a_id, date '2026-01-01', null),
    (factory_a_id, worker_before_id, crew_a_id, date '2026-01-11', null),
    (factory_a_id, worker_after_id, crew_a_id, date '2026-01-01', date '2026-01-09'),
    (factory_a_id, worker_other_crew_id, crew_a_other_id, date '2026-01-01', null),
    (factory_b_id, worker_b_id, crew_b_id, date '2026-01-01', null),
    (factory_b_id, worker_b_other_id, crew_b_id, date '2026-01-01', null);

  insert into public.transport_daily_entries (
    id, factory_id, transport_crew_id, work_date, paya_quantity
  ) values
    (entry_integer_id, factory_a_id, crew_a_id, date '2026-01-10', 10),
    (entry_decimal_id, factory_a_id, crew_a_id, date '2026-01-11', 10.5),
    (entry_other_crew_id, factory_a_id, crew_a_other_id, date '2026-01-10', 5),
    (entry_b_id, factory_b_id, crew_b_id, date '2026-01-10', 7);

  insert into public.transport_daily_attendance (
    factory_id, transport_daily_entry_id, transport_crew_id,
    transport_worker_id, work_date
  ) values (
    factory_b_id, entry_b_id, crew_b_id, worker_b_id, date '2026-01-10'
  );

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_a_other_id', crew_a_other_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.worker_start_id', worker_start_id::text, true);
  perform set_config('atlas_test.worker_end_id', worker_end_id::text, true);
  perform set_config('atlas_test.worker_open_id', worker_open_id::text, true);
  perform set_config('atlas_test.worker_before_id', worker_before_id::text, true);
  perform set_config('atlas_test.worker_after_id', worker_after_id::text, true);
  perform set_config('atlas_test.worker_other_crew_id', worker_other_crew_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
  perform set_config('atlas_test.worker_b_other_id', worker_b_other_id::text, true);
  perform set_config('atlas_test.entry_integer_id', entry_integer_id::text, true);
  perform set_config('atlas_test.entry_decimal_id', entry_decimal_id::text, true);
  perform set_config('atlas_test.entry_other_crew_id', entry_other_crew_id::text, true);
  perform set_config('atlas_test.entry_b_id', entry_b_id::text, true);

  raise notice 'PASS: rollback-only T2A factory, membership, entry, and security fixtures created';
end;
$$;

do $$
declare
  integer_quantity numeric;
  decimal_quantity numeric;
begin
  select paya_quantity into integer_quantity
  from public.transport_daily_entries
  where id = current_setting('atlas_test.entry_integer_id')::uuid;

  select paya_quantity into decimal_quantity
  from public.transport_daily_entries
  where id = current_setting('atlas_test.entry_decimal_id')::uuid;

  if integer_quantity <> 10 or decimal_quantity <> 10.5 then
    raise exception 'FAIL: positive integer or decimal paya was not stored exactly';
  end if;

  perform pg_temp.expect_error(
    'zero paya is rejected',
    '23514',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, 0)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-12'
    )
  );

  perform pg_temp.expect_error(
    'negative paya is rejected',
    '23514',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, -0.5)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-13'
    )
  );

  perform pg_temp.expect_error(
    'duplicate factory crew and work date entry is rejected',
    '23505',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, 20)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'cross-factory crew daily entry is rejected',
    '23503',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, 20)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-01-14'
    )
  );

  raise notice 'PASS: positive integer and decimal paya are accepted; invalid and duplicate entries are rejected';
end;
$$;

insert into public.transport_daily_attendance (
  factory_id, transport_daily_entry_id, transport_crew_id,
  transport_worker_id, work_date
)
values
  (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.entry_integer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.worker_start_id')::uuid,
    date '2026-01-10'
  ),
  (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.entry_integer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.worker_end_id')::uuid,
    date '2026-01-10'
  ),
  (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.entry_integer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.worker_open_id')::uuid,
    date '2026-01-10'
  );

do $$
declare
  valid_attendance_count bigint;
begin
  select count(*) into valid_attendance_count
  from public.transport_daily_attendance
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and transport_daily_entry_id = current_setting('atlas_test.entry_integer_id')::uuid;

  if valid_attendance_count <> 3 then
    raise exception 'FAIL: inclusive boundary or open-ended attendance was rejected';
  end if;

  if not exists (
    select 1
    from public.transport_daily_attendance
    join public.transport_workers
      on transport_workers.id = transport_daily_attendance.transport_worker_id
      and transport_workers.factory_id = transport_daily_attendance.factory_id
    where transport_daily_attendance.transport_worker_id =
      current_setting('atlas_test.worker_open_id')::uuid
      and transport_workers.is_active = false
  ) then
    raise exception 'FAIL: inactive worker with valid historical membership was rejected';
  end if;

  perform pg_temp.expect_error(
    'worker before membership start is rejected',
    '23514',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_before_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'worker after membership end is rejected',
    '23514',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_after_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'worker belonging to another crew on work date is rejected',
    '23514',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_other_crew_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'duplicate worker attendance in the same daily entry is rejected',
    '23505',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_start_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'same worker attendance in two different crews on one day is rejected',
    '23505',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_other_crew_id'),
      current_setting('atlas_test.crew_a_other_id'),
      current_setting('atlas_test.worker_start_id'),
      '2026-01-10'
    )
  );

  raise notice 'PASS: inclusive historical membership and one-worker-one-crew-per-day invariants hold';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'cross-factory worker attendance is rejected',
    '23503',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_b_other_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'attendance cannot mismatch parent factory',
    '23503',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_b_id'),
      current_setting('atlas_test.worker_b_other_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'attendance cannot mismatch parent crew',
    '23503',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_other_id'),
      current_setting('atlas_test.worker_other_crew_id'),
      '2026-01-10'
    )
  );

  perform pg_temp.expect_error(
    'attendance cannot mismatch parent work date',
    '23503',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_before_id'),
      '2026-01-11'
    )
  );

  raise notice 'PASS: attendance parent and worker cross-factory relationships are impossible';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'T1A overlapping membership remains rejected',
    '23P01',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_end_id'),
      current_setting('atlas_test.crew_a_other_id'),
      '2026-01-10',
      '2026-01-12'
    )
  );

  raise notice 'PASS: T1A membership overlap behavior remains intact';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  visible_rows bigint;
begin
  select count(*) into visible_rows
  from public.transport_daily_entries
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;
  if visible_rows <> 3 then
    raise exception 'FAIL: Factory A cannot read its own daily entries';
  end if;

  select count(*) into visible_rows
  from public.transport_daily_attendance
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;
  if visible_rows <> 3 then
    raise exception 'FAIL: Factory A cannot read its own daily attendance';
  end if;

  select count(*) into visible_rows
  from public.transport_daily_entries
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;
  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B daily entries';
  end if;

  select count(*) into visible_rows
  from public.transport_daily_attendance
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;
  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B daily attendance';
  end if;

  raise notice 'PASS: authenticated reads are restricted to the active mapped factory';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'authenticated direct daily-entry insert is denied',
    '42501',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, 10)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-20'
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct daily-entry update is denied',
    '42501',
    format(
      'update public.transport_daily_entries set paya_quantity = 11 where id = %L::uuid',
      current_setting('atlas_test.entry_integer_id')
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct daily-entry delete is denied',
    '42501',
    format(
      'delete from public.transport_daily_entries where id = %L::uuid',
      current_setting('atlas_test.entry_integer_id')
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct attendance insert is denied',
    '42501',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_before_id'),
      '2026-01-10'
    )
  );

  raise notice 'PASS: authenticated users have no direct operational write path';
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous daily-entry read is denied',
    '42501',
    'select 1 from public.transport_daily_entries limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous attendance read is denied',
    '42501',
    'select 1 from public.transport_daily_attendance limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous daily-entry insert is denied',
    '42501',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, 10)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-20'
    )
  );

  perform pg_temp.expect_error(
    'anonymous attendance insert is denied',
    '42501',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.entry_integer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_before_id'),
      '2026-01-10'
    )
  );

  raise notice 'PASS: anonymous transport daily work and attendance access is denied';
end;
$$;

reset role;

rollback;
