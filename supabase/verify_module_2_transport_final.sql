-- Atlas Chamber Transport T10 final security, history, and regression verifier.

-- Run after all Chamber Transport migrations through R1.

-- Requires one existing public.factory_users row. Every fixture and mapping

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

        test_label, expected_sqlstate, sqlstate, sqlerrm;

    end if;

end;

$$;

do $$

declare

  table_name text;

  privilege_name text;

  routine_oid regprocedure;

  routine record;

  routine_definition text;

  public_can_execute boolean;

  save_definition text;

  rate_definition text;

  calculator_definition text;

  balance_definition text;

  withdrawal_definition text;

  production_definition text;

  mud_definition text;

begin

  foreach table_name in array array[

    'transport_workers',

    'transport_crews',

    'transport_crew_memberships',

    'transport_crew_assignments',

    'transport_daily_entries',

    'transport_daily_attendance',

    'transport_crew_wage_rates',

    'transport_weekly_earnings',

    'transport_weekly_earning_details',

    'transport_withdrawals'

  ] loop

    if not (

      select relrowsecurity

      from pg_catalog.pg_class

      where oid = format('public.%I', table_name)::regclass

    ) then

      raise exception 'FAIL: RLS is not enabled on public.%', table_name;

    end if;

    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop

      if has_table_privilege(

        'anon', format('public.%I', table_name), privilege_name

      ) then

        raise exception 'FAIL: anon has % on public.%', privilege_name, table_name;

      end if;

    end loop;

  end loop;

  if not has_table_privilege('authenticated', 'public.transport_workers', 'SELECT')

    or not has_table_privilege('authenticated', 'public.transport_workers', 'INSERT')

    or not has_table_privilege('authenticated', 'public.transport_workers', 'UPDATE')

    or has_table_privilege('authenticated', 'public.transport_workers', 'DELETE')

    or not has_table_privilege('authenticated', 'public.transport_crews', 'SELECT')

    or not has_table_privilege('authenticated', 'public.transport_crews', 'INSERT')

    or not has_table_privilege('authenticated', 'public.transport_crews', 'UPDATE')

    or has_table_privilege('authenticated', 'public.transport_crews', 'DELETE') then

    raise exception 'FAIL: worker or crew operational grants are incorrect';

  end if;

  if not has_table_privilege('authenticated', 'public.transport_crew_assignments', 'SELECT')

    or not has_table_privilege('authenticated', 'public.transport_crew_assignments', 'INSERT')

    or not has_table_privilege('authenticated', 'public.transport_crew_assignments', 'DELETE')

    or has_table_privilege('authenticated', 'public.transport_crew_assignments', 'UPDATE') then

    raise exception 'FAIL: assignment operational grants are incorrect';

  end if;

  if not has_table_privilege('authenticated', 'public.transport_crew_memberships', 'SELECT')

    or has_table_privilege('authenticated', 'public.transport_crew_memberships', 'INSERT')

    or has_table_privilege('authenticated', 'public.transport_crew_memberships', 'UPDATE')

    or has_table_privilege('authenticated', 'public.transport_crew_memberships', 'DELETE') then

    raise exception 'FAIL: legacy membership history is not read-only';

  end if;

  foreach table_name in array array[

    'transport_daily_entries',

    'transport_daily_attendance',

    'transport_crew_wage_rates',

    'transport_weekly_earnings',

    'transport_weekly_earning_details',

    'transport_withdrawals'

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

      raise exception 'FAIL: controlled/read-only grants are incorrect on public.%', table_name;

    end if;

  end loop;

  if not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_assignments'::regclass

      and conname = 'transport_crew_assignments_worker_crew_key'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_memberships'::regclass

      and conname = 'transport_crew_memberships_worker_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_memberships'::regclass

      and conname = 'transport_crew_memberships_crew_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_assignments'::regclass

      and conname = 'transport_crew_assignments_worker_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_assignments'::regclass

      and conname = 'transport_crew_assignments_crew_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_daily_entries'::regclass

      and conname = 'transport_daily_entries_factory_crew_date_key'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_daily_entries'::regclass

      and conname = 'transport_daily_entries_crew_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_daily_attendance'::regclass

      and conname = 'transport_daily_attendance_entry_worker_key'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_daily_attendance'::regclass

      and conname = 'transport_daily_attendance_parent_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_daily_attendance'::regclass

      and conname = 'transport_daily_attendance_worker_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_wage_rates'::regclass

      and conname = 'transport_crew_wage_rates_no_overlapping_dates'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_crew_wage_rates'::regclass

      and conname = 'transport_crew_wage_rates_crew_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_weekly_earnings'::regclass

      and conname = 'transport_weekly_earnings_worker_week_key'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_weekly_earnings'::regclass

      and conname = 'transport_weekly_earnings_worker_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_weekly_earning_details'::regclass

      and conname = 'transport_weekly_earning_details_parent_entry_key'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_weekly_earning_details'::regclass

      and conname = 'transport_weekly_earning_details_parent_identity_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_weekly_earning_details'::regclass

      and conname = 'transport_weekly_earning_details_daily_entry_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_weekly_earning_details'::regclass

      and conname = 'transport_weekly_earning_details_rate_factory_fkey'

  ) or not exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_withdrawals'::regclass

      and conname = 'transport_withdrawals_worker_factory_fkey'

  ) then

    raise exception 'FAIL: final assignment, daily, rate, earning, or withdrawal constraints are missing';

  end if;

  if exists (

    select 1 from pg_catalog.pg_constraint

    where conrelid = 'public.transport_daily_attendance'::regclass

      and conname = 'transport_daily_attendance_worker_day_key'

  ) or exists (

    select 1 from pg_catalog.pg_trigger

    where tgrelid = 'public.transport_daily_attendance'::regclass

      and tgname = 'transport_daily_attendance_validate_membership'

      and not tgisinternal

  ) or to_regprocedure(

    'public.validate_transport_daily_attendance_membership()'

  ) is not null then

    raise exception 'FAIL: legacy one-crew/day or membership-date attendance logic remains';

  end if;

  if exists (

    select 1 from information_schema.columns as c

    where c.table_schema = 'public'

      and c.table_name = 'transport_crew_wage_rates'

      and c.column_name = 'transport_worker_id'

  ) then

    raise exception 'FAIL: an individual transport rate column exists';

  end if;

  foreach routine_oid in array array[

    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure,

    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'::regprocedure,

    'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure,

    'public.get_transport_worker_available_balance(uuid,uuid,date)'::regprocedure,

    'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)'::regprocedure

  ] loop

    select procedure.prosecdef, procedure.proconfig, procedure.proacl,

        procedure.proowner

      into routine

    from pg_catalog.pg_proc as procedure

    where procedure.oid = routine_oid;

    select exists (

      select 1

      from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner)))

        as privilege

      where privilege.grantee = 0

        and privilege.privilege_type = 'EXECUTE'

    ) into public_can_execute;

    select lower(pg_get_functiondef(routine_oid)) into routine_definition;

    if not routine.prosecdef

      or not coalesce(routine.proconfig, array[]::text[])

        @> array['search_path=pg_catalog, public']

      or not has_function_privilege('authenticated', routine_oid, 'EXECUTE')

      or has_function_privilege('anon', routine_oid, 'EXECUTE')

      or public_can_execute

      or routine_definition not like '%auth.uid()%'

      or routine_definition not like '%factory_users%'

      or routine_definition not like '%is_active = true%' then

      raise exception 'FAIL: RPC security/authentication is incorrect for %', routine_oid;

    end if;

  end loop;

  select lower(pg_get_functiondef(

    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure

  )) into save_definition;

  select lower(pg_get_functiondef(

    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'::regprocedure

  )) into rate_definition;

  select lower(pg_get_functiondef(

    'public.calculate_transport_weekly_wages(uuid,date)'::regprocedure

  )) into calculator_definition;

  select lower(pg_get_functiondef(

    'public.get_transport_worker_available_balance(uuid,uuid,date)'::regprocedure

  )) into balance_definition;

  select lower(pg_get_functiondef(

    'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)'::regprocedure

  )) into withdrawal_definition;

  if save_definition not like '%transport_crew_assignments%'

    or save_definition not like '%transport_workers.is_active = true%'

    or save_definition not like '%saved_entry.id is not null%'

    or save_definition not like '%pg_advisory_xact_lock%'

    or save_definition like '%transport_crew_memberships%'

    or save_definition like '%already attend another crew%'

    or rate_definition not like '%p_effective_from - 1%'

    or rate_definition not like '%pg_advisory_xact_lock%'

    or calculator_definition not like '%pg_advisory_xact_lock%'

    or calculator_definition not like '%matching_rate_count = 0%'

    or calculator_definition not like '%matching_rate_count > 1%'

    or calculator_definition not like '%daily_attendance_count = 0%'

    or calculator_definition not like '%select distinct transport_daily_attendance.transport_worker_id%'

    or calculator_definition not like '%transport_weekly_earning_details%'

    or calculator_definition like '%transport_crew_memberships%'

    or calculator_definition like '%round(%'

    or balance_definition not like '%week_start + 6 <= p_as_of_date%'

    or balance_definition like '%transport_crew_memberships%'

    or balance_definition like '%transport_crew_id%'

    or withdrawal_definition not like '%pg_advisory_xact_lock%'

    or withdrawal_definition not like '%week_start + 6 <= p_withdrawal_date%'

    or withdrawal_definition like '%transport_crew_memberships%'

    or withdrawal_definition like '%transport_crew_id%' then

    raise exception 'FAIL: authoritative RPC runtime architecture changed';

  end if;

  select lower(pg_get_functiondef(

    'public.calculate_production_wages(uuid,date)'::regprocedure

  )) into production_definition;

  select lower(pg_get_functiondef(

    'public.calculate_mud_supply_wages(uuid,uuid,date)'::regprocedure

  )) into mud_definition;

  if production_definition like '%transport_%'

    or mud_definition like '%transport_%'

    or production_definition not like '%resolve_production_wage_rate%'

    or mud_definition not like '%mud_supply%' then

    raise exception 'FAIL: production or mud wage architecture regressed';

  end if;

  raise notice 'PASS: final constraints, RLS, grants, RPC security, locks, and regression definitions verified';

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

  crew_formula_id uuid := gen_random_uuid();

  crew_missing_rate_id uuid := gen_random_uuid();

  crew_zero_attendance_id uuid := gen_random_uuid();

  foreign_crew_id uuid := gen_random_uuid();

  worker_id uuid := gen_random_uuid();

  replacement_worker_id uuid := gen_random_uuid();

  historical_worker_id uuid := gen_random_uuid();

  formula_worker_id uuid := gen_random_uuid();

  formula_helper_id uuid := gen_random_uuid();

  missing_rate_worker_id uuid := gen_random_uuid();

  inactive_worker_id uuid := gen_random_uuid();

  foreign_worker_id uuid := gen_random_uuid();

  foreign_entry_id uuid := gen_random_uuid();

  foreign_rate_id uuid := gen_random_uuid();

  foreign_earning_id uuid := gen_random_uuid();

  zero_entry_id uuid := gen_random_uuid();

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

    (factory_a_id, format('Transport Final Factory A %s', factory_a_id)),

    (factory_b_id, format('Transport Final Factory B %s', factory_b_id));

  update public.factory_users

  set factory_id = factory_a_id, is_active = true

  where id = mapping_id;

  insert into public.transport_crews (

    id, factory_id, name, work_direction, is_active

  ) values

    (crew_a_id, factory_a_id, 'Final Crew A', 'FIELD_TO_KILN', true),

    (crew_b_id, factory_a_id, 'Final Crew B', 'KILN_TO_FIELD', true),

    (crew_formula_id, factory_a_id, 'Final Formula Crew', 'FIELD_TO_KILN', true),

    (crew_missing_rate_id, factory_a_id, 'Final Missing Rate Crew', 'FIELD_TO_KILN', true),

    (crew_zero_attendance_id, factory_a_id, 'Final Zero Attendance Crew', 'KILN_TO_FIELD', true),

    (foreign_crew_id, factory_b_id, 'Final Foreign Crew', 'FIELD_TO_KILN', true);

  insert into public.transport_workers (

    id, factory_id, name, is_active

  ) values

    (worker_id, factory_a_id, 'Final Multi-crew Worker', true),

    (replacement_worker_id, factory_a_id, 'Final Replacement Worker', true),

    (historical_worker_id, factory_a_id, 'Final Historical Worker', true),

    (formula_worker_id, factory_a_id, 'Final Formula Worker', true),

    (formula_helper_id, factory_a_id, 'Final Formula Helper', true),

    (missing_rate_worker_id, factory_a_id, 'Final Missing Rate Worker', true),

    (inactive_worker_id, factory_a_id, 'Final Inactive Worker', false),

    (foreign_worker_id, factory_b_id, 'Final Foreign Worker', true);

  insert into public.transport_crew_memberships (

    factory_id, transport_worker_id, transport_crew_id,

    effective_from, effective_to

  ) values

    (factory_a_id, historical_worker_id, crew_a_id,

      date '2026-07-01', date '2026-07-31'),

    (factory_b_id, foreign_worker_id, foreign_crew_id,

      date '2026-07-01', null);

  insert into public.transport_crew_assignments (

    factory_id, transport_worker_id, transport_crew_id

  ) values

    (factory_a_id, worker_id, crew_a_id),

    (factory_a_id, worker_id, crew_b_id),

    (factory_a_id, replacement_worker_id, crew_a_id),

    (factory_a_id, historical_worker_id, crew_a_id),

    (factory_a_id, formula_worker_id, crew_formula_id),

    (factory_a_id, formula_helper_id, crew_formula_id),

    (factory_a_id, missing_rate_worker_id, crew_missing_rate_id),

    (factory_a_id, inactive_worker_id, crew_a_id),

    (factory_b_id, foreign_worker_id, foreign_crew_id);

  if (

    select count(*)

    from public.transport_crew_assignments

    where transport_worker_id = worker_id

  ) <> 2 then

    raise exception 'FAIL: one worker was not assigned to two crews';

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

  insert into public.transport_daily_entries (

    id, factory_id, transport_crew_id, work_date, paya_quantity

  ) values

    (zero_entry_id, factory_a_id, crew_zero_attendance_id,

      date '2026-07-28', 1),

    (foreign_entry_id, factory_b_id, foreign_crew_id,

      date '2026-07-07', 1);

  insert into public.transport_daily_attendance (

    factory_id, transport_daily_entry_id, transport_crew_id,

    transport_worker_id, work_date

  ) values (

    factory_b_id, foreign_entry_id, foreign_crew_id,

    foreign_worker_id, date '2026-07-07'

  );

  insert into public.transport_crew_wage_rates (

    id, factory_id, transport_crew_id, rate_per_paya,

    effective_from, effective_to

  ) values (

    foreign_rate_id, factory_b_id, foreign_crew_id, 50,

    date '2026-07-01', null

  );

  insert into public.transport_weekly_earnings (

    id, factory_id, transport_worker_id, week_start, total_amount

  ) values (

    foreign_earning_id, factory_b_id, foreign_worker_id,

    date '2026-07-06', 50

  );

  insert into public.transport_weekly_earning_details (

    factory_id, transport_weekly_earning_id, transport_worker_id,

    week_start, transport_daily_entry_id, transport_crew_id, work_date,

    transport_crew_wage_rate_id, rate_per_paya_snapshot,

    paya_quantity_snapshot, attendance_count_snapshot,

    daily_crew_pool_snapshot, worker_daily_share_snapshot

  ) values (

    factory_b_id, foreign_earning_id, foreign_worker_id,

    date '2026-07-06', foreign_entry_id, foreign_crew_id, date '2026-07-07',

    foreign_rate_id, 50, 1, 1, 50, 50

  );

  insert into public.transport_withdrawals (

    factory_id, transport_worker_id, withdrawal_date, amount

  ) values (

    factory_b_id, foreign_worker_id, date '2026-07-13', 10

  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);

  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);

  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);

  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);

  perform set_config('atlas_test.crew_formula_id', crew_formula_id::text, true);

  perform set_config('atlas_test.crew_missing_rate_id', crew_missing_rate_id::text, true);

  perform set_config('atlas_test.worker_id', worker_id::text, true);

  perform set_config('atlas_test.replacement_worker_id', replacement_worker_id::text, true);

  perform set_config('atlas_test.historical_worker_id', historical_worker_id::text, true);

  perform set_config('atlas_test.formula_worker_id', formula_worker_id::text, true);

  perform set_config('atlas_test.formula_helper_id', formula_helper_id::text, true);

  perform set_config('atlas_test.missing_rate_worker_id', missing_rate_worker_id::text, true);

  perform set_config('atlas_test.inactive_worker_id', inactive_worker_id::text, true);

  perform set_config('atlas_test.foreign_crew_id', foreign_crew_id::text, true);

  perform set_config('atlas_test.foreign_worker_id', foreign_worker_id::text, true);

  raise notice 'PASS: final assignment, legacy-history, and cross-factory fixtures created';

