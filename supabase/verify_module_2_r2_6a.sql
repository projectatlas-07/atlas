-- Atlas Module 2 Rework R2.6A controlled crew-assignment lifecycle verifier.
-- Run after applying 20260816000006_create_production_crew_assignment_rpcs.sql.
-- It requires one existing public.factory_users row. All fixtures and mapping
-- changes are discarded by the final rollback.

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
  assign_definition text;
  end_definition text;
  resolver_definition text;
  public_can_execute boolean;
begin
  for routine in
    select procedure.oid, procedure.prosecdef, procedure.proconfig,
      procedure.proacl, procedure.proowner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.assign_labourer_to_production_crew(uuid, uuid, uuid, date)'::regprocedure,
      'public.end_labourer_production_crew_assignment(uuid, uuid, date)'::regprocedure
    )
  loop
    select pg_get_functiondef(routine.oid) into routine_definition;

    select exists (
      select 1
      from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
      where privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) into public_can_execute;

    if not routine.prosecdef
      or not coalesce(routine.proconfig, array[]::text[])
        @> array['search_path=pg_catalog, public']
      or not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      or has_function_privilege('anon', routine.oid, 'EXECUTE')
      or public_can_execute then
      raise exception 'FAIL: % security or execution privileges are incorrect',
        routine.oid::regprocedure;
    end if;

    if routine_definition not ilike '%pg_advisory_xact_lock%'
      or routine_definition not ilike '%production_crew_assignment:%'
      or routine_definition ilike '%isodow%'
      or routine_definition ilike '%resolve_production_wage_rate%'
      or routine_definition ilike '%production_entries%'
      or routine_definition ilike '%production_wage_rates%'
      or routine_definition ilike '%weekly_earnings%'
      or routine_definition ilike '%withdrawals%' then
      raise exception 'FAIL: % locking or non-interference definition is incorrect',
        routine.oid::regprocedure;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.assign_labourer_to_production_crew(uuid, uuid, uuid, date)'::regprocedure
  ) into assign_definition;

  select pg_get_functiondef(
    'public.end_labourer_production_crew_assignment(uuid, uuid, date)'::regprocedure
  ) into end_definition;

  select pg_get_functiondef(
    'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure
  ) into resolver_definition;

  if assign_definition not ilike '%effective_to = p_effective_from - 1%'
    or assign_definition not ilike '%latest_assignment.effective_to is null%'
    or assign_definition not ilike '%latest assignment end%'
    or assign_definition ilike '%delete from%'
    or end_definition not ilike '%effective_to = p_effective_to%'
    or end_definition not ilike '%effective_to is null%'
    or end_definition ilike '%insert into%'
    or resolver_definition ilike '%assign_labourer_to_production_crew%'
    or resolver_definition ilike '%end_labourer_production_crew_assignment%' then
    raise exception 'FAIL: lifecycle append/close rules or resolver isolation are incorrect';
  end if;

  if has_table_privilege('authenticated', 'public.production_crew_assignments', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_crew_assignments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_crew_assignments', 'DELETE')
    or not has_table_privilege('authenticated', 'public.production_crew_assignments', 'SELECT') then
    raise exception 'FAIL: direct authenticated assignment privileges are incorrect';
  end if;

  if has_table_privilege('anon', 'public.production_crew_assignments', 'SELECT')
    or has_table_privilege('anon', 'public.production_crew_assignments', 'INSERT')
    or has_table_privilege('anon', 'public.production_crew_assignments', 'UPDATE')
    or has_table_privilege('anon', 'public.production_crew_assignments', 'DELETE') then
    raise exception 'FAIL: anonymous assignment privileges are too broad';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'production_crew_assignments'
      and cmd <> 'SELECT'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'production_crew_assignments'
      and cmd = 'SELECT'
      and qual ilike '%factory_users%'
      and qual ilike '%auth.uid()%'
      and qual ilike '%is_active%'
  ) then
    raise exception 'FAIL: assignment RLS is not read-only and factory-scoped';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.production_crew_assignments'::regclass
      and conname = 'production_crew_assignments_no_overlapping_dates'
      and contype = 'x'
  ) then
    raise exception 'FAIL: R2.1 assignment overlap exclusion is missing';
  end if;

  raise notice 'PASS: RPC hardening, shared labourer lock, direct-write cutover, RLS, exclusion safety, and resolver isolation are correct';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_type_a_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  labourer_a_id uuid := gen_random_uuid();
  preserved_labourer_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  factory_b_crew_id uuid := gen_random_uuid();
  crew_a_rate_id uuid := gen_random_uuid();
  crew_b_rate_id uuid := gen_random_uuid();
  factory_b_rate_id uuid := gen_random_uuid();
  factory_b_assignment_id uuid := gen_random_uuid();
  production_entry_id uuid := gen_random_uuid();
  weekly_earning_id uuid := gen_random_uuid();
  earning_detail_id uuid := gen_random_uuid();
  withdrawal_id uuid := gen_random_uuid();
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
    (factory_a_id, format('R2.6A verification Factory A %s', factory_a_id)),
    (factory_b_id, format('R2.6A verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'R2.6A brick A'),
    (brick_type_b_id, factory_b_id, 'R2.6A brick B');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values
    (labourer_a_id, factory_a_id, 'R2.6A inactive lifecycle worker', brick_type_a_id, false),
    (preserved_labourer_id, factory_a_id, 'R2.6A preserved worker', brick_type_a_id, true),
    (labourer_b_id, factory_b_id, 'R2.6A Factory B worker', brick_type_b_id, true);

  insert into public.production_crews (id, factory_id, name, is_active)
  values
    (crew_a_id, factory_a_id, 'R2.6A Crew A', true),
    (crew_b_id, factory_a_id, 'R2.6A Crew B', true),
    (factory_b_crew_id, factory_b_id, 'R2.6A Factory B Crew', true);

  insert into public.production_wage_rates (
    id, factory_id, production_crew_id, rate_per_1000_bricks, effective_from
  ) values
    (crew_a_rate_id, factory_a_id, crew_a_id, 520, date '2026-01-01'),
    (crew_b_rate_id, factory_a_id, crew_b_id, 610, date '2026-01-01'),
    (factory_b_rate_id, factory_b_id, factory_b_crew_id, 700, date '2026-01-01');

  insert into public.production_crew_assignments (
    id, factory_id, labourer_id, production_crew_id, effective_from
  ) values (
    factory_b_assignment_id, factory_b_id, labourer_b_id,
    factory_b_crew_id, date '2026-08-01'
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values (
    production_entry_id, factory_a_id, labourer_a_id,
    brick_type_a_id, date '2026-08-10', 1000
  );

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    weekly_earning_id, factory_a_id, preserved_labourer_id,
    date '2026-08-03', 1000, null, null, 520
  );

  insert into public.production_weekly_earning_details (
    id, factory_id, weekly_earning_id, work_date, quantity_used,
    production_wage_rate_id, rate_per_1000_bricks, rate_source,
    production_crew_id, amount
  ) values (
    earning_detail_id, factory_a_id, weekly_earning_id,
    date '2026-08-04', 1000, crew_a_rate_id, 520,
    'crew_default', crew_a_id, 520
  );

  insert into public.withdrawals (
    id, factory_id, labourer_id, withdrawal_date, amount
  ) values (
    withdrawal_id, factory_a_id, preserved_labourer_id,
    date '2026-08-10', 100
  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.preserved_labourer_id', preserved_labourer_id::text, true);
  perform set_config('atlas_test.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.factory_b_crew_id', factory_b_crew_id::text, true);
  perform set_config('atlas_test.crew_a_rate_id', crew_a_rate_id::text, true);
  perform set_config('atlas_test.crew_b_rate_id', crew_b_rate_id::text, true);
  perform set_config('atlas_test.factory_b_rate_id', factory_b_rate_id::text, true);
  perform set_config('atlas_test.factory_b_assignment_id', factory_b_assignment_id::text, true);
  perform set_config('atlas_test.production_entry_id', production_entry_id::text, true);
  perform set_config('atlas_test.weekly_earning_id', weekly_earning_id::text, true);
  perform set_config('atlas_test.earning_detail_id', earning_detail_id::text, true);
  perform set_config('atlas_test.withdrawal_id', withdrawal_id::text, true);

  raise notice 'PASS: rollback-only two-factory lifecycle and preservation fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  first_assignment public.production_crew_assignments%rowtype;
  moved_assignment public.production_crew_assignments%rowtype;
  ended_assignment public.production_crew_assignments%rowtype;
  returned_assignment public.production_crew_assignments%rowtype;
begin
  select * into first_assignment
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-08-01'
  );

  if first_assignment.factory_id <> current_setting('atlas_test.factory_a_id')::uuid
    or first_assignment.labourer_id <> current_setting('atlas_test.labourer_a_id')::uuid
    or first_assignment.production_crew_id <> current_setting('atlas_test.crew_a_id')::uuid
    or first_assignment.effective_from <> date '2026-08-01'
    or first_assignment.effective_to is not null then
    raise exception 'FAIL: first assignment is incorrect';
  end if;

  perform pg_temp.expect_error(
    'Factory A labourer cannot use Factory B crew',
    '42501',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.factory_b_crew_id'),
      '2026-08-15'
    )
  );

  perform pg_temp.expect_error(
    'Factory B labourer cannot be mutated through Factory A',
    '42501',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_b_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-15'
    )
  );

  perform pg_temp.expect_error(
    'Factory A user cannot end Factory B assignment',
    '42501',
    format(
      'select public.end_labourer_production_crew_assignment(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.labourer_b_id'),
      '2026-08-20'
    )
  );

  select * into moved_assignment
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    date '2026-08-15'
  );

  if not exists (
      select 1 from public.production_crew_assignments
      where id = first_assignment.id
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and effective_from = date '2026-08-01'
        and effective_to = date '2026-08-14'
    )
    or moved_assignment.production_crew_id <> current_setting('atlas_test.crew_b_id')::uuid
    or moved_assignment.effective_from <> date '2026-08-15'
    or moved_assignment.effective_to is not null then
    raise exception 'FAIL: crew move did not close Crew A and open Crew B exactly';
  end if;

  perform pg_temp.expect_error(
    'same open crew reassignment is rejected',
    'P0001',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-08-25'
    )
  );

  perform pg_temp.expect_error(
    'unsafe backdated move is rejected',
    'P0001',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'leave before open assignment start is rejected',
    'P0001',
    format(
      'select public.end_labourer_production_crew_assignment(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-14'
    )
  );

  select * into ended_assignment
  from public.end_labourer_production_crew_assignment(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-20'
  );

  if ended_assignment.id <> moved_assignment.id
    or ended_assignment.effective_from <> date '2026-08-15'
    or ended_assignment.effective_to <> date '2026-08-20' then
    raise exception 'FAIL: leave did not close the exact open assignment date';
  end if;

  perform pg_temp.expect_error(
    'leave with no open assignment is rejected',
    'P0001',
    format(
      'select public.end_labourer_production_crew_assignment(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-25'
    )
  );

  perform pg_temp.expect_error(
    'overlapping return date is rejected',
    'P0001',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-08-20'
    )
  );

  select * into returned_assignment
  from public.assign_labourer_to_production_crew(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    current_setting('atlas_test.crew_b_id')::uuid,
    date '2026-09-05'
  );

  if returned_assignment.production_crew_id <> current_setting('atlas_test.crew_b_id')::uuid
    or returned_assignment.effective_from <> date '2026-09-05'
    or returned_assignment.effective_to is not null
    or (
      select count(*)
      from public.production_crew_assignments
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
    ) <> 3
    or exists (
      select 1
      from public.production_crew_assignments
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
        and effective_from <= date '2026-08-25'
        and (effective_to is null or effective_to >= date '2026-08-25')
    ) then
    raise exception 'FAIL: same-former-crew return or preserved assignment gap is incorrect';
  end if;

  perform pg_temp.expect_error(
    'missing assignment effective_from is rejected',
    '22023',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, null::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'missing leave effective_to is rejected',
    '22023',
    format(
      'select public.end_labourer_production_crew_assignment(%L::uuid, %L::uuid, null::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id')
    )
  );

  perform set_config('atlas_test.first_assignment_id', first_assignment.id::text, true);
  perform set_config('atlas_test.moved_assignment_id', moved_assignment.id::text, true);
  perform set_config('atlas_test.returned_assignment_id', returned_assignment.id::text, true);

  raise notice 'PASS: first assignment, move, exact leave, preserved gap, same-crew return, and backdated safety are correct';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'direct authenticated assignment INSERT is denied',
    '42501',
    format(
      'insert into public.production_crew_assignments (factory_id, labourer_id, production_crew_id, effective_from) values (%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.preserved_labourer_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-01'
    )
  );

  perform pg_temp.expect_error(
    'direct authenticated assignment UPDATE is denied',
    '42501',
    'update public.production_crew_assignments set effective_to = effective_to'
  );

  perform pg_temp.expect_error(
    'direct authenticated assignment DELETE is denied',
    '42501',
    'delete from public.production_crew_assignments'
  );

  if (
    select count(*)
    from public.production_crew_assignments
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) <> 0 then
    raise exception 'FAIL: Factory A can read Factory B assignments';
  end if;

  raise notice 'PASS: direct assignment writes are denied and authenticated reads are factory-isolated';
