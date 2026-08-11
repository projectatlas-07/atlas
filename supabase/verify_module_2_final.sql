-- Atlas Module 2 final live database and security audit.
-- Paste this entire file into Supabase SQL Editor after all Module 2 migrations.
-- It requires one existing factory_users row. Every fixture and mapping change is
-- transactional and is discarded by the final ROLLBACK.

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

-- Final schema, privilege, RPC-hardening, and placeholder-removal audit.
do $$
declare
  required_constraint text;
  required_index text;
  table_name text;
  signature text;
  routine_oid oid;
  routine_security_definer boolean;
  routine_config text[];
  routine_definition text;
  public_can_execute boolean;
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.labourers'::regclass
      and attname = 'is_placeholder'
      and not attisdropped
  ) then
    raise exception 'FAIL: labourers.is_placeholder still exists';
  end if;

  if not coalesce((
    select attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'public.labourers'::regclass
      and attname = 'assigned_brick_type_id'
      and not attisdropped
  ), false) then
    raise exception 'FAIL: normal labourers no longer require a brick type';
  end if;

  if not coalesce((
    select attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'public.production_entries'::regclass
      and attname = 'brick_type_id'
      and not attisdropped
  ), false) then
    raise exception 'FAIL: production entries no longer require a brick-type snapshot';
  end if;

  foreach required_constraint in array array[
    'wage_rates_applies_to_check',
    'wage_rates_rate_per_1000_bricks_check',
    'wage_rates_effective_dates_check',
    'weekly_earnings_exactly_one_entity_check',
    'weekly_earnings_week_start_monday_check',
    'weekly_earnings_quantity_used_check',
    'weekly_earnings_rate_used_check',
    'weekly_earnings_amount_check',
    'withdrawals_exactly_one_entity_check',
    'withdrawals_amount_check',
    'labour_groups_member_count_check'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_constraint where conname = required_constraint
    ) then
      raise exception 'FAIL: required constraint % is missing', required_constraint;
    end if;
  end loop;

  foreach required_index in array array[
    'weekly_earnings_factory_labourer_week_key',
    'weekly_earnings_one_group_per_factory_week_idx',
    'labour_groups_one_active_per_factory_idx'
  ] loop
    if to_regclass('public.' || required_index) is null then
      raise exception 'FAIL: required index % is missing', required_index;
    end if;
  end loop;

  foreach table_name in array array[
    'labour_groups', 'wage_rates', 'weekly_earnings', 'withdrawals'
  ] loop
    if not coalesce((
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = format('public.%I', table_name)::regclass
    ), false) then
      raise exception 'FAIL: RLS is not enabled on public.%', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'FAIL: anon retains business-data privileges on public.%', table_name;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.labour_groups', 'SELECT')
    or not has_table_privilege('authenticated', 'public.labour_groups', 'INSERT')
    or not has_table_privilege('authenticated', 'public.labour_groups', 'UPDATE')
    or has_table_privilege('authenticated', 'public.labour_groups', 'DELETE') then
    raise exception 'FAIL: authenticated labour_groups privileges differ from the management contract';
  end if;

  foreach table_name in array array['wage_rates', 'weekly_earnings', 'withdrawals'] loop
    if not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'FAIL: authenticated privileges on public.% are not read-only', table_name;
    end if;
  end loop;

  foreach signature in array array[
    'public.create_wage_rate(uuid,text,numeric,date)',
    'public.calculate_production_wages(uuid,date)',
    'public.calculate_mud_supply_wages(uuid,uuid,date)',
    'public.create_labourer_withdrawal(uuid,uuid,date,numeric)',
    'public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'
  ] loop
    routine_oid := to_regprocedure(signature);
    if routine_oid is null then
      raise exception 'FAIL: required RPC % is missing', signature;
    end if;

    select prosecdef, proconfig, pg_catalog.pg_get_functiondef(oid),
      coalesce((
        select bool_or(expanded.grantee = 0 and expanded.privilege_type = 'EXECUTE')
        from pg_catalog.aclexplode(
          coalesce(pg_proc.proacl, pg_catalog.acldefault('f', pg_proc.proowner))
        ) as expanded
      ), false)
      into routine_security_definer, routine_config, routine_definition, public_can_execute
      from pg_catalog.pg_proc
      where oid = routine_oid;

    if not routine_security_definer then
      raise exception 'FAIL: RPC % is not SECURITY DEFINER', signature;
    end if;
    if not ('search_path=pg_catalog, public' = any(coalesce(routine_config, array[]::text[]))) then
      raise exception 'FAIL: RPC % lacks the safe explicit search_path', signature;
    end if;
    if not has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or has_function_privilege('anon', routine_oid, 'EXECUTE')
      or public_can_execute then
      raise exception 'FAIL: RPC % execute permissions are incorrect', signature;
    end if;
    if routine_definition not ilike '%pg_advisory_xact_lock%' then
      raise exception 'FAIL: RPC % lacks transaction-scoped advisory locking', signature;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind in ('f', 'p')
      and pg_catalog.pg_get_functiondef(procedure.oid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.connamespace = 'public'::regnamespace
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_index as index_record
    where pg_catalog.pg_get_indexdef(index_record.indexrelid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger_record.oid) ilike '%is_placeholder%'
  ) or exists (
    select 1
    from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and (coalesce(policies.qual, '') ilike '%is_placeholder%'
        or coalesce(policies.with_check, '') ilike '%is_placeholder%')
  ) or exists (
    select 1 from pg_catalog.pg_views
    where schemaname = 'public' and definition ilike '%is_placeholder%'
  ) or exists (
    select 1 from pg_catalog.pg_matviews
    where schemaname = 'public' and definition ilike '%is_placeholder%'
  ) then
    raise exception 'FAIL: an active public database object still references is_placeholder';
  end if;

  if to_regprocedure('public.ensure_factory_placeholder(uuid)') is not null
    or to_regprocedure('public.provision_new_factory_placeholder()') is not null
    or to_regprocedure('public.prevent_placeholder_labourer_weekly_earning()') is not null
    or to_regprocedure('public.require_normal_production_brick_type()') is not null
    or exists (
      select 1 from pg_catalog.pg_trigger
      where not tgisinternal
        and tgname in (
          'factories_provision_placeholder_labourer',
          'weekly_earnings_prevent_placeholder_labourer',
          'production_entries_require_normal_brick_type'
        )
    ) then
    raise exception 'FAIL: obsolete placeholder provisioning/guard objects remain active';
  end if;

  raise notice 'PASS: final schema, RLS, grants, RPC hardening, locks, and placeholder removal';
