-- Atlas Chamber Transport T3 effective-dated crew wage-rate verifier.
-- Run after applying 20260818000003_create_transport_crew_wage_rates.sql.
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
  rate_table record;
  routine record;
  routine_definition text;
  public_can_execute boolean;
begin
  select class.relrowsecurity
    into rate_table
  from pg_catalog.pg_class as class
  where class.oid = 'public.transport_crew_wage_rates'::regclass;

  if not rate_table.relrowsecurity then
    raise exception 'FAIL: transport_crew_wage_rates RLS is not enabled';
  end if;

  if not has_table_privilege(
    'authenticated', 'public.transport_crew_wage_rates', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.transport_crew_wage_rates', 'INSERT'
  ) or has_table_privilege(
    'authenticated', 'public.transport_crew_wage_rates', 'UPDATE'
  ) or has_table_privilege(
    'authenticated', 'public.transport_crew_wage_rates', 'DELETE'
  ) or has_table_privilege(
    'anon', 'public.transport_crew_wage_rates', 'SELECT'
  ) then
    raise exception 'FAIL: transport crew wage-rate table grants are incorrect';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'transport_crew_wage_rates'
  ) <> 1 or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'transport_crew_wage_rates'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'FAIL: wage-rate RLS must contain only the authenticated SELECT policy';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_wage_rates'::regclass
      and conname = 'transport_crew_wage_rates_rate_per_paya_check'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_wage_rates'::regclass
      and conname = 'transport_crew_wage_rates_effective_dates_check'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_wage_rates'::regclass
      and conname = 'transport_crew_wage_rates_crew_factory_fkey'
      and contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_wage_rates'::regclass
      and conname = 'transport_crew_wage_rates_no_overlapping_dates'
      and contype = 'x'
  ) then
    raise exception 'FAIL: required wage-rate constraints are missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transport_crew_wage_rates'
      and column_name = 'transport_worker_id'
  ) or to_regprocedure(
    'public.resolve_transport_crew_wage_rate(uuid,date)'
  ) is not null then
    raise exception 'FAIL: T3 added a worker override or premature rate resolver';
  end if;

  select procedure.prosecdef, procedure.proconfig, procedure.proacl,
      procedure.proowner
    into routine
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'::regprocedure;

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
      'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'::regprocedure,
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'::regprocedure,
      'EXECUTE'
    ) or public_can_execute then
    raise exception 'FAIL: create_transport_crew_wage_rate security or grants are incorrect';
  end if;

  select pg_get_functiondef(
    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'::regprocedure
  ) into routine_definition;

  if routine_definition not ilike '%pg_advisory_xact_lock%'
    or routine_definition not ilike '%for update%'
    or routine_definition not ilike '%set effective_to = p_effective_from - 1%'
    or routine_definition not ilike '%factory_users.is_active = true%'
    or routine_definition ilike '%isodow%'
    or routine_definition ilike '%monday%' then
    raise exception 'FAIL: RPC lock, carry-forward, access, or daily-date policy is incorrect';
  end if;

  raise notice 'PASS: T3 schema, RLS, grants, RPC security, and scope are correct';
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
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.transport_daily_attendance'::regclass
      and tgname = 'transport_daily_attendance_validate_membership'
      and tgisinternal = false
  ) or to_regprocedure(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'
  ) is null then
    raise exception 'FAIL: T1A, T2A, or T2B transport foundations changed';
  end if;

  select pg_get_functiondef(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'::regprocedure
  ) into daily_save_definition;

  if daily_save_definition ilike '%transport_crew_wage_rates%' then
    raise exception 'FAIL: T2B daily-save RPC was coupled to T3 rates';
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
    or production_calculator_definition ilike '%transport_%' then
    raise exception 'FAIL: production wage calculation behavior was modified';
  end if;

  raise notice 'PASS: T1A, T2A, T2B, and production wage foundations remain intact';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_a_schema_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Transport T3 Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T3 Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_crews (id, factory_id, name, work_direction)
  values
    (crew_a_id, factory_a_id, 'T3 Factory A main crew', 'FIELD_TO_KILN'),
    (crew_a_schema_id, factory_a_id, 'T3 Factory A schema crew', 'KILN_TO_FIELD'),
    (crew_b_id, factory_b_id, 'T3 Factory B crew', 'FIELD_TO_KILN');

  insert into public.transport_crew_wage_rates (
    factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to
  ) values
    (factory_a_id, crew_a_schema_id, 700, date '2026-01-01', date '2026-01-31'),
    (factory_a_id, crew_a_schema_id, 700.5, date '2026-02-01', date '2026-02-28'),
    (factory_b_id, crew_b_id, 1000, date '2026-01-01', null);

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.unmapped_user_id', gen_random_uuid()::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_a_schema_id', crew_a_schema_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);

  raise notice 'PASS: positive integer/decimal rate values and rollback-only fixtures accepted';
end;
$$;

select pg_temp.expect_error(
  'zero rate rejected',
  '23514',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from) values (%L, %L, 0, date ''2027-01-01'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_schema_id')
  )
);

select pg_temp.expect_error(
  'negative rate rejected',
  '23514',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from) values (%L, %L, -1, date ''2027-01-02'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_schema_id')
  )
);

