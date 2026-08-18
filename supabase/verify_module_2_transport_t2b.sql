-- Atlas Chamber Transport T2B controlled daily-save RPC verifier.
-- Run after applying 20260818000002_create_transport_daily_save_rpc.sql.
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
  routine record;
  routine_definition text;
  public_can_execute boolean;
  table_name text;
begin
  select procedure.prosecdef, procedure.proconfig, procedure.proacl, procedure.proowner
    into routine
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure;

  select exists (
    select 1
    from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) into public_can_execute;

  if not routine.prosecdef
    or not coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=pg_catalog, public']
    or not has_function_privilege(
      'authenticated',
      'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure,
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure,
      'EXECUTE'
    )
    or public_can_execute then
    raise exception 'FAIL: save_transport_daily_entry security or grants are incorrect';
  end if;

  select pg_get_functiondef(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure
  ) into routine_definition;

  if routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition not ilike '%transport_crew_memberships%'
    or routine_definition not ilike '%delete from public.transport_daily_attendance%'
    or routine_definition not ilike '%unnest(p_transport_worker_ids)%' then
    raise exception 'FAIL: save RPC is missing locking, membership, or replacement behavior';
  end if;

  foreach table_name in array array[
    'transport_daily_entries',
    'transport_daily_attendance'
  ] loop
    if not has_table_privilege(
      'authenticated', format('public.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'UPDATE'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'DELETE'
    ) then
      raise exception 'FAIL: T2A direct-write privileges changed on public.%', table_name;
    end if;
  end loop;

  raise notice 'PASS: authoritative RPC security, lock, validation, and table grants are correct';
end;
$$;

do $$
declare
  production_calculator_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_daily_entries'::regclass
      and conname = 'transport_daily_entries_factory_crew_date_key'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_daily_attendance'::regclass
      and conname = 'transport_daily_attendance_worker_day_key'
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.transport_daily_attendance'::regclass
      and tgname = 'transport_daily_attendance_validate_membership'
      and tgisinternal = false
  ) then
    raise exception 'FAIL: T2A constraints or membership trigger are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_memberships'::regclass
      and conname = 'transport_crew_memberships_no_overlapping_dates'
  ) then
    raise exception 'FAIL: T1A membership overlap constraint is missing';
  end if;

  if to_regclass('public.production_wage_rates') is null
    or to_regclass('public.production_weekly_earning_details') is null
    or to_regprocedure('public.resolve_production_wage_rate(uuid,uuid,date)') is null
    or to_regprocedure('public.calculate_production_wages(uuid,date)') is null then
    raise exception 'FAIL: production wage schema or logic is missing';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid,date)'::regprocedure
  ) into production_calculator_definition;

  if production_calculator_definition not ilike '%resolve_production_wage_rate%'
    or production_calculator_definition ilike '%transport_daily_%' then
    raise exception 'FAIL: production wage calculation logic was modified';
  end if;

  raise notice 'PASS: T2A, T1A, and production wage foundations remain intact';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  unmapped_user_id uuid := gen_random_uuid();
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_a_other_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  worker_a_id uuid := gen_random_uuid();
  worker_a_inactive_id uuid := gen_random_uuid();
  worker_a_new_id uuid := gen_random_uuid();
  worker_a_no_membership_id uuid := gen_random_uuid();
  worker_a_other_crew_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Transport T2B Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T2B Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_crews (
    id, factory_id, name, work_direction
  ) values
    (crew_a_id, factory_a_id, 'T2B Factory A field crew', 'FIELD_TO_KILN'),
    (crew_a_other_id, factory_a_id, 'T2B Factory A kiln crew', 'KILN_TO_FIELD'),
    (crew_b_id, factory_b_id, 'T2B Factory B field crew', 'FIELD_TO_KILN');

  insert into public.transport_workers (id, factory_id, name, is_active)
  values
    (worker_a_id, factory_a_id, 'T2B active worker', true),
    (worker_a_inactive_id, factory_a_id, 'T2B inactive historical worker', false),
    (worker_a_new_id, factory_a_id, 'T2B replacement worker', true),
    (worker_a_no_membership_id, factory_a_id, 'T2B worker without membership', true),
    (worker_a_other_crew_id, factory_a_id, 'T2B other crew worker', true),
    (worker_b_id, factory_b_id, 'T2B Factory B worker', true);

  insert into public.transport_crew_memberships (
    factory_id, transport_worker_id, transport_crew_id,
    effective_from, effective_to
  ) values
    (factory_a_id, worker_a_id, crew_a_id, date '2026-01-01', null),
    (factory_a_id, worker_a_inactive_id, crew_a_id,
      date '2026-01-01', date '2026-01-10'),
    (factory_a_id, worker_a_new_id, crew_a_id, date '2026-01-10', null),
    (factory_a_id, worker_a_other_crew_id, crew_a_other_id, date '2026-01-01', null),
    (factory_b_id, worker_b_id, crew_b_id, date '2026-01-01', null);

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.unmapped_user_id', unmapped_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_a_other_id', crew_a_other_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.worker_a_id', worker_a_id::text, true);
  perform set_config('atlas_test.worker_a_inactive_id', worker_a_inactive_id::text, true);
  perform set_config('atlas_test.worker_a_new_id', worker_a_new_id::text, true);
  perform set_config('atlas_test.worker_a_no_membership_id', worker_a_no_membership_id::text, true);
  perform set_config('atlas_test.worker_a_other_crew_id', worker_a_other_crew_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);

  raise notice 'PASS: rollback-only T2B factory, worker, crew, and membership fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  save_result record;
  stored_entry_count bigint;
  stored_attendance_count bigint;