end;
$$;

-- Isolated two-factory fixture. The selected pilot mapping is restored by ROLLBACK.
do $$
declare
  audit_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  labourer_a1_id uuid := gen_random_uuid();
  labourer_a2_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
  historical_group_a_id uuid := gen_random_uuid();
  group_b_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week date;
  week_old date;
  week_calc date;
  week_next date;
begin
  select user_id
    into audit_user_id
    from public.factory_users
    order by created_at, id
    limit 1
    for update;

  if audit_user_id is null then
    raise exception 'FAIL: audit requires one existing factory_users row';
  end if;

  current_week := business_today - (extract(isodow from business_today)::integer - 1);
  week_old := current_week - 21;
  week_calc := current_week - 14;
  week_next := current_week - 7;

  insert into public.factories (id, name)
  values
    (factory_a_id, 'Module 2 Final Audit A ' || factory_a_id),
    (factory_b_id, 'Module 2 Final Audit B ' || factory_b_id);

  if exists (
    select 1 from public.labourers
    where factory_id in (factory_a_id, factory_b_id)
  ) then
    raise exception 'FAIL: new factories still receive synthetic placeholder labourers';
  end if;

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where user_id = audit_user_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_a_id, factory_a_id, 'Audit Brick A'),
    (brick_b_id, factory_b_id, 'Audit Brick B');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values
    (labourer_a1_id, factory_a_id, 'Audit Labourer A1', brick_a_id, true),
    (labourer_a2_id, factory_a_id, 'Audit Labourer A2 Inactive', brick_a_id, false),
    (labourer_b_id, factory_b_id, 'Audit Labourer B', brick_b_id, true);

  insert into public.labour_groups (
    id, factory_id, name, member_names, member_count, is_active
  ) values
    (group_a_id, factory_a_id, 'Audit Mud Group A', 'Eight members', 8, true),
    (historical_group_a_id, factory_a_id, 'Audit Historical Group A', 'Six members', 6, false),
    (group_b_id, factory_b_id, 'Audit Mud Group B', 'Five members', 5, true);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_a_id, week_calc, 60000),
    (gen_random_uuid(), factory_a_id, labourer_a2_id, brick_a_id, week_calc + 2, 40000),
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_a_id, week_calc - 1, 7777),
    (gen_random_uuid(), factory_a_id, labourer_a1_id, brick_a_id, current_week, 8888),
    (gen_random_uuid(), factory_b_id, labourer_b_id, brick_b_id, week_calc, 50000);

  perform set_config('atlas_audit.user_id', audit_user_id::text, true);
  perform set_config('atlas_audit.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_audit.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_audit.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_audit.brick_b_id', brick_b_id::text, true);
  perform set_config('atlas_audit.labourer_a1_id', labourer_a1_id::text, true);
  perform set_config('atlas_audit.labourer_a2_id', labourer_a2_id::text, true);
  perform set_config('atlas_audit.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_audit.group_a_id', group_a_id::text, true);
  perform set_config('atlas_audit.historical_group_a_id', historical_group_a_id::text, true);
  perform set_config('atlas_audit.group_b_id', group_b_id::text, true);
  perform set_config('atlas_audit.current_week', current_week::text, true);
  perform set_config('atlas_audit.week_old', week_old::text, true);
  perform set_config('atlas_audit.week_calc', week_calc::text, true);
  perform set_config('atlas_audit.week_next', week_next::text, true);
  perform set_config('atlas_audit.withdrawal_date', current_week::text, true);
  perform set_config('request.jwt.claim.sub', audit_user_id::text, true);

  raise notice 'PASS: isolated two-factory fixtures created, including inactive historical records';
