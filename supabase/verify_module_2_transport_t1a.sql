-- Atlas Chamber Transport T1A foundation verifier.
-- Run after applying 20260818000000_create_transport_foundation.sql.
-- Requires one existing public.factory_users row. All fixture data and mapping
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
  table_name text;
  required_constraint text;
begin
  foreach table_name in array array[
    'transport_workers',
    'transport_crews',
    'transport_crew_memberships'
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

    if (select count(*)
        from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = table_name) <> 3 then
      raise exception 'FAIL: public.% does not have exactly SELECT/INSERT/UPDATE policies',
        table_name;
    end if;
  end loop;

  foreach required_constraint in array array[
    'transport_workers_id_factory_key',
    'transport_crews_factory_name_key',
    'transport_crews_id_factory_key',
    'transport_crews_work_direction_check',
    'transport_crew_memberships_id_factory_key',
    'transport_crew_memberships_effective_dates_check',
    'transport_crew_memberships_worker_factory_fkey',
    'transport_crew_memberships_crew_factory_fkey',
    'transport_crew_memberships_no_overlapping_dates'
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

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_memberships'::regclass
      and conname = 'transport_crew_memberships_worker_factory_fkey'
      and confrelid = 'public.transport_workers'::regclass
  ) then
    raise exception 'FAIL: memberships do not reference the separate transport worker population';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_workers'::regclass
      and confrelid = 'public.labourers'::regclass
  ) then
    raise exception 'FAIL: transport workers were coupled to production labourers';
  end if;

  raise notice 'PASS: transport schema, separation, constraints, RLS, and grants are present';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_type_a_id uuid := gen_random_uuid();
  labourer_a_id uuid := gen_random_uuid();
  production_entry_id uuid := gen_random_uuid();
  wage_rate_id uuid := gen_random_uuid();
  weekly_earning_id uuid := gen_random_uuid();
  worker_a_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
  field_crew_a_id uuid := gen_random_uuid();
  kiln_crew_a_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Transport T1A Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T1A Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_a_id, factory_a_id, 'Transport T1A unaffected brick');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values (
    labourer_a_id, factory_a_id, 'Transport T1A unaffected labourer',
    brick_type_a_id, true
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values (
    production_entry_id, factory_a_id, labourer_a_id,
    brick_type_a_id, date '2026-01-05', 1000
  );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (
    wage_rate_id, factory_a_id, 'production', 100, date '2026-01-01'
  );

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    weekly_earning_id, factory_a_id, labourer_a_id,
    date '2026-01-05', 1000, wage_rate_id, 100, 100
  );

  insert into public.transport_workers (id, factory_id, name)
  values (worker_b_id, factory_b_id, 'Factory B transport worker');

  insert into public.transport_crews (
    id, factory_id, name, work_direction
  ) values (
    crew_b_id, factory_b_id, 'Factory B transport crew', 'FIELD_TO_KILN'
  );

  insert into public.transport_crew_memberships (
    factory_id, transport_worker_id, transport_crew_id, effective_from
  ) values (
    factory_b_id, worker_b_id, crew_b_id, date '2025-01-01'
  );

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.production_entry_id', production_entry_id::text, true);
  perform set_config('atlas_test.wage_rate_id', wage_rate_id::text, true);
  perform set_config('atlas_test.weekly_earning_id', weekly_earning_id::text, true);
  perform set_config('atlas_test.worker_a_id', worker_a_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
  perform set_config('atlas_test.field_crew_a_id', field_crew_a_id::text, true);
  perform set_config('atlas_test.kiln_crew_a_id', kiln_crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);

  raise notice 'PASS: rollback-only factory, security, and unaffected-schema fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

insert into public.transport_workers (id, factory_id, name)
values (
  current_setting('atlas_test.worker_a_id')::uuid,
  current_setting('atlas_test.factory_a_id')::uuid,
  'Factory A transport worker'
);

insert into public.transport_crews (id, factory_id, name, work_direction)
values
  (
    current_setting('atlas_test.field_crew_a_id')::uuid,
    current_setting('atlas_test.factory_a_id')::uuid,
    'User-defined field crew',
    'FIELD_TO_KILN'
  ),
  (
    current_setting('atlas_test.kiln_crew_a_id')::uuid,
    current_setting('atlas_test.factory_a_id')::uuid,
    'User-defined kiln crew',
    'KILN_TO_FIELD'
  );

do $$
begin
  if not exists (
    select 1
    from public.transport_workers
    where id = current_setting('atlas_test.worker_a_id')::uuid
      and name = 'Factory A transport worker'
      and is_active = true
  ) then
    raise exception 'FAIL: valid transport worker creation failed';
  end if;

  if (select count(*)
      from public.transport_crews
      where id in (
        current_setting('atlas_test.field_crew_a_id')::uuid,
        current_setting('atlas_test.kiln_crew_a_id')::uuid
      )
        and work_direction in ('FIELD_TO_KILN', 'KILN_TO_FIELD')) <> 2 then
    raise exception 'FAIL: valid crews or one of the work directions was not accepted';
  end if;

  perform pg_temp.expect_error(
    'invalid transport work direction is rejected',
    '23514',
    format(
      'insert into public.transport_crews (factory_id, name, work_direction) values (%L::uuid, %L, %L)',
      current_setting('atlas_test.factory_a_id'),
      'Invalid direction crew',
      'FIELD_TO_FACTORY'
    )
  );

  perform pg_temp.expect_error(
    'effective_to before effective_from is rejected',
    '23514',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_a_id'),
      current_setting('atlas_test.field_crew_a_id'),
      '2026-01-02',
      '2026-01-01'
    )
  );

  raise notice 'PASS: worker creation, crew creation, and both exact work directions are valid';
