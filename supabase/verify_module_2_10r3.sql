-- Run this entire file in the Supabase SQL Editor after applying Module 2.10R3.
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
        test_label,
        expected_sqlstate,
        sqlstate,
        sqlerrm;
    end if;
end;
$$;

do $$
declare
  routine record;
  public_can_execute boolean;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'labourers'
      and column_name = 'is_placeholder'
  ) then
    raise exception 'FAIL: labourers.is_placeholder still exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind in ('f', 'p')
      and pg_get_functiondef(procedure.oid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.connamespace = 'public'::regnamespace
      and pg_get_constraintdef(constraint_record.oid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_index as index_record
    where pg_get_indexdef(index_record.indexrelid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and pg_get_triggerdef(trigger_record.oid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and (coalesce(policies.qual, '') ilike '%is_placeholder%'
        or coalesce(policies.with_check, '') ilike '%is_placeholder%')
  ) or exists (
    select 1
    from pg_catalog.pg_views as views
    where views.schemaname = 'public'
      and views.definition ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_matviews as views
    where views.schemaname = 'public'
      and views.definition ilike '%is_placeholder%'
  ) then
    raise exception 'FAIL: an active public database object still references is_placeholder';
  end if;

  for routine in
    select procedure.oid, procedure.prosecdef, procedure.proconfig, procedure.proacl, procedure.proowner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.calculate_production_wages(uuid, date)'::regprocedure,
      'public.calculate_mud_supply_wages(uuid, uuid, date)'::regprocedure
    )
  loop
    if not routine.prosecdef
      or not coalesce(routine.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public'] then
      raise exception 'FAIL: % does not retain SECURITY DEFINER with the safe search_path', routine.oid::regprocedure;
    end if;

    if not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      or has_function_privilege('anon', routine.oid, 'EXECUTE') then
      raise exception 'FAIL: % has incorrect authenticated/anonymous execution privileges', routine.oid::regprocedure;
    end if;

    select exists (
      select 1
      from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
      where privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) into public_can_execute;

    if public_can_execute then
      raise exception 'FAIL: PUBLIC can execute %', routine.oid::regprocedure;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.weekly_earnings', 'INSERT')
    or has_table_privilege('authenticated', 'public.weekly_earnings', 'UPDATE')
    or has_table_privilege('authenticated', 'public.weekly_earnings', 'DELETE')
    or not has_table_privilege('authenticated', 'public.weekly_earnings', 'SELECT') then
    raise exception 'FAIL: weekly_earnings browser permissions changed';
  end if;

  raise notice 'PASS: column removal, live dependency cleanup, function security, and permissions are correct';
end;
$$;

do $$
declare
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  mapping_id uuid;
  test_user_id uuid;
  brick_type_a_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  labourer_a1_id uuid := gen_random_uuid();
  labourer_a2_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
  group_b_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  completed_week_start date;
begin
  current_week_start := business_today - (extract(isodow from business_today)::integer - 1);
  completed_week_start := current_week_start - 7;

  select id, user_id
    into mapping_id, test_user_id
    from public.factory_users
    order by created_at
    limit 1
    for update;

  if test_user_id is null then
    raise exception 'FAIL: prerequisite missing: create an authenticated user with a factory_users mapping before running this script';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Module 2.10R3 Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.10R3 Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'Module 2.10R3 Factory A brick'),
    (brick_type_b_id, factory_b_id, 'Module 2.10R3 Factory B brick');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active)
  values
    (labourer_a1_id, factory_a_id, 'Module 2.10R3 Labourer A1', brick_type_a_id, true),
    (labourer_a2_id, factory_a_id, 'Module 2.10R3 Labourer A2', brick_type_a_id, false),
    (labourer_b_id, factory_b_id, 'Module 2.10R3 Labourer B', brick_type_b_id, true);

  insert into public.labour_groups (id, factory_id, name, member_count, is_active)
  values
    (group_a_id, factory_a_id, 'Module 2.10R3 Group A', 8, true),
    (group_b_id, factory_b_id, 'Module 2.10R3 Group B', 5, true);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  )
  values
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_type_a_id, completed_week_start, 60000),
    (gen_random_uuid(), factory_a_id, labourer_a2_id, brick_type_a_id, completed_week_start + 2, 40000),
    (gen_random_uuid(), factory_b_id, labourer_b_id, brick_type_b_id, completed_week_start, 50000);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.labourer_a1_id', labourer_a1_id::text, true);
  perform set_config('atlas_test.labourer_a2_id', labourer_a2_id::text, true);
  perform set_config('atlas_test.group_a_id', group_a_id::text, true);
  perform set_config('atlas_test.group_b_id', group_b_id::text, true);
  perform set_config('atlas_test.current_week_start', current_week_start::text, true);
  perform set_config('atlas_test.completed_week_start', completed_week_start::text, true);

  raise notice 'PASS: rollback-only normal-labourer fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'production RPC rejects a non-Monday week',
    '22023',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date + 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'production RPC rejects the current week',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.current_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud RPC rejects the current week',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.group_a_id')::uuid,
        current_setting('atlas_test.current_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'production RPC rejects a missing rate',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud RPC rejects a missing rate',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.group_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A user cannot calculate Factory B production wages',
    '42501',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_b_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A user cannot calculate Factory B mud wages',
    '42501',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_b_id')::uuid,
        current_setting('atlas_test.group_b_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );
end;
$$;

reset role;

do $$
declare
  production_rate_id uuid := gen_random_uuid();
  mud_rate_id uuid := gen_random_uuid();
begin
  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values
    (
      production_rate_id,
      current_setting('atlas_test.factory_a_id')::uuid,
      'production',
      520,
      current_setting('atlas_test.completed_week_start')::date - 7
    ),
    (
      mud_rate_id,
      current_setting('atlas_test.factory_a_id')::uuid,
      'mud_supply',
      230,
      current_setting('atlas_test.completed_week_start')::date - 7
    );

  perform set_config('atlas_test.production_rate_id', production_rate_id::text, true);
  perform set_config('atlas_test.mud_rate_id', mud_rate_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  production_first record;
  production_second record;
  mud_first record;
  mud_second record;
  group_earning public.weekly_earnings%rowtype;
begin
  select *
    into production_first
    from public.calculate_production_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if production_first.labourers_calculated <> 2
    or production_first.rows_skipped <> 0
    or (
      select count(*)
      from public.weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = current_setting('atlas_test.completed_week_start')::date
        and labourer_id is not null
    ) <> 2
    or (
      select sum(quantity_used)
      from public.weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = current_setting('atlas_test.completed_week_start')::date
        and labourer_id is not null
    ) <> 100000
    or (
      select sum(amount)
      from public.weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = current_setting('atlas_test.completed_week_start')::date
        and labourer_id is not null
    ) <> 52000
    or exists (
      select 1
      from public.weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and week_start = current_setting('atlas_test.completed_week_start')::date
        and labourer_id is not null
        and (wage_rate_id <> current_setting('atlas_test.production_rate_id')::uuid or rate_used <> 520)
    ) then
    raise exception 'FAIL: production wage snapshots changed after removing is_placeholder';
  end if;

  select *
    into production_second
    from public.calculate_production_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if production_second.labourers_calculated <> 0 or production_second.rows_skipped <> 2 then
    raise exception 'FAIL: production wage rerun is not idempotent';
  end if;

  select *
    into mud_first
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.group_a_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  select *
    into group_earning
    from public.weekly_earnings
    where id = mud_first.weekly_earning_id;

  if mud_first.groups_calculated <> 1
    or mud_first.rows_skipped <> 0
    or group_earning.labour_group_id <> current_setting('atlas_test.group_a_id')::uuid
    or group_earning.quantity_used <> 100000
    or group_earning.wage_rate_id <> current_setting('atlas_test.mud_rate_id')::uuid
    or group_earning.rate_used <> 230
    or group_earning.amount <> 23000 then
    raise exception 'FAIL: mud wage did not include all normal factory production with the unchanged formula';
  end if;

  select *
    into mud_second
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.group_a_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  if mud_second.weekly_earning_id <> mud_first.weekly_earning_id
    or mud_second.groups_calculated <> 0
    or mud_second.rows_skipped <> 1 then
    raise exception 'FAIL: mud wage rerun is not idempotent';
  end if;

  raise notice 'PASS: production and mud calculations, snapshots, formulas, and idempotency are unchanged';
end;
$$;

reset role;

do $$
begin
  insert into public.wage_rates (
    factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values
    (
      current_setting('atlas_test.factory_a_id')::uuid,
      'production',
      525,
      current_setting('atlas_test.completed_week_start')::date - 14
    ),
    (
      current_setting('atlas_test.factory_a_id')::uuid,
      'mud_supply',
      235,
      current_setting('atlas_test.completed_week_start')::date - 14
    );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'production RPC still rejects overlapping rates',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date - 7
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud RPC still rejects overlapping rates',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.group_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date - 7
      )
    $sql$
  );
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous user cannot execute production wage RPC',
    '42501',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'anonymous user cannot execute mud wage RPC',
    '42501',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.group_a_id')::uuid,
        current_setting('atlas_test.completed_week_start')::date
      )
    $sql$
  );
end;
$$;

reset role;

rollback;