end;
$$;

-- Core constraint and same-factory integrity checks.
do $$
begin
  perform pg_temp.expect_error(
    'a second active labour group in one factory is rejected',
    '23505',
    $sql$
      insert into public.labour_groups (factory_id, name, member_count, is_active)
      values (current_setting('atlas_audit.factory_a_id')::uuid, 'Second active audit group', 2, true)
    $sql$
  );

  perform pg_temp.expect_error(
    'non-positive labour-group member count is rejected',
    '23514',
    $sql$
      insert into public.labour_groups (factory_id, name, member_count, is_active)
      values (current_setting('atlas_audit.factory_a_id')::uuid, 'Invalid member count', 0, false)
    $sql$
  );

  perform pg_temp.expect_error(
    'invalid wage-rate track is rejected',
    '23514',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_audit.factory_a_id')::uuid, 'invalid', 1, current_setting('atlas_audit.week_old')::date)
    $sql$
  );

  perform pg_temp.expect_error(
    'zero wage rate is rejected',
    '23514',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_audit.factory_a_id')::uuid, 'production', 0, current_setting('atlas_audit.week_old')::date)
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory production labourer is rejected',
    '23503',
    $sql$
      insert into public.production_entries (id, factory_id, labourer_id, brick_type_id, production_date, quantity)
      values (
        gen_random_uuid(),
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_b_id')::uuid,
        current_setting('atlas_audit.brick_a_id')::uuid,
        current_setting('atlas_audit.week_next')::date,
        1
      )
    $sql$
  );

  raise notice 'PASS: core group, rate, and production constraints reject invalid data';
end;
$$;

-- Authenticated RPC validation, factory access, and effective-dated rates.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_audit.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'production calculation rejects a non-Monday week',
    '22023',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date + 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'production calculation rejects the current week',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.current_week')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'production calculation rejects a missing rate',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud calculation rejects a non-Monday week',
    '22023',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date + 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud calculation rejects the current week',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.current_week')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud calculation rejects a missing rate',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'create_wage_rate rejects a non-Monday date',
    '22023',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_audit.factory_a_id')::uuid,
        'production', 1::numeric,
        current_setting('atlas_audit.week_old')::date + 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'create_wage_rate rejects zero',
    '22023',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_audit.factory_a_id')::uuid,
        'production', 0::numeric,
        current_setting('atlas_audit.week_old')::date
      )
    $sql$
  );
end;
$$;

do $$
declare
  created_rate public.wage_rates%rowtype;
  prior_rate public.wage_rates%rowtype;
