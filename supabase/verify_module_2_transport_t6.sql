-- Atlas Chamber Transport T6 authoritative weekly calculator verifier.
-- Run after applying 20260818000005_calculate_transport_weekly_wages.sql.
-- Requires one existing public.factory_users row. Fixtures and mapping changes
-- are transactional and discarded by the final rollback.

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
  production_definition text;
  mud_definition text;
  daily_save_definition text;
begin
  select procedure.prosecdef, procedure.proconfig, procedure.proacl,
      procedure.proowner
    into routine
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure;

  select exists (
    select 1
    from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner)))
      as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) into public_can_execute;

  if not routine.prosecdef
    or not coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=pg_catalog, public']
    or not has_function_privilege(
      'authenticated',
      'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure,
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure,
      'EXECUTE'
    ) or public_can_execute then
    raise exception 'FAIL: transport calculator security or grants are incorrect';
  end if;

  select pg_get_functiondef(
    'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure
  ) into routine_definition;

  if routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition not ilike '%calculate_transport_weekly_wages:%'
    or routine_definition not ilike '%matching_rate_count = 0%'
    or routine_definition not ilike '%matching_rate_count > 1%'
    or routine_definition not ilike '%effective_from <= daily_entry.work_date%'
    or routine_definition not ilike '%effective_to >= daily_entry.work_date%'
    or routine_definition not ilike '%daily_attendance_count = 0%'
    or routine_definition not ilike '%transport_weekly_earning_details%'
    or routine_definition ilike '%round(%' then
    raise exception 'FAIL: calculator lock, validation, snapshot, or no-rounding behavior is missing';
  end if;

  foreach table_name in array array[
    'transport_weekly_earnings',
    'transport_weekly_earning_details'
  ] loop
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
      raise exception 'FAIL: T5 immutable grants changed on public.%', table_name;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earnings'::regclass
      and conname = 'transport_weekly_earnings_worker_week_key'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_weekly_earning_details'::regclass
      and conname = 'transport_weekly_earning_details_parent_entry_key'
  ) then
    raise exception 'FAIL: T5 idempotency/detail uniqueness constraints are missing';
  end if;

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
    raise exception 'FAIL: T1-T3 transport foundations changed';
  end if;

  select pg_get_functiondef(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure
  ) into daily_save_definition;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid,date)'::regprocedure
  ) into production_definition;

  select pg_get_functiondef(
    'public.calculate_mud_supply_wages(uuid,uuid,date)'::regprocedure
  ) into mud_definition;

  if daily_save_definition ilike '%transport_weekly_%'
    or production_definition ilike '%transport_weekly_%'
    or mud_definition ilike '%transport_weekly_%'
    or production_definition not ilike '%resolve_production_wage_rate%'
    or mud_definition not ilike '%mud_supply%' then
    raise exception 'FAIL: T2B, production, or mud wage behavior was modified';
  end if;

  raise notice 'PASS: calculator security, exact-one checks, lock, constraints, and regressions are intact';
  raise notice 'INFO: overlapping-rate runtime fixture omitted because the authoritative T3 exclusion constraint safely prevents creating one';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  field_crew_id uuid := gen_random_uuid();
  kiln_crew_id uuid := gen_random_uuid();
  missing_crew_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  field_workers uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid()
  ];
  kiln_worker_d_id uuid := gen_random_uuid();
  kiln_worker_e_id uuid := gen_random_uuid();
  kiln_worker_f_id uuid := gen_random_uuid();
  missing_worker_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
  field_rate_old_id uuid := gen_random_uuid();
  field_rate_new_id uuid := gen_random_uuid();
  kiln_rate_id uuid := gen_random_uuid();
  rate_b_id uuid := gen_random_uuid();
  basic_entry_id uuid := gen_random_uuid();
  multi_day_1_id uuid := gen_random_uuid();
  multi_day_2_id uuid := gen_random_uuid();
  change_old_id uuid := gen_random_uuid();
  change_new_id uuid := gen_random_uuid();
  change_kiln_id uuid := gen_random_uuid();
  missing_entry_id uuid := gen_random_uuid();
  zero_entry_id uuid := gen_random_uuid();
  atomic_valid_entry_id uuid := gen_random_uuid();
  atomic_invalid_entry_id uuid := gen_random_uuid();
  entry_b_id uuid := gen_random_uuid();
  earning_b_id uuid := gen_random_uuid();
  worker_id uuid;
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
    (factory_a_id, format('Transport T6 Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T6 Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_crews (id, factory_id, name, work_direction)
  values
    (field_crew_id, factory_a_id, 'T6 field crew', 'FIELD_TO_KILN'),
    (kiln_crew_id, factory_a_id, 'T6 kiln crew', 'KILN_TO_FIELD'),
    (missing_crew_id, factory_a_id, 'T6 missing-rate crew', 'FIELD_TO_KILN'),
    (crew_b_id, factory_b_id, 'T6 Factory B crew', 'FIELD_TO_KILN');

  insert into public.transport_workers (id, factory_id, name)
  select supplied.worker_id, factory_a_id,
    format('T6 field worker %s', supplied.ordinality)
  from unnest(field_workers) with ordinality as supplied(worker_id, ordinality);

  insert into public.transport_workers (id, factory_id, name)
  values
    (kiln_worker_d_id, factory_a_id, 'T6 kiln worker D'),
    (kiln_worker_e_id, factory_a_id, 'T6 kiln worker E'),
    (kiln_worker_f_id, factory_a_id, 'T6 kiln worker F'),
    (missing_worker_id, factory_a_id, 'T6 missing-rate worker'),
    (worker_b_id, factory_b_id, 'T6 Factory B worker');

  insert into public.transport_crew_memberships (
    factory_id, transport_worker_id, transport_crew_id, effective_from
  )
  select factory_a_id, supplied.worker_id, field_crew_id, date '2026-01-01'
  from unnest(field_workers) as supplied(worker_id);

  insert into public.transport_crew_memberships (
    factory_id, transport_worker_id, transport_crew_id, effective_from
  ) values
    (factory_a_id, kiln_worker_d_id, kiln_crew_id, date '2026-01-01'),
    (factory_a_id, kiln_worker_e_id, kiln_crew_id, date '2026-01-01'),
    (factory_a_id, kiln_worker_f_id, kiln_crew_id, date '2026-01-01'),
    (factory_a_id, missing_worker_id, missing_crew_id, date '2026-01-01'),
    (factory_b_id, worker_b_id, crew_b_id, date '2026-01-01');

  insert into public.transport_crew_wage_rates (
    id, factory_id, transport_crew_id, rate_per_paya,
    effective_from, effective_to
  ) values
    (field_rate_old_id, factory_a_id, field_crew_id, 800,
      date '2026-01-01', date '2026-06-17'),
    (field_rate_new_id, factory_a_id, field_crew_id, 900,
      date '2026-06-18', null),
    (kiln_rate_id, factory_a_id, kiln_crew_id, 1000,
      date '2026-01-01', null),
    (rate_b_id, factory_b_id, crew_b_id, 700,
      date '2026-01-01', null);

  insert into public.transport_daily_entries (
    id, factory_id, transport_crew_id, work_date, paya_quantity
  ) values
    (basic_entry_id, factory_a_id, field_crew_id, date '2026-06-01', 6),
    (multi_day_1_id, factory_a_id, field_crew_id, date '2026-06-08', 6),
    (multi_day_2_id, factory_a_id, field_crew_id, date '2026-06-09', 5),
    (change_old_id, factory_a_id, field_crew_id, date '2026-06-17', 2.5),
    (change_new_id, factory_a_id, field_crew_id, date '2026-06-18', 2.5),
    (change_kiln_id, factory_a_id, kiln_crew_id, date '2026-06-19', 1),
    (missing_entry_id, factory_a_id, missing_crew_id, date '2026-06-22', 1),
    (zero_entry_id, factory_a_id, field_crew_id, date '2026-06-29', 1),
    (atomic_valid_entry_id, factory_a_id, field_crew_id, date '2026-07-06', 2),
    (atomic_invalid_entry_id, factory_a_id, missing_crew_id, date '2026-07-07', 2),
    (entry_b_id, factory_b_id, crew_b_id, date '2026-06-01', 1);

  insert into public.transport_daily_attendance (
    factory_id, transport_daily_entry_id, transport_crew_id,
    transport_worker_id, work_date
  )
  select factory_a_id, basic_entry_id, field_crew_id,
    supplied.worker_id, date '2026-06-01'
  from unnest(field_workers) as supplied(worker_id);

  insert into public.transport_daily_attendance (
    factory_id, transport_daily_entry_id, transport_crew_id,
    transport_worker_id, work_date
  ) values
    (factory_a_id, multi_day_1_id, field_crew_id, field_workers[1], date '2026-06-08'),
    (factory_a_id, multi_day_1_id, field_crew_id, field_workers[2], date '2026-06-08'),
    (factory_a_id, multi_day_2_id, field_crew_id, field_workers[1], date '2026-06-09'),
    (factory_a_id, change_old_id, field_crew_id, field_workers[1], date '2026-06-17'),
    (factory_a_id, change_old_id, field_crew_id, field_workers[2], date '2026-06-17'),
    (factory_a_id, change_new_id, field_crew_id, field_workers[1], date '2026-06-18'),
    (factory_a_id, change_kiln_id, kiln_crew_id, kiln_worker_d_id, date '2026-06-19'),
    (factory_a_id, change_kiln_id, kiln_crew_id, kiln_worker_e_id, date '2026-06-19'),
    (factory_a_id, change_kiln_id, kiln_crew_id, kiln_worker_f_id, date '2026-06-19'),
    (factory_a_id, missing_entry_id, missing_crew_id, missing_worker_id, date '2026-06-22'),
    (factory_a_id, atomic_valid_entry_id, field_crew_id, field_workers[1], date '2026-07-06'),
    (factory_a_id, atomic_invalid_entry_id, missing_crew_id, missing_worker_id, date '2026-07-07'),
    (factory_b_id, entry_b_id, crew_b_id, worker_b_id, date '2026-06-01');

  insert into public.transport_weekly_earnings (
    id, factory_id, transport_worker_id, week_start, total_amount
  ) values (
    earning_b_id, factory_b_id, worker_b_id, date '2026-06-01', 700
  );

  insert into public.transport_weekly_earning_details (
    factory_id, transport_weekly_earning_id, transport_worker_id,
    week_start, transport_daily_entry_id, transport_crew_id, work_date,
    transport_crew_wage_rate_id, rate_per_paya_snapshot,
    paya_quantity_snapshot, attendance_count_snapshot,
    daily_crew_pool_snapshot, worker_daily_share_snapshot
  ) values (
    factory_b_id, earning_b_id, worker_b_id, date '2026-06-01',
    entry_b_id, crew_b_id, date '2026-06-01', rate_b_id,
    700, 1, 1, 700, 700
  );

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.unmapped_user_id', gen_random_uuid()::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.field_crew_id', field_crew_id::text, true);
  perform set_config('atlas_test.kiln_crew_id', kiln_crew_id::text, true);
  perform set_config('atlas_test.missing_crew_id', missing_crew_id::text, true);
  perform set_config('atlas_test.worker_a_id', field_workers[1]::text, true);
  perform set_config('atlas_test.worker_b_id', field_workers[2]::text, true);
  perform set_config('atlas_test.worker_c_id', field_workers[3]::text, true);
  perform set_config('atlas_test.worker_d_id', kiln_worker_d_id::text, true);
  perform set_config('atlas_test.worker_e_id', kiln_worker_e_id::text, true);
  perform set_config('atlas_test.worker_f_id', kiln_worker_f_id::text, true);
  perform set_config('atlas_test.field_rate_old_id', field_rate_old_id::text, true);
  perform set_config('atlas_test.field_rate_new_id', field_rate_new_id::text, true);
  perform set_config('atlas_test.kiln_rate_id', kiln_rate_id::text, true);
  perform set_config('atlas_test.basic_entry_id', basic_entry_id::text, true);
  perform set_config('atlas_test.multi_day_1_id', multi_day_1_id::text, true);
  perform set_config('atlas_test.change_old_id', change_old_id::text, true);
  perform set_config('atlas_test.change_new_id', change_new_id::text, true);
  perform set_config('atlas_test.change_kiln_id', change_kiln_id::text, true);

  raise notice 'PASS: rollback-only T6 factories, rates, entries, attendance, and isolation fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  summary record;
begin
  select * into summary
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    date '2026-06-01'
  );

  if summary.workers_calculated <> 10
    or summary.detail_rows_created <> 10
    or summary.rows_skipped <> 0 then
    raise exception 'FAIL: basic 10-worker summary is incorrect';
  end if;

  if (
    select count(*)
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = date '2026-06-01'
      and total_amount = 480
  ) <> 10 or (
    select count(*)
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = date '2026-06-01'
      and transport_daily_entry_id = current_setting('atlas_test.basic_entry_id')::uuid
      and rate_per_paya_snapshot = 800
      and paya_quantity_snapshot = 6
      and attendance_count_snapshot = 10
      and daily_crew_pool_snapshot = 4800
      and worker_daily_share_snapshot = 480
  ) <> 10 then
    raise exception 'FAIL: 6 paya x 800 / 10 calculation or snapshots are incorrect';
  end if;

  raise notice 'PASS: 6 paya at 800 creates a 4800 pool and 480 shares for 10 workers';
