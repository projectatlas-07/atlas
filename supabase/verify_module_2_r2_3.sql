-- Atlas Module 2 Rework R2.3 controlled production-rate mutation verifier.
-- Run after applying 20260816000002_create_production_wage_rate_rpcs.sql.
-- It requires one existing public.factory_users row. Every fixture and mapping
-- change is transactional and discarded by the final rollback.

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
begin
  for routine in
    select procedure.oid, procedure.prosecdef, procedure.proconfig,
      procedure.proacl, procedure.proowner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.create_production_crew_wage_rate(uuid, uuid, numeric, date)'::regprocedure,
      'public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date)'::regprocedure
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
      or routine_definition ilike '%isodow%'
      or routine_definition ilike '%weekly_earnings%'
      or routine_definition ilike '%production_entries%'
      or routine_definition ilike '%public.wage_rates%' then
      raise exception 'FAIL: % locking or non-interference definition is incorrect',
        routine.oid::regprocedure;
    end if;
  end loop;

  if not pg_get_functiondef(
      'public.create_production_crew_wage_rate(uuid, uuid, numeric, date)'::regprocedure
    ) ilike '%production_crew_wage_rate:%'
    or not pg_get_functiondef(
      'public.create_labourer_production_wage_rate_override(uuid, uuid, numeric, date)'::regprocedure
    ) ilike '%labourer_production_wage_rate:%' then
    raise exception 'FAIL: crew and labourer RPCs do not use distinct lock namespaces';
  end if;

  if has_table_privilege('authenticated', 'public.production_wage_rates', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'DELETE')
    or not has_table_privilege('authenticated', 'public.production_wage_rates', 'SELECT') then
    raise exception 'FAIL: production_wage_rates direct authenticated permissions changed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.production_wage_rates'::regclass
      and conname = 'production_wage_rates_no_overlapping_crew_dates'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.production_wage_rates'::regclass
      and conname = 'production_wage_rates_no_overlapping_labourer_dates'
  ) then
    raise exception 'FAIL: R2.2 exclusion constraints are missing';
  end if;

  raise notice 'PASS: RPC security, distinct advisory locks, and direct-write denial are correct';
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
  labourer_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  production_entry_id uuid := gen_random_uuid();
  legacy_wage_rate_id uuid := gen_random_uuid();
  weekly_earning_id uuid := gen_random_uuid();
  factory_b_rate_id uuid := gen_random_uuid();
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
    (factory_a_id, format('R2.3 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('R2.3 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'R2.3 verification brick A'),
    (brick_type_b_id, factory_b_id, 'R2.3 verification brick B');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active)
  values
    (labourer_a_id, factory_a_id, 'R2.3 labourer A', brick_type_a_id, true),
    (labourer_b_id, factory_b_id, 'R2.3 labourer B', brick_type_b_id, true);

  insert into public.production_crews (id, factory_id, name, is_active)
  values
    (crew_a_id, factory_a_id, 'R2.3 Crew A', true),
    (crew_b_id, factory_b_id, 'R2.3 Crew B', true);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values (
    production_entry_id, factory_a_id, labourer_a_id,
    brick_type_a_id, date '2026-08-04', 1000
  );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (
    legacy_wage_rate_id, factory_a_id, 'production', 500, date '2026-08-03'
  );

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    weekly_earning_id, factory_a_id, labourer_a_id,
    date '2026-08-03', 1000, legacy_wage_rate_id, 500, 500
  );

  insert into public.production_wage_rates (
    id, factory_id, production_crew_id, rate_per_1000_bricks, effective_from
  ) values (
    factory_b_rate_id, factory_b_id, crew_b_id, 600, date '2026-07-01'
  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_type_a_id', brick_type_a_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.production_entry_id', production_entry_id::text, true);
  perform set_config('atlas_test.legacy_wage_rate_id', legacy_wage_rate_id::text, true);
  perform set_config('atlas_test.weekly_earning_id', weekly_earning_id::text, true);
  perform set_config('atlas_test.factory_b_rate_id', factory_b_rate_id::text, true);

  raise notice 'PASS: rollback-only R2.3 fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  first_crew_rate public.production_wage_rates%rowtype;
  second_crew_rate public.production_wage_rates%rowtype;
  first_override public.production_wage_rates%rowtype;
  second_override public.production_wage_rates%rowtype;
