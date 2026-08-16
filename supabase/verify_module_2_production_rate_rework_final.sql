-- Atlas Module 2 Production Wage Rate Rework final verifier (R2.1-R2.8).
-- Run after all migrations through 20260816000007. It requires one existing
-- factory_users row. All fixtures and mapping changes are rolled back.

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

-- Minimal first fixture set for controlled mutation/lifecycle verification.
do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  success_week date;
  missing_week date;
  current_week_start date;
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  key_name text;
  key_value uuid;
begin
  current_week_start := business_today
    - (extract(isodow from business_today)::integer - 1);
  success_week := current_week_start - 28;
  missing_week := current_week_start - 14;

  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name) values
    (factory_a_id, format('Final mutation audit Factory A %s', factory_a_id)),
    (factory_b_id, format('Final mutation audit Factory B %s', factory_b_id));
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.brick_types (id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Final mutation brick A'),
    (brick_b_id, factory_b_id, 'Final mutation brick B');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.success_week', success_week::text, true);
  perform set_config('atlas_test.missing_week', missing_week::text, true);

  foreach key_name in array array[
    'default_labourer_id', 'override_labourer_id', 'override_rpc_labourer_id',
    'move_labourer_id', 'lifecycle_labourer_id', 'missing_rate_labourer_id'
  ] loop
    key_value := gen_random_uuid();
    insert into public.labourers (
      id, factory_id, name, assigned_brick_type_id, is_active
    ) values (key_value, factory_a_id, 'Final mutation ' || key_name, brick_a_id, true);
    perform set_config('atlas_test.' || key_name, key_value::text, true);
  end loop;

  key_value := gen_random_uuid();
  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values (key_value, factory_b_id, 'Final mutation Factory B worker', brick_b_id, true);

  foreach key_name in array array['crew_a_id', 'crew_b_id', 'no_rate_crew_id'] loop
    key_value := gen_random_uuid();
    insert into public.production_crews (id, factory_id, name, is_active)
    values (key_value, factory_a_id, 'Final mutation ' || key_name, true);
    perform set_config('atlas_test.' || key_name, key_value::text, true);
  end loop;

  key_value := gen_random_uuid();
  insert into public.production_crews (id, factory_id, name, is_active)
  values (key_value, factory_b_id, 'Final mutation Factory B crew', true);
  perform set_config('atlas_test.factory_b_crew_id', key_value::text, true);
  perform set_config('atlas_test.bounded_override_id', gen_random_uuid()::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  crew_a_old_rate public.production_wage_rates%rowtype;
  crew_a_new_rate public.production_wage_rates%rowtype;
  crew_b_rate public.production_wage_rates%rowtype;
  first_override public.production_wage_rates%rowtype;
  second_override public.production_wage_rates%rowtype;
  first_assignment public.production_crew_assignments%rowtype;
  moved_assignment public.production_crew_assignments%rowtype;
  ended_assignment public.production_crew_assignments%rowtype;
  returned_assignment public.production_crew_assignments%rowtype;
begin
  select * into crew_a_old_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    520,
    current_setting('atlas_test.success_week')::date - 7
  );

  select * into crew_a_new_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    530,
    current_setting('atlas_test.success_week')::date + 3
  );

  select * into crew_b_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    600,
    current_setting('atlas_test.success_week')::date - 7
  );

  select * into crew_a_old_rate
  from public.production_wage_rates
  where id = crew_a_old_rate.id;

  if crew_a_old_rate.effective_to
      <> current_setting('atlas_test.success_week')::date + 2
    or crew_a_new_rate.effective_from
      <> current_setting('atlas_test.success_week')::date + 3
    or crew_a_new_rate.effective_to is not null then
    raise exception 'FAIL: mid-week crew-rate replacement did not preserve a contiguous history';
  end if;

  select * into first_override
  from public.create_labourer_production_wage_rate_override(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_rpc_labourer_id')::uuid,
    545,
    current_setting('atlas_test.success_week')::date + 1
  );

  select * into second_override
  from public.create_labourer_production_wage_rate_override(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_rpc_labourer_id')::uuid,
    555,
    current_setting('atlas_test.success_week')::date + 4
  );

  select * into first_override
  from public.production_wage_rates
  where id = first_override.id;

  if first_override.effective_to
      <> current_setting('atlas_test.success_week')::date + 3
    or second_override.effective_from
      <> current_setting('atlas_test.success_week')::date + 4
    or second_override.effective_to is not null
    or exists (
      select 1 from public.production_crew_assignments
      where labourer_id = current_setting('atlas_test.override_rpc_labourer_id')::uuid
    ) then
    raise exception 'FAIL: crew-independent override track or history closure is incorrect';
  end if;

  perform pg_temp.expect_error(
    'duplicate crew-rate date is rejected',
    'P0001',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 535, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      (current_setting('atlas_test.success_week')::date + 3)::text
    )
  );
  perform pg_temp.expect_error(
    'unsafe backdated override is rejected',
    'P0001',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 560, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.override_rpc_labourer_id'),
      current_setting('atlas_test.success_week')
    )
  );
  perform pg_temp.expect_error(
    'non-positive production rate is rejected',
    '22023',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 0, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      (current_setting('atlas_test.success_week')::date + 6)::text
    )
  );
  perform pg_temp.expect_error(
    'infinite crew-rate date is rejected',
    '22023',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 610, %L::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      'infinity'
    )
  );
  perform pg_temp.expect_error(
    'infinite override date is rejected',
    '22023',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 560, %L::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.override_rpc_labourer_id'),
      '-infinity'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot mutate Factory B crew rate',
    '42501',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 710, date %L)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.factory_b_crew_id'),
      current_setting('atlas_test.success_week')
    )
  );

  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.default_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.move_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.move_labourer_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    current_setting('atlas_test.success_week')::date + 3
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.missing_rate_labourer_id')::uuid,
    current_setting('atlas_test.no_rate_crew_id')::uuid,
    current_setting('atlas_test.missing_week')::date - 7
  );

  select * into first_assignment
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );

  perform pg_temp.expect_error(
    'same currently open crew reassignment is rejected',
    'P0001',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.lifecycle_labourer_id'),
      current_setting('atlas_test.crew_a_id'),
      (current_setting('atlas_test.success_week')::date)::text
    )
  );

  select * into moved_assignment
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    current_setting('atlas_test.success_week')::date + 1
  );

  if not exists (
      select 1 from public.production_crew_assignments
      where id = first_assignment.id
        and effective_to = current_setting('atlas_test.success_week')::date
    )
    or moved_assignment.effective_from
      <> current_setting('atlas_test.success_week')::date + 1 then
    raise exception 'FAIL: crew move boundaries are incorrect';
  end if;

  select * into ended_assignment
  from public.end_labourer_production_crew_assignment(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 2
  );

  if ended_assignment.id <> moved_assignment.id
    or ended_assignment.effective_to
      <> current_setting('atlas_test.success_week')::date + 2 then
    raise exception 'FAIL: leave did not close the exact final assigned date';
  end if;

  perform pg_temp.expect_error(
    'overlapping return is rejected',
    'P0001',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.lifecycle_labourer_id'),
      current_setting('atlas_test.crew_b_id'),
      (current_setting('atlas_test.success_week')::date + 2)::text
    )
  );

  select * into returned_assignment
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    current_setting('atlas_test.success_week')::date + 4
  );

  if returned_assignment.production_crew_id
      <> current_setting('atlas_test.crew_b_id')::uuid
    or returned_assignment.effective_from
      <> current_setting('atlas_test.success_week')::date + 4
    or exists (
      select 1 from public.production_crew_assignments
      where labourer_id = current_setting('atlas_test.lifecycle_labourer_id')::uuid
        and effective_from <= current_setting('atlas_test.success_week')::date + 3
        and (effective_to is null or effective_to >= current_setting('atlas_test.success_week')::date + 3)
    ) then
    raise exception 'FAIL: return to same former crew or genuine leave gap is incorrect';
  end if;

  perform pg_temp.expect_error(
    'unsafe backdated crew move is rejected',
    'P0001',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.lifecycle_labourer_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.success_week')
    )
  );
  perform pg_temp.expect_error(
    'Factory A labourer cannot be assigned to Factory B crew',
    '42501',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.lifecycle_labourer_id'),
      current_setting('atlas_test.factory_b_crew_id'),
      (current_setting('atlas_test.success_week')::date + 8)::text
    )
  );

  perform set_config('atlas_test.crew_a_old_rate_id', crew_a_old_rate.id::text, true);
  perform set_config('atlas_test.crew_a_new_rate_id', crew_a_new_rate.id::text, true);
  perform set_config('atlas_test.crew_b_rate_id', crew_b_rate.id::text, true);
  perform set_config('atlas_test.first_override_id', first_override.id::text, true);
  perform set_config('atlas_test.second_override_id', second_override.id::text, true);

  raise notice 'PASS: rate tracks and crew lifecycle preserve boundaries, gaps, returns, isolation, and finite dates';
