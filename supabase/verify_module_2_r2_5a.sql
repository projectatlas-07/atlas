-- Atlas Module 2 Rework R2.5A production weekly-rate snapshot verifier.
-- Run after applying 20260816000004_create_production_weekly_earning_details.sql.
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
  production_calculator_definition text;
  mud_calculator_definition text;
  resolver_definition text;
  policy_count integer;
begin
  if to_regclass('public.production_weekly_earning_details') is null then
    raise exception 'FAIL: production_weekly_earning_details does not exist';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.production_weekly_earning_details'::regclass
      and relrowsecurity
  ) then
    raise exception 'FAIL: production detail RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.production_weekly_earning_details', 'SELECT')
    or has_table_privilege('anon', 'public.production_weekly_earning_details', 'INSERT')
    or has_table_privilege('anon', 'public.production_weekly_earning_details', 'UPDATE')
    or has_table_privilege('anon', 'public.production_weekly_earning_details', 'DELETE') then
    raise exception 'FAIL: anonymous production-detail privileges are too broad';
  end if;

  if not has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'SELECT')
    or has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'INSERT')
    or has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'UPDATE')
    or has_table_privilege('authenticated', 'public.production_weekly_earning_details', 'DELETE') then
    raise exception 'FAIL: authenticated production-detail privileges are incorrect';
  end if;

  select count(*) into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'production_weekly_earning_details'
    and 'authenticated' = any (roles)
    and cmd = 'SELECT'
    and qual ilike '%factory_users%'
    and qual ilike '%auth.uid()%'
    and qual ilike '%is_active%';

  if policy_count <> 1 or exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'production_weekly_earning_details'
      and cmd <> 'SELECT'
  ) then
    raise exception 'FAIL: production-detail policies are not SELECT-only and factory-scoped';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_earnings'
      and column_name in ('wage_rate_id', 'rate_used')
      and is_nullable <> 'YES'
  ) or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_earnings'
      and column_name in ('wage_rate_id', 'rate_used')
  ) <> 2 then
    raise exception 'FAIL: legacy production rate fields are not a nullable pair';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.weekly_earnings'::regclass
        and conname = 'weekly_earnings_legacy_rate_pair_check'
        and contype = 'c'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.weekly_earnings'::regclass
        and conname = 'weekly_earnings_mud_rate_required_check'
        and contype = 'c'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.production_weekly_earning_details'::regclass
        and conname = 'production_weekly_earning_details_parent_work_date_key'
        and contype = 'u'
    ) then
    raise exception 'FAIL: required compatibility or detail uniqueness constraints are missing';
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
    raise exception 'FAIL: same-factory historical foreign keys are missing or not restrictive';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid, date)'::regprocedure
  ) into production_calculator_definition;

  select pg_get_functiondef(
    'public.calculate_mud_supply_wages(uuid, uuid, date)'::regprocedure
  ) into mud_calculator_definition;

  select pg_get_functiondef(
    'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure
  ) into resolver_definition;

  if production_calculator_definition ilike '%production_weekly_earning_details%'
    or production_calculator_definition ilike '%resolve_production_wage_rate%'
    or production_calculator_definition not ilike '%public.wage_rates%'
    or resolver_definition ilike '%production_weekly_earning_details%'
    or resolver_definition ilike '%weekly_earnings%' then
    raise exception 'FAIL: production calculator or R2.4 resolver changed during R2.5A';
  end if;

  if mud_calculator_definition ilike '%production_weekly_earning_details%'
    or mud_calculator_definition not ilike '%wage_rate_id%'
    or mud_calculator_definition not ilike '%rate_used%'
    or mud_calculator_definition not ilike '%public.wage_rates%' then
    raise exception 'FAIL: mud-supply calculator behavior changed during R2.5A';
  end if;

  raise notice 'PASS: schema, immutable permissions, calculator isolation, and mud compatibility are correct';
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
  legacy_labourer_id uuid := gen_random_uuid();
  multi_rate_labourer_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  crew_rate_a_id uuid := gen_random_uuid();
  override_rate_a_id uuid := gen_random_uuid();
  crew_rate_b_id uuid := gen_random_uuid();
  legacy_production_rate_id uuid := gen_random_uuid();
  legacy_mud_rate_id uuid := gen_random_uuid();
  legacy_earning_id uuid := gen_random_uuid();
  multi_rate_earning_id uuid := gen_random_uuid();
  factory_b_earning_id uuid := gen_random_uuid();
  mud_earning_id uuid := gen_random_uuid();
  production_entry_one_id uuid := gen_random_uuid();
  production_entry_two_id uuid := gen_random_uuid();
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
    (factory_a_id, format('R2.5A verification Factory A %s', factory_a_id)),
    (factory_b_id, format('R2.5A verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'R2.5A brick A'),
    (brick_type_b_id, factory_b_id, 'R2.5A brick B');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values
    (legacy_labourer_id, factory_a_id, 'R2.5A legacy labourer', brick_type_a_id, true),
    (multi_rate_labourer_id, factory_a_id, 'R2.5A multi-rate labourer', brick_type_a_id, true),
    (labourer_b_id, factory_b_id, 'R2.5A Factory B labourer', brick_type_b_id, true);

  insert into public.labour_groups (id, factory_id, name, is_active)
  values (group_a_id, factory_a_id, 'R2.5A mud group', true);

  insert into public.production_crews (id, factory_id, name, is_active)
  values
    (crew_a_id, factory_a_id, 'R2.5A Crew A', true),
    (crew_b_id, factory_b_id, 'R2.5A Crew B', true);

  insert into public.production_wage_rates (
    id, factory_id, production_crew_id, labourer_id,
    rate_per_1000_bricks, effective_from
  ) values
    (crew_rate_a_id, factory_a_id, crew_a_id, null, 520, date '2026-07-01'),
    (override_rate_a_id, factory_a_id, null, multi_rate_labourer_id, 540, date '2026-07-01'),
    (crew_rate_b_id, factory_b_id, crew_b_id, null, 610, date '2026-07-01');

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values
    (legacy_production_rate_id, factory_a_id, 'production', 500, date '2026-07-01'),
    (legacy_mud_rate_id, factory_a_id, 'mud_supply', 200, date '2026-07-01');

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values
    (legacy_earning_id, factory_a_id, legacy_labourer_id, date '2026-07-06', 1000,
      legacy_production_rate_id, 500, 500),
    (multi_rate_earning_id, factory_a_id, multi_rate_labourer_id, date '2026-07-06', 19000,
      null, null, 10060),
    (factory_b_earning_id, factory_b_id, labourer_b_id, date '2026-07-06', 1000,
      null, null, 610);

  insert into public.weekly_earnings (
    id, factory_id, labour_group_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    mud_earning_id, factory_a_id, group_a_id, date '2026-07-06', 20000,
    legacy_mud_rate_id, 200, 4000
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (production_entry_one_id, factory_a_id, multi_rate_labourer_id,
      brick_type_a_id, date '2026-07-06', 10000),
    (production_entry_two_id, factory_a_id, multi_rate_labourer_id,
      brick_type_a_id, date '2026-07-07', 9000);

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.crew_rate_a_id', crew_rate_a_id::text, true);
  perform set_config('atlas_test.override_rate_a_id', override_rate_a_id::text, true);
  perform set_config('atlas_test.crew_rate_b_id', crew_rate_b_id::text, true);
  perform set_config('atlas_test.legacy_production_rate_id', legacy_production_rate_id::text, true);
  perform set_config('atlas_test.legacy_mud_rate_id', legacy_mud_rate_id::text, true);
  perform set_config('atlas_test.legacy_earning_id', legacy_earning_id::text, true);
  perform set_config('atlas_test.multi_rate_earning_id', multi_rate_earning_id::text, true);
  perform set_config('atlas_test.factory_b_earning_id', factory_b_earning_id::text, true);
  perform set_config('atlas_test.mud_earning_id', mud_earning_id::text, true);
  perform set_config('atlas_test.group_a_id', group_a_id::text, true);
  perform set_config('atlas_test.legacy_labourer_id', legacy_labourer_id::text, true);
  perform set_config('atlas_test.multi_rate_labourer_id', multi_rate_labourer_id::text, true);
  perform set_config('atlas_test.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_test.brick_type_a_id', brick_type_a_id::text, true);
  perform set_config('atlas_test.production_entry_one_id', production_entry_one_id::text, true);
  perform set_config('atlas_test.production_entry_two_id', production_entry_two_id::text, true);
end;
$$;

insert into public.production_weekly_earning_details (
  factory_id, weekly_earning_id, work_date, quantity_used,
  production_wage_rate_id, rate_per_1000_bricks,
  rate_source, production_crew_id, amount
) values
  (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.multi_rate_earning_id')::uuid,
    date '2026-07-06', 10000,
    current_setting('atlas_test.crew_rate_a_id')::uuid, 520,
    'crew_default', current_setting('atlas_test.crew_a_id')::uuid, 5200
  ),
  (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.multi_rate_earning_id')::uuid,
    date '2026-07-07', 9000,
    current_setting('atlas_test.override_rate_a_id')::uuid, 540,
    'individual_override', null, 4860
  ),
  (
    current_setting('atlas_test.factory_b_id')::uuid,
    current_setting('atlas_test.factory_b_earning_id')::uuid,
    date '2026-07-06', 1000,
    current_setting('atlas_test.crew_rate_b_id')::uuid, 610,
    'crew_default', current_setting('atlas_test.crew_b_id')::uuid, 610
  );

do $$
declare
  detail_count integer;
  rate_count integer;
begin
  select count(*), count(distinct production_wage_rate_id)
    into detail_count, rate_count
  from public.production_weekly_earning_details
  where weekly_earning_id = current_setting('atlas_test.multi_rate_earning_id')::uuid;

  if detail_count <> 2 or rate_count <> 2
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = current_setting('atlas_test.multi_rate_earning_id')::uuid
        and work_date = date '2026-07-06'
        and quantity_used = 10000
        and production_wage_rate_id = current_setting('atlas_test.crew_rate_a_id')::uuid
        and rate_per_1000_bricks = 520
        and rate_source = 'crew_default'
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and amount = 5200
    )
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = current_setting('atlas_test.multi_rate_earning_id')::uuid
        and work_date = date '2026-07-07'
        and quantity_used = 9000
        and production_wage_rate_id = current_setting('atlas_test.override_rate_a_id')::uuid
        and rate_per_1000_bricks = 540
        and rate_source = 'individual_override'
        and production_crew_id is null
        and amount = 4860
    ) then
    raise exception 'FAIL: valid multi-date, multi-rate snapshots were not preserved exactly';
  end if;

  raise notice 'PASS: one parent preserves exact crew-default and individual-override work-date snapshots';

  perform pg_temp.expect_error(
    'crew-default snapshot without crew is rejected',
    '23514',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default'
    )
  );

  perform pg_temp.expect_error(
    'individual override snapshot with crew is rejected',
    '23514',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 540, %L, %L::uuid, 540)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.override_rate_a_id'),
      'individual_override',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'unknown rate source is rejected',
    '23514',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 540, %L, 540)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.override_rate_a_id'),
      'manual'
    )
  );

  perform pg_temp.expect_error(
    'duplicate parent work date is rejected',
    '23505',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, %L::uuid, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-06',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'non-positive snapshot quantity is rejected',
    '23514',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 0, %L::uuid, 520, %L, %L::uuid, 0)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'non-positive snapshot rate is rejected',
    '23514',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 0, %L, %L::uuid, 0)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'negative snapshot amount is rejected',
    '23514',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, %L::uuid, -1)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'cross-factory parent is rejected',
    '23503',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, %L::uuid, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.factory_b_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'cross-factory production rate is rejected',
    '23503',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 610, %L, %L::uuid, 610)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_b_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'cross-factory crew snapshot is rejected',
    '23503',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, %L::uuid, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_b_id')
    )
  );

  perform pg_temp.expect_error(
    'legacy production rate pair cannot be half-populated',
    '23514',
    format(
      'insert into public.weekly_earnings (factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount) values (%L::uuid, %L::uuid, date %L, 1000, null, 520, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.legacy_labourer_id'),
      '2026-07-13'
    )
  );

  perform pg_temp.expect_error(
    'mud earning cannot omit legacy rate fields',
    '23514',
    format(
      'insert into public.weekly_earnings (factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount) values (%L::uuid, %L::uuid, date %L, 1000, null, null, 200)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.group_a_id'),
      '2026-07-13'
    )
  );

  perform pg_temp.expect_error(
    'detail-protected parent cannot be deleted',
    '23503',
    format(
      'delete from public.weekly_earnings where id = %L::uuid',
      current_setting('atlas_test.multi_rate_earning_id')
    )
  );

  perform pg_temp.expect_error(
    'snapshotted production rate cannot be deleted',
    '23503',
    format(
      'delete from public.production_wage_rates where id = %L::uuid',
      current_setting('atlas_test.crew_rate_a_id')
    )
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  visible_rows integer;
begin
  select count(*) into visible_rows
  from public.production_weekly_earning_details
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows <> 2 then
    raise exception 'FAIL: Factory A cannot read its production details';
  end if;

  select count(*) into visible_rows
  from public.production_weekly_earning_details
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B production details';
  end if;

  raise notice 'PASS: authenticated detail reads are factory-isolated';

  perform pg_temp.expect_error(
    'authenticated direct detail INSERT is denied',
    '42501',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, %L::uuid, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );

  perform pg_temp.expect_error(
    'authenticated direct detail UPDATE is denied',
    '42501',
    'update public.production_weekly_earning_details set amount = amount'
  );

  perform pg_temp.expect_error(
    'authenticated direct detail DELETE is denied',
    '42501',
    'delete from public.production_weekly_earning_details'
  );
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.legacy_earning_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.legacy_labourer_id')::uuid
      and week_start = date '2026-07-06'
      and quantity_used = 1000
      and wage_rate_id = current_setting('atlas_test.legacy_production_rate_id')::uuid
      and rate_used = 500
      and amount = 500
  ) then
    raise exception 'FAIL: historical weekly earning was modified or deleted';
  end if;

  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.multi_rate_earning_id')::uuid
      and wage_rate_id is null
      and rate_used is null
      and quantity_used = 19000
      and amount = 10060
  ) then
    raise exception 'FAIL: multi-rate parent cannot honestly omit legacy rate fields';
  end if;

  if not exists (
      select 1 from public.wage_rates
      where id = current_setting('atlas_test.legacy_production_rate_id')::uuid
        and factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and applies_to = 'production'
        and rate_per_1000_bricks = 500
        and effective_from = date '2026-07-01'
        and effective_to is null
    )
    or not exists (
      select 1 from public.wage_rates
      where id = current_setting('atlas_test.legacy_mud_rate_id')::uuid
        and factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and applies_to = 'mud_supply'
        and rate_per_1000_bricks = 200
        and effective_from = date '2026-07-01'
        and effective_to is null
    ) then
    raise exception 'FAIL: legacy wage rates were modified or deleted';
  end if;

  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.mud_earning_id')::uuid
      and labour_group_id = current_setting('atlas_test.group_a_id')::uuid
      and wage_rate_id = current_setting('atlas_test.legacy_mud_rate_id')::uuid
      and rate_used = 200
      and amount = 4000
  ) then
    raise exception 'FAIL: mud-supply earning behavior/schema is not intact';
  end if;

  if (
    select count(*) from public.production_entries
    where id in (
      current_setting('atlas_test.production_entry_one_id')::uuid,
      current_setting('atlas_test.production_entry_two_id')::uuid
    )
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.multi_rate_labourer_id')::uuid
      and brick_type_id = current_setting('atlas_test.brick_type_a_id')::uuid
      and (
        (production_date = date '2026-07-06' and quantity = 10000)
        or (production_date = date '2026-07-07' and quantity = 9000)
      )
  ) <> 2 then
    raise exception 'FAIL: production entries were modified or deleted';
  end if;

  raise notice 'PASS: legacy history, null multi-rate parent, mud earning, rates, and production entries are unchanged';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous detail SELECT is denied',
    '42501',
    'select 1 from public.production_weekly_earning_details limit 1'
  );

  perform pg_temp.expect_error(
    'anonymous detail INSERT is denied',
    '42501',
    format(
      'insert into public.production_weekly_earning_details (factory_id, weekly_earning_id, work_date, quantity_used, production_wage_rate_id, rate_per_1000_bricks, rate_source, production_crew_id, amount) values (%L::uuid, %L::uuid, date %L, 1000, %L::uuid, 520, %L, %L::uuid, 520)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.multi_rate_earning_id'),
      '2026-07-08',
      current_setting('atlas_test.crew_rate_a_id'),
      'crew_default',
      current_setting('atlas_test.crew_a_id')
    )
  );
end;
$$;

reset role;

rollback;