end;

$$;

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$

declare

  rate_a_old public.transport_crew_wage_rates;

  rate_a_middle public.transport_crew_wage_rates;

  rate_b public.transport_crew_wage_rates;

  rate_formula public.transport_crew_wage_rates;

begin

  select * into rate_a_old

  from public.create_transport_crew_wage_rate(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-01',

    500

  );

  select * into rate_a_middle

  from public.create_transport_crew_wage_rate(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-05',

    600

  );

  select * into rate_b

  from public.create_transport_crew_wage_rate(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_b_id')::uuid,

    date '2026-08-01',

    300

  );

  select * into rate_formula

  from public.create_transport_crew_wage_rate(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_formula_id')::uuid,

    date '2026-08-01',

    100.25

  );

  if rate_formula.rate_per_paya <> 100.25

    or rate_a_old.rate_per_paya <> 500

    or rate_a_middle.effective_from <> date '2026-08-05'

    or not exists (

      select 1 from public.transport_crew_wage_rates

      where id = rate_a_old.id

        and effective_from = date '2026-08-01'

        and effective_to = date '2026-08-04'

    ) or (

      select count(*) from public.transport_crew_wage_rates

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid

        and effective_from <= date '2026-08-04'

        and (effective_to is null or effective_to >= date '2026-08-04')

    ) <> 1 or not exists (

      select 1 from public.transport_crew_wage_rates

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid

        and rate_per_paya = 500

        and effective_from <= date '2026-08-04'

        and (effective_to is null or effective_to >= date '2026-08-04')

    ) or not exists (

      select 1 from public.transport_crew_wage_rates

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid

        and rate_per_paya = 600

        and effective_from <= date '2026-08-08'

        and (effective_to is null or effective_to >= date '2026-08-08')

    ) then

    raise exception 'FAIL: decimal, mid-week, close-previous, or work-date rate behavior is incorrect';

  end if;

  perform pg_temp.expect_error(

    'duplicate transport rate date rejected',

    'P0001',

    format(

      'select * from public.create_transport_crew_wage_rate(%L,%L,date %L,650)',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-05'

    )

  );

  perform pg_temp.expect_error(

    'backdated transport rate rejected',

    'P0001',

    format(

      'select * from public.create_transport_crew_wage_rate(%L,%L,date %L,450)',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-07-31'

    )

  );

  perform pg_temp.expect_error(

    'non-positive transport rate rejected',

    '22023',

    format(

      'select * from public.create_transport_crew_wage_rate(%L,%L,date %L,0)',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-10'

    )

  );

  perform pg_temp.expect_error(

    'authenticated direct transport rate mutation denied',

    '42501',

    format(

      'update public.transport_crew_wage_rates set rate_per_paya = 999 where id = %L',

      rate_a_old.id

    )

  );

  raise notice 'PASS: final crew-rate creation, history, resolver boundaries, and direct-write denial verified';

