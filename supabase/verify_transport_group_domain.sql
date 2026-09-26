-- Run only against confirmed Test Atlas Clean after migration 20260926000066.
-- Fixtures run inside a transaction and are discarded by the final rollback.

begin;

do $$
declare
  save_definition text;
  calculator_definition text;
  balance_definition text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transport_crews'
      and column_name = 'work_direction'
  ) then
    raise exception 'FAIL: transport_crews.work_direction still exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crews'::regclass
      and conname = 'transport_crews_work_direction_check'
  ) then
    raise exception 'FAIL: transport direction check constraint still exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_assignments'::regclass
      and conname = 'transport_crew_assignments_worker_crew_key'
  ) then
    raise exception 'FAIL: multi-group worker/crew assignment identity changed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_assignments'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) in (
        'UNIQUE (transport_worker_id)',
        'UNIQUE (factory_id, transport_worker_id)'
      )
  ) then
    raise exception 'FAIL: one-worker-one-group uniqueness was introduced';
  end if;

  if not (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.transport_crews'::regclass
  ) or not (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.transport_crew_assignments'::regclass
  ) then
    raise exception 'FAIL: Transport Group RLS changed';
  end if;

  select lower(pg_get_functiondef(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure
  )) into save_definition;

  if save_definition not like '%transport_crew_assignments%'
    or save_definition not like '%transport_daily_attendance.transport_daily_entry_id = saved_entry.id%'
    or save_definition like '%work_direction%'
  then
    raise exception 'FAIL: daily save assignment/history behaviour changed';
  end if;

  select lower(pg_get_functiondef(
    'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure
  )) into calculator_definition;

  if calculator_definition not like '%transport_daily_entries.paya_quantity%'
    or calculator_definition not like '%transport_crew_wage_rates.rate_per_paya%'
    or calculator_definition not like '%attendance_totals.attendance_count%'
    or calculator_definition not like '%transport_weekly_earning_details%'
    or calculator_definition like '%work_direction%'
  then
    raise exception 'FAIL: Transport Group pool/share calculation changed';
  end if;

  select lower(pg_get_functiondef(
    'public.get_transport_worker_available_balance(uuid,uuid,date)'::regprocedure
  )) into balance_definition;

  if balance_definition not like '%transport_weekly_earnings%'
    or balance_definition not like '%transport_withdrawals%'
    or balance_definition like '%transport_crew_id%'
  then
    raise exception 'FAIL: worker balance sources changed';
  end if;

  raise notice 'PASS: Transport Group direction removal, multi-group assignments, RLS, calculations, and balances are intact';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  fixture_factory_id uuid := gen_random_uuid();
  fixture_worker_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
  group_b_id uuid := gen_random_uuid();
  foreign_factory_id uuid := gen_random_uuid();
  foreign_group_id uuid := gen_random_uuid();
begin
  select id, user_id
    into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: Test Atlas Clean has no factory user for Transport Group verification';
  end if;

  insert into public.factories (id, name)
  values
    (fixture_factory_id, format('Transport Group verifier %s', fixture_factory_id)),
    (foreign_factory_id, format('Transport Group foreign verifier %s', foreign_factory_id));

  update public.factory_users
  set factory_id = fixture_factory_id, is_active = true
  where id = mapping_id;

  insert into public.transport_workers (id, factory_id, name)
  values (fixture_worker_id, fixture_factory_id, 'Transport Group verifier worker');

  insert into public.transport_crews (id, factory_id, name)
  values
    (group_a_id, fixture_factory_id, 'Transport Group A'),
    (group_b_id, fixture_factory_id, 'Transport Group B'),
    (foreign_group_id, foreign_factory_id, 'Transport Group foreign fixture');

  insert into public.transport_crew_assignments (
    factory_id,
    transport_worker_id,
    transport_crew_id
  ) values
    (fixture_factory_id, fixture_worker_id, group_a_id),
    (fixture_factory_id, fixture_worker_id, group_b_id);

  if (
    select count(*)
    from public.transport_crew_assignments
    where transport_worker_id = fixture_worker_id
  ) <> 2 then
    raise exception 'FAIL: one worker cannot remain assigned to multiple Transport Groups';
  end if;

  insert into public.transport_daily_entries (
    id,
    factory_id,
    transport_crew_id,
    work_date,
    paya_quantity
  ) values
    (gen_random_uuid(), fixture_factory_id, group_a_id, date '2026-08-04', 1),
    (gen_random_uuid(), fixture_factory_id, group_b_id, date '2026-08-04', 1);

  insert into public.transport_daily_attendance (
    factory_id,
    transport_daily_entry_id,
    transport_crew_id,
    transport_worker_id,
    work_date
  )
  select
    fixture_factory_id,
    entries.id,
    entries.transport_crew_id,
    fixture_worker_id,
    entries.work_date
  from public.transport_daily_entries as entries
  where entries.factory_id = fixture_factory_id;

  insert into public.transport_crew_wage_rates (
    factory_id,
    transport_crew_id,
    rate_per_paya,
    effective_from
  ) values
    (fixture_factory_id, group_a_id, 500, date '2026-08-01'),
    (fixture_factory_id, group_b_id, 300, date '2026-08-01');

  perform set_config('atlas_test.transport_group_user_id', test_user_id::text, true);
  perform set_config('atlas_test.transport_group_factory_id', fixture_factory_id::text, true);
  perform set_config('atlas_test.transport_group_worker_id', fixture_worker_id::text, true);
  perform set_config('atlas_test.transport_group_foreign_id', foreign_group_id::text, true);
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('atlas_test.transport_group_user_id'),
  true
);

