-- Run this entire file in the Supabase SQL Editor after applying Module 2.10R1.
-- It requires one existing public.factory_users row. Every fixture and mapping
-- change is discarded by the final rollback.

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

create or replace function pg_temp.assert_placeholder_cleanup_safe()
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.weekly_earnings
    join public.labourers
      on labourers.id = weekly_earnings.labourer_id
      and labourers.factory_id = weekly_earnings.factory_id
    where labourers.is_placeholder
  ) then
    raise exception 'Placeholder cleanup aborted: a placeholder labourer is referenced by weekly_earnings.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.withdrawals
    join public.labourers
      on labourers.id = withdrawals.labourer_id
      and labourers.factory_id = withdrawals.factory_id
    where labourers.is_placeholder
  ) then
    raise exception 'Placeholder cleanup aborted: a placeholder labourer is referenced by withdrawals.'
      using errcode = 'P0001';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.labourers
    where is_placeholder
  ) then
    raise exception 'FAIL: placeholder labourer rows remain after cleanup';
  end if;

  if exists (
    select 1
    from public.production_entries
    join public.labourers
      on labourers.id = production_entries.labourer_id
      and labourers.factory_id = production_entries.factory_id
    where labourers.is_placeholder
  ) then
    raise exception 'FAIL: placeholder production rows remain after cleanup';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger
    where (tgrelid = 'public.factories'::regclass and tgname = 'factories_provision_placeholder_labourer')
      or (tgrelid = 'public.weekly_earnings'::regclass and tgname = 'weekly_earnings_prevent_placeholder_labourer')
      or (tgrelid = 'public.production_entries'::regclass and tgname = 'production_entries_require_normal_brick_type')
  ) then
    raise exception 'FAIL: a placeholder workflow trigger still exists';
  end if;

  if to_regprocedure('public.ensure_factory_placeholder(uuid)') is not null
    or to_regprocedure('public.provision_new_factory_placeholder()') is not null
    or to_regprocedure('public.prevent_placeholder_labourer_weekly_earning()') is not null
    or to_regprocedure('public.require_normal_production_brick_type()') is not null then
    raise exception 'FAIL: a placeholder workflow function still exists';
  end if;

  raise notice 'PASS: placeholder rows, triggers, and functions are removed';
end;
$$;

do $$
declare
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  factory_user_mapping_id uuid;
  test_user_id uuid;
  brick_type_a1_id uuid := gen_random_uuid();
  brick_type_a2_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  normal_a_id uuid := gen_random_uuid();
  normal_b_id uuid := gen_random_uuid();
  normal_entry_id uuid := gen_random_uuid();
  normal_b_entry_id uuid := gen_random_uuid();
  placeholder_financial_test_id uuid := gen_random_uuid();
  production_rate_id uuid := gen_random_uuid();
