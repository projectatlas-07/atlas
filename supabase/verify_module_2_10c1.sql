-- Run this entire file in the Supabase SQL Editor after applying Module 2.10C1.
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
  brick_type_a1_id uuid := gen_random_uuid();
  brick_type_a2_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  normal_a_id uuid := gen_random_uuid();
  normal_b_id uuid := gen_random_uuid();
  placeholder_a_id uuid;
  placeholder_b_id uuid;
  placeholder_entry_id uuid := gen_random_uuid();
  normal_entry_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Module 2.10C1 Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.10C1 Factory B %s', factory_b_id));

  select id
    into placeholder_a_id
    from public.labourers
    where factory_id = factory_a_id
      and is_placeholder;

  select id
    into placeholder_b_id
    from public.labourers
    where factory_id = factory_b_id
      and is_placeholder;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a1_id, factory_a_id, 'Module 2.10C1 Factory A brick type 1'),
    (brick_type_a2_id, factory_a_id, 'Module 2.10C1 Factory A brick type 2'),
    (brick_type_b_id, factory_b_id, 'Module 2.10C1 Factory B brick type');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_placeholder, is_active
  )
  values
    (normal_a_id, factory_a_id, 'Module 2.10C1 normal labourer A', brick_type_a1_id, false, true),
    (normal_b_id, factory_b_id, 'Module 2.10C1 normal labourer B', brick_type_b_id, false, true);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  )
  values (
    placeholder_entry_id,
    factory_a_id,
    placeholder_a_id,
    null,
    date '2026-08-10',
    1000
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  )
  values (
    normal_entry_id,
    factory_a_id,
    normal_a_id,
    brick_type_a1_id,
    date '2026-08-10',
    2000
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
  perform set_config('atlas_test.placeholder_a_id', placeholder_a_id::text, true);
  perform set_config('atlas_test.placeholder_b_id', placeholder_b_id::text, true);
  perform set_config('atlas_test.placeholder_entry_id', placeholder_entry_id::text, true);
  perform set_config('atlas_test.normal_entry_id', normal_entry_id::text, true);

  raise notice 'PASS: placeholder production with null brick type succeeds';
  raise notice 'PASS: normal production with a valid same-factory brick snapshot succeeds';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'normal labourer production with null brick type is rejected',
    '23514',
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
    'cross-factory labourer reference remains rejected',
    '23503',
    $sql$
      insert into public.production_entries (
        id, factory_id, labourer_id, brick_type_id, production_date, quantity
      )
      values (
        gen_random_uuid(),
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.normal_b_id')::uuid,
        current_setting('atlas_test.brick_type_a1_id')::uuid,
        date '2026-08-11',
        1000
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'cross-factory brick-type snapshot remains rejected',
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

  perform pg_temp.expect_error(
    'one daily production row per factory and labourer remains enforced',
    '23505',
    $sql$
      insert into public.production_entries (
        id, factory_id, labourer_id, brick_type_id, production_date, quantity
      )
      values (
        gen_random_uuid(),
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.placeholder_a_id')::uuid,
        null,
        date '2026-08-10',
        999
      )
    $sql$
  );
end;
$$;

do $$
declare
  placeholder_entry_id_before uuid;
  placeholder_entry_id_after uuid;
  placeholder_entry_count bigint;
  normal_snapshot_before uuid;
  normal_snapshot_after uuid;
begin
  select id
    into placeholder_entry_id_before
    from public.production_entries
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.placeholder_a_id')::uuid
      and production_date = date '2026-08-10';

  update public.production_entries
  set quantity = 1500
  where id = placeholder_entry_id_before;

  select id, count(*) over ()
    into placeholder_entry_id_after, placeholder_entry_count
    from public.production_entries
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.placeholder_a_id')::uuid
      and production_date = date '2026-08-10'
      and quantity = 1500
      and brick_type_id is null;

  if placeholder_entry_id_after <> placeholder_entry_id_before
    or placeholder_entry_count <> 1 then
    raise exception 'FAIL: placeholder quantity update did not preserve the single daily row';
  end if;

  select brick_type_id
    into normal_snapshot_before
    from public.production_entries
    where id = current_setting('atlas_test.normal_entry_id')::uuid;

  update public.labourers
  set assigned_brick_type_id = current_setting('atlas_test.brick_type_a2_id')::uuid
  where id = current_setting('atlas_test.normal_a_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  select brick_type_id
    into normal_snapshot_after
    from public.production_entries
    where id = current_setting('atlas_test.normal_entry_id')::uuid;

  if normal_snapshot_before <> current_setting('atlas_test.brick_type_a1_id')::uuid
    or normal_snapshot_after <> normal_snapshot_before then
    raise exception 'FAIL: historical normal-labourer brick-type snapshot changed after reassignment';
  end if;

  raise notice 'PASS: placeholder quantity update preserves the same daily production row';
  raise notice 'PASS: historical normal-labourer brick-type snapshot survives labourer reassignment';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if exists (
    select 1
    from public.production_entries
    where factory_id = current_setting('atlas_test.factory_b_id')::uuid
  ) then
    raise exception 'FAIL: Factory A user can read Factory B production';
  end if;

  perform pg_temp.expect_error(
    'Factory A user cannot insert Factory B placeholder production',
    '42501',
    $sql$
      insert into public.production_entries (
        id, factory_id, labourer_id, brick_type_id, production_date, quantity
      )
      values (
        gen_random_uuid(),
        current_setting('atlas_test.factory_b_id')::uuid,
        current_setting('atlas_test.placeholder_b_id')::uuid,
        null,
        date '2026-08-10',
        1000
      )
    $sql$
  );

  raise notice 'PASS: production factory isolation remains enforced';
end;
$$;

reset role;

do $$
declare
  brick_type_is_not_null boolean;
  trigger_definition text;
begin
  select pg_attribute.attnotnull
    into brick_type_is_not_null
    from pg_catalog.pg_attribute
    where pg_attribute.attrelid = 'public.production_entries'::regclass
      and pg_attribute.attname = 'brick_type_id'
      and not pg_attribute.attisdropped;

  select pg_get_triggerdef(pg_trigger.oid)
    into trigger_definition
    from pg_catalog.pg_trigger
    where pg_trigger.tgrelid = 'public.production_entries'::regclass
      and pg_trigger.tgname = 'production_entries_require_normal_brick_type'
      and not pg_trigger.tgisinternal;

  if brick_type_is_not_null then
    raise exception 'FAIL: production_entries.brick_type_id still has unconditional NOT NULL';
  end if;

  if trigger_definition is null
    or position('BEFORE INSERT OR UPDATE OF factory_id, labourer_id, brick_type_id' in trigger_definition) = 0 then
    raise exception 'FAIL: conditional production brick-type trigger is missing or incorrectly scoped';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where pg_constraint.conrelid = 'public.production_entries'::regclass
      and pg_constraint.conname = 'production_entries_factory_labourer_date_key'
      and pg_constraint.contype = 'u'
  ) then
    raise exception 'FAIL: daily production uniqueness constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where pg_constraint.conrelid = 'public.production_entries'::regclass
      and pg_constraint.conname = 'production_entries_brick_type_factory_fkey'
      and pg_constraint.contype = 'f'
  ) then
    raise exception 'FAIL: same-factory production brick-type foreign key is missing';
  end if;

  raise notice 'PASS: conditional nullability, daily uniqueness, and same-factory constraints are installed';
end;
$$;

rollback;