begin
  select * into created_rate from public.create_wage_rate(
    current_setting('atlas_audit.factory_a_id')::uuid,
    'production', 500::numeric,
    current_setting('atlas_audit.week_old')::date
  );
  prior_rate := created_rate;

  select * into created_rate from public.create_wage_rate(
    current_setting('atlas_audit.factory_a_id')::uuid,
    'production', 520::numeric,
    current_setting('atlas_audit.week_calc')::date
  );
  perform set_config('atlas_audit.production_rate_id', created_rate.id::text, true);

  select * into prior_rate from public.wage_rates where id = prior_rate.id;
  if prior_rate.effective_to <> current_setting('atlas_audit.week_calc')::date - 1
    or created_rate.effective_to is not null then
    raise exception 'FAIL: production rate history did not close on Sunday/open the new rate';
  end if;

  select * into created_rate from public.create_wage_rate(
    current_setting('atlas_audit.factory_a_id')::uuid,
    'mud_supply', 200::numeric,
    current_setting('atlas_audit.week_old')::date
  );
  prior_rate := created_rate;

  select * into created_rate from public.create_wage_rate(
    current_setting('atlas_audit.factory_a_id')::uuid,
    'mud_supply', 230::numeric,
    current_setting('atlas_audit.week_calc')::date
  );
  perform set_config('atlas_audit.mud_rate_id', created_rate.id::text, true);

  select * into prior_rate from public.wage_rates where id = prior_rate.id;
  if prior_rate.effective_to <> current_setting('atlas_audit.week_calc')::date - 1
    or created_rate.effective_to is not null then
    raise exception 'FAIL: mud rate history did not close on Sunday/open the new rate';
  end if;

  raise notice 'PASS: production and mud rate tracks close prior history independently';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'same-date production rate is rejected',
    'P0001',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_audit.factory_a_id')::uuid,
        'production', 530::numeric,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'backdated production rate is rejected',
    'P0001',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_audit.factory_a_id')::uuid,
        'production', 530::numeric,
        current_setting('atlas_audit.week_old')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A cannot create a Factory B wage rate',
    '42501',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_audit.factory_b_id')::uuid,
        'production', 500::numeric,
        current_setting('atlas_audit.week_old')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A cannot calculate Factory B production wages',
    '42501',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_audit.factory_b_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A cannot calculate Factory B mud wages',
    '42501',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_b_id')::uuid,
        current_setting('atlas_audit.group_b_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'an inactive labour group cannot receive a new mud earning',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.historical_group_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );

  raise notice 'PASS: rate validation, authorization, and active-group eligibility';
end;
$$;

-- Authoritative production and mud calculations, snapshots, and idempotency.
do $$
declare
  production_result record;
  mud_result record;
  labourer_rows integer;
  total_quantity numeric;
  total_amount numeric;
  snapshot_rate_id uuid;
  snapshot_rate numeric;
  snapshot_group_id uuid;
  mud_earning_id uuid;
begin
  select * into production_result
  from public.calculate_production_wages(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.week_calc')::date
  );

  if production_result.labourers_calculated <> 2 or production_result.rows_skipped <> 0 then
    raise exception 'FAIL: first production calculation returned % calculated/% skipped',
      production_result.labourers_calculated, production_result.rows_skipped;
  end if;

  select count(*), sum(quantity_used), sum(amount), max(wage_rate_id::text)::uuid, min(rate_used)
    into labourer_rows, total_quantity, total_amount, snapshot_rate_id, snapshot_rate
    from public.weekly_earnings
    where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
      and week_start = current_setting('atlas_audit.week_calc')::date
      and labourer_id is not null;

  if labourer_rows <> 2 or total_quantity <> 100000 or total_amount <> 52000
    or snapshot_rate_id <> current_setting('atlas_audit.production_rate_id')::uuid
    or snapshot_rate <> 520 then
    raise exception 'FAIL: production snapshot/formula does not equal 100000 / 1000 * 520 = 52000';
  end if;

  select * into production_result
  from public.calculate_production_wages(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.week_calc')::date
  );
  if production_result.labourers_calculated <> 0 or production_result.rows_skipped <> 2 then
    raise exception 'FAIL: production rerun is not idempotent';
  end if;

  select * into mud_result
  from public.calculate_mud_supply_wages(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.group_a_id')::uuid,
    current_setting('atlas_audit.week_calc')::date
  );

  if mud_result.groups_calculated <> 1 or mud_result.rows_skipped <> 0 then
    raise exception 'FAIL: first mud calculation returned an unexpected summary';
  end if;
  mud_earning_id := mud_result.weekly_earning_id;
  perform set_config('atlas_audit.mud_earning_id', mud_earning_id::text, true);

  select quantity_used, amount, wage_rate_id, rate_used, labour_group_id
    into total_quantity, total_amount, snapshot_rate_id, snapshot_rate, snapshot_group_id
    from public.weekly_earnings
    where id = mud_earning_id;

  if total_quantity <> 100000 or total_amount <> 23000
    or snapshot_rate_id <> current_setting('atlas_audit.mud_rate_id')::uuid
    or snapshot_rate <> 230
    or snapshot_group_id <> current_setting('atlas_audit.group_a_id')::uuid then
    raise exception 'FAIL: mud snapshot/formula does not equal 100000 / 1000 * 230 = 23000';
  end if;

  select * into mud_result
  from public.calculate_mud_supply_wages(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.group_a_id')::uuid,
    current_setting('atlas_audit.week_calc')::date
  );
  if mud_result.weekly_earning_id <> mud_earning_id
    or mud_result.groups_calculated <> 0 or mud_result.rows_skipped <> 1 then
    raise exception 'FAIL: mud rerun did not return the existing locked earning';
  end if;

  raise notice 'PASS: Mon-Sun production includes inactive labourer work and excludes out-of-week rows';
  raise notice 'PASS: production/mud formulas, stored snapshots, rerun idempotency, and member-count independence';
end;
$$;

-- Later rate/member/production changes must not rewrite locked snapshots.
do $$
declare
  created_rate public.wage_rates%rowtype;
begin
  select * into created_rate from public.create_wage_rate(
    current_setting('atlas_audit.factory_a_id')::uuid,
    'production', 530::numeric,
    current_setting('atlas_audit.week_next')::date
  );
  perform set_config('atlas_audit.production_future_rate_id', created_rate.id::text, true);

  select * into created_rate from public.create_wage_rate(
    current_setting('atlas_audit.factory_a_id')::uuid,
    'mud_supply', 240::numeric,
    current_setting('atlas_audit.week_next')::date
  );
  perform set_config('atlas_audit.mud_future_rate_id', created_rate.id::text, true);

  if not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_audit.production_rate_id')::uuid
      and effective_to = current_setting('atlas_audit.week_next')::date - 1
  ) or not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_audit.mud_rate_id')::uuid
      and effective_to = current_setting('atlas_audit.week_next')::date - 1
  ) then
    raise exception 'FAIL: adding later rates did not close both current histories';
  end if;

  update public.labour_groups
  set member_count = 4
  where id = current_setting('atlas_audit.group_a_id')::uuid
    and factory_id = current_setting('atlas_audit.factory_a_id')::uuid;

  if not found then
    raise exception 'FAIL: active group member-count update was unexpectedly blocked';
  end if;
