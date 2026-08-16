-- Atlas Module 2 Rework R2.1 production crew foundation verifier.
-- Run after applying 20260816000000_create_production_crew_foundation.sql.
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
  table_name text;
  required_constraint text;
begin
  foreach table_name in array array[
    'production_crews',
    'production_crew_assignments'
  ] loop
    if not (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = format('public.%I', table_name)::regclass
    ) then
      raise exception 'FAIL: RLS is not enabled on public.%', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'FAIL: anon has privileges on public.%', table_name;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      or not has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or not has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'FAIL: authenticated privileges are incorrect on public.%', table_name;
    end if;
  end loop;

  foreach required_constraint in array array[
    'production_crews_id_factory_key',
    'production_crews_factory_name_key',
    'production_crew_assignments_effective_dates_check',
    'production_crew_assignments_labourer_factory_fkey',
    'production_crew_assignments_crew_factory_fkey',
    'production_crew_assignments_no_overlapping_dates'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = required_constraint
        and connamespace = 'public'::regnamespace
    ) then
      raise exception 'FAIL: required constraint % is missing', required_constraint;
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'production_crews') <> 3
    or (select count(*) from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'production_crew_assignments') <> 3 then
    raise exception 'FAIL: expected SELECT/INSERT/UPDATE factory policies are missing';
  end if;

  raise notice 'PASS: crew schema, constraints, RLS, and grants are present';
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
  unassigned_labourer_a_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  crew_a1_id uuid := gen_random_uuid();
  crew_a2_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  production_entry_id uuid := gen_random_uuid();
  wage_rate_id uuid := gen_random_uuid();
  weekly_earning_id uuid := gen_random_uuid();
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
    (factory_a_id, format('R2.1 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('R2.1 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'R2.1 verification brick A'),
    (brick_type_b_id, factory_b_id, 'R2.1 verification brick B');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active)
  values
    (labourer_a_id, factory_a_id, 'R2.1 assigned labourer A', brick_type_a_id, true),
    (unassigned_labourer_a_id, factory_a_id, 'R2.1 unassigned labourer A', brick_type_a_id, true),
    (labourer_b_id, factory_b_id, 'R2.1 labourer B', brick_type_b_id, true);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values (
    production_entry_id, factory_a_id, unassigned_labourer_a_id,
    brick_type_a_id, date '2026-07-01', 1000
  );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (
    wage_rate_id, factory_a_id, 'production', 100, date '2026-06-30'
  );

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    weekly_earning_id, factory_a_id, unassigned_labourer_a_id,
    date '2026-06-29', 1000, wage_rate_id, 100, 100
  );

  insert into public.production_crews (id, factory_id, name)
  values
    (crew_a1_id, factory_a_id, 'R2.1 Crew A One'),
    (crew_a2_id, factory_a_id, 'R2.1 Crew A Two'),
    (crew_b_id, factory_b_id, 'R2.1 Crew B');

  insert into public.production_crew_assignments (
    factory_id, labourer_id, production_crew_id, effective_from
  ) values (
    factory_b_id, labourer_b_id, crew_b_id, date '2026-01-01'
  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.unassigned_labourer_a_id', unassigned_labourer_a_id::text, true);
  perform set_config('atlas_test.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_test.crew_a1_id', crew_a1_id::text, true);
  perform set_config('atlas_test.crew_a2_id', crew_a2_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.production_entry_id', production_entry_id::text, true);
  perform set_config('atlas_test.weekly_earning_id', weekly_earning_id::text, true);

  raise notice 'PASS: rollback-only Factory A/B and existing-data fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  visible_rows bigint;
  affected_rows bigint;
begin
  select count(*) into visible_rows
  from public.production_crews
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows <> 2 then
    raise exception 'FAIL: Factory A cannot read its own crews';
  end if;

  select count(*) into visible_rows
  from public.production_crews
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B crews';
  end if;

  select count(*) into visible_rows
  from public.production_crew_assignments
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B crew assignments';
  end if;

  update public.production_crews
  set name = name
  where id = current_setting('atlas_test.crew_b_id')::uuid;
  get diagnostics affected_rows = row_count;

  if affected_rows <> 0 then
    raise exception 'FAIL: Factory A can update Factory B crews';
  end if;

  raise notice 'PASS: Factory A cannot access Factory B crews or assignments';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'Factory A cannot insert a Factory B crew',
    '42501',
    format(
      'insert into public.production_crews (factory_id, name) values (%L::uuid, %L)',
      current_setting('atlas_test.factory_b_id'),
      'R2.1 blocked Factory B crew'
    )
  );

  perform pg_temp.expect_error(
    'Factory A labourer cannot be assigned to Factory B crew',
    '23503',
    format(
      'insert into public.production_crew_assignments (factory_id, labourer_id, production_crew_id, effective_from) values (%L::uuid, %L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'effective_to before effective_from is rejected',
    '23514',
    format(
      'insert into public.production_crew_assignments (factory_id, labourer_id, production_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_a1_id'),
      '2026-01-02',
      '2026-01-01'
    )
  );
end;
$$;

insert into public.production_crew_assignments (
  factory_id, labourer_id, production_crew_id, effective_from, effective_to
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.labourer_a_id')::uuid,
  current_setting('atlas_test.crew_a1_id')::uuid,
  date '2026-01-01',
  date '2026-01-31'
);

insert into public.production_crew_assignments (
  factory_id, labourer_id, production_crew_id, effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.labourer_a_id')::uuid,
  current_setting('atlas_test.crew_a2_id')::uuid,
  date '2026-02-01'
);

do $$
declare
  assignment_count bigint;
  january_crew_id uuid;
  february_crew_id uuid;
begin
  select count(*) into assignment_count
  from public.production_crew_assignments
  where labourer_id = current_setting('atlas_test.labourer_a_id')::uuid;

  if assignment_count <> 2 then
    raise exception 'FAIL: valid and non-overlapping later assignments were not stored';
  end if;

  select production_crew_id into january_crew_id
  from public.production_crew_assignments
  where labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
    and effective_from <= date '2026-01-15'
    and (effective_to is null or effective_to >= date '2026-01-15');

  select production_crew_id into february_crew_id
  from public.production_crew_assignments
  where labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
    and effective_from <= date '2026-02-15'
    and (effective_to is null or effective_to >= date '2026-02-15');

  if january_crew_id <> current_setting('atlas_test.crew_a1_id')::uuid
    or february_crew_id <> current_setting('atlas_test.crew_a2_id')::uuid then
    raise exception 'FAIL: work dates do not resolve to their historical crews';
  end if;

  raise notice 'PASS: valid non-overlapping history resolves each work date to its crew';

  perform pg_temp.expect_error(
    'overlapping crew assignment is rejected',
    '23P01',
    format(
      'insert into public.production_crew_assignments (factory_id, labourer_id, production_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      current_setting('atlas_test.crew_a2_id'),
      '2026-01-15',
      '2026-02-15'
    )
  );
end;
$$;

update public.production_crews
set is_active = false
where id = current_setting('atlas_test.crew_a1_id')::uuid;

update public.labourers
set is_active = false
where id = current_setting('atlas_test.labourer_a_id')::uuid;

do $$
declare
  assignment_count bigint;
begin
  select count(*) into assignment_count
  from public.production_crew_assignments
  where labourer_id = current_setting('atlas_test.labourer_a_id')::uuid;

  if assignment_count <> 2 then
    raise exception 'FAIL: assignment history changed after crew/labourer inactivity';
  end if;

  if exists (
    select 1
    from public.production_crew_assignments
    where labourer_id = current_setting('atlas_test.unassigned_labourer_a_id')::uuid
  ) then
    raise exception 'FAIL: migration required an existing labourer assignment';
  end if;

  raise notice 'PASS: inactivity preserves history and existing labourers need no assignment';
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.production_entries
    where id = current_setting('atlas_test.production_entry_id')::uuid
      and labourer_id = current_setting('atlas_test.unassigned_labourer_a_id')::uuid
      and production_date = date '2026-07-01'
      and quantity = 1000
  ) then
    raise exception 'FAIL: existing Module 1 production data was modified or deleted';
  end if;

  if not exists (
    select 1
    from public.weekly_earnings
    where id = current_setting('atlas_test.weekly_earning_id')::uuid
      and labourer_id = current_setting('atlas_test.unassigned_labourer_a_id')::uuid
      and week_start = date '2026-06-29'
      and quantity_used = 1000
      and rate_used = 100
      and amount = 100
  ) then
    raise exception 'FAIL: existing Module 2 earnings data was modified or deleted';
  end if;

  raise notice 'PASS: existing Module 1/Module 2 data remains unchanged';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous users cannot read production crews',
    '42501',
    'select 1 from public.production_crews limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous users cannot read production crew assignments',
    '42501',
    'select 1 from public.production_crew_assignments limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous users cannot insert production crews',
    '42501',
    format(
      'insert into public.production_crews (factory_id, name) values (%L::uuid, %L)',
      current_setting('atlas_test.factory_a_id'),
      'R2.1 anonymous crew'
    )
  );
end;
$$;

reset role;

rollback;