begin
  select id, user_id
    into factory_user_mapping_id, test_user_id
    from public.factory_users
    order by created_at
    limit 1
    for update;

  if test_user_id is null then
    raise exception 'FAIL: prerequisite missing: create an authenticated user with a factory_users mapping before running this script';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Module 2.10R1 Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.10R1 Factory B %s', factory_b_id));

  if exists (
    select 1
    from public.labourers
    where factory_id in (factory_a_id, factory_b_id)
  ) then
    raise exception 'FAIL: a new factory still automatically receives a placeholder';
  end if;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a1_id, factory_a_id, 'Module 2.10R1 Factory A brick type 1'),
    (brick_type_a2_id, factory_a_id, 'Module 2.10R1 Factory A brick type 2'),
    (brick_type_b_id, factory_b_id, 'Module 2.10R1 Factory B brick type');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder, is_active
  )
  values
    (normal_a_id, factory_a_id, 'Module 2.10R1 normal labourer A', brick_type_a1_id, false, true),
    (normal_b_id, factory_b_id, 'Module 2.10R1 normal labourer B', brick_type_b_id, false, true),
    (placeholder_financial_test_id, factory_a_id, 'Module 2.10R1 financial safety placeholder', brick_type_a1_id, true, true);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  )
  values
    (
      normal_entry_id,
      factory_a_id,
      normal_a_id,
      brick_type_a1_id,
      date '2026-08-10',
      2000
    ),
    (
      normal_b_entry_id,
      factory_b_id,
      normal_b_id,
      brick_type_b_id,
      date '2026-08-10',
      3000
    );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values (
    production_rate_id,
    factory_a_id,
    'production',
    520,
    date '2026-08-03'
  );

  insert into public.weekly_earnings (
    factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    factory_a_id,
    placeholder_financial_test_id,
    date '2026-08-03',
    1000,
    production_rate_id,
    520,
    520
  );

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = factory_user_mapping_id;

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.brick_type_a1_id', brick_type_a1_id::text, true);
  perform set_config('atlas_test.brick_type_a2_id', brick_type_a2_id::text, true);
  perform set_config('atlas_test.brick_type_b_id', brick_type_b_id::text, true);
  perform set_config('atlas_test.normal_a_id', normal_a_id::text, true);
  perform set_config('atlas_test.normal_b_id', normal_b_id::text, true);
  perform set_config('atlas_test.normal_entry_id', normal_entry_id::text, true);
  perform set_config('atlas_test.placeholder_financial_test_id', placeholder_financial_test_id::text, true);

  raise notice 'PASS: new factories no longer auto-provision placeholders';
  raise notice 'PASS: normal labourer and production fixtures remain valid';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'placeholder weekly-earning reference aborts cleanup',
    'P0001',
    'select pg_temp.assert_placeholder_cleanup_safe()'
  );

  delete from public.weekly_earnings
  where labourer_id = current_setting('atlas_test.placeholder_financial_test_id')::uuid;

  insert into public.withdrawals (
    factory_id, labourer_id, withdrawal_date, amount
  )
  values (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.placeholder_financial_test_id')::uuid,
    date '2026-08-10',
    100
  );

  perform pg_temp.expect_error(
    'placeholder withdrawal reference aborts cleanup',
    'P0001',
    'select pg_temp.assert_placeholder_cleanup_safe()'
  );

  perform pg_temp.expect_error(
    'normal labourer cannot have null brick type',
    '23502',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.10R1 invalid labourer',
        null,
        false
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'production entry cannot have null brick type',
    '23502',
    $sql$
      insert into public.production_entries (
        id, factory_id, labourer_id, brick_type_id, production_date, quantity
      )
      values (
        gen_random_uuid(),
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.normal_a_id')::uuid,
        null,
        date '2026-08-11',
        1000
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'normal labourer cannot use a cross-factory brick type',
    '23503',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.10R1 cross-factory labourer',
        current_setting('atlas_test.brick_type_b_id')::uuid,
        false
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'normal production cannot use a cross-factory brick snapshot',
    '23503',
    $sql$
      insert into public.production_entries (
        id, factory_id, labourer_id, brick_type_id, production_date, quantity
      )
      values (
        gen_random_uuid(),
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.normal_a_id')::uuid,
        current_setting('atlas_test.brick_type_b_id')::uuid,
        date '2026-08-11',
        1000
      )
    $sql$
  );
end;
$$;

do $$
declare
  original_snapshot uuid;
  snapshot_after_reassignment uuid;
begin
  select brick_type_id
    into original_snapshot
    from public.production_entries
    where id = current_setting('atlas_test.normal_entry_id')::uuid;

  update public.labourers
  set assigned_brick_type_id = current_setting('atlas_test.brick_type_a2_id')::uuid
  where id = current_setting('atlas_test.normal_a_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  select brick_type_id
    into snapshot_after_reassignment
    from public.production_entries
    where id = current_setting('atlas_test.normal_entry_id')::uuid;

  if original_snapshot <> current_setting('atlas_test.brick_type_a1_id')::uuid
    or snapshot_after_reassignment <> original_snapshot then
    raise exception 'FAIL: normal historical brick snapshot changed during labourer reassignment';
  end if;

  raise notice 'PASS: normal historical production brick snapshot remains intact';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if not exists (
    select 1
    from public.labourers
    where id = current_setting('atlas_test.normal_a_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user cannot read its normal labourer';
  end if;

  if exists (
    select 1
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user can read Factory B labourers';
  end if;

  if not exists (
    select 1
    from public.production_entries
    where id = current_setting('atlas_test.normal_entry_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user cannot read its normal production';
  end if;

  if exists (
    select 1
    from public.production_entries
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user can read Factory B production';
  end if;

  raise notice 'PASS: labourer and production factory isolation remains intact';
end;
$$;

reset role;

do $$
declare
  labourer_brick_type_not_null boolean;
  production_brick_type_not_null boolean;
begin
  select attnotnull
    into labourer_brick_type_not_null
    from pg_catalog.pg_attribute
    where attrelid = 'public.labourers'::regclass
      and attname = 'assigned_brick_type_id'
      and not attisdropped;

  select attnotnull
    into production_brick_type_not_null
    from pg_catalog.pg_attribute
    where attrelid = 'public.production_entries'::regclass
      and attname = 'brick_type_id'
      and not attisdropped;

  if not labourer_brick_type_not_null or not production_brick_type_not_null then
    raise exception 'FAIL: original NOT NULL brick-type guarantees were not restored';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.production_entries'::regclass
      and conname = 'production_entries_factory_labourer_date_key'
      and contype = 'u'
  ) then
    raise exception 'FAIL: daily production uniqueness constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.production_entries'::regclass
      and conname = 'production_entries_brick_type_factory_fkey'
      and contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.labourers'::regclass
      and conname = 'labourers_assigned_brick_type_factory_fkey'
      and contype = 'f'
  ) then
    raise exception 'FAIL: same-factory brick-type foreign keys are missing';
  end if;

  raise notice 'PASS: NOT NULL, uniqueness, and same-factory constraints are restored';
end;
$$;

rollback;