end;
$$;

reset role;

insert into public.production_wage_rates (
  id, factory_id, labourer_id, rate_per_1000_bricks,
  effective_from, effective_to
) values (
  current_setting('atlas_test.bounded_override_id')::uuid,
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.override_labourer_id')::uuid,
  540,
  current_setting('atlas_test.success_week')::date + 1,
  current_setting('atlas_test.success_week')::date + 2
);

update public.production_crews
set is_active = false
where id = current_setting('atlas_test.crew_a_id')::uuid;

do $$
declare
  routine record;
  routine_definition text;
  public_can_execute boolean;
  resolver_definition text;
  calculator_definition text;
  mud_definition text;
begin
  if (
    select count(*)
    from pg_catalog.pg_class
    where oid in (
      'public.production_crews'::regclass,
      'public.production_crew_assignments'::regclass,
      'public.production_wage_rates'::regclass,
      'public.production_weekly_earning_details'::regclass
    ) and relrowsecurity
  ) <> 4 then
    raise exception 'FAIL: a rework table is missing RLS';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint
    where (conrelid, conname) in (
      ('public.production_crews'::regclass, 'production_crews_id_factory_key'),
      ('public.production_crew_assignments'::regclass, 'production_crew_assignments_effective_dates_check'),
      ('public.production_crew_assignments'::regclass, 'production_crew_assignments_labourer_factory_fkey'),
      ('public.production_crew_assignments'::regclass, 'production_crew_assignments_crew_factory_fkey'),
      ('public.production_crew_assignments'::regclass, 'production_crew_assignments_no_overlapping_dates'),
      ('public.production_wage_rates'::regclass, 'production_wage_rates_exactly_one_scope_check'),
      ('public.production_wage_rates'::regclass, 'production_wage_rates_no_overlapping_crew_dates'),
      ('public.production_wage_rates'::regclass, 'production_wage_rates_no_overlapping_labourer_dates'),
      ('public.production_wage_rates'::regclass, 'production_wage_rates_crew_factory_fkey'),
      ('public.production_wage_rates'::regclass, 'production_wage_rates_labourer_factory_fkey'),
      ('public.production_weekly_earning_details'::regclass, 'production_weekly_earning_details_parent_work_date_key'),
      ('public.production_weekly_earning_details'::regclass, 'production_weekly_earning_details_parent_factory_fkey'),
      ('public.production_weekly_earning_details'::regclass, 'production_weekly_earning_details_rate_factory_fkey'),
      ('public.production_weekly_earning_details'::regclass, 'production_weekly_earning_details_crew_factory_fkey')
    )
  ) <> 14 then
    raise exception 'FAIL: a required rework integrity constraint is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = 'public.production_weekly_earning_details'::regclass
      and conname in (
        'production_weekly_earning_details_parent_factory_fkey',
        'production_weekly_earning_details_rate_factory_fkey',
        'production_weekly_earning_details_crew_factory_fkey'
      )
      and contype = 'f'
      and confdeltype = 'r'
  ) <> 3 then
    raise exception 'FAIL: detail snapshot foreign keys are not delete-restricting';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.weekly_earnings'::regclass
        and conname = 'weekly_earnings_legacy_rate_pair_check'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.weekly_earnings'::regclass
        and conname = 'weekly_earnings_mud_rate_required_check'
    ) then
    raise exception 'FAIL: legacy/mud weekly earning compatibility constraints are missing';
  end if;

  if has_table_privilege('authenticated', 'public.production_crew_assignments', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_crew_assignments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_crew_assignments', 'DELETE')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'DELETE')
    or has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'DELETE')
    or has_table_privilege('authenticated', 'public.weekly_earnings', 'INSERT')
    or has_table_privilege('authenticated', 'public.weekly_earnings', 'UPDATE')
    or has_table_privilege('authenticated', 'public.weekly_earnings', 'DELETE')
    or has_table_privilege('authenticated', 'public.withdrawals', 'INSERT')
    or has_table_privilege('authenticated', 'public.withdrawals', 'UPDATE')
    or has_table_privilege('authenticated', 'public.withdrawals', 'DELETE')
    or not has_table_privilege('authenticated', 'public.production_crew_assignments', 'SELECT')
    or not has_table_privilege('authenticated', 'public.production_wage_rates', 'SELECT')
    or not has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'SELECT') then
    raise exception 'FAIL: authenticated direct protected-table privileges are incorrect';
  end if;

  if has_table_privilege('anon', 'public.production_crews', 'SELECT')
    or has_table_privilege('anon', 'public.production_crew_assignments', 'SELECT')
    or has_table_privilege('anon', 'public.production_wage_rates', 'SELECT')
    or has_table_privilege('anon', 'public.production_weekly_earning_details', 'SELECT') then
    raise exception 'FAIL: anonymous rework table access is not denied';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'production_crew_assignments',
        'production_wage_rates',
        'production_weekly_earning_details'
      )
      and cmd <> 'SELECT'
  ) then
    raise exception 'FAIL: a protected history table has a write policy';
  end if;

  for routine in
    select procedure.oid, procedure.prosecdef, procedure.proconfig,
      procedure.proacl, procedure.proowner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.create_production_crew_wage_rate(uuid, uuid, numeric, date)'::regprocedure,
      'public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date)'::regprocedure,
      'public.assign_labourer_to_production_crew(uuid, uuid, uuid, date)'::regprocedure,
      'public.end_labourer_production_crew_assignment(uuid, uuid, date)'::regprocedure,
      'public.calculate_production_wages(uuid, date)'::regprocedure
    )
  loop
    select pg_get_functiondef(routine.oid) into routine_definition;
    select exists (
      select 1
      from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
      where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ) into public_can_execute;

    if not routine.prosecdef
      or not coalesce(routine.proconfig, array[]::text[])
        @> array['search_path=pg_catalog, public']
      or not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      or has_function_privilege('anon', routine.oid, 'EXECUTE')
      or public_can_execute then
      raise exception 'FAIL: client RPC security is incorrect for %', routine.oid::regprocedure;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.create_production_crew_wage_rate(uuid, uuid, numeric, date)'::regprocedure
  ) into routine_definition;
  if routine_definition not ilike '%isfinite(p_effective_from)%'
    or routine_definition not ilike '%production_crew_wage_rate:%'
    or routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition ilike '%isodow%' then
    raise exception 'FAIL: crew-rate RPC date or locking safety is incorrect';
  end if;

  select pg_get_functiondef(
    'public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date)'::regprocedure
  ) into routine_definition;
  if routine_definition not ilike '%isfinite(p_effective_from)%'
    or routine_definition not ilike '%labourer_production_wage_rate:%'
    or routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition ilike '%isodow%' then
    raise exception 'FAIL: override RPC date or locking safety is incorrect';
  end if;

  select pg_get_functiondef(
    'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure
  ) into resolver_definition;
  if (
      select procedure.prosecdef
        or procedure.provolatile <> 's'
        or not coalesce(procedure.proconfig, array[]::text[])
          @> array['search_path=pg_catalog, public']
      from pg_catalog.pg_proc as procedure
      where procedure.oid =
        'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure
    )
    or has_function_privilege('authenticated',
      'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon',
      'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure, 'EXECUTE')
    or resolver_definition ilike '%order by%'
    or resolver_definition ilike '%limit 1%'
    or resolver_definition ilike '%public.wage_rates%'
    or resolver_definition ilike '%is_active%'
    or resolver_definition ilike '%isodow%'
    or resolver_definition not ilike '%matching_rate_count > 1%'
    or resolver_definition not ilike '%matching_assignment_count > 1%' then
    raise exception 'FAIL: resolver exposure, precedence, or ambiguity safety is incorrect';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid, date)'::regprocedure
  ) into calculator_definition;
  if pg_get_function_result(
      'public.calculate_production_wages(uuid, date)'::regprocedure
    ) <> 'TABLE(labourers_calculated integer, rows_skipped integer)'
    or calculator_definition not ilike '%resolve_production_wage_rate%'
    or calculator_definition not ilike '%group by production_entries.production_date%'
    or calculator_definition not ilike '%production_weekly_earning_details%'
    or calculator_definition not ilike '%sum(details.amount)%'
    or calculator_definition not ilike '%pg_advisory_xact_lock%'
    or calculator_definition ilike '%public.wage_rates%'
    or calculator_definition ilike '%labourers.is_active%' then
    raise exception 'FAIL: production calculator cutover definition is incorrect';
  end if;

  select pg_get_functiondef(
    'public.assign_labourer_to_production_crew(uuid, uuid, uuid, date)'::regprocedure
  ) into routine_definition;
  if routine_definition not ilike '%isfinite(p_effective_from)%'
    or routine_definition not ilike '%effective_to = p_effective_from - 1%'
    or routine_definition not ilike '%production_crew_assignment:%'
    or routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition ilike '%delete from%' then
    raise exception 'FAIL: assignment RPC lifecycle or locking definition is incorrect';
  end if;

  select pg_get_functiondef(
    'public.end_labourer_production_crew_assignment(uuid, uuid, date)'::regprocedure
  ) into routine_definition;
  if routine_definition not ilike '%isfinite(p_effective_to)%'
    or routine_definition not ilike '%effective_to = p_effective_to%'
    or routine_definition not ilike '%production_crew_assignment:%'
    or routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition ilike '%insert into%' then
    raise exception 'FAIL: leave RPC lifecycle or locking definition is incorrect';
  end if;

  select pg_get_functiondef(
    'public.calculate_mud_supply_wages(uuid, uuid, date)'::regprocedure
  ) into mud_definition;
  if mud_definition ilike '%resolve_production_wage_rate%'
    or mud_definition ilike '%production_weekly_earning_details%'
    or mud_definition not ilike '%public.wage_rates%'
    or mud_definition not ilike '%wage_rate_id%'
    or mud_definition not ilike '%rate_used%' then
    raise exception 'FAIL: mud-supply calculator was changed by the production rework';
  end if;

  raise notice 'PASS: schema, RLS, grants, RPC hardening, resolver isolation, and calculator architecture are correct';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  default_labourer_id uuid := gen_random_uuid();
  override_labourer_id uuid := gen_random_uuid();
  override_rpc_labourer_id uuid := gen_random_uuid();
  move_labourer_id uuid := gen_random_uuid();
  lifecycle_labourer_id uuid := gen_random_uuid();
  missing_rate_labourer_id uuid := gen_random_uuid();
  legacy_labourer_id uuid := gen_random_uuid();
  factory_b_labourer_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  no_rate_crew_id uuid := gen_random_uuid();
  factory_b_crew_id uuid := gen_random_uuid();
  factory_b_rate_id uuid := gen_random_uuid();
  factory_b_assignment_id uuid := gen_random_uuid();
  bounded_override_id uuid := gen_random_uuid();
  legacy_production_rate_id uuid := gen_random_uuid();
  mud_rate_id uuid := gen_random_uuid();
  legacy_earning_id uuid := gen_random_uuid();
  labour_group_id uuid := gen_random_uuid();
  production_entry_to_change_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  success_week date;
  missing_week date;
  historical_week date;