end;

$$;

do $$

declare

  crew_a_entry_id uuid;

  crew_a_entry_id_again uuid;

  crew_b_entry_id uuid;

  historical_entry_id uuid;

  next_week_entry_id uuid;

begin

  select daily_entry_id into crew_a_entry_id

  from public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-04',

    1,

    array[

      current_setting('atlas_test.worker_id')::uuid,

      current_setting('atlas_test.replacement_worker_id')::uuid

    ]

  );

  select daily_entry_id into crew_a_entry_id_again

  from public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-04',

    1,

    array[current_setting('atlas_test.worker_id')::uuid]

  );

  if crew_a_entry_id <> crew_a_entry_id_again

    or (

      select count(*) from public.transport_daily_entries

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid

        and work_date = date '2026-08-04'

    ) <> 1 or (

      select count(*) from public.transport_daily_attendance

      where transport_daily_entry_id = crew_a_entry_id

    ) <> 1 or exists (

      select 1 from public.transport_daily_attendance

      where transport_daily_entry_id = crew_a_entry_id

        and transport_worker_id = current_setting('atlas_test.replacement_worker_id')::uuid

    ) then

    raise exception 'FAIL: same crew/date upsert or exact attendance replacement failed';

  end if;

  select daily_entry_id into crew_b_entry_id

  from public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_b_id')::uuid,

    date '2026-08-04',

    1,

    array[current_setting('atlas_test.worker_id')::uuid]

  );

  if crew_b_entry_id = crew_a_entry_id or (

    select count(*)

    from public.transport_daily_attendance

    where factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid

      and work_date = date '2026-08-04'

  ) <> 2 then

    raise exception 'FAIL: same worker did not retain separate attendance in two crews on one date';

  end if;

  perform public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_formula_id')::uuid,

    date '2026-08-06',

    3,

    array[

      current_setting('atlas_test.formula_worker_id')::uuid,

      current_setting('atlas_test.formula_helper_id')::uuid

    ]

  );

  select daily_entry_id into historical_entry_id

  from public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-05',

    1.5,

    array[current_setting('atlas_test.historical_worker_id')::uuid]

  );

  select daily_entry_id into next_week_entry_id

  from public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-11',

    1,

    array[current_setting('atlas_test.worker_id')::uuid]

  );

  perform public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_missing_rate_id')::uuid,

    date '2026-07-21',

    1,

    array[current_setting('atlas_test.missing_rate_worker_id')::uuid]

  );

  perform pg_temp.expect_error(

    'duplicate worker IDs in one save rejected',

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

    'empty attendance rejected',

    '22023',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[]::uuid[])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-07'

    )

  );

  perform pg_temp.expect_error(

    'non-positive paya rejected',

    '22023',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,0,array[%L::uuid])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-07',

      current_setting('atlas_test.worker_id')

    )

  );

  perform pg_temp.expect_error(

    'NaN paya rejected',

    '22023',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,%L::numeric,array[%L::uuid])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-07',

      'NaN',

      current_setting('atlas_test.worker_id')

    )

  );

  perform pg_temp.expect_error(

    'inactive worker cannot be newly introduced',

    '23514',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-07',

      current_setting('atlas_test.inactive_worker_id')

    )

  );

  perform pg_temp.expect_error(

    'cross-factory crew rejected by daily save',

    '42501',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.foreign_crew_id'),

      '2026-08-07',

      current_setting('atlas_test.worker_id')

    )

  );

  perform pg_temp.expect_error(

    'cross-factory worker rejected by daily save',

    '42501',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_a_id'),

      '2026-08-07',

      current_setting('atlas_test.foreign_worker_id')

    )

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

    1.75,

    array[current_setting('atlas_test.historical_worker_id')::uuid]

  );

  if not exists (

    select 1 from public.transport_daily_attendance

    where transport_daily_entry_id = historical_entry_id

      and transport_worker_id = current_setting('atlas_test.historical_worker_id')::uuid

  ) then

    raise exception 'FAIL: historical saved attendance disappeared after unassignment/deactivation';

  end if;

  perform pg_temp.expect_error(

    'historical attendance exception is not transferable to a new entry',

    '23514',

    format(

      'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.crew_b_id'),

      '2026-08-07',

      current_setting('atlas_test.historical_worker_id')

    )

  );

  perform set_config('atlas_test.crew_a_entry_id', crew_a_entry_id::text, true);

  perform set_config('atlas_test.crew_b_entry_id', crew_b_entry_id::text, true);

  perform set_config('atlas_test.next_week_entry_id', next_week_entry_id::text, true);

  raise notice 'PASS: daily upsert, exact replacement, multi-crew attendance, validation, and history preservation verified';

