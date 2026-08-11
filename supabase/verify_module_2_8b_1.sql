-- Run this entire file in the Supabase SQL Editor after applying Module 2.8B.1.
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
  test_user_id uuid;
  factory_user_mapping_id uuid;
  brick_type_id uuid := gen_random_uuid();
  labourer_id uuid := gen_random_uuid();
  placeholder_labourer_id uuid := gen_random_uuid();
  active_group_id uuid := gen_random_uuid();
  historical_group_id uuid := gen_random_uuid();
  other_inactive_group_id uuid := gen_random_uuid();
  factory_b_group_id uuid := gen_random_uuid();
  mud_rate_id uuid := gen_random_uuid();
  historical_earning_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  completed_week_start date;
begin
  current_week_start := business_today - (extract(isodow from business_today)::integer - 1);
  completed_week_start := current_week_start - 7;

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
    (factory_a_id, format('Module 2.8B.1 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.8B.1 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = factory_user_mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_id, factory_a_id, 'Module 2.8B.1 verification brick type');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active, is_placeholder)
  values
    (labourer_id, factory_a_id, 'Module 2.8B.1 labourer', brick_type_id, false, false),
    (placeholder_labourer_id, factory_a_id, 'Module 2.8B.1 placeholder', brick_type_id, true, true);

  insert into public.labour_groups (id, factory_id, name, member_count, is_active)
  values
    (active_group_id, factory_a_id, 'Module 2.8B.1 active group', 8, true),
    (historical_group_id, factory_a_id, 'Module 2.8B.1 historical group', 6, false),
    (other_inactive_group_id, factory_a_id, 'Module 2.8B.1 other inactive group', null, false),
    (factory_b_group_id, factory_b_id, 'Module 2.8B.1 Factory B active group', 5, true);

  insert into public.wage_rates (id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values (mud_rate_id, factory_a_id, 'mud_supply', 230, completed_week_start - 7);

  insert into public.production_entries (id, factory_id, labourer_id, brick_type_id, production_date, quantity)
  values
    (gen_random_uuid(), factory_a_id, labourer_id, brick_type_id, completed_week_start, 60000),
    (gen_random_uuid(), factory_a_id, labourer_id, brick_type_id, completed_week_start + 6, 40000),
    (gen_random_uuid(), factory_a_id, placeholder_labourer_id, brick_type_id, completed_week_start + 3, 99999);

  insert into public.weekly_earnings (
    id, factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    historical_earning_id,
    factory_a_id,
    historical_group_id,
    completed_week_start - 7,
    50000,
    mud_rate_id,
    230,
    11500
  );

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.active_group_id', active_group_id::text, true);
  perform set_config('atlas_test.historical_group_id', historical_group_id::text, true);
  perform set_config('atlas_test.factory_b_group_id', factory_b_group_id::text, true);
  perform set_config('atlas_test.historical_earning_id', historical_earning_id::text, true);
  perform set_config('atlas_test.completed_week_start', completed_week_start::text, true);

  raise notice 'PASS: one active group, multiple inactive historical groups, and an independent Factory B active group were created';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'second active group in the same factory is rejected',
    '23505',
    $sql$
      insert into public.labour_groups (factory_id, name, member_count, is_active)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'Module 2.8B.1 forbidden second active group',
        4,
        true
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'reactivation is rejected while another group is active',
    '23505',
    $sql$
      update public.labour_groups
      set is_active = true
      where id = current_setting('atlas_test.historical_group_id')::uuid
        and factory_id = current_setting('atlas_test.factory_a_id')::uuid
    $sql$
  );
end;
$$;

do $$
declare
  historical_earning public.weekly_earnings%rowtype;
begin
  update public.labour_groups
  set is_active = false
  where id = current_setting('atlas_test.active_group_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  update public.labour_groups
  set is_active = true
  where id = current_setting('atlas_test.historical_group_id')::uuid
    and factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if (
    select count(*)
    from public.labour_groups
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and is_active
  ) <> 1 then
    raise exception 'FAIL: activation after deactivation did not leave exactly one active group';
  end if;

  select *
    into historical_earning
    from public.weekly_earnings
    where id = current_setting('atlas_test.historical_earning_id')::uuid;

  if historical_earning.labour_group_id <> current_setting('atlas_test.historical_group_id')::uuid
    or historical_earning.quantity_used <> 50000
    or historical_earning.rate_used <> 230
    or historical_earning.amount <> 11500 then
    raise exception 'FAIL: historical group earning was changed or invalidated';
  end if;

  raise notice 'PASS: deactivation permits a different group to activate and historical earnings remain unchanged';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  calculation_result record;
  cross_factory_rows integer;
  stored_earning public.weekly_earnings%rowtype;
begin
  update public.labour_groups
  set is_active = false
  where id = current_setting('atlas_test.factory_b_group_id')::uuid;
  get diagnostics cross_factory_rows = row_count;

  if cross_factory_rows <> 0 then
    raise exception 'FAIL: Factory A user updated Factory B labour group';
  end if;

  select *
    into calculation_result
    from public.calculate_mud_supply_wages(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.historical_group_id')::uuid,
      current_setting('atlas_test.completed_week_start')::date
    );

  select *
    into stored_earning
    from public.weekly_earnings
    where id = calculation_result.weekly_earning_id;

  if calculation_result.groups_calculated <> 1
    or calculation_result.rows_skipped <> 0
    or stored_earning.quantity_used <> 100000
    or stored_earning.rate_used <> 230
    or stored_earning.amount <> 23000 then
    raise exception 'FAIL: mud-supply RPC did not work with the one-active-group rule';
  end if;

  raise notice 'PASS: factory RLS isolation remains intact and the mud-supply RPC calculates the sole active group';
end;
$$;

reset role;

do $$
declare
  index_definition text;
begin
  select indexdef
    into index_definition
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'labour_groups_one_active_per_factory_idx';

  if index_definition is null
    or position('UNIQUE INDEX' in upper(index_definition)) = 0
    or position('(FACTORY_ID)' in upper(index_definition)) = 0
    or position('WHERE IS_ACTIVE' in upper(index_definition)) = 0 then
    raise exception 'FAIL: one-active-group partial unique index is missing or incorrect';
  end if;

  raise notice 'PASS: database index enforces at most one active labour group per factory';
end;
$$;

rollback;