begin
  current_week_start := business_today
    - (extract(isodow from business_today)::integer - 1);
  success_week := current_week_start - 28;
  missing_week := current_week_start - 14;
  historical_week := current_week_start - 42;

  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name) values
    (factory_a_id, format('Final production-rate audit Factory A %s', factory_a_id)),
    (factory_b_id, format('Final production-rate audit Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Final audit brick A'),
    (brick_b_id, factory_b_id, 'Final audit brick B');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values
    (default_labourer_id, factory_a_id, 'Final inactive historical worker', brick_a_id, false),
    (override_labourer_id, factory_a_id, 'Final override worker', brick_a_id, true),
    (override_rpc_labourer_id, factory_a_id, 'Final override RPC worker', brick_a_id, true),
    (move_labourer_id, factory_a_id, 'Final crew-move worker', brick_a_id, true),
    (lifecycle_labourer_id, factory_a_id, 'Final lifecycle worker', brick_a_id, true),
    (missing_rate_labourer_id, factory_a_id, 'Final missing-rate worker', brick_a_id, true),
    (legacy_labourer_id, factory_a_id, 'Final legacy worker', brick_a_id, true),
    (factory_b_labourer_id, factory_b_id, 'Final Factory B worker', brick_b_id, true);

  insert into public.labour_groups (
    id, factory_id, name, member_count, is_active
  ) values (labour_group_id, factory_a_id, 'Final mud group', 5, true);

  insert into public.production_crews (id, factory_id, name, is_active) values
    (crew_a_id, factory_a_id, 'Final Crew A', true),
    (crew_b_id, factory_a_id, 'Final Crew B', true),
    (no_rate_crew_id, factory_a_id, 'Final Crew Without Rate', true),
    (factory_b_crew_id, factory_b_id, 'Final Factory B Crew', true);

  insert into public.production_wage_rates (
    id, factory_id, production_crew_id, rate_per_1000_bricks, effective_from
  ) values (
    factory_b_rate_id, factory_b_id, factory_b_crew_id, 700, success_week - 7
  );

  insert into public.production_crew_assignments (
    id, factory_id, labourer_id, production_crew_id, effective_from
  ) values (
    factory_b_assignment_id, factory_b_id, factory_b_labourer_id,
    factory_b_crew_id, success_week - 7
  );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values
    (legacy_production_rate_id, factory_a_id, 'production', 999, historical_week),
    (mud_rate_id, factory_a_id, 'mud_supply', 200, historical_week);

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    legacy_earning_id, factory_a_id, legacy_labourer_id, historical_week,
    1000, legacy_production_rate_id, 999, 999
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (production_entry_to_change_id, factory_a_id, default_labourer_id, brick_a_id, success_week, 10000),
    (gen_random_uuid(), factory_a_id, default_labourer_id, brick_a_id, success_week + 4, 10000),
    (gen_random_uuid(), factory_a_id, override_labourer_id, brick_a_id, success_week, 10000),
    (gen_random_uuid(), factory_a_id, override_labourer_id, brick_a_id, success_week + 1, 10000),
    (gen_random_uuid(), factory_a_id, override_labourer_id, brick_a_id, success_week + 3, 10000),
    (gen_random_uuid(), factory_a_id, move_labourer_id, brick_a_id, success_week + 1, 10000),
    (gen_random_uuid(), factory_a_id, move_labourer_id, brick_a_id, success_week + 4, 10000),
    (gen_random_uuid(), factory_a_id, default_labourer_id, brick_a_id, missing_week, 1000),
    (gen_random_uuid(), factory_a_id, missing_rate_labourer_id, brick_a_id, missing_week + 1, 1000);

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_test.default_labourer_id', default_labourer_id::text, true);
  perform set_config('atlas_test.override_labourer_id', override_labourer_id::text, true);
  perform set_config('atlas_test.override_rpc_labourer_id', override_rpc_labourer_id::text, true);
  perform set_config('atlas_test.move_labourer_id', move_labourer_id::text, true);
  perform set_config('atlas_test.lifecycle_labourer_id', lifecycle_labourer_id::text, true);
  perform set_config('atlas_test.missing_rate_labourer_id', missing_rate_labourer_id::text, true);
  perform set_config('atlas_test.legacy_labourer_id', legacy_labourer_id::text, true);
  perform set_config('atlas_test.factory_b_labourer_id', factory_b_labourer_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.no_rate_crew_id', no_rate_crew_id::text, true);
  perform set_config('atlas_test.factory_b_crew_id', factory_b_crew_id::text, true);
  perform set_config('atlas_test.factory_b_rate_id', factory_b_rate_id::text, true);
  perform set_config('atlas_test.factory_b_assignment_id', factory_b_assignment_id::text, true);
  perform set_config('atlas_test.bounded_override_id', bounded_override_id::text, true);
  perform set_config('atlas_test.legacy_production_rate_id', legacy_production_rate_id::text, true);
  perform set_config('atlas_test.mud_rate_id', mud_rate_id::text, true);
  perform set_config('atlas_test.legacy_earning_id', legacy_earning_id::text, true);
  perform set_config('atlas_test.labour_group_id', labour_group_id::text, true);
  perform set_config('atlas_test.production_entry_to_change_id', production_entry_to_change_id::text, true);
  perform set_config('atlas_test.success_week', success_week::text, true);
  perform set_config('atlas_test.missing_week', missing_week::text, true);
  perform set_config('atlas_test.historical_week', historical_week::text, true);
  perform set_config('atlas_test.current_week_start', current_week_start::text, true);

  raise notice 'PASS: rollback-only Factory A/Factory B, legacy, mud, production, and missing-rate fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  old_rate public.production_wage_rates%rowtype;
  new_rate public.production_wage_rates%rowtype;
  crew_b_rate public.production_wage_rates%rowtype;
  lifecycle_move public.production_crew_assignments%rowtype;
begin
  select * into old_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    520,
    current_setting('atlas_test.success_week')::date - 7
  );
  select * into new_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    530,
    current_setting('atlas_test.success_week')::date + 3
  );
  select * into crew_b_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    600,
    current_setting('atlas_test.success_week')::date - 7
  );

  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.default_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.move_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.move_labourer_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    current_setting('atlas_test.success_week')::date + 3
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.missing_rate_labourer_id')::uuid,
    current_setting('atlas_test.no_rate_crew_id')::uuid,
    current_setting('atlas_test.missing_week')::date - 7
  );

  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    current_setting('atlas_test.success_week')::date - 7
  );
  select * into lifecycle_move
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    current_setting('atlas_test.success_week')::date + 1
  );
  perform public.end_labourer_production_crew_assignment(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 2
  );
  perform public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.lifecycle_labourer_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    current_setting('atlas_test.success_week')::date + 4
  );

  perform set_config('atlas_test.crew_a_old_rate_id', old_rate.id::text, true);
  perform set_config('atlas_test.crew_a_new_rate_id', new_rate.id::text, true);
  perform set_config('atlas_test.crew_b_rate_id', crew_b_rate.id::text, true);