end;

$$;

select pg_temp.expect_error(

  'missing rate fails the complete weekly settlement',

  'P2602',

  format(

    'select * from public.calculate_transport_weekly_wages(%L,date %L)',

    current_setting('atlas_test.factory_a_id'),

    '2026-07-20'

  )

);

select pg_temp.expect_error(

  'zero-attendance defensive case fails the complete weekly settlement',

  'P2601',

  format(

    'select * from public.calculate_transport_weekly_wages(%L,date %L)',

    current_setting('atlas_test.factory_a_id'),

    '2026-07-27'

  )

);

do $$

begin

  if exists (

    select 1 from public.transport_weekly_earnings

    where factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and week_start in (date '2026-07-20', date '2026-07-27')

  ) or exists (

    select 1 from public.transport_weekly_earning_details

    where factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and week_start in (date '2026-07-20', date '2026-07-27')

  ) then

    raise exception 'FAIL: failed settlements left partial parents or details';

  end if;

  raise notice 'PASS: missing-rate and zero-attendance settlement failures are atomic';

end;

$$;

do $$

declare

  summary record;

  earning_id uuid;

  parent_count integer;

  detail_count integer;

begin

  select * into summary

  from public.calculate_transport_weekly_wages(

    current_setting('atlas_test.factory_a_id')::uuid,

    date '2026-08-03'

  );

  select id into earning_id

  from public.transport_weekly_earnings

  where factory_id = current_setting('atlas_test.factory_a_id')::uuid

    and transport_worker_id = current_setting('atlas_test.worker_id')::uuid

    and week_start = date '2026-08-03';

  if earning_id is null or not exists (

    select 1 from public.transport_weekly_earnings

    where id = earning_id

      and total_amount = 800

  ) or (

    select count(*) from public.transport_weekly_earning_details

    where transport_weekly_earning_id = earning_id

  ) <> 2 or not exists (

    select 1 from public.transport_weekly_earning_details

    where transport_weekly_earning_id = earning_id

      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid

      and work_date = date '2026-08-04'

      and rate_per_paya_snapshot = 500

      and paya_quantity_snapshot = 1

      and attendance_count_snapshot = 1

      and daily_crew_pool_snapshot = 500

      and worker_daily_share_snapshot = 500

  ) or not exists (

    select 1 from public.transport_weekly_earning_details

    where transport_weekly_earning_id = earning_id

      and transport_crew_id = current_setting('atlas_test.crew_b_id')::uuid

      and work_date = date '2026-08-04'

      and rate_per_paya_snapshot = 300

      and paya_quantity_snapshot = 1

      and attendance_count_snapshot = 1

      and daily_crew_pool_snapshot = 300

      and worker_daily_share_snapshot = 300

  ) then

    raise exception 'FAIL: one worker/two crews did not produce one 800 earning and two immutable details';

  end if;

  if not exists (

    select 1 from public.transport_weekly_earning_details

    where factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and transport_worker_id = current_setting('atlas_test.formula_worker_id')::uuid

      and week_start = date '2026-08-03'

      and rate_per_paya_snapshot = 100.25

      and paya_quantity_snapshot = 3

      and attendance_count_snapshot = 2

      and daily_crew_pool_snapshot = 300.75

      and worker_daily_share_snapshot = 150.375

  ) then

    raise exception 'FAIL: exact pool/share formula or no-rounding behavior is incorrect';

  end if;

  select count(*), coalesce(sum(detail_rows), 0)

    into parent_count, detail_count

  from (

    select earnings.id, count(details.id)::integer as detail_rows

    from public.transport_weekly_earnings as earnings

    left join public.transport_weekly_earning_details as details

      on details.transport_weekly_earning_id = earnings.id

    where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and earnings.week_start = date '2026-08-03'

    group by earnings.id

  ) as settled;

  perform set_config('atlas_test.main_earning_id', earning_id::text, true);

  perform set_config('atlas_test.main_parent_count', parent_count::text, true);

  perform set_config('atlas_test.main_detail_count', detail_count::text, true);

  raise notice 'PASS: exact formulas, no rounding, one 800 worker/week earning, and separate same-day crew snapshots verified';