begin
  select * into save_result
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-01-10',
    10,
    array[
      current_setting('atlas_test.worker_a_id')::uuid,
      current_setting('atlas_test.worker_a_inactive_id')::uuid
    ]
  );

  if save_result.daily_entry_id is null
    or save_result.attendance_count <> 2
    or save_result.saved_paya_quantity <> 10 then
    raise exception 'FAIL: valid integer save returned an incorrect result';
  end if;

  select count(*) into stored_entry_count
  from public.transport_daily_entries
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
    and work_date = date '2026-01-10';

  select count(*) into stored_attendance_count
  from public.transport_daily_attendance
  where transport_daily_entry_id = save_result.daily_entry_id;

  if stored_entry_count <> 1 or stored_attendance_count <> 2 then
    raise exception 'FAIL: valid daily entry and attendance did not persist exactly';
  end if;

  if not exists (
    select 1
    from public.transport_daily_attendance
    where transport_daily_entry_id = save_result.daily_entry_id
      and transport_worker_id = current_setting('atlas_test.worker_a_inactive_id')::uuid
  ) then
    raise exception 'FAIL: inactive worker with valid historical membership was excluded';
  end if;

  perform set_config('atlas_test.primary_entry_id', save_result.daily_entry_id::text, true);
  raise notice 'PASS: mapped factory saves integer paya and exact active/inactive attendance';
end;
$$;

do $$
declare
  save_result record;
begin
  select * into save_result
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-01-11',
    10.5,
    array[
      current_setting('atlas_test.worker_a_id')::uuid,
      current_setting('atlas_test.worker_a_new_id')::uuid
    ]
  );

  if save_result.attendance_count <> 2
    or save_result.saved_paya_quantity <> 10.5 then
    raise exception 'FAIL: valid decimal paya was not saved exactly';
  end if;

  raise notice 'PASS: decimal paya saves without integer coercion';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'mapped user cannot save another factory',
    '42501',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-01-10',
      current_setting('atlas_test.worker_b_id')
    )
  );

  perform pg_temp.expect_error(
    'crew from another factory is rejected',
    '42501',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-01-12',
      current_setting('atlas_test.worker_a_id')
    )
  );
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  current_setting('atlas_test.unmapped_user_id'),
  true
);