end;
$$;

reset role;

insert into public.production_wage_rates (
  id, factory_id, labourer_id, rate_per_1000_bricks,
  effective_from, effective_to
) values (
  current_setting('atlas_test.bounded_override_id')::uuid,
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.override_labourer_id')::uuid,
  540,
  current_setting('atlas_test.success_week')::date + 1,
  current_setting('atlas_test.success_week')::date + 2
);

update public.production_crews set is_active = false
where id = current_setting('atlas_test.crew_a_id')::uuid;

do $$
declare
  resolved record;
begin
  select * into resolved from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.default_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );
  if resolved.rate_source <> 'crew_default'
    or resolved.rate_per_1000_bricks <> 520
    or resolved.production_crew_id <> current_setting('atlas_test.crew_a_id')::uuid then
    raise exception 'FAIL: inactive historical labourer/crew default did not resolve';
  end if;

  select * into resolved from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 1
  );
  if resolved.rate_source <> 'individual_override'
    or resolved.rate_per_1000_bricks <> 540
    or resolved.production_crew_id is not null then
    raise exception 'FAIL: individual override did not win over crew default';
  end if;

  select * into resolved from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 3
  );
  if resolved.rate_source <> 'crew_default'
    or resolved.rate_per_1000_bricks <> 530 then
    raise exception 'FAIL: expired override did not fall back to dated crew rate';
  end if;

  select * into resolved from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.move_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 4
  );
  if resolved.production_crew_id <> current_setting('atlas_test.crew_b_id')::uuid
    or resolved.rate_per_1000_bricks <> 600 then
    raise exception 'FAIL: historical crew move did not resolve by work date';
  end if;

  perform pg_temp.expect_error(
    'leave gap has no production crew assignment',
    'P2402',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.lifecycle_labourer_id'),
      (current_setting('atlas_test.success_week')::date + 3)::text
    )
  );
  perform pg_temp.expect_error(
    'missing crew default fails explicitly',
    'P2403',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.missing_rate_labourer_id'),
      current_setting('atlas_test.missing_week')
    )
  );
  perform pg_temp.expect_error(
    'cross-factory labourer resolution fails',
    'P2401',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.factory_b_labourer_id'),
      current_setting('atlas_test.success_week')
    )
  );

  raise notice 'PASS: authoritative resolver precedence, fallback, move, inactivity, gaps, and failures are correct';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  result record;
  parent_record public.weekly_earnings%rowtype;
  mud_result record;
  mud_parent public.weekly_earnings%rowtype;
  withdrawal_result record;
  affected_rows integer;