end;

$$;

do $$

declare

  later_rate public.transport_crew_wage_rates;

  rerun record;

begin

  select * into later_rate

  from public.create_transport_crew_wage_rate(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-10',

    700

  );

  delete from public.transport_crew_assignments

  where factory_id = current_setting('atlas_test.factory_a_id')::uuid

    and transport_worker_id = current_setting('atlas_test.worker_id')::uuid

    and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid;

  update public.transport_workers

  set is_active = false

  where factory_id = current_setting('atlas_test.factory_a_id')::uuid

    and id = current_setting('atlas_test.worker_id')::uuid;

  update public.transport_crews

  set is_active = false

  where factory_id = current_setting('atlas_test.factory_a_id')::uuid

    and id = current_setting('atlas_test.crew_a_id')::uuid;

  perform public.save_transport_daily_entry(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.crew_a_id')::uuid,

    date '2026-08-04',

    2,

    array[

      current_setting('atlas_test.worker_id')::uuid,

      current_setting('atlas_test.replacement_worker_id')::uuid

    ]

  );

  if not exists (

    select 1 from public.transport_daily_entries

    where id = current_setting('atlas_test.crew_a_entry_id')::uuid

      and paya_quantity = 2

  ) or (

    select count(*) from public.transport_daily_attendance

    where transport_daily_entry_id = current_setting('atlas_test.crew_a_entry_id')::uuid

  ) <> 2 or not exists (

    select 1 from public.transport_weekly_earnings

    where id = current_setting('atlas_test.main_earning_id')::uuid

      and total_amount = 800

  ) or not exists (

    select 1 from public.transport_weekly_earning_details

    where transport_weekly_earning_id = current_setting('atlas_test.main_earning_id')::uuid

      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid

      and rate_per_paya_snapshot = 500

      and paya_quantity_snapshot = 1

      and attendance_count_snapshot = 1

      and daily_crew_pool_snapshot = 500

      and worker_daily_share_snapshot = 500

  ) then

    raise exception 'FAIL: locked snapshots changed after mutable paya/assignment/active/rate changes';

  end if;

  select * into rerun

  from public.calculate_transport_weekly_wages(

    current_setting('atlas_test.factory_a_id')::uuid,

    date '2026-08-03'

  );

  if rerun.workers_calculated <> 0

    or rerun.detail_rows_created <> 0

    or rerun.rows_skipped <> current_setting('atlas_test.main_parent_count')::integer

    or (

      select count(*) from public.transport_weekly_earnings

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and week_start = date '2026-08-03'

    ) <> current_setting('atlas_test.main_parent_count')::integer

    or (

      select count(*) from public.transport_weekly_earning_details

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and week_start = date '2026-08-03'

    ) <> current_setting('atlas_test.main_detail_count')::integer then

    raise exception 'FAIL: settled week rerun was not idempotently locked';

  end if;

  raise notice 'PASS: immutable snapshots and settled-week idempotency survive mutable source changes';