end;
$$;

do $$
declare
  summary record;
begin
  select * into summary
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    date '2026-06-08'
  );

  if summary.workers_calculated <> 2
    or summary.detail_rows_created <> 3
    or summary.rows_skipped <> 0 then
    raise exception 'FAIL: changing-attendance summary is incorrect';
  end if;

  if not exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid
      and week_start = date '2026-06-08'
      and total_amount = 6400
  ) or not exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_b_id')::uuid
      and week_start = date '2026-06-08'
      and total_amount = 2400
  ) then
    raise exception 'FAIL: changing-attendance weekly totals are incorrect';
  end if;

  if not exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid
      and work_date = date '2026-06-08'
      and daily_crew_pool_snapshot = 4800
      and attendance_count_snapshot = 2
      and worker_daily_share_snapshot = 2400
  ) or not exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid
      and work_date = date '2026-06-09'
      and daily_crew_pool_snapshot = 4000
      and attendance_count_snapshot = 1
      and worker_daily_share_snapshot = 4000
  ) then
    raise exception 'FAIL: changing-attendance daily details are incorrect';
  end if;

  raise notice 'PASS: multiple days aggregate A=6400 and B=2400 from exact daily shares';
end;
$$;

do $$
declare
  summary record;
begin
  select * into summary
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    date '2026-06-15'
  );

  if summary.workers_calculated <> 5
    or summary.detail_rows_created <> 6
    or summary.rows_skipped <> 0 then
    raise exception 'FAIL: rate-change/multiple-crew summary is incorrect';
  end if;

  if not exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and work_date = date '2026-06-17'
      and transport_daily_entry_id = current_setting('atlas_test.change_old_id')::uuid
      and transport_crew_id = current_setting('atlas_test.field_crew_id')::uuid
      and transport_crew_wage_rate_id = current_setting('atlas_test.field_rate_old_id')::uuid
      and rate_per_paya_snapshot = 800
      and paya_quantity_snapshot = 2.5
      and attendance_count_snapshot = 2
      and daily_crew_pool_snapshot = 2000
      and worker_daily_share_snapshot = 1000
  ) or not exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and work_date = date '2026-06-18'
      and transport_daily_entry_id = current_setting('atlas_test.change_new_id')::uuid
      and transport_crew_id = current_setting('atlas_test.field_crew_id')::uuid
      and transport_crew_wage_rate_id = current_setting('atlas_test.field_rate_new_id')::uuid
      and rate_per_paya_snapshot = 900
      and paya_quantity_snapshot = 2.5
      and attendance_count_snapshot = 1
      and daily_crew_pool_snapshot = 2250
      and worker_daily_share_snapshot = 2250
  ) then
    raise exception 'FAIL: exact work-date old/new rate snapshots are incorrect';
  end if;

  if (
    select count(*)
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = date '2026-06-15'
      and transport_daily_entry_id = current_setting('atlas_test.change_kiln_id')::uuid
      and transport_crew_id = current_setting('atlas_test.kiln_crew_id')::uuid
      and transport_crew_wage_rate_id = current_setting('atlas_test.kiln_rate_id')::uuid
      and rate_per_paya_snapshot = 1000
      and paya_quantity_snapshot = 1
      and attendance_count_snapshot = 3
      and daily_crew_pool_snapshot = 1000
      and worker_daily_share_snapshot = 1000::numeric / 3
  ) <> 3 then
    raise exception 'FAIL: second crew fractional snapshots were rounded or incorrect';
  end if;

  if not exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid
      and week_start = date '2026-06-15'
      and total_amount = 3250
  ) or not exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_b_id')::uuid
      and week_start = date '2026-06-15'
      and total_amount = 1000
  ) or (
    select count(*)
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id in (
        current_setting('atlas_test.worker_d_id')::uuid,
        current_setting('atlas_test.worker_e_id')::uuid,
        current_setting('atlas_test.worker_f_id')::uuid
      )
      and week_start = date '2026-06-15'
      and total_amount = 1000::numeric / 3
  ) <> 3 or exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_test.worker_c_id')::uuid
      and week_start = date '2026-06-15'
  ) then
    raise exception 'FAIL: weekly aggregation across crews or no-attendance exclusion is incorrect';
  end if;

  if exists (
    select 1
    from public.transport_weekly_earnings as earnings
    where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and earnings.week_start = date '2026-06-15'
      and earnings.total_amount <> (
        select sum(details.worker_daily_share_snapshot)
        from public.transport_weekly_earning_details as details
        where details.transport_weekly_earning_id = earnings.id
      )
  ) then
    raise exception 'FAIL: a weekly total differs from its exact detail sum';
  end if;

  raise notice 'PASS: mid-week rates, multiple crews, exact decimals, aggregation, and no-attendance exclusion work';