end;
$$;

reset role;

update public.production_entries
set quantity = 1
where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
  and production_date between current_setting('atlas_audit.week_calc')::date
    and current_setting('atlas_audit.week_calc')::date + 6;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_audit.user_id'), true);

do $$
declare
  production_result record;
  mud_result record;
  locked_quantity numeric;
  locked_amount numeric;
begin
  select * into production_result
  from public.calculate_production_wages(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.week_calc')::date
  );
  select * into mud_result
  from public.calculate_mud_supply_wages(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.group_a_id')::uuid,
    current_setting('atlas_audit.week_calc')::date
  );

  if production_result.labourers_calculated <> 0 or production_result.rows_skipped <> 2
    or mud_result.groups_calculated <> 0 or mud_result.rows_skipped <> 1 then
    raise exception 'FAIL: recalculation attempted to replace locked history';
  end if;

  select sum(quantity_used), sum(amount)
    into locked_quantity, locked_amount
    from public.weekly_earnings
    where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
      and week_start = current_setting('atlas_audit.week_calc')::date
      and labourer_id is not null;
  if locked_quantity <> 100000 or locked_amount <> 52000 then
    raise exception 'FAIL: production history changed after source production/rate changes';
  end if;

  select quantity_used, amount
    into locked_quantity, locked_amount
    from public.weekly_earnings
    where id = current_setting('atlas_audit.mud_earning_id')::uuid;
  if locked_quantity <> 100000 or locked_amount <> 23000 then
    raise exception 'FAIL: mud history changed after production/rate/member-count changes';
  end if;

  raise notice 'PASS: locked production and mud history survives later source, rate, and member-count changes';
end;
$$;

reset role;

insert into public.wage_rates (
  factory_id, applies_to, rate_per_1000_bricks, effective_from
) values
  (
    current_setting('atlas_audit.factory_a_id')::uuid,
    'production', 535,
    current_setting('atlas_audit.week_next')::date
  ),
  (
    current_setting('atlas_audit.factory_a_id')::uuid,
    'mud_supply', 245,
    current_setting('atlas_audit.week_next')::date
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_audit.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'overlapping production rates are rejected by calculation',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.week_next')::date
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'overlapping mud rates are rejected by calculation',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.week_next')::date
      )
    $sql$
  );

  raise notice 'PASS: overlapping effective-dated production and mud rates fail visibly';
end;
$$;

-- Additional isolated snapshots for cross-factory, RLS, and withdrawal checks.
reset role;

do $$
declare
  production_rate_b_id uuid := gen_random_uuid();
  mud_rate_b_id uuid := gen_random_uuid();
  old_mud_rate_a_id uuid;