begin
  select * into result from public.calculate_production_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );

  if result.labourers_calculated <> 3 or result.rows_skipped <> 0 then
    raise exception 'FAIL: successful production calculation did not create three parents';
  end if;

  if (
      select count(*) from public.weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = current_setting('atlas_test.success_week')::date
        and labourer_id is not null
    ) <> 3
    or (
      select count(*)
      from public.production_weekly_earning_details as details
      join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
      where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and earnings.week_start = current_setting('atlas_test.success_week')::date
    ) <> 7 then
    raise exception 'FAIL: calculator did not create one parent and one detail per actual work date';
  end if;

  if exists (
    select 1 from public.weekly_earnings as earnings
    where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and earnings.week_start = current_setting('atlas_test.success_week')::date
      and earnings.labourer_id is not null
      and (
        earnings.wage_rate_id is not null
        or earnings.rate_used is not null
        or earnings.quantity_used <> (
          select sum(details.quantity_used)::integer
          from public.production_weekly_earning_details as details
          where details.weekly_earning_id = earnings.id
        )
        or earnings.amount <> (
          select sum(details.amount)
          from public.production_weekly_earning_details as details
          where details.weekly_earning_id = earnings.id
        )
      )
  ) then
    raise exception 'FAIL: production parent legacy nullability or exact detail equality is incorrect';
  end if;

  select * into parent_record from public.weekly_earnings
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and labourer_id = current_setting('atlas_test.default_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;
  if parent_record.quantity_used <> 20000 or parent_record.amount <> 10500
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date
        and quantity_used = 10000 and rate_per_1000_bricks = 520
        and rate_source = 'crew_default'
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and amount = 5200
    )
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date + 4
        and quantity_used = 10000 and rate_per_1000_bricks = 530
        and amount = 5300
    ) then
    raise exception 'FAIL: mid-week rate change snapshots are incorrect';
  end if;
  perform set_config('atlas_test.default_parent_id', parent_record.id::text, true);

  select * into parent_record from public.weekly_earnings
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and labourer_id = current_setting('atlas_test.override_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;
  if parent_record.amount <> 15900
    or (
      select count(*) from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and rate_source = 'individual_override'
        and production_wage_rate_id = current_setting('atlas_test.bounded_override_id')::uuid
        and production_crew_id is null
        and rate_per_1000_bricks = 540
    ) <> 1 then
    raise exception 'FAIL: multi-rate override precedence/fallback snapshots are incorrect';
  end if;

  select * into parent_record from public.weekly_earnings
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid
    and labourer_id = current_setting('atlas_test.move_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;
  if parent_record.amount <> 11200
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date + 1
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and rate_per_1000_bricks = 520 and amount = 5200
    )
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date + 4
        and production_crew_id = current_setting('atlas_test.crew_b_id')::uuid
        and rate_per_1000_bricks = 600 and amount = 6000
    ) then
    raise exception 'FAIL: mid-week crew move snapshots are incorrect';
  end if;

  select * into result from public.calculate_production_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );
  if result.labourers_calculated <> 0 or result.rows_skipped <> 3 then
    raise exception 'FAIL: idempotent production rerun did not skip three locked parents';
  end if;

  perform pg_temp.expect_error(
    'missing-rate calculation fails atomically',
    'P2403',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.missing_week')
    )
  );
  if exists (
    select 1 from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and week_start = current_setting('atlas_test.missing_week')::date
      and labourer_id is not null
  ) then
    raise exception 'FAIL: failed calculation left a partial production parent';
  end if;

  perform pg_temp.expect_error(
    'non-Monday production week is rejected',
    '22023',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      (current_setting('atlas_test.success_week')::date + 1)::text
    )
  );
  perform pg_temp.expect_error(
    'incomplete production week is rejected',
    'P0001',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.current_week_start')
    )
  );

  select * into withdrawal_result from public.create_labourer_withdrawal(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.default_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 6,
    500
  );
  if withdrawal_result.available_balance <> 10000 then
    raise exception 'FAIL: partial withdrawal did not use the multi-rate parent amount';
  end if;
  select * into withdrawal_result from public.create_labourer_withdrawal(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.default_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 6,
    10000
  );
  if withdrawal_result.available_balance <> 0 then
    raise exception 'FAIL: full withdrawal did not consume the carry-forward balance';
  end if;
  perform pg_temp.expect_error(
    'over-withdrawal is rejected after full withdrawal',
    'P0001',
    format(
      'select * from public.create_labourer_withdrawal(%L::uuid, %L::uuid, date %L, 1)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.default_labourer_id'),
      (current_setting('atlas_test.success_week')::date + 6)::text
    )
  );
  if (
    select count(*) from public.withdrawals
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.default_labourer_id')::uuid
  ) <> 2 then
    raise exception 'FAIL: withdrawal history does not contain the partial and full withdrawals';
  end if;

  select * into mud_result from public.calculate_mud_supply_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labour_group_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );
  select * into mud_parent from public.weekly_earnings where id = mud_result.weekly_earning_id;
  if mud_result.groups_calculated <> 1 or mud_result.rows_skipped <> 0
    or mud_parent.quantity_used <> 70000
    or mud_parent.wage_rate_id <> current_setting('atlas_test.mud_rate_id')::uuid
    or mud_parent.rate_used <> 200
    or mud_parent.amount <> 14000
    or exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = mud_parent.id
    )
    or (select member_count from public.labour_groups
        where id = current_setting('atlas_test.labour_group_id')::uuid) <> 5 then
    raise exception 'FAIL: mud-supply calculation or member-count behavior regressed';
  end if;

  perform pg_temp.expect_error(
    'Factory A cannot calculate Factory B production',
    '42501',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.success_week')
    )
  );

  if exists (
      select 1 from public.production_crews
      where factory_id = current_setting('atlas_test.factory_b_id')::uuid
    )
    or exists (
      select 1 from public.production_wage_rates
      where factory_id = current_setting('atlas_test.factory_b_id')::uuid
    )
    or exists (
      select 1 from public.production_crew_assignments
      where factory_id = current_setting('atlas_test.factory_b_id')::uuid
    ) then
    raise exception 'FAIL: Factory A can read Factory B rework rows';
  end if;

  update public.production_crews
  set name = 'Factory B write should be invisible'
  where id = current_setting('atlas_test.factory_b_crew_id')::uuid;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'FAIL: Factory A updated Factory B crew';
  end if;

  perform pg_temp.expect_error(
    'authenticated direct assignment insert is denied',
    '42501',
    format(
      'insert into public.production_crew_assignments (factory_id, labourer_id, production_crew_id, effective_from) values (%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.override_rpc_labourer_id'),
      current_setting('atlas_test.crew_a_id'),
      (current_setting('atlas_test.success_week')::date + 10)::text
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct production-rate update is denied',
    '42501',
    format(
      'update public.production_wage_rates set rate_per_1000_bricks = 1 where id = %L::uuid',
      current_setting('atlas_test.crew_a_old_rate_id')
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct detail update is denied',
    '42501',
    format(
      'update public.production_weekly_earning_details set amount = 0 where weekly_earning_id = %L::uuid',
      current_setting('atlas_test.default_parent_id')
    )
  );

  raise notice 'PASS: calculation, exact snapshots, atomicity, idempotency, withdrawals, mud, and Factory A/B isolation are correct';
end;
$$;

reset role;

set local role anon;
do $$
begin
  perform pg_temp.expect_error(
    'anonymous production crew read is denied', '42501',
    'select * from public.production_crews limit 1'
  );
  perform pg_temp.expect_error(
    'anonymous production rate RPC execution is denied', '42501',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 500, current_date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id')
    )
  );
  perform pg_temp.expect_error(
    'anonymous calculator execution is denied', '42501',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.success_week')
    )
  );