do $$
begin
  perform pg_temp.expect_error(
    'unmapped authenticated user cannot save',
    '42501',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-12',
      current_setting('atlas_test.worker_a_id')
    )
  );
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'zero paya is rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 0, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-20',
      current_setting('atlas_test.worker_a_id')
    )
  );

  perform pg_temp.expect_error(
    'negative paya is rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, -0.5, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-21',
      current_setting('atlas_test.worker_a_id')
    )
  );

  perform pg_temp.expect_error(
    'numeric NaN paya is rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, %L::numeric, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-22',
      'NaN',
      current_setting('atlas_test.worker_a_id')
    )
  );

  perform pg_temp.expect_error(
    'NULL attendance array is rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, null::uuid[])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-23'
    )
  );

  perform pg_temp.expect_error(
    'empty attendance is rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[]::uuid[])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-24'
    )
  );

  perform pg_temp.expect_error(
    'NULL worker ID is rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[null]::uuid[])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-25'
    )
  );

  perform pg_temp.expect_error(
    'duplicate worker IDs are rejected',
    '22023',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid, %L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-26',
      current_setting('atlas_test.worker_a_id'),
      current_setting('atlas_test.worker_a_id')
    )
  );

  perform pg_temp.expect_error(
    'cross-factory worker is rejected',
    '42501',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-27',
      current_setting('atlas_test.worker_b_id')
    )
  );

  perform pg_temp.expect_error(
    'worker without valid membership is rejected',
    '23514',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-28',
      current_setting('atlas_test.worker_a_no_membership_id')
    )
  );

  perform pg_temp.expect_error(
    'worker from another crew is rejected',
    '23514',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-29',
      current_setting('atlas_test.worker_a_other_crew_id')
    )
  );

  if exists (
    select 1
    from public.transport_daily_entries
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and work_date between date '2026-01-20' and date '2026-01-29'
  ) or exists (
    select 1
    from public.transport_daily_attendance
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and work_date between date '2026-01-20' and date '2026-01-29'
  ) then
    raise exception 'FAIL: rejected validations left partial daily rows';
  end if;

  raise notice 'PASS: all input validations reject cleanly without partial rows';
end;
$$;

do $$
declare
  save_result record;
  entry_count bigint;
  saved_worker_ids uuid[];
begin
  select * into save_result
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-01-10',
    12.5,
    array[
      current_setting('atlas_test.worker_a_inactive_id')::uuid,
      current_setting('atlas_test.worker_a_new_id')::uuid
    ]
  );

  if save_result.daily_entry_id <>
      current_setting('atlas_test.primary_entry_id')::uuid
    or save_result.attendance_count <> 2
    or save_result.saved_paya_quantity <> 12.5 then
    raise exception 'FAIL: replacement returned an incorrect result or new entry ID';
  end if;

  select count(*) into entry_count
  from public.transport_daily_entries
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
    and work_date = date '2026-01-10';

  select array_agg(transport_worker_id order by transport_worker_id)
    into saved_worker_ids
  from public.transport_daily_attendance
  where transport_daily_entry_id = save_result.daily_entry_id;

  if entry_count <> 1
    or saved_worker_ids is null
    or (
      saved_worker_ids <> array[
        current_setting('atlas_test.worker_a_inactive_id')::uuid,
        current_setting('atlas_test.worker_a_new_id')::uuid
      ]::uuid[]
      and saved_worker_ids <> array[
        current_setting('atlas_test.worker_a_new_id')::uuid,
        current_setting('atlas_test.worker_a_inactive_id')::uuid
      ]::uuid[]
    ) then
    raise exception 'FAIL: attendance replacement did not exactly remove/add supplied workers';
  end if;

  if exists (
    select 1
    from public.transport_daily_attendance
    where transport_daily_entry_id = save_result.daily_entry_id
      and transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid
  ) then
    raise exception 'FAIL: removed worker remained after attendance replacement';
  end if;

  raise notice 'PASS: same crew/date updates quantity and exactly replaces attendance without a second entry';
end;
$$;

do $$
declare
  paya_before numeric;
  worker_ids_before uuid[];
  paya_after numeric;
  worker_ids_after uuid[];