begin
  select id into old_mud_rate_a_id
  from public.wage_rates
  where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
    and applies_to = 'mud_supply'
    and effective_from = current_setting('atlas_audit.week_old')::date;

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values
    (
      production_rate_b_id,
      current_setting('atlas_audit.factory_b_id')::uuid,
      'production', 500,
      current_setting('atlas_audit.week_old')::date
    ),
    (
      mud_rate_b_id,
      current_setting('atlas_audit.factory_b_id')::uuid,
      'mud_supply', 200,
      current_setting('atlas_audit.week_old')::date
    );

  insert into public.weekly_earnings (
    factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  ) values
    (
      current_setting('atlas_audit.factory_b_id')::uuid,
      current_setting('atlas_audit.labourer_b_id')::uuid,
      current_setting('atlas_audit.week_calc')::date,
      50000, production_rate_b_id, 500, 25000
    ),
    (
      current_setting('atlas_audit.factory_a_id')::uuid,
      current_setting('atlas_audit.labourer_a1_id')::uuid,
      current_setting('atlas_audit.current_week')::date,
      1,
      current_setting('atlas_audit.production_future_rate_id')::uuid,
      530, 999
    );

  insert into public.weekly_earnings (
    factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  ) values
    (
      current_setting('atlas_audit.factory_b_id')::uuid,
      current_setting('atlas_audit.group_b_id')::uuid,
      current_setting('atlas_audit.week_calc')::date,
      50000, mud_rate_b_id, 200, 10000
    ),
    (
      current_setting('atlas_audit.factory_a_id')::uuid,
      current_setting('atlas_audit.group_a_id')::uuid,
      current_setting('atlas_audit.current_week')::date,
      1,
      current_setting('atlas_audit.mud_future_rate_id')::uuid,
      240, 999
    ),
    (
      current_setting('atlas_audit.factory_a_id')::uuid,
      current_setting('atlas_audit.historical_group_a_id')::uuid,
      current_setting('atlas_audit.week_old')::date,
      5000, old_mud_rate_a_id, 200, 1000
    );

  insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
  values (
    current_setting('atlas_audit.factory_b_id')::uuid,
    current_setting('atlas_audit.labourer_b_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    100
  );

  insert into public.withdrawals (factory_id, labour_group_id, withdrawal_date, amount)
  values (
    current_setting('atlas_audit.factory_b_id')::uuid,
    current_setting('atlas_audit.group_b_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    100
  );

  perform set_config('atlas_audit.production_rate_b_id', production_rate_b_id::text, true);
  perform set_config('atlas_audit.mud_rate_b_id', mud_rate_b_id::text, true);
  raise notice 'PASS: isolated Factory B and current-week financial snapshots created';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'weekly earning with both entity fields is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, labour_group_id, week_start,
        quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.week_old')::date,
        1, current_setting('atlas_audit.production_rate_id')::uuid, 1, 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'weekly earning with neither entity field is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.week_old')::date,
        1, current_setting('atlas_audit.production_rate_id')::uuid, 1, 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'withdrawal with both entity fields is rejected',
    '23514',
    $sql$
      insert into public.withdrawals (
        factory_id, labourer_id, labour_group_id, withdrawal_date, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'withdrawal with neither entity field is rejected',
    '23514',
    $sql$
      insert into public.withdrawals (factory_id, withdrawal_date, amount)
      values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory labourer earning is rejected',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_b_id')::uuid,
        current_setting('atlas_audit.week_old')::date,
        1, current_setting('atlas_audit.production_rate_id')::uuid, 1, 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory group earning is rejected',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_b_id')::uuid,
        current_setting('atlas_audit.week_next')::date,
        1, current_setting('atlas_audit.mud_rate_id')::uuid, 1, 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory wage-rate snapshot is rejected',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.week_old')::date,
        1, current_setting('atlas_audit.production_rate_b_id')::uuid, 1, 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory labourer withdrawal is rejected',
    '23503',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_b_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory group withdrawal is rejected',
    '23503',
    $sql$
      insert into public.withdrawals (factory_id, labour_group_id, withdrawal_date, amount)
      values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_b_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'a second group earning for one factory/week is rejected',
    '23505',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.historical_group_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date,
        1, current_setting('atlas_audit.mud_rate_id')::uuid, 1, 1
      )
    $sql$
  );

  raise notice 'PASS: entity XOR, same-factory references, and one group earning per factory/week';
end;
$$;

-- Runtime RLS isolation and direct-write restrictions for Factory A.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_audit.user_id'), true);

do $$
declare
  visible_rows integer;
  affected_rows integer;
