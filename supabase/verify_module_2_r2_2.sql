-- Atlas Module 2 Rework R2.2 production rate schema verifier.
-- Run after applying 20260816000001_create_production_wage_rate_foundation.sql.
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
  required_constraint text;
  calculator_definition text;
begin
  if not (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.production_wage_rates'::regclass
  ) then
    raise exception 'FAIL: RLS is not enabled on public.production_wage_rates';
  end if;

  if has_table_privilege('anon', 'public.production_wage_rates', 'SELECT')
    or has_table_privilege('anon', 'public.production_wage_rates', 'INSERT')
    or has_table_privilege('anon', 'public.production_wage_rates', 'UPDATE')
    or has_table_privilege('anon', 'public.production_wage_rates', 'DELETE') then
    raise exception 'FAIL: anon has production_wage_rates privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.production_wage_rates', 'SELECT')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_wage_rates', 'DELETE') then
    raise exception 'FAIL: authenticated production_wage_rates privileges are not read-only';
  end if;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'production_wage_rates'
        and cmd = 'SELECT') <> 1
    or (select count(*) from pg_catalog.pg_policies
        where schemaname = 'public'
          and tablename = 'production_wage_rates') <> 1 then
    raise exception 'FAIL: production_wage_rates must have exactly one SELECT policy';
  end if;

  foreach required_constraint in array array[
    'production_wage_rates_id_factory_key',
    'production_wage_rates_exactly_one_scope_check',
    'production_wage_rates_rate_per_1000_bricks_check',
    'production_wage_rates_effective_dates_check',
    'production_wage_rates_crew_factory_fkey',
    'production_wage_rates_labourer_factory_fkey',
    'production_wage_rates_no_overlapping_crew_dates',
    'production_wage_rates_no_overlapping_labourer_dates'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint
      where conname = required_constraint
        and connamespace = 'public'::regnamespace
        and conrelid = 'public.production_wage_rates'::regclass
    ) then
      raise exception 'FAIL: required constraint % is missing', required_constraint;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'weekly_earnings_wage_rate_factory_fkey'
      and conrelid = 'public.weekly_earnings'::regclass
      and confrelid = 'public.wage_rates'::regclass
  ) then
    raise exception 'FAIL: weekly_earnings no longer references legacy wage_rates';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid, date)'::regprocedure
  ) into calculator_definition;

  if position('public.wage_rates' in lower(calculator_definition)) = 0
    or position('production_wage_rates' in lower(calculator_definition)) > 0 then
    raise exception 'FAIL: production calculator was cut over during the schema milestone';
  end if;

  raise notice 'PASS: R2.2 schema, read-only security, and legacy calculator linkage are correct';
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
    (factory_a_id, format('R2.2 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('R2.2 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'R2.2 verification brick A'),
    (brick_type_b_id, factory_b_id, 'R2.2 verification brick B');

  insert into public.labourers (
    id,
    factory_id,
    name,
    assigned_brick_type_id,
    is_active
  )
  values
    (
      labourer_a_id,
      factory_a_id,
      'R2.2 labourer A',
      brick_type_a_id,
      true
    ),
    (
      labourer_b_id,
      factory_b_id,
      'R2.2 labourer B',
      brick_type_b_id,
      true
    );

  insert into public.production_crews (
    id,
    factory_id,
    name,
    is_active
  )
  values
    (
      crew_a_id,
      factory_a_id,
      'R2.2 Crew A',
      true
    ),
    (
      crew_b_id,
      factory_b_id,
      'R2.2 Crew B',
      true
    );

  insert into public.production_entries (
    id,
    factory_id,
    labourer_id,
    brick_type_id,
    production_date,
    quantity
  )
  values (
    production_entry_id,
    factory_a_id,
    labourer_a_id,
    brick_type_a_id,
    date '2026-08-04',
    1000
  );

  insert into public.wage_rates (
    id,
    factory_id,
    applies_to,
    rate_per_1000_bricks,
    effective_from
  )
  values (
    legacy_wage_rate_id,
    factory_a_id,
    'production',
    500,
    date '2026-08-03'
  );

  insert into public.weekly_earnings (
    id,
    factory_id,
    labourer_id,
    week_start,
    quantity_used,
    wage_rate_id,
    rate_used,
    amount
  )
  values (
    weekly_earning_id,
    factory_a_id,
    labourer_a_id,
    date '2026-08-03',
    1000,
    legacy_wage_rate_id,
    500,
    500
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

  raise notice 'PASS: rollback-only R2.2 fixtures created';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'rate zero is rejected',
    '23514',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, 0, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'negative rate is rejected',
    '23514',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, -1, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'NaN rate is rejected',
    '23514',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, %L::numeric, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      'NaN',
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'effective_to before effective_from is rejected',
    '23514',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from, effective_to) values (%L::uuid, %L::uuid, 500, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-01-02',
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'rate with both scopes is rejected',
    '23514',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, labourer_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, %L::uuid, 500, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'rate with neither scope is rejected',
    '23514',
    format(
      'insert into public.production_wage_rates (factory_id, rate_per_1000_bricks, effective_from) values (%L::uuid, 500, date %L)',
      current_setting('atlas_test.factory_a_id'),
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'Factory A cannot own a rate for Factory B crew',
    '23503',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, 500, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_b_id'),
      '2026-01-01'
    )
  );

  perform pg_temp.expect_error(
    'Factory A cannot own an override for Factory B labourer',
    '23503',
    format(
      'insert into public.production_wage_rates (factory_id, labourer_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, 500, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_b_id'),
      '2026-01-01'
    )
  );
end;
$$;

insert into public.production_wage_rates (
  factory_id,
  production_crew_id,
  rate_per_1000_bricks,
  effective_from,
  effective_to
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.crew_a_id')::uuid,
  520,
  date '2026-08-01',
  date '2026-08-10'
);