end;
$$;
reset role;

create temporary table final_locked_parents on commit drop as
select earnings.* from public.weekly_earnings as earnings
where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
  and earnings.week_start = current_setting('atlas_test.success_week')::date
  and earnings.labourer_id is not null;

create temporary table final_locked_details on commit drop as
select details.*
from public.production_weekly_earning_details as details
join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
  and earnings.week_start = current_setting('atlas_test.success_week')::date;

update public.production_entries set quantity = 99999
where id = current_setting('atlas_test.production_entry_to_change_id')::uuid;
update public.production_wage_rates set rate_per_1000_bricks = 999
where id = current_setting('atlas_test.crew_a_old_rate_id')::uuid;
update public.production_wage_rates set rate_per_1000_bricks = 777
where id = current_setting('atlas_test.bounded_override_id')::uuid;
update public.production_crew_assignments
set production_crew_id = current_setting('atlas_test.crew_b_id')::uuid
where labourer_id = current_setting('atlas_test.default_labourer_id')::uuid;
update public.labourers set is_active = false
where id = current_setting('atlas_test.override_labourer_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);
do $$
declare
  result record;
begin
  select * into result from public.calculate_production_wages(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );
  if result.labourers_calculated <> 0 or result.rows_skipped <> 3 then
    raise exception 'FAIL: source mutations changed idempotent locked-parent behavior';
  end if;
end;
$$;
reset role;

do $$
begin
  if exists (
      (select * from public.weekly_earnings
       where factory_id = current_setting('atlas_test.factory_a_id')::uuid
         and week_start = current_setting('atlas_test.success_week')::date
         and labourer_id is not null
       except select * from final_locked_parents)
      union all
      (select * from final_locked_parents
       except select * from public.weekly_earnings
       where factory_id = current_setting('atlas_test.factory_a_id')::uuid
         and week_start = current_setting('atlas_test.success_week')::date
         and labourer_id is not null)
    )
    or exists (
      (select details.*
       from public.production_weekly_earning_details as details
       join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
       where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
         and earnings.week_start = current_setting('atlas_test.success_week')::date
       except select * from final_locked_details)
      union all
      (select * from final_locked_details
       except select details.*
       from public.production_weekly_earning_details as details
       join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
       where earnings.factory_id = current_setting('atlas_test.factory_a_id')::uuid
         and earnings.week_start = current_setting('atlas_test.success_week')::date)
    ) then
    raise exception 'FAIL: live quantity, assignment, activity, rate, or override changes altered locked snapshots';
  end if;

  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.legacy_earning_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and wage_rate_id = current_setting('atlas_test.legacy_production_rate_id')::uuid
      and rate_used = 999 and amount = 999 and quantity_used = 1000
  ) or not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_test.legacy_production_rate_id')::uuid
      and applies_to = 'production' and rate_per_1000_bricks = 999
  ) then
    raise exception 'FAIL: legacy production earning/rate history was rewritten';
  end if;

  perform pg_temp.expect_error(
    'snapshotted production rate cannot be deleted', '23503',
    format('delete from public.production_wage_rates where id = %L::uuid',
      current_setting('atlas_test.crew_a_old_rate_id'))
  );
  perform pg_temp.expect_error(
    'snapshotted production crew cannot be deleted', '23503',
    format('delete from public.production_crews where id = %L::uuid',
      current_setting('atlas_test.crew_a_id'))
  );
  perform pg_temp.expect_error(
    'production parent with details cannot be deleted', '23503',
    format('delete from public.weekly_earnings where id = %L::uuid',
      current_setting('atlas_test.default_parent_id'))
  );

  raise notice 'PASS: locked parent/detail snapshots, restrictive deletes, and legacy history remain immutable';
end;
$$;

rollback;