end;
$$;

insert into public.transport_crew_memberships (
  factory_id, transport_worker_id, transport_crew_id,
  effective_from, effective_to
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.worker_a_id')::uuid,
  current_setting('atlas_test.field_crew_a_id')::uuid,
  date '2026-01-01',
  date '2026-01-10'
);

insert into public.transport_crew_memberships (
  factory_id, transport_worker_id, transport_crew_id,
  effective_from, effective_to
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.worker_a_id')::uuid,
  current_setting('atlas_test.kiln_crew_a_id')::uuid,
  date '2026-01-11',
  date '2026-01-20'
);

insert into public.transport_crew_memberships (
  factory_id, transport_worker_id, transport_crew_id, effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.worker_a_id')::uuid,
  current_setting('atlas_test.field_crew_a_id')::uuid,
  date '2026-02-01'
);

do $$
declare
  membership_count bigint;
begin
  select count(*) into membership_count
  from public.transport_crew_memberships
  where transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid;

  if membership_count <> 3 then
    raise exception 'FAIL: sequential membership and later rejoin were not preserved';
  end if;

  if not exists (
    select 1
    from public.transport_crew_memberships
    where transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid
      and transport_crew_id = current_setting('atlas_test.field_crew_a_id')::uuid
      and effective_from = date '2026-02-01'
      and effective_to is null
  ) then
    raise exception 'FAIL: worker could not leave and later rejoin a crew';
  end if;

  perform pg_temp.expect_error(
    'overlapping membership in the same crew is rejected',
    '23P01',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_a_id'),
      current_setting('atlas_test.field_crew_a_id'),
      '2026-01-05',
      '2026-01-06'
    )
  );

  perform pg_temp.expect_error(
    'overlapping membership across different crews is rejected',
    '23P01',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_a_id'),
      current_setting('atlas_test.kiln_crew_a_id'),
      '2026-02-02',
      '2026-02-03'
    )
  );

  perform pg_temp.expect_error(
    'Factory A worker cannot join a Factory B crew',
    '23503',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2025-01-01',
      '2025-12-31'
    )
  );

  perform pg_temp.expect_error(
    'Factory B worker cannot join a Factory A crew',
    '23503',
    format(
      'insert into public.transport_crew_memberships (factory_id, transport_worker_id, transport_crew_id, effective_from, effective_to) values (%L::uuid, %L::uuid, %L::uuid, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.worker_b_id'),
      current_setting('atlas_test.field_crew_a_id'),
      '2024-01-01',
      '2024-12-31'
    )
  );

  raise notice 'PASS: valid, sequential, rejoined, non-overlapping membership history is enforced';