do $$
declare
  calculation record;
  repeat_calculation record;
  balance record;
begin
  if (
    select count(*)
    from public.transport_crews
    where factory_id = current_setting('atlas_test.transport_group_factory_id')::uuid
  ) <> 2 or exists (
    select 1
    from public.transport_crews
    where id = current_setting('atlas_test.transport_group_foreign_id')::uuid
  ) then
    raise exception 'FAIL: Transport Group factory isolation changed';
  end if;

  select * into calculation
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.transport_group_factory_id')::uuid,
    date '2026-08-03'
  );

  if calculation.workers_calculated <> 1
    or calculation.detail_rows_created <> 2
    or calculation.rows_skipped <> 0
  then
    raise exception 'FAIL: multi-group weekly calculation summary changed';
  end if;

  if not exists (
    select 1
    from public.transport_weekly_earnings
    where factory_id = current_setting('atlas_test.transport_group_factory_id')::uuid
      and transport_worker_id = current_setting('atlas_test.transport_group_worker_id')::uuid
      and week_start = date '2026-08-03'
      and total_amount = 800
  ) or (
    select count(*)
    from public.transport_weekly_earning_details
    where factory_id = current_setting('atlas_test.transport_group_factory_id')::uuid
      and transport_worker_id = current_setting('atlas_test.transport_group_worker_id')::uuid
      and week_start = date '2026-08-03'
  ) <> 2 then
    raise exception 'FAIL: paya x group rate pool or same-day multi-group shares changed';
  end if;

  select * into repeat_calculation
  from public.calculate_transport_weekly_wages(
    current_setting('atlas_test.transport_group_factory_id')::uuid,
    date '2026-08-03'
  );

  if repeat_calculation.workers_calculated <> 0
    or repeat_calculation.rows_skipped <> 1
  then
    raise exception 'FAIL: weekly earning lock/idempotent skip changed';
  end if;

  select * into balance
  from public.get_transport_worker_available_balance(
    current_setting('atlas_test.transport_group_factory_id')::uuid,
    current_setting('atlas_test.transport_group_worker_id')::uuid,
    date '2026-08-10'
  );

  if balance.total_earned <> 800
    or balance.total_withdrawn <> 0
    or balance.available_balance <> 800
  then
    raise exception 'FAIL: Transport Group worker balance changed';
  end if;

  perform public.create_transport_worker_withdrawal(
    current_setting('atlas_test.transport_group_factory_id')::uuid,
    current_setting('atlas_test.transport_group_worker_id')::uuid,
    date '2026-08-10',
    100
  );

  select * into balance
  from public.get_transport_worker_available_balance(
    current_setting('atlas_test.transport_group_factory_id')::uuid,
    current_setting('atlas_test.transport_group_worker_id')::uuid,
    date '2026-08-10'
  );

  if balance.total_earned <> 800
    or balance.total_withdrawn <> 100
    or balance.available_balance <> 700
  then
    raise exception 'FAIL: Transport Group withdrawal/balance behaviour changed';
  end if;

  raise notice 'PASS: group creation, multi-group attendance, rates, pools, weekly locks, balances, and withdrawals are intact';
end;
$$;

rollback;
