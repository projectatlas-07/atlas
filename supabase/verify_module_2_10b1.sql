-- Run this entire file in the Supabase SQL Editor after applying Module 2.10B1.
-- Every fixture is discarded by the final rollback.

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
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_type_a_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  normal_a_id uuid := gen_random_uuid();
  placeholder_a_id uuid := gen_random_uuid();
  placeholder_b_id uuid := gen_random_uuid();
  production_rate_a_id uuid := gen_random_uuid();
begin
  insert into public.factories (id, name)
  values
    (factory_a_id, format('Module 2.10B1 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.10B1 verification Factory B %s', factory_b_id));

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'Module 2.10B1 Factory A brick type'),
    (brick_type_b_id, factory_b_id, 'Module 2.10B1 Factory B brick type');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder
  )
  values (
    normal_a_id,
    factory_a_id,
    'Module 2.10B1 normal labourer',
    brick_type_a_id,
    false
  );

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder
  )
  values (
    placeholder_a_id,
    factory_a_id,
    'Module 2.10B1 null-brick placeholder',
    null,
    true
  );

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder
  )
  values (
    placeholder_b_id,
    factory_b_id,
    'Module 2.10B1 assigned-brick placeholder',
    brick_type_b_id,
    true
  );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values (
    production_rate_a_id,
    factory_a_id,
    'production',
    520,
    date '2026-08-03'
  );

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_type_a_id', brick_type_a_id::text, true);
  perform set_config('atlas_test.brick_type_b_id', brick_type_b_id::text, true);
  perform set_config('atlas_test.normal_a_id', normal_a_id::text, true);
  perform set_config('atlas_test.placeholder_a_id', placeholder_a_id::text, true);
  perform set_config('atlas_test.placeholder_b_id', placeholder_b_id::text, true);
  perform set_config('atlas_test.production_rate_a_id', production_rate_a_id::text, true);

  raise notice 'PASS: normal labourer with a valid same-factory brick type succeeds';
  raise notice 'PASS: placeholder with a null brick type succeeds';
  raise notice 'PASS: placeholder with a valid same-factory brick type remains valid';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'normal labourer with null brick type is rejected',
    '23514',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.10B1 invalid normal labourer',
        null,
        false
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory brick-type assignment remains rejected',
    '23503',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.10B1 cross-factory labourer',
        current_setting('atlas_test.brick_type_b_id')::uuid,
        false
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'changing a normal labourer brick type to null is rejected',
    '23514',
    $sql$
      update public.labourers
      set assigned_brick_type_id = null
      where id = current_setting('atlas_test.normal_a_id')::uuid
        and factory_id = current_setting('atlas_test.factory_a_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'existing one-placeholder-per-factory rule remains enforced',
    '23505',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.10B1 duplicate placeholder',
        null,
        true
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'existing placeholder weekly-earning guard remains enforced',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.placeholder_a_id')::uuid,
        date '2026-08-03',
        1000,
        current_setting('atlas_test.production_rate_a_id')::uuid,
        520,
        520
      )
    $sql$
  );
end;
$$;

do $$
declare
  assigned_brick_type_is_not_null boolean;
begin
  select pg_attribute.attnotnull
    into assigned_brick_type_is_not_null
    from pg_catalog.pg_attribute
    where pg_attribute.attrelid = 'public.labourers'::regclass
      and pg_attribute.attname = 'assigned_brick_type_id'
      and not pg_attribute.attisdropped;

  if assigned_brick_type_is_not_null then
    raise exception 'FAIL: assigned_brick_type_id still has unconditional NOT NULL';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where pg_constraint.conrelid = 'public.labourers'::regclass
      and pg_constraint.conname = 'labourers_brick_type_required_unless_placeholder_check'
      and pg_constraint.contype = 'c'
  ) then
    raise exception 'FAIL: conditional brick-type CHECK constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where pg_constraint.conrelid = 'public.labourers'::regclass
      and pg_constraint.conname = 'labourers_assigned_brick_type_factory_fkey'
      and pg_constraint.contype = 'f'
  ) then
    raise exception 'FAIL: same-factory brick-type foreign key is missing';
  end if;

  raise notice 'PASS: conditional nullability and same-factory foreign key are both installed';
end;
$$;

rollback;