end;
$$;

do $$
declare
  visible_rows bigint;
  affected_rows bigint;
begin
  select count(*) into visible_rows
  from public.transport_workers
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;
  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B transport workers';
  end if;

  select count(*) into visible_rows
  from public.transport_crews
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;
  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B transport crews';
  end if;

  select count(*) into visible_rows
  from public.transport_crew_memberships
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;
  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B transport memberships';
  end if;

  update public.transport_workers
  set name = name
  where id = current_setting('atlas_test.worker_b_id')::uuid;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'FAIL: Factory A can update Factory B transport workers';
  end if;

  perform pg_temp.expect_error(
    'Factory A cannot insert Factory B transport data',
    '42501',
    format(
      'insert into public.transport_workers (factory_id, name) values (%L::uuid, %L)',
      current_setting('atlas_test.factory_b_id'),
      'Blocked Factory B worker'
    )
  );

  raise notice 'PASS: Factory A cannot access Factory B transport data';
end;
$$;

update public.transport_workers
set is_active = false
where id = current_setting('atlas_test.worker_a_id')::uuid;

update public.transport_crews
set is_active = false
where id = current_setting('atlas_test.field_crew_a_id')::uuid;

do $$
begin
  if (select count(*)
      from public.transport_crew_memberships
      where transport_worker_id = current_setting('atlas_test.worker_a_id')::uuid) <> 3 then
    raise exception 'FAIL: worker or crew inactivity removed membership history';
  end if;

  raise notice 'PASS: inactive workers and crews retain historical memberships';
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.labourers
    where id = current_setting('atlas_test.labourer_a_id')::uuid
      and name = 'Transport T1A unaffected labourer'
  ) then
    raise exception 'FAIL: existing production labourer behavior was affected';
  end if;

  if not exists (
    select 1
    from public.production_entries
    where id = current_setting('atlas_test.production_entry_id')::uuid
      and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
      and quantity = 1000
  ) then
    raise exception 'FAIL: existing production schema or data was affected';
  end if;

  if not exists (
    select 1
    from public.wage_rates
    where id = current_setting('atlas_test.wage_rate_id')::uuid
      and applies_to = 'production'
      and rate_per_1000_bricks = 100
  ) or not exists (
    select 1
    from public.weekly_earnings
    where id = current_setting('atlas_test.weekly_earning_id')::uuid
      and amount = 100
  ) then
    raise exception 'FAIL: existing wage schema or data was affected';
  end if;

  raise notice 'PASS: existing production, labourer, and wage schema remains unaffected';
end;
$$;

update public.factory_users
set is_active = false
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if exists (
    select 1
    from public.transport_workers
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: inactive factory mapping still grants transport access';
  end if;

  raise notice 'PASS: an inactive factory mapping grants no transport access';
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous users cannot read transport workers',
    '42501',
    'select 1 from public.transport_workers limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous users cannot read transport crews',
    '42501',
    'select 1 from public.transport_crews limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous users cannot read transport memberships',
    '42501',
    'select 1 from public.transport_crew_memberships limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous users cannot insert transport workers',
    '42501',
    format(
      'insert into public.transport_workers (factory_id, name) values (%L::uuid, %L)',
      current_setting('atlas_test.factory_a_id'),
      'Anonymous transport worker'
    )
  );

  raise notice 'PASS: anonymous transport access is rejected';
end;
$$;

reset role;

rollback;