begin
  select * into first_crew_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    520,
    date '2026-08-01'
  );

  if first_crew_rate.production_crew_id
      is distinct from current_setting('atlas_test.crew_a_id')::uuid
    or first_crew_rate.labourer_id is not null
    or first_crew_rate.rate_per_1000_bricks <> 520
    or first_crew_rate.effective_from <> date '2026-08-01'
    or first_crew_rate.effective_to is not null then
    raise exception 'FAIL: first crew rate result is incorrect';
  end if;

  select * into first_override
  from public.create_labourer_production_wage_rate_override(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    540,
    date '2026-08-05'
  );

  if first_override.labourer_id
      is distinct from current_setting('atlas_test.labourer_a_id')::uuid
    or first_override.production_crew_id is not null
    or first_override.rate_per_1000_bricks <> 540
    or first_override.effective_from <> date '2026-08-05'
    or first_override.effective_to is not null then
    raise exception 'FAIL: first labourer override result is incorrect';
  end if;

  if exists (
    select 1 from public.production_crew_assignments
    where labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
  ) then
    raise exception 'FAIL: verifier unexpectedly assigned the labourer to a crew';
  end if;

  select * into second_crew_rate
  from public.create_production_crew_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.crew_a_id')::uuid,
    530,
    date '2026-08-15'
  );

  if not exists (
    select 1 from public.production_wage_rates
    where id = first_crew_rate.id
      and effective_from = date '2026-08-01'
      and effective_to = date '2026-08-14'
      and rate_per_1000_bricks = 520
  ) or second_crew_rate.effective_from <> date '2026-08-15'
    or second_crew_rate.effective_to is not null
    or not exists (
      select 1 from public.production_wage_rates
      where id = first_override.id
        and effective_from = date '2026-08-05'
        and effective_to is null
        and rate_per_1000_bricks = 540
    ) then
    raise exception 'FAIL: crew replacement did not close correctly or changed override history';
  end if;

  select * into second_override
  from public.create_labourer_production_wage_rate_override(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    550,
    date '2026-08-20'
  );

  if not exists (
    select 1 from public.production_wage_rates
    where id = first_override.id
      and effective_from = date '2026-08-05'
      and effective_to = date '2026-08-19'
      and rate_per_1000_bricks = 540
  ) or second_override.effective_from <> date '2026-08-20'
    or second_override.effective_to is not null
    or not exists (
      select 1 from public.production_wage_rates
      where id = first_crew_rate.id
        and effective_to = date '2026-08-14'
        and rate_per_1000_bricks = 520
    ) or not exists (
      select 1 from public.production_wage_rates
      where id = second_crew_rate.id
        and effective_from = date '2026-08-15'
        and effective_to is null
        and rate_per_1000_bricks = 530
    ) then
    raise exception 'FAIL: override replacement did not close correctly or changed crew history';
  end if;

  perform set_config('atlas_test.first_crew_rate_id', first_crew_rate.id::text, true);
  perform set_config('atlas_test.second_crew_rate_id', second_crew_rate.id::text, true);
  perform set_config('atlas_test.first_override_id', first_override.id::text, true);
  perform set_config('atlas_test.second_override_id', second_override.id::text, true);

  raise notice 'PASS: crew and override tracks append independently on mid-week dates';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'duplicate crew effective_from is rejected',
    'P0001',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 535, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-15'
    )
  );

  perform pg_temp.expect_error(
    'unsafe backdated crew rate is rejected',
    'P0001',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 535, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'non-positive crew rate is rejected',
    '22023',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 0, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-09-01'
    )
  );

  perform pg_temp.expect_error(
    'missing crew rate effective_from is rejected',
    '22023',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 535, null::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'cross-factory crew is rejected',
    '42501',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 535, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-09-01'
    )
  );

  perform pg_temp.expect_error(
    'Factory A cannot mutate Factory B crew rates',
    '42501',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 610, date %L)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-08-01'
    )
  );

  perform pg_temp.expect_error(
    'duplicate override effective_from is rejected',
    'P0001',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 555, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-20'
    )
  );

  perform pg_temp.expect_error(
    'unsafe backdated labourer override is rejected',
    'P0001',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 555, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'non-positive labourer override is rejected',
    '22023',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, -1, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-09-01'
    )
  );

  perform pg_temp.expect_error(
    'missing override effective_from is rejected',
    '22023',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 555, null::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id')
    )
  );

  perform pg_temp.expect_error(
    'cross-factory labourer is rejected',
    '42501',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 555, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_b_id'),
      '2026-09-01'
    )
  );

  perform pg_temp.expect_error(
    'Factory A cannot mutate Factory B labourer overrides',
    '42501',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 620, date %L)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.labourer_b_id'),
      '2026-08-01'
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct INSERT remains denied',
    '42501',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, 700, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2027-01-01'
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct UPDATE remains denied',
    '42501',
    'update public.production_wage_rates set rate_per_1000_bricks = rate_per_1000_bricks'
  );

  perform pg_temp.expect_error(
    'authenticated direct DELETE remains denied',
    '42501',
    'delete from public.production_wage_rates'
  );