begin
  select count(*) into visible_rows from public.labour_groups
  where factory_id = current_setting('atlas_audit.factory_b_id')::uuid;
  if visible_rows <> 0 then raise exception 'FAIL: Factory A can read Factory B labour groups'; end if;

  select count(*) into visible_rows from public.wage_rates
  where factory_id = current_setting('atlas_audit.factory_b_id')::uuid;
  if visible_rows <> 0 then raise exception 'FAIL: Factory A can read Factory B wage rates'; end if;

  select count(*) into visible_rows from public.weekly_earnings
  where factory_id = current_setting('atlas_audit.factory_b_id')::uuid;
  if visible_rows <> 0 then raise exception 'FAIL: Factory A can read Factory B weekly earnings'; end if;

  select count(*) into visible_rows from public.withdrawals
  where factory_id = current_setting('atlas_audit.factory_b_id')::uuid;
  if visible_rows <> 0 then raise exception 'FAIL: Factory A can read Factory B withdrawals'; end if;

  select count(*) into visible_rows from public.weekly_earnings
  where factory_id = current_setting('atlas_audit.factory_a_id')::uuid;
  if visible_rows = 0 then raise exception 'FAIL: Factory A cannot read its own weekly earnings'; end if;

  update public.labour_groups set member_names = 'blocked'
  where id = current_setting('atlas_audit.group_b_id')::uuid
    and factory_id = current_setting('atlas_audit.factory_b_id')::uuid;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then raise exception 'FAIL: Factory A updated Factory B labour group'; end if;

  raise notice 'PASS: Factory A reads its own data and cannot read/update Factory B Module 2 rows';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'Factory A cannot insert a Factory B labour group',
    '42501',
    $sql$
      insert into public.labour_groups (factory_id, name, member_count, is_active)
      values (current_setting('atlas_audit.factory_b_id')::uuid, 'Blocked group', 2, false)
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot directly insert wage rates',
    '42501',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_audit.factory_a_id')::uuid, 'production', 1, current_setting('atlas_audit.week_old')::date)
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot directly update wage rates',
    '42501',
    $sql$
      update public.wage_rates set rate_per_1000_bricks = 1
      where factory_id = current_setting('atlas_audit.factory_b_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot directly insert weekly earnings',
    '42501',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.week_old')::date,
        1, current_setting('atlas_audit.production_rate_id')::uuid, 1, 1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot update locked weekly earnings',
    '42501',
    $sql$
      update public.weekly_earnings set amount = amount + 1
      where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot delete locked weekly earnings',
    '42501',
    $sql$
      delete from public.weekly_earnings
      where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot directly insert withdrawals',
    '42501',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot update withdrawal history',
    '42501',
    $sql$
      update public.withdrawals set amount = amount + 1
      where factory_id = current_setting('atlas_audit.factory_b_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated cannot delete withdrawal history',
    '42501',
    $sql$
      delete from public.withdrawals
      where factory_id = current_setting('atlas_audit.factory_b_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A cannot invoke labourer withdrawal RPC for Factory B',
    '42501',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_audit.factory_b_id')::uuid,
        current_setting('atlas_audit.labourer_b_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1::numeric
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A cannot invoke group withdrawal RPC for Factory B',
    '42501',
    $sql$
      select * from public.create_labour_group_withdrawal(
        current_setting('atlas_audit.factory_b_id')::uuid,
        current_setting('atlas_audit.group_b_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1::numeric
      )
    $sql$
  );

  raise notice 'PASS: direct financial writes and cross-factory authoritative RPC calls are blocked';
end;
$$;

-- Labourer withdrawal balance boundaries and lock/recheck behavior.
do $$
declare
  result record;
  withdrawn_total numeric;
begin
  select * into result from public.create_labourer_withdrawal(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.labourer_a1_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    10000::numeric
  );
  if result.available_balance <> 21200
    or result.withdrawal_labourer_id <> current_setting('atlas_audit.labourer_a1_id')::uuid then
    raise exception 'FAIL: partial labourer withdrawal did not return balance 21200';
  end if;

  select * into result from public.create_labourer_withdrawal(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.labourer_a1_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    21200::numeric
  );
  if result.available_balance <> 0 then
    raise exception 'FAIL: full labourer withdrawal did not return zero balance';
  end if;

  perform pg_temp.expect_error(
    'labourer over-withdrawal is rejected after full withdrawal',
    'P0001',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1::numeric
      )
    $sql$
  );

  select * into result from public.create_labourer_withdrawal(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.labourer_a2_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    12000::numeric
  );
  if result.available_balance <> 8800 then
    raise exception 'FAIL: competing-withdrawal fixture has wrong remaining balance';
  end if;

  perform pg_temp.expect_error(
    'second competing labourer withdrawal rechecks balance and cannot overdraw',
    'P0001',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a2_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        9000::numeric
      )
    $sql$
  );

  select coalesce(sum(amount), 0) into withdrawn_total
  from public.withdrawals
  where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
    and labourer_id = current_setting('atlas_audit.labourer_a2_id')::uuid;
  if withdrawn_total <> 12000 then
    raise exception 'FAIL: rejected competing labourer withdrawal inserted a row';
  end if;

  perform pg_temp.expect_error(
    'labourer withdrawal rejects a zero amount',
    '22023',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a2_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        0::numeric
      )
    $sql$
  );

  raise notice 'PASS: labourer balance uses completed locked earnings, excludes current-week earnings, and prevents overdraw';
  raise notice 'PASS: labourer advisory lock plus post-lock balance recheck protects competing withdrawals';
end;
$$;

-- Group withdrawal balance boundaries, inactive history, and separation.
do $$
declare
  result record;
  withdrawn_total numeric;
begin
  select * into result from public.create_labour_group_withdrawal(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.group_a_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    10000::numeric
  );
  if result.available_balance <> 13000
    or result.withdrawal_labour_group_id <> current_setting('atlas_audit.group_a_id')::uuid then
    raise exception 'FAIL: partial group withdrawal did not return balance 13000';
  end if;

  select * into result from public.create_labour_group_withdrawal(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.group_a_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    13000::numeric
  );
  if result.available_balance <> 0 then
    raise exception 'FAIL: full group withdrawal did not return zero balance';
  end if;

  perform pg_temp.expect_error(
    'group over-withdrawal is rejected after full withdrawal',
    'P0001',
    $sql$
      select * from public.create_labour_group_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1::numeric
      )
    $sql$
  );

  select * into result from public.create_labour_group_withdrawal(
    current_setting('atlas_audit.factory_a_id')::uuid,
    current_setting('atlas_audit.historical_group_a_id')::uuid,
    current_setting('atlas_audit.withdrawal_date')::date,
    600::numeric
  );
  if result.available_balance <> 400 then
    raise exception 'FAIL: inactive historical group balance was not preserved';
  end if;

  perform pg_temp.expect_error(
    'second competing group withdrawal rechecks balance and cannot overdraw',
    'P0001',
    $sql$
      select * from public.create_labour_group_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.historical_group_a_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        500::numeric
      )
    $sql$
  );

  select coalesce(sum(amount), 0) into withdrawn_total
  from public.withdrawals
  where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
    and labour_group_id = current_setting('atlas_audit.historical_group_a_id')::uuid
    and labourer_id is null;
  if withdrawn_total <> 600 then
    raise exception 'FAIL: rejected competing group withdrawal inserted a row';
  end if;

  if exists (
    select 1 from public.withdrawals
    where factory_id = current_setting('atlas_audit.factory_a_id')::uuid
      and ((labourer_id is not null and labour_group_id is not null)
        or (labourer_id is null and labour_group_id is null))
  ) then
    raise exception 'FAIL: labourer/group withdrawal separation was lost';
  end if;

  raise notice 'PASS: group balance uses completed locked group earnings only and prevents overdraw';
  raise notice 'PASS: group advisory lock plus post-lock balance recheck protects competing withdrawals';