begin
  select paya_quantity into paya_before
  from public.transport_daily_entries
  where id = current_setting('atlas_test.primary_entry_id')::uuid;

  select array_agg(transport_worker_id order by transport_worker_id)
    into worker_ids_before
  from public.transport_daily_attendance
  where transport_daily_entry_id = current_setting('atlas_test.primary_entry_id')::uuid;

  perform pg_temp.expect_error(
    'failed replacement with invalid membership is atomic',
    '23514',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 99, array[%L::uuid, %L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-10',
      current_setting('atlas_test.worker_a_inactive_id'),
      current_setting('atlas_test.worker_a_no_membership_id')
    )
  );

  select paya_quantity into paya_after
  from public.transport_daily_entries
  where id = current_setting('atlas_test.primary_entry_id')::uuid;

  select array_agg(transport_worker_id order by transport_worker_id)
    into worker_ids_after
  from public.transport_daily_attendance
  where transport_daily_entry_id = current_setting('atlas_test.primary_entry_id')::uuid;

  if paya_after is distinct from paya_before
    or worker_ids_after is distinct from worker_ids_before then
    raise exception 'FAIL: failed replacement changed quantity or attendance';
  end if;

  raise notice 'PASS: failed replacement leaves prior quantity and attendance unchanged';
end;
$$;

do $$
declare
  other_crew_result record;
  paya_before numeric;
  worker_ids_before uuid[];
  paya_after numeric;
  worker_ids_after uuid[];
begin
  select * into other_crew_result
  from public.save_transport_daily_entry(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_other_id')::uuid,
    date '2026-01-10',
    5,
    array[current_setting('atlas_test.worker_a_other_crew_id')::uuid]
  );

  select paya_quantity into paya_before
  from public.transport_daily_entries
  where id = current_setting('atlas_test.primary_entry_id')::uuid;

  select array_agg(transport_worker_id order by transport_worker_id)
    into worker_ids_before
  from public.transport_daily_attendance
  where transport_daily_entry_id = current_setting('atlas_test.primary_entry_id')::uuid;

  perform pg_temp.expect_error(
    'worker already attending another crew causes complete failure',
    '23505',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 88, array[%L::uuid, %L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-10',
      current_setting('atlas_test.worker_a_inactive_id'),
      current_setting('atlas_test.worker_a_other_crew_id')
    )
  );

  select paya_quantity into paya_after
  from public.transport_daily_entries
  where id = current_setting('atlas_test.primary_entry_id')::uuid;

  select array_agg(transport_worker_id order by transport_worker_id)
    into worker_ids_after
  from public.transport_daily_attendance
  where transport_daily_entry_id = current_setting('atlas_test.primary_entry_id')::uuid;

  if paya_after is distinct from paya_before
    or worker_ids_after is distinct from worker_ids_before
    or not exists (
      select 1
      from public.transport_daily_attendance
      where transport_daily_entry_id = other_crew_result.daily_entry_id
        and transport_worker_id = current_setting('atlas_test.worker_a_other_crew_id')::uuid
    ) then
    raise exception 'FAIL: cross-crew failure changed existing daily state';
  end if;

  raise notice 'PASS: cross-crew worker conflict fails atomically with a clear unique error';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'authenticated direct daily-entry insert remains denied',
    '42501',
    format(
      'insert into public.transport_daily_entries (factory_id, transport_crew_id, work_date, paya_quantity) values (%L::uuid, %L::uuid, date %L, 10)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-02-01'
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct attendance insert remains denied',
    '42501',
    format(
      'insert into public.transport_daily_attendance (factory_id, transport_daily_entry_id, transport_crew_id, transport_worker_id, work_date) values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.primary_entry_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.worker_a_id'),
      '2026-01-10'
    )
  );

  raise notice 'PASS: direct authenticated table writes remain denied';
end;
$$;

reset role;

do $$
begin
  perform pg_temp.expect_error(
    'T1A overlapping membership remains rejected',
    '23P01',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_a_inactive_id'),
      current_setting('atlas_test.crew_a_other_id'),
      '2026-01-10',
      '2026-01-12'
    )
  );

  raise notice 'PASS: T1A overlap behavior remains active after T2B';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous RPC execution is denied',
    '42501',
    format(
      'select * from public.save_transport_daily_entry(%L::uuid, %L::uuid, date %L, 10, array[%L::uuid])',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-02-01',
      current_setting('atlas_test.worker_a_id')
    )
  );
end;
$$;

reset role;

rollback;
