-- Run this entire file in the Supabase SQL Editor after applying Module 2.10A.
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
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  factory_user_mapping_id uuid;
  test_user_id uuid;
  brick_type_a_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  placeholder_a_id uuid := gen_random_uuid();
  placeholder_b_id uuid := gen_random_uuid();
  normal_a1_id uuid := gen_random_uuid();
  normal_a2_id uuid := gen_random_uuid();
  normal_b_id uuid := gen_random_uuid();
  labour_group_a_id uuid := gen_random_uuid();
  production_rate_a_id uuid := gen_random_uuid();
  mud_rate_a_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Module 2.10A verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.10A verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = factory_user_mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'Module 2.10A Factory A brick type'),
    (brick_type_b_id, factory_b_id, 'Module 2.10A Factory B brick type');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder
  )
  values
    (placeholder_a_id, factory_a_id, 'Module 2.10A Factory A placeholder', brick_type_a_id, true),
    (placeholder_b_id, factory_b_id, 'Module 2.10A Factory B placeholder', brick_type_b_id, true),
    (normal_a1_id, factory_a_id, 'Module 2.10A normal labourer A1', brick_type_a_id, false),
    (normal_a2_id, factory_a_id, 'Module 2.10A normal labourer A2', brick_type_a_id, false),
    (normal_b_id, factory_b_id, 'Module 2.10A normal labourer B', brick_type_b_id, false);

  insert into public.labour_groups (id, factory_id, name, member_count, is_active)
  values (labour_group_a_id, factory_a_id, 'Module 2.10A labour group A', 8, true);

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values
    (production_rate_a_id, factory_a_id, 'production', 520, date '2026-08-03'),
    (mud_rate_a_id, factory_a_id, 'mud_supply', 230, date '2026-08-03');

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.brick_type_a_id', brick_type_a_id::text, true);
  perform set_config('atlas_test.brick_type_b_id', brick_type_b_id::text, true);
  perform set_config('atlas_test.placeholder_a_id', placeholder_a_id::text, true);
  perform set_config('atlas_test.placeholder_b_id', placeholder_b_id::text, true);
  perform set_config('atlas_test.normal_a1_id', normal_a1_id::text, true);
  perform set_config('atlas_test.normal_a2_id', normal_a2_id::text, true);
  perform set_config('atlas_test.normal_b_id', normal_b_id::text, true);
  perform set_config('atlas_test.labour_group_a_id', labour_group_a_id::text, true);
  perform set_config('atlas_test.production_rate_a_id', production_rate_a_id::text, true);
  perform set_config('atlas_test.mud_rate_a_id', mud_rate_a_id::text, true);

  raise notice 'PASS: first Factory A placeholder succeeds';
  raise notice 'PASS: Factory B independently has its own placeholder';
  raise notice 'PASS: multiple normal Factory A labourers succeed';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'a second placeholder for the same factory is rejected',
    '23505',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.10A duplicate placeholder',
        current_setting('atlas_test.brick_type_a_id')::uuid,
        true
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'placeholder labourer individual weekly earning is rejected',
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

  perform pg_temp.expect_error(
    'Factory A earning cannot reference Factory B labourer',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      )
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.normal_b_id')::uuid,
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
begin
  insert into public.weekly_earnings (
    factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.normal_a1_id')::uuid,
    date '2026-08-03',
    1000,
    current_setting('atlas_test.production_rate_a_id')::uuid,
    520,
    520
  );

  insert into public.weekly_earnings (
    factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labour_group_a_id')::uuid,
    date '2026-08-03',
    100000,
    current_setting('atlas_test.mud_rate_a_id')::uuid,
    230,
    23000
  );

  if not exists (
    select 1
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.normal_a1_id')::uuid
      and labour_group_id is null
  ) then
    raise exception 'FAIL: normal labourer weekly earning was not stored';
  end if;

  if not exists (
    select 1
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labour_group_id = current_setting('atlas_test.labour_group_a_id')::uuid
      and labourer_id is null
  ) then
    raise exception 'FAIL: group weekly earning was not stored';
  end if;

  raise notice 'PASS: normal labourer weekly earning still succeeds';
  raise notice 'PASS: group weekly earning remains unaffected';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if exists (
    select 1
    from public.labourers
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user can read Factory B labourers';
  end if;

  perform pg_temp.expect_error(
    'Factory A user cannot insert a Factory B labourer',
    '42501',
    $sql$
      insert into public.labourers (
        factory_id, name, assigned_brick_type_id, is_placeholder
      )
      values (
        current_setting('atlas_test.factory_b_id')::uuid,
        'Module 2.10A unauthorized Factory B labourer',
        current_setting('atlas_test.brick_type_b_id')::uuid,
        false
      )
    $sql$
  );

  raise notice 'PASS: Factory A user cannot read or insert Factory B labourers';
end;
$$;

reset role;

do $$
declare
  placeholder_index_definition text;
  earning_trigger_definition text;
begin
  select pg_get_indexdef('public.labourers_one_placeholder_per_factory_idx'::regclass)
    into placeholder_index_definition;

  select pg_get_triggerdef(pg_trigger.oid)
    into earning_trigger_definition
    from pg_catalog.pg_trigger
    where pg_trigger.tgrelid = 'public.weekly_earnings'::regclass
      and pg_trigger.tgname = 'weekly_earnings_prevent_placeholder_labourer'
      and not pg_trigger.tgisinternal;

  if position('UNIQUE INDEX' in placeholder_index_definition) = 0
    or position('WHERE is_placeholder' in placeholder_index_definition) = 0 then
    raise exception 'FAIL: one-placeholder-per-factory partial unique index is missing or incorrect';
  end if;

  if earning_trigger_definition is null
    or position('BEFORE INSERT OR UPDATE OF factory_id, labourer_id' in earning_trigger_definition) = 0 then
    raise exception 'FAIL: placeholder weekly-earning trigger is missing or incorrectly scoped';
  end if;

  raise notice 'PASS: database guardrails are installed with the intended scope';
end;
$$;

rollback;