end;
$$;

-- Anonymous users must have neither table access nor authoritative RPC access.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  perform pg_temp.expect_error(
    'anon cannot read labour groups', '42501',
    'select count(*) from public.labour_groups'
  );
  perform pg_temp.expect_error(
    'anon cannot read wage rates', '42501',
    'select count(*) from public.wage_rates'
  );
  perform pg_temp.expect_error(
    'anon cannot read weekly earnings', '42501',
    'select count(*) from public.weekly_earnings'
  );
  perform pg_temp.expect_error(
    'anon cannot read withdrawals', '42501',
    'select count(*) from public.withdrawals'
  );
  perform pg_temp.expect_error(
    'anon cannot execute create_wage_rate', '42501',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_audit.factory_a_id')::uuid,
        'production', 1::numeric,
        current_setting('atlas_audit.week_next')::date
      )
    $sql$
  );
  perform pg_temp.expect_error(
    'anon cannot execute production wage calculation', '42501',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );
  perform pg_temp.expect_error(
    'anon cannot execute mud wage calculation', '42501',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.week_calc')::date
      )
    $sql$
  );
  perform pg_temp.expect_error(
    'anon cannot execute labourer withdrawal', '42501',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.labourer_a1_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1::numeric
      )
    $sql$
  );
  perform pg_temp.expect_error(
    'anon cannot execute group withdrawal', '42501',
    $sql$
      select * from public.create_labour_group_withdrawal(
        current_setting('atlas_audit.factory_a_id')::uuid,
        current_setting('atlas_audit.group_a_id')::uuid,
        current_setting('atlas_audit.withdrawal_date')::date,
        1::numeric
      )
    $sql$
  );

  raise notice 'PASS: anonymous Module 2 table and RPC access is blocked';
end;
$$;

reset role;

do $$
begin
  raise notice 'PASS: FINAL MODULE 2 DATABASE AND SECURITY AUDIT COMPLETED';
  raise notice 'PASS: all audit fixtures and mapping changes will now be rolled back';
end;
$$;

rollback;