end;
$$;

reset role;

do $$
declare
  resolved record;
begin
  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-10'
  );

  if resolved.production_crew_id <> current_setting('atlas_test.crew_a_id')::uuid
    or resolved.production_wage_rate_id <> current_setting('atlas_test.crew_a_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 520 then
    raise exception 'FAIL: pre-move date did not resolve historical Crew A';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-16'
  );

  if resolved.production_crew_id <> current_setting('atlas_test.crew_b_id')::uuid
    or resolved.production_wage_rate_id <> current_setting('atlas_test.crew_b_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 610 then
    raise exception 'FAIL: post-move date did not resolve Crew B';
  end if;

  perform pg_temp.expect_error(
    'leave gap remains missing to the resolver',
    'P2402',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-25'
    )
  );

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-09-05'
  );

  if resolved.production_crew_id <> current_setting('atlas_test.crew_b_id')::uuid
    or resolved.production_wage_rate_id <> current_setting('atlas_test.crew_b_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 610 then
    raise exception 'FAIL: return date did not resolve returned Crew B';
  end if;

  raise notice 'PASS: unchanged R2.4 resolver handles old crew, moved crew, leave gap, and returned crew';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous assign RPC execution is denied',
    '42501',
    format(
      'select public.assign_labourer_to_production_crew(%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-10-01'
    )
  );

  perform pg_temp.expect_error(
    'anonymous leave RPC execution is denied',
    '42501',
    format(
      'select public.end_labourer_production_crew_assignment(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-10-01'
    )
  );
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.production_entries
    where id = current_setting('atlas_test.production_entry_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
      and production_date = date '2026-08-10'
      and quantity = 1000
  ) then
    raise exception 'FAIL: production entry was modified or deleted';
  end if;

  if not exists (
      select 1 from public.production_wage_rates
      where id = current_setting('atlas_test.crew_a_rate_id')::uuid
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and rate_per_1000_bricks = 520
        and effective_from = date '2026-01-01'
        and effective_to is null
    )
    or not exists (
      select 1 from public.production_wage_rates
      where id = current_setting('atlas_test.crew_b_rate_id')::uuid
        and production_crew_id = current_setting('atlas_test.crew_b_id')::uuid
        and rate_per_1000_bricks = 610
        and effective_from = date '2026-01-01'
        and effective_to is null
    ) then
    raise exception 'FAIL: production wage rates were modified or deleted';
  end if;

  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.weekly_earning_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.preserved_labourer_id')::uuid
      and week_start = date '2026-08-03'
      and quantity_used = 1000
      and wage_rate_id is null
      and rate_used is null
      and amount = 520
  ) or not exists (
    select 1 from public.production_weekly_earning_details
    where id = current_setting('atlas_test.earning_detail_id')::uuid
      and weekly_earning_id = current_setting('atlas_test.weekly_earning_id')::uuid
      and work_date = date '2026-08-04'
      and quantity_used = 1000
      and production_wage_rate_id = current_setting('atlas_test.crew_a_rate_id')::uuid
      and rate_per_1000_bricks = 520
      and rate_source = 'crew_default'
      and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
      and amount = 520
  ) then
    raise exception 'FAIL: weekly earning or production detail was modified or deleted';
  end if;

  if not exists (
    select 1 from public.withdrawals
    where id = current_setting('atlas_test.withdrawal_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.preserved_labourer_id')::uuid
      and withdrawal_date = date '2026-08-10'
      and amount = 100
  ) then
    raise exception 'FAIL: withdrawal was modified or deleted';
  end if;

  if not exists (
    select 1 from public.production_crew_assignments
    where id = current_setting('atlas_test.factory_b_assignment_id')::uuid
      and factory_id = current_setting('atlas_test.factory_b_id')::uuid
      and labourer_id = current_setting('atlas_test.labourer_b_id')::uuid
      and production_crew_id = current_setting('atlas_test.factory_b_crew_id')::uuid
      and effective_from = date '2026-08-01'
      and effective_to is null
  ) then
    raise exception 'FAIL: Factory B assignment was mutated';
  end if;

  raise notice 'PASS: production, rates, weekly history/details, withdrawals, and Factory B history are unchanged';
end;
$$;

rollback;