end;
$$;

select pg_temp.expect_error(
  'missing exact work-date rate rejects entire week', 'P2602',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-06-22'')',
    current_setting('atlas_test.factory_a_id')
  )
);

select pg_temp.expect_error(
  'zero-attendance daily entry rejects entire week', 'P2601',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-06-29'')',
    current_setting('atlas_test.factory_a_id')
  )
);

select pg_temp.expect_error(
  'mixed valid/invalid source fails atomically', 'P2602',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-07-06'')',
    current_setting('atlas_test.factory_a_id')
  )
);

do $$
begin
  if exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start in (
        date '2026-06-22', date '2026-06-29', date '2026-07-06'
      )
  ) or exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start in (
        date '2026-06-22', date '2026-06-29', date '2026-07-06'
      )
  ) then
    raise exception 'FAIL: failed calculations left partial financial rows';
  end if;

  raise notice 'PASS: missing-rate, zero-attendance, and mixed-source failures leave no rows';
end;
$$;

select pg_temp.expect_error(
  'non-Monday week rejected', '22023',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-06-02'')',
    current_setting('atlas_test.factory_a_id')
  )
);

select pg_temp.expect_error(
  'current incomplete week rejected', 'P0001',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date %L)',
    current_setting('atlas_test.factory_a_id'),
    (
      (now() at time zone 'Asia/Kolkata')::date
      - (extract(isodow from (now() at time zone 'Asia/Kolkata')::date)::integer - 1)
    )
  )
);