end;

$$;

do $$

declare

  balance record;

  withdrawal_count integer;

begin

  select * into balance

  from public.get_transport_worker_available_balance(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.worker_id')::uuid,

    date '2026-08-10'

  );

  if balance.total_earned <> 800

    or balance.total_withdrawn <> 0

    or balance.available_balance <> 800 then

    raise exception 'FAIL: combined multi-crew earning did not feed one worker balance';

  end if;

  perform public.create_transport_worker_withdrawal(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.worker_id')::uuid,

    date '2026-08-10',

    100

  );

  perform public.create_transport_worker_withdrawal(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.worker_id')::uuid,

    date '2026-08-10',

    200

  );

  select count(*) into withdrawal_count

  from public.transport_withdrawals

  where factory_id = current_setting('atlas_test.factory_a_id')::uuid

    and transport_worker_id = current_setting('atlas_test.worker_id')::uuid;

  perform pg_temp.expect_error(

    'over-withdrawal rejected atomically',

    'P0001',

    format(

      'select * from public.create_transport_worker_withdrawal(%L,%L,date %L,500.01)',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.worker_id'),

      '2026-08-10'

    )

  );

  if (

    select count(*) from public.transport_withdrawals

    where factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and transport_worker_id = current_setting('atlas_test.worker_id')::uuid

  ) <> withdrawal_count then

    raise exception 'FAIL: rejected over-withdrawal left a history row';

  end if;

  perform public.create_transport_worker_withdrawal(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.worker_id')::uuid,

    date '2026-08-10',

    500

  );

  select * into balance

  from public.get_transport_worker_available_balance(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.worker_id')::uuid,

    date '2026-08-10'

  );

  if balance.available_balance <> 0

    or balance.total_withdrawn <> 800

    or (

      select count(*) from public.transport_withdrawals

      where factory_id = current_setting('atlas_test.factory_a_id')::uuid

        and transport_worker_id = current_setting('atlas_test.worker_id')::uuid

    ) <> 3 then

    raise exception 'FAIL: partial, multiple, full, or one-worker withdrawal history is incorrect';

  end if;

  perform public.calculate_transport_weekly_wages(

    current_setting('atlas_test.factory_a_id')::uuid,

    date '2026-08-10'

  );

  select * into balance

  from public.get_transport_worker_available_balance(

    current_setting('atlas_test.factory_a_id')::uuid,

    current_setting('atlas_test.worker_id')::uuid,

    date '2026-08-17'

  );

  if balance.total_earned <> 1500

    or balance.total_withdrawn <> 800

    or balance.available_balance <> 700 then

    raise exception 'FAIL: later earning did not carry the inactive worker balance forward';

  end if;

  raise notice 'PASS: worker-level balance, partial/multiple/full withdrawals, atomic rejection, and carry-forward verified';