end;
$$;

do $$
begin
  if (select count(*) from public.production_wage_rates
      where production_crew_id = current_setting('atlas_test.crew_a_id')::uuid) <> 2
    or (select count(*) from public.production_wage_rates
        where labourer_id = current_setting('atlas_test.labourer_a_id')::uuid) <> 2 then
    raise exception 'FAIL: historical crew or override rows were deleted';
  end if;

  if exists (
    select 1
    from public.production_wage_rates as earlier_rate
    join public.production_wage_rates as later_rate
      on later_rate.id <> earlier_rate.id
      and (
        later_rate.production_crew_id = earlier_rate.production_crew_id
        or later_rate.labourer_id = earlier_rate.labourer_id
      )
      and later_rate.effective_from <= coalesce(earlier_rate.effective_to, 'infinity'::date)
      and earlier_rate.effective_from <= coalesce(later_rate.effective_to, 'infinity'::date)
    where earlier_rate.factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: an overlapping same-track rate resulted';
  end if;

  raise notice 'PASS: history is retained and no same-track overlaps resulted';
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.production_wage_rates
    where id = current_setting('atlas_test.factory_b_rate_id')::uuid
      and factory_id = current_setting('atlas_test.factory_b_id')::uuid
      and production_crew_id = current_setting('atlas_test.crew_b_id')::uuid
      and rate_per_1000_bricks = 600
      and effective_from = date '2026-07-01'
      and effective_to is null
  ) or (select count(*) from public.production_wage_rates
        where factory_id = current_setting('atlas_test.factory_b_id')::uuid) <> 1 then
    raise exception 'FAIL: Factory B production-rate data was mutated';
  end if;

  if not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_test.legacy_wage_rate_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'production'
      and rate_per_1000_bricks = 500
      and effective_from = date '2026-08-03'
      and effective_to is null
  ) then
    raise exception 'FAIL: legacy wage_rates data was modified';
  end if;

  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.weekly_earning_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
      and wage_rate_id = current_setting('atlas_test.legacy_wage_rate_id')::uuid
      and week_start = date '2026-08-03'
      and quantity_used = 1000
      and rate_used = 500
      and amount = 500
  ) then
    raise exception 'FAIL: weekly_earnings data was modified';
  end if;

  if not exists (
    select 1 from public.production_entries
    where id = current_setting('atlas_test.production_entry_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
      and brick_type_id = current_setting('atlas_test.brick_type_a_id')::uuid
      and production_date = date '2026-08-04'
      and quantity = 1000
  ) then
    raise exception 'FAIL: production entry data was modified';
  end if;

  raise notice 'PASS: Factory B, legacy rates, earnings, and production data are unchanged';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous crew-rate RPC execution is denied',
    '42501',
    format(
      'select public.create_production_crew_wage_rate(%L::uuid, %L::uuid, 700, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2027-01-01'
    )
  );

  perform pg_temp.expect_error(
    'anonymous override RPC execution is denied',
    '42501',
    format(
      'select public.create_labourer_production_wage_rate_override(%L::uuid, %L::uuid, 700, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2027-01-01'
    )
  );
end;
$$;

reset role;

rollback;