select pg_temp.expect_error(
  'future week rejected', 'P0001',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date %L)',
    current_setting('atlas_test.factory_a_id'),
    (
      (now() at time zone 'Asia/Kolkata')::date
      - (extract(isodow from (now() at time zone 'Asia/Kolkata')::date)::integer - 1)
      + 7
    )
  )
);

select pg_temp.expect_error(
  'wrong factory calculation rejected', '42501',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-06-01'')',
    current_setting('atlas_test.factory_b_id')
  )
);

reset role;

create temporary table t6_locked_earnings on commit drop as
select *
from public.transport_weekly_earnings
where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  and week_start = date '2026-06-08';

create temporary table t6_locked_details on commit drop as
select *
from public.transport_weekly_earning_details
where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  and week_start = date '2026-06-08';

update public.transport_daily_entries
set paya_quantity = 60
where id = current_setting('atlas_test.multi_day_1_id')::uuid;

update public.transport_crew_wage_rates
set rate_per_paya = 850
where id = current_setting('atlas_test.field_rate_old_id')::uuid;

insert into public.transport_daily_attendance (
  factory_id, transport_daily_entry_id, transport_crew_id,
  transport_worker_id, work_date
) values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.multi_day_1_id')::uuid,
  current_setting('atlas_test.field_crew_id')::uuid,
  current_setting('atlas_test.worker_c_id')::uuid,
  date '2026-06-08'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  summary record;