end;

$$;

do $$

declare

  table_name text;

begin

  foreach table_name in array array[

    'transport_workers',

    'transport_crews',

    'transport_crew_memberships',

    'transport_crew_assignments',

    'transport_daily_entries',

    'transport_daily_attendance',

    'transport_crew_wage_rates',

    'transport_weekly_earnings',

    'transport_weekly_earning_details',

    'transport_withdrawals'

  ] loop

    if exists (

      select 1

      from pg_catalog.pg_class

      where oid = format('public.%I', table_name)::regclass

        and not relrowsecurity

    ) or (

      case table_name

        when 'transport_workers' then exists (

          select 1 from public.transport_workers

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_crews' then exists (

          select 1 from public.transport_crews

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_crew_memberships' then exists (

          select 1 from public.transport_crew_memberships

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_crew_assignments' then exists (

          select 1 from public.transport_crew_assignments

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_daily_entries' then exists (

          select 1 from public.transport_daily_entries

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_daily_attendance' then exists (

          select 1 from public.transport_daily_attendance

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_crew_wage_rates' then exists (

          select 1 from public.transport_crew_wage_rates

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_weekly_earnings' then exists (

          select 1 from public.transport_weekly_earnings

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_weekly_earning_details' then exists (

          select 1 from public.transport_weekly_earning_details

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        when 'transport_withdrawals' then exists (

          select 1 from public.transport_withdrawals

          where factory_id = current_setting('atlas_test.factory_b_id')::uuid

        )

        else true

      end

    ) then

      raise exception 'FAIL: Factory A can read Factory B data in public.%', table_name;

    end if;

  end loop;

  if (

    select count(*) from public.transport_crew_memberships

    where factory_id = current_setting('atlas_test.factory_a_id')::uuid

      and transport_worker_id = current_setting('atlas_test.historical_worker_id')::uuid

  ) <> 1 then

    raise exception 'FAIL: preserved legacy membership history changed';

  end if;

  perform pg_temp.expect_error(

    'authenticated legacy membership insert denied',

    '42501',

    format(

      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from) values (%L,%L,%L,date %L)',

      current_setting('atlas_test.factory_a_id'),

      current_setting('atlas_test.worker_id'),

      current_setting('atlas_test.crew_b_id'),

      '2026-08-01'

    )

  );

  foreach table_name in array array[

    'transport_weekly_earnings',

    'transport_weekly_earning_details',

    'transport_withdrawals'

  ] loop

    perform pg_temp.expect_error(

      format('authenticated direct insert denied on %s', table_name),

      '42501',

      format('insert into public.%I default values', table_name)

    );

  end loop;

  raise notice 'PASS: all transport tables are factory-isolated and legacy/financial mutation stays controlled';

