-- Run this entire file in the Supabase SQL Editor after applying Module 2.10B2.
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

do $$
declare
  factory_without_placeholder_id uuid := gen_random_uuid();
  factory_with_placeholder_id uuid := gen_random_uuid();
  new_factory_id uuid := gen_random_uuid();
  factory_user_mapping_id uuid;
  test_user_id uuid;
  brick_type_id uuid := gen_random_uuid();
  normal_labourer_id uuid := gen_random_uuid();
  preserved_placeholder_id uuid;
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
    (factory_without_placeholder_id, format('Module 2.10B2 backfill Factory %s', factory_without_placeholder_id)),
    (factory_with_placeholder_id, format('Module 2.10B2 preserved Factory %s', factory_with_placeholder_id));

  delete from public.labourers
  where factory_id = factory_without_placeholder_id
    and is_placeholder;

  select id
    into preserved_placeholder_id
    from public.labourers
    where factory_id = factory_with_placeholder_id
      and is_placeholder;

  update public.labourers
  set name = 'Existing Valid Placeholder'
  where id = preserved_placeholder_id;

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_id, factory_without_placeholder_id, 'Module 2.10B2 normal brick type');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder, is_active
  )
  values (
    normal_labourer_id,
    factory_without_placeholder_id,
    'Module 2.10B2 normal labourer',
    brick_type_id,
    false,
    true
  );

  perform public.ensure_factory_placeholder(factory_without_placeholder_id);
  perform public.ensure_factory_placeholder(factory_with_placeholder_id);

  perform public.ensure_factory_placeholder(factory_without_placeholder_id);
  perform public.ensure_factory_placeholder(factory_with_placeholder_id);

  insert into public.factories (id, name)
  values (new_factory_id, format('Module 2.10B2 new Factory %s', new_factory_id));

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values (
    production_rate_id,
    factory_without_placeholder_id,
    'production',
    520,
    date '2026-08-03'
  );

  update public.factory_users
  set factory_id = factory_without_placeholder_id, is_active = true
  where id = factory_user_mapping_id;

  perform set_config('atlas_test.factory_a_id', factory_without_placeholder_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_with_placeholder_id::text, true);
  perform set_config('atlas_test.new_factory_id', new_factory_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.brick_type_id', brick_type_id::text, true);
  perform set_config('atlas_test.normal_labourer_id', normal_labourer_id::text, true);
  perform set_config('atlas_test.preserved_placeholder_id', preserved_placeholder_id::text, true);
  perform set_config('atlas_test.production_rate_id', production_rate_id::text, true);
end;
$$;

do $$
declare
  provisioned_placeholder_id uuid;
begin
  if (
    select count(*)
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and is_placeholder
  ) <> 1 then
    raise exception 'FAIL: existing factory without placeholder did not receive exactly one';
  end if;

  select id
    into provisioned_placeholder_id
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and is_placeholder;

  if not exists (
    select 1
    from public.labourers
    where id = provisioned_placeholder_id
      and name = 'Unattributed Production'
      and is_placeholder = true
      and is_active = true
      and assigned_brick_type_id is null
  ) then
    raise exception 'FAIL: backfilled placeholder does not have the exact required values';
  end if;

  if (
    select count(*)
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
      and is_placeholder
  ) <> 1 or not exists (
    select 1
    from public.labourers
    where id = current_setting('atlas_test.preserved_placeholder_id')::uuid
      and name = 'Existing Valid Placeholder'
  ) then
    raise exception 'FAIL: existing valid placeholder was replaced or duplicated';
  end if;

  if (
    select count(*)
    from public.labourers
    where factory_id = current_setting('atlas_test.new_factory_id')::uuid
      and is_placeholder
  ) <> 1 or not exists (
    select 1
    from public.labourers
    where factory_id = current_setting('atlas_test.new_factory_id')::uuid
      and name = 'Unattributed Production'
      and is_placeholder = true
      and is_active = true
      and assigned_brick_type_id is null
  ) then
    raise exception 'FAIL: new factory did not automatically receive the required placeholder';
  end if;

  if not exists (
    select 1
    from public.labourers
    where id = current_setting('atlas_test.normal_labourer_id')::uuid
      and factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and name = 'Module 2.10B2 normal labourer'
      and assigned_brick_type_id = current_setting('atlas_test.brick_type_id')::uuid
      and is_placeholder = false
      and is_active = true
  ) then
    raise exception 'FAIL: normal labourer was changed by placeholder provisioning';
  end if;

  raise notice 'PASS: missing existing placeholder is backfilled exactly once with required values';
  raise notice 'PASS: existing valid placeholder is preserved exactly once';
  raise notice 'PASS: repeated provisioning remains idempotent';
  raise notice 'PASS: new factory automatically receives the required placeholder';
  raise notice 'PASS: normal labourers remain unchanged';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'one-placeholder-per-factory uniqueness remains enforced',
    '23505',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder, is_active
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Duplicate Unattributed Production',
        null,
        true,
        true
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'provisioned placeholder cannot receive an individual weekly earning',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      )
      select
        labourers.factory_id,
        labourers.id,
        date '2026-08-03',
        1000,
        current_setting('atlas_test.production_rate_id')::uuid,
        520,
        520
      from public.labourers
      where labourers.factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and labourers.is_placeholder
    $sql$
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if (
    select count(*)
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and is_placeholder
  ) <> 1 then
    raise exception 'FAIL: Factory A user cannot read its factory placeholder';
  end if;

  if exists (
    select 1
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user can read Factory B labourers';
  end if;

  perform pg_temp.expect_error(
    'authenticated clients cannot invoke internal placeholder provisioning',
    '42501',
    $sql$
      select public.ensure_factory_placeholder(
        current_setting('atlas_test.factory_b_id')::uuid
      )
    $sql$
  );

  raise notice 'PASS: factory isolation is preserved and provisioning is not client-executable';
end;
$$;

reset role;

do $$
declare
  trigger_definition text;
begin
  select pg_get_triggerdef(pg_trigger.oid)
    into trigger_definition
    from pg_catalog.pg_trigger
    where pg_trigger.tgrelid = 'public.factories'::regclass
      and pg_trigger.tgname = 'factories_provision_placeholder_labourer'
      and not pg_trigger.tgisinternal;

  if trigger_definition is null
    or position('AFTER INSERT ON public.factories' in trigger_definition) = 0 then
    raise exception 'FAIL: future-factory placeholder trigger is missing or incorrectly scoped';
  end if;

  raise notice 'PASS: future-factory provisioning trigger is installed';
end;
$$;

rollback;