select pg_temp.expect_error(
  'NaN rate rejected',
  '23514',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from) values (%L, %L, ''NaN''::numeric, date ''2027-01-03'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_schema_id')
  )
);

select pg_temp.expect_error(
  'effective_to before effective_from rejected',
  '23514',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to) values (%L, %L, 750, date ''2027-02-02'', date ''2027-02-01'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_schema_id')
  )
);

select pg_temp.expect_error(
  'overlapping inclusive crew-rate periods rejected',
  '23P01',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to) values (%L, %L, 750, date ''2026-01-31'', date ''2026-02-01'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_schema_id')
  )
);

select pg_temp.expect_error(
  'cross-factory crew relationship rejected',
  '23503',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from) values (%L, %L, 750, date ''2027-03-01'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_b_id')
  )
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  first_rate public.transport_crew_wage_rates%rowtype;
  second_rate public.transport_crew_wage_rates%rowtype;
begin
  select * into first_rate
  from public.create_transport_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-08-01',
    800
  );

  if first_rate.rate_per_paya <> 800
    or first_rate.effective_from <> date '2026-08-01'
    or first_rate.effective_to is not null then
    raise exception 'FAIL: first RPC rate was not stored open-ended';
  end if;

  if extract(isodow from date '2026-08-18') <> 2 then
    raise exception 'FAIL: verifier mid-week fixture is not a Tuesday';
  end if;

  select * into second_rate
  from public.create_transport_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    date '2026-08-18',
    900
  );

  if second_rate.rate_per_paya <> 900
    or second_rate.effective_from <> date '2026-08-18'
    or second_rate.effective_to is not null then
    raise exception 'FAIL: replacement RPC rate was not stored open-ended';
  end if;

  if not exists (
    select 1
    from public.transport_crew_wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
      and rate_per_paya = 800
      and effective_from = date '2026-08-01'
      and effective_to = date '2026-08-17'
  ) or not exists (
    select 1
    from public.transport_crew_wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
      and rate_per_paya = 900
      and effective_from = date '2026-08-18'
      and effective_to is null
  ) then
    raise exception 'FAIL: exact 800/900 carry-forward history is incorrect';
  end if;

  raise notice 'PASS: first, later, mid-week, and exact carry-forward RPC behavior works';
end;
$$;

select pg_temp.expect_error(
  'duplicate effective date rejected',
  'P0001',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-08-18'', 950)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

select pg_temp.expect_error(
  'backdated replacement rejected',
  'P0001',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-08-10'', 850)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

do $$
begin
  if (
    select count(*)
    from public.transport_crew_wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
  ) <> 2 or not exists (
    select 1
    from public.transport_crew_wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
      and rate_per_paya = 800
      and effective_to = date '2026-08-17'
  ) or not exists (
    select 1
    from public.transport_crew_wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and transport_crew_id = current_setting('atlas_test.crew_a_id')::uuid
      and rate_per_paya = 900
      and effective_to is null
  ) then
    raise exception 'FAIL: rejected RPC call changed existing history';
  end if;

  raise notice 'PASS: duplicate/backdated failures are atomic and history is unchanged';
end;
$$;

select pg_temp.expect_error(
  'nonpositive RPC rate rejected',
  '22023',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-09-01'', 0)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

select pg_temp.expect_error(
  'NaN RPC rate rejected',
  '22023',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-09-01'', ''NaN''::numeric)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

select pg_temp.expect_error(
  'cross-factory crew RPC rejected',
  '42501',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-09-01'', 950)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_b_id')
  )
);

do $$
begin
  if exists (
    select 1
    from public.transport_crew_wage_rates
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A can read Factory B transport rates';
  end if;

  raise notice 'PASS: Factory A cannot read Factory B transport rates';
end;
$$;

select pg_temp.expect_error(
  'authenticated direct insert rejected',
  '42501',
  format(
    'insert into public.transport_crew_wage_rates (factory_id, transport_crew_id, rate_per_paya, effective_from) values (%L, %L, 950, date ''2026-09-01'')',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated direct update rejected',
  '42501',
  format(
    'update public.transport_crew_wage_rates set rate_per_paya = 1 where factory_id = %L and transport_crew_id = %L',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

select pg_temp.expect_error(
  'authenticated direct delete rejected',
  '42501',
  format(
    'delete from public.transport_crew_wage_rates where factory_id = %L and transport_crew_id = %L',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

select set_config('request.jwt.claim.sub', current_setting('atlas_test.unmapped_user_id'), true);

select pg_temp.expect_error(
  'unmapped authenticated RPC rejected',
  '42501',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-09-01'', 950)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select pg_temp.expect_error(
  'anonymous table access rejected',
  '42501',
  'select * from public.transport_crew_wage_rates'
);

select pg_temp.expect_error(
  'anonymous RPC access rejected',
  '42501',
  format(
    'select public.create_transport_crew_wage_rate(%L, %L, date ''2026-09-01'', 950)',
    current_setting('atlas_test.factory_a_id'),
    current_setting('atlas_test.crew_a_id')
  )
);

reset role;

rollback;