insert into public.production_wage_rates (
  factory_id,
  production_crew_id,
  rate_per_1000_bricks,
  effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.crew_a_id')::uuid,
  525,
  date '2026-08-11'
);

insert into public.production_wage_rates (
  factory_id,
  labourer_id,
  rate_per_1000_bricks,
  effective_from,
  effective_to
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.labourer_a_id')::uuid,
  540,
  date '2026-08-05',
  date '2026-08-20'
);

insert into public.production_wage_rates (
  factory_id,
  labourer_id,
  rate_per_1000_bricks,
  effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.labourer_a_id')::uuid,
  545,
  date '2026-08-21'
);

insert into public.production_wage_rates (
  factory_id,
  production_crew_id,
  rate_per_1000_bricks,
  effective_from
)
values (
  current_setting('atlas_test.factory_b_id')::uuid,
  current_setting('atlas_test.crew_b_id')::uuid,
  600,
  date '2026-08-01'
);

do $$
declare
  crew_rate_count bigint;
  override_count bigint;
begin
  select count(*) into crew_rate_count
  from public.production_wage_rates
  where production_crew_id =
    current_setting('atlas_test.crew_a_id')::uuid;

  select count(*) into override_count
  from public.production_wage_rates
  where labourer_id =
    current_setting('atlas_test.labourer_a_id')::uuid;

  if crew_rate_count <> 2 or override_count <> 2 then
    raise exception 'FAIL: valid adjacent crew/override rate histories were not stored';
  end if;

  if (
    select count(*)
    from public.production_wage_rates
    where production_crew_id =
      current_setting('atlas_test.crew_a_id')::uuid
      and effective_from <= date '2026-08-12'
      and (
        effective_to is null
        or effective_to >= date '2026-08-12'
      )
  ) <> 1
  or (
    select count(*)
    from public.production_wage_rates
    where labourer_id =
      current_setting('atlas_test.labourer_a_id')::uuid
      and effective_from <= date '2026-08-12'
      and (
        effective_to is null
        or effective_to >= date '2026-08-12'
      )
  ) <> 1 then
    raise exception 'FAIL: crew rate and individual override do not coexist on the same work date';
  end if;

  raise notice 'PASS: adjacent histories succeed and crew plus override coexist on 2026-08-12';

  perform pg_temp.expect_error(
    'overlapping rates for the same crew are rejected',
    '23P01',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from, effective_to) values (%L::uuid, %L::uuid, 530, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2026-08-10',
      '2026-08-11'
    )
  );

  perform pg_temp.expect_error(
    'overlapping overrides for the same labourer are rejected',
    '23P01',
    format(
      'insert into public.production_wage_rates (factory_id, labourer_id, rate_per_1000_bricks, effective_from, effective_to) values (%L::uuid, %L::uuid, 550, date %L, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-20',
      '2026-08-21'
    )
  );
end;
$$;

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  current_setting('atlas_test.user_id'),
  true
);

do $$
declare
  visible_rows bigint;
begin
  select count(*) into visible_rows
  from public.production_wage_rates
  where factory_id =
    current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows <> 4 then
    raise exception 'FAIL: Factory A cannot read all of its production rates';
  end if;

  select count(*) into visible_rows
  from public.production_wage_rates
  where factory_id =
    current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B production rates';
  end if;

  raise notice 'PASS: authenticated production-rate reads are factory-isolated';

  perform pg_temp.expect_error(
    'authenticated direct production-rate INSERT is denied',
    '42501',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, 700, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2027-01-01'
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct production-rate UPDATE is denied',
    '42501',
    'update public.production_wage_rates set rate_per_1000_bricks = rate_per_1000_bricks'
  );

  perform pg_temp.expect_error(
    'authenticated direct production-rate DELETE is denied',
    '42501',
    'delete from public.production_wage_rates'
  );
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.wage_rates
    where id =
      current_setting('atlas_test.legacy_wage_rate_id')::uuid
      and factory_id =
        current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'production'
      and rate_per_1000_bricks = 500
      and effective_from = date '2026-08-03'
      and effective_to is null
  ) then
    raise exception 'FAIL: existing wage_rates data was modified or deleted';
  end if;

  if not exists (
    select 1
    from public.weekly_earnings
    where id =
      current_setting('atlas_test.weekly_earning_id')::uuid
      and factory_id =
        current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id =
        current_setting('atlas_test.labourer_a_id')::uuid
      and wage_rate_id =
        current_setting('atlas_test.legacy_wage_rate_id')::uuid
      and week_start = date '2026-08-03'
      and quantity_used = 1000
      and rate_used = 500
      and amount = 500
  ) then
    raise exception 'FAIL: existing weekly_earnings data was modified or deleted';
  end if;

  if not exists (
    select 1
    from public.production_entries
    where id =
      current_setting('atlas_test.production_entry_id')::uuid
      and factory_id =
        current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id =
        current_setting('atlas_test.labourer_a_id')::uuid
      and brick_type_id =
        current_setting('atlas_test.brick_type_a_id')::uuid
      and production_date = date '2026-08-04'
      and quantity = 1000
  ) then
    raise exception 'FAIL: existing production data was modified or deleted';
  end if;

  raise notice 'PASS: legacy wage rates, locked earnings, and production data are unchanged';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous production-rate SELECT is denied',
    '42501',
    'select 1 from public.production_wage_rates limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous production-rate INSERT is denied',
    '42501',
    format(
      'insert into public.production_wage_rates (factory_id, production_crew_id, rate_per_1000_bricks, effective_from) values (%L::uuid, %L::uuid, 700, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.crew_a_id'),
      '2027-01-01'
    )
  );
end;
$$;

reset role;

rollback;