end;

$$;

reset role;

select pg_temp.expect_error(

  'same worker twice in one persisted daily entry rejected',

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

  'anonymous financial table read rejected',

  '42501',

  'select * from public.transport_weekly_earnings'

);

select pg_temp.expect_error(

  'anonymous daily save RPC rejected',

  '42501',

  format(

    'select * from public.save_transport_daily_entry(%L,%L,date %L,1,array[%L::uuid])',

    current_setting('atlas_test.factory_a_id'),

    current_setting('atlas_test.crew_b_id'),

    '2026-08-08',

    current_setting('atlas_test.worker_id')

  )

);

select pg_temp.expect_error(

  'anonymous rate creation RPC rejected',

  '42501',

  format(

    'select * from public.create_transport_crew_wage_rate(%L,%L,date %L,900)',

    current_setting('atlas_test.factory_a_id'),

    current_setting('atlas_test.crew_b_id'),

    '2026-08-20'

  )

);

select pg_temp.expect_error(

  'anonymous weekly calculator RPC rejected',

  '42501',

  format(

    'select * from public.calculate_transport_weekly_wages(%L,date %L)',

    current_setting('atlas_test.factory_a_id'),

    '2026-08-03'

  )

);

select pg_temp.expect_error(

  'anonymous balance RPC rejected',

  '42501',

  format(

    'select * from public.get_transport_worker_available_balance(%L,%L,date %L)',

    current_setting('atlas_test.factory_a_id'),

    current_setting('atlas_test.worker_id'),

    '2026-08-17'

  )

);

select pg_temp.expect_error(

  'anonymous withdrawal RPC rejected',

  '42501',

  format(

    'select * from public.create_transport_worker_withdrawal(%L,%L,date %L,1)',

    current_setting('atlas_test.factory_a_id'),

    current_setting('atlas_test.worker_id'),

    '2026-08-17'

  )

);

reset role;

rollback;