begin
  select * into summary
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    date '2026-06-08'
  );

  if summary.workers_calculated <> 0
    or summary.detail_rows_created <> 0
    or summary.rows_skipped <> 2 then
    raise exception 'FAIL: idempotent rerun summary is incorrect';
  end if;

  raise notice 'PASS: already-calculated week reports two immutable worker rows skipped';
end;
$$;

reset role;

do $$
begin
  if exists (
    (select *
      from public.transport_weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = date '2026-06-08')
    except
    (select * from pg_temp.t6_locked_earnings)
  ) or exists (
    (select * from pg_temp.t6_locked_earnings)
    except
    (select *
      from public.transport_weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = date '2026-06-08')
  ) or exists (
    (select *
      from public.transport_weekly_earning_details
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = date '2026-06-08')
    except
    (select * from pg_temp.t6_locked_details)
  ) or exists (
    (select * from pg_temp.t6_locked_details)
    except
    (select *
      from public.transport_weekly_earning_details
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = date '2026-06-08')
  ) then
    raise exception 'FAIL: source edits or rerun changed locked earnings/details';
  end if;

  if exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = date '2026-06-08'
      and transport_worker_id = current_setting('atlas_test.worker_c_id')::uuid
  ) then
    raise exception 'FAIL: rerun appended a newly attended worker';
  end if;

  raise notice 'PASS: source paya/rate/attendance edits cannot change or append to a locked week';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) or exists (
    select 1
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A can read Factory B earnings/details';
  end if;

  raise notice 'PASS: Factory A cannot read Factory B financial rows';
end;
$$;

select pg_temp.expect_error(
  'authenticated direct earning insert remains denied', '42501',
  format(
    'insert into public.transport_weekly_earnings (factory_id, transport_worker_id, week_start, total_amount) values (%L,%L,date ''2026-07-13'',1)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.worker_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated direct earning update remains denied', '42501',
  'update public.transport_weekly_earnings set total_amount = 1'
);

select pg_temp.expect_error(
  'authenticated direct earning delete remains denied', '42501',
  'delete from public.transport_weekly_earnings'
);

select pg_temp.expect_error(
  'authenticated direct detail insert remains denied', '42501',
  'insert into public.transport_weekly_earning_details (id) values (gen_random_uuid())'
);

select pg_temp.expect_error(
  'authenticated direct detail update remains denied', '42501',
  'update public.transport_weekly_earning_details set worker_daily_share_snapshot = 1'
);

select pg_temp.expect_error(
  'authenticated direct detail delete remains denied', '42501',
  'delete from public.transport_weekly_earning_details'
);

reset role;

update public.factory_users
set is_active = false
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

select pg_temp.expect_error(
  'inactive factory mapping calculator rejected', '42501',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-07-13'')',
    current_setting('atlas_test.factory_a_id')
  )
);

reset role;

update public.factory_users
set is_active = true
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.unmapped_user_id'), true);

select pg_temp.expect_error(
  'unmapped authenticated calculator rejected', '42501',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-07-13'')',
    current_setting('atlas_test.factory_a_id')
  )
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select pg_temp.expect_error(
  'anonymous calculator execution rejected', '42501',
  format(
    'select * from public.calculate_transport_weekly_wages(%L, date ''2026-07-13'')',
    current_setting('atlas_test.factory_a_id')
  )
);

reset role;

rollback;
