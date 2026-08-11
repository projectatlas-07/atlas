-- Run this entire file in the Supabase SQL Editor after applying Module 2.1.
-- It requires at least one existing public.factory_users row. All test data and
-- the temporary factory-user mapping change are discarded by the final rollback.

begin;

create temporary table module_2_1_verification_context (ready boolean);

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
  raise exception 'FAIL: % unexpectedly succeeded', test_label;
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
  brick_type_a_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  labourer_a_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  labour_group_a_id uuid := gen_random_uuid();
  labour_group_b_id uuid := gen_random_uuid();
  wage_rate_a_id uuid := gen_random_uuid();
  wage_rate_b_id uuid := gen_random_uuid();
  earning_a_id uuid := gen_random_uuid();
  earning_b_id uuid := gen_random_uuid();
  withdrawal_a_id uuid := gen_random_uuid();
  withdrawal_b_id uuid := gen_random_uuid();
begin
  select user_id
    into test_user_id
    from public.factory_users
    order by created_at
    limit 1
    for update;

  if test_user_id is null then
    raise exception 'FAIL: prerequisite missing: create an authenticated user with a factory_users mapping before running this script';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Module 2.1 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.1 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where user_id = test_user_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'Module 2.1 verification brick A'),
    (brick_type_b_id, factory_b_id, 'Module 2.1 verification brick B');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_placeholder)
  values
    (labourer_a_id, factory_a_id, 'Module 2.1 verification labourer A', brick_type_a_id, false),
    (labourer_b_id, factory_b_id, 'Module 2.1 verification labourer B', brick_type_b_id, false),
    (gen_random_uuid(), factory_a_id, 'Module 2.1 verification placeholder', brick_type_a_id, true);

  insert into public.labour_groups (id, factory_id, name)
  values
    (labour_group_a_id, factory_a_id, 'Module 2.1 verification group A'),
    (labour_group_b_id, factory_b_id, 'Module 2.1 verification group B');

  insert into public.wage_rates (id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values
    (wage_rate_a_id, factory_a_id, 'production', 100, date '2026-08-03'),
    (wage_rate_b_id, factory_b_id, 'production', 100, date '2026-08-03');

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    earning_a_id, factory_a_id, labourer_a_id, date '2026-08-03', 1000, wage_rate_a_id, 100, 100
  );

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    earning_b_id, factory_b_id, labourer_b_id, date '2026-08-03', 1000, wage_rate_b_id, 100, 100
  );

  insert into public.weekly_earnings (
    factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values (
    factory_a_id, labour_group_a_id, date '2026-08-03', 1000, wage_rate_a_id, 100, 100
  );

  insert into public.withdrawals (id, factory_id, labourer_id, withdrawal_date, amount)
  values (withdrawal_a_id, factory_a_id, labourer_a_id, date '2026-08-03', 10);

  insert into public.withdrawals (id, factory_id, labourer_id, withdrawal_date, amount)
  values (withdrawal_b_id, factory_b_id, labourer_b_id, date '2026-08-03', 10);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_test.labour_group_a_id', labour_group_a_id::text, true);
  perform set_config('atlas_test.labour_group_b_id', labour_group_b_id::text, true);
  perform set_config('atlas_test.wage_rate_a_id', wage_rate_a_id::text, true);
  perform set_config('atlas_test.wage_rate_b_id', wage_rate_b_id::text, true);
  perform set_config('atlas_test.earning_a_id', earning_a_id::text, true);
  perform set_config('atlas_test.withdrawal_a_id', withdrawal_a_id::text, true);

  raise notice 'PASS: rollback-only Factory A/B test fixtures created';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'a second placeholder labourer in one factory is rejected',
    '23505',
    $sql$
      insert into public.labourers (factory_id, name, assigned_brick_type_id, is_placeholder)
      select factory_id, 'Module 2.1 duplicate placeholder', assigned_brick_type_id, true
      from public.labourers
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and is_placeholder
    $sql$
  );

  perform pg_temp.expect_error(
    'invalid wage_rates.applies_to is rejected',
    '23514',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_test.factory_a_id')::uuid, 'invalid', 100, date '2026-08-03')
    $sql$
  );

  perform pg_temp.expect_error(
    'zero wage rate is rejected',
    '23514',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_test.factory_a_id')::uuid, 'production', 0, date '2026-08-03')
    $sql$
  );

  perform pg_temp.expect_error(
    'negative wage rate is rejected',
    '23514',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_test.factory_a_id')::uuid, 'production', -1, date '2026-08-03')
    $sql$
  );

  perform pg_temp.expect_error(
    'effective_to before effective_from is rejected',
    '23514',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from, effective_to)
      values (current_setting('atlas_test.factory_a_id')::uuid, 'production', 100, date '2026-08-03', date '2026-08-02')
    $sql$
  );

  perform pg_temp.expect_error(
    'weekly earning with both entity fields is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        current_setting('atlas_test.labour_group_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
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
        current_setting('atlas_test.factory_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'negative weekly quantity_used is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', -1, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'zero weekly rate_used is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 0, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'negative weekly rate_used is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, -1, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'negative weekly amount is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, -1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'duplicate labourer weekly earning is rejected',
    '23505',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-03', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'duplicate labour group weekly earning is rejected',
    '23505',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labour_group_a_id')::uuid,
        date '2026-08-03', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'non-Monday weekly week_start is rejected',
    '23514',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-04', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'withdrawal with both entity fields is rejected',
    '23514',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, labour_group_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        current_setting('atlas_test.labour_group_a_id')::uuid,
        date '2026-08-03', 10
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'withdrawal with neither entity field is rejected',
    '23514',
    $sql$
      insert into public.withdrawals (factory_id, withdrawal_date, amount)
      values (current_setting('atlas_test.factory_a_id')::uuid, date '2026-08-03', 10)
    $sql$
  );

  perform pg_temp.expect_error(
    'zero withdrawal amount is rejected',
    '23514',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-03', 0
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'negative withdrawal amount is rejected',
    '23514',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-03', -1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A earning cannot reference Factory B labourer',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_b_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A earning cannot reference Factory B labour group',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labour_group_b_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A earning cannot reference Factory B wage rate',
    '23503',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_b_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A withdrawal cannot reference Factory B labourer',
    '23503',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_b_id')::uuid,
        date '2026-08-03', 10
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A withdrawal cannot reference Factory B labour group',
    '23503',
    $sql$
      insert into public.withdrawals (factory_id, labour_group_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labour_group_b_id')::uuid,
        date '2026-08-03', 10
      )
    $sql$
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  visible_rows bigint;
  affected_rows bigint;
begin
  select count(*) into visible_rows
  from public.labour_groups
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows = 0 then
    raise exception 'FAIL: Factory A user cannot SELECT Factory A labour_groups';
  end if;

  select count(*) into visible_rows
  from public.wage_rates
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows = 0 then
    raise exception 'FAIL: Factory A user cannot SELECT Factory A wage_rates';
  end if;

  select count(*) into visible_rows
  from public.weekly_earnings
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows = 0 then
    raise exception 'FAIL: Factory A user cannot SELECT Factory A weekly_earnings';
  end if;

  select count(*) into visible_rows
  from public.withdrawals
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows = 0 then
    raise exception 'FAIL: Factory A user cannot SELECT Factory A withdrawals';
  end if;

  insert into public.labour_groups (factory_id, name)
  values (current_setting('atlas_test.factory_a_id')::uuid, 'Module 2.1 authenticated group insert');

  insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
  values (current_setting('atlas_test.factory_a_id')::uuid, 'production', 101, date '2026-08-10');

  insert into public.weekly_earnings (
    factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  ) values (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-17', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
  );

  insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
  values (
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-17', 10
  );

  update public.labour_groups
  set name = 'Module 2.1 authenticated group update'
  where id = current_setting('atlas_test.labour_group_a_id')::uuid;
  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception 'FAIL: Factory A user cannot UPDATE Factory A labour_groups';
  end if;

  update public.wage_rates
  set rate_per_1000_bricks = 101
  where id = current_setting('atlas_test.wage_rate_a_id')::uuid;
  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception 'FAIL: Factory A user cannot UPDATE Factory A wage_rates';
  end if;

  raise notice 'PASS: Factory A user can use every granted Module 2 operation in Factory A';

  select count(*) into visible_rows
  from public.labour_groups
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A user can SELECT Factory B labour_groups';
  end if;

  select count(*) into visible_rows
  from public.wage_rates
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A user can SELECT Factory B wage_rates';
  end if;

  select count(*) into visible_rows
  from public.weekly_earnings
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A user can SELECT Factory B weekly_earnings';
  end if;

  select count(*) into visible_rows
  from public.withdrawals
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A user can SELECT Factory B withdrawals';
  end if;

  update public.labour_groups
  set name = name
  where id = current_setting('atlas_test.labour_group_b_id')::uuid;
  get diagnostics affected_rows = row_count;

  if affected_rows <> 0 then
    raise exception 'FAIL: Factory A user can UPDATE Factory B labour_groups';
  end if;

  update public.wage_rates
  set rate_per_1000_bricks = rate_per_1000_bricks
  where id = current_setting('atlas_test.wage_rate_b_id')::uuid;
  get diagnostics affected_rows = row_count;

  if affected_rows <> 0 then
    raise exception 'FAIL: Factory A user can UPDATE Factory B wage_rates';
  end if;

  raise notice 'PASS: Factory A user cannot SELECT or UPDATE Factory B rows';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'Factory A user cannot INSERT Factory B labour_groups',
    '42501',
    $sql$
      insert into public.labour_groups (factory_id, name)
      values (current_setting('atlas_test.factory_b_id')::uuid, 'Module 2.1 blocked group insert')
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A user cannot INSERT Factory B wage_rates',
    '42501',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_test.factory_b_id')::uuid, 'production', 100, date '2026-08-10')
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A user cannot INSERT Factory B weekly_earnings',
    '42501',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_b_id')::uuid,
        current_setting('atlas_test.labourer_b_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_b_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A user cannot INSERT Factory B withdrawals',
    '42501',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_b_id')::uuid,
        current_setting('atlas_test.labourer_b_id')::uuid,
        date '2026-08-10', 10
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot UPDATE weekly_earnings',
    '42501',
    $sql$
      update public.weekly_earnings
      set amount = amount
      where id = current_setting('atlas_test.earning_a_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot DELETE weekly_earnings',
    '42501',
    $sql$
      delete from public.weekly_earnings
      where id = current_setting('atlas_test.earning_a_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot UPDATE withdrawals',
    '42501',
    $sql$
      update public.withdrawals
      set amount = amount
      where id = current_setting('atlas_test.withdrawal_a_id')::uuid
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot DELETE withdrawals',
    '42501',
    $sql$
      delete from public.withdrawals
      where id = current_setting('atlas_test.withdrawal_a_id')::uuid
    $sql$
  );
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error('anonymous users cannot SELECT labour_groups', '42501', 'select 1 from public.labour_groups limit 1');
  perform pg_temp.expect_error('anonymous users cannot SELECT wage_rates', '42501', 'select 1 from public.wage_rates limit 1');
  perform pg_temp.expect_error('anonymous users cannot SELECT weekly_earnings', '42501', 'select 1 from public.weekly_earnings limit 1');
  perform pg_temp.expect_error('anonymous users cannot SELECT withdrawals', '42501', 'select 1 from public.withdrawals limit 1');

  perform pg_temp.expect_error(
    'anonymous users cannot INSERT labour_groups',
    '42501',
    $sql$
      insert into public.labour_groups (factory_id, name)
      values (current_setting('atlas_test.factory_a_id')::uuid, 'Module 2.1 anonymous group insert')
    $sql$
  );

  perform pg_temp.expect_error(
    'anonymous users cannot INSERT wage_rates',
    '42501',
    $sql$
      insert into public.wage_rates (factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values (current_setting('atlas_test.factory_a_id')::uuid, 'production', 100, date '2026-08-10')
    $sql$
  );

  perform pg_temp.expect_error(
    'anonymous users cannot INSERT weekly_earnings',
    '42501',
    $sql$
      insert into public.weekly_earnings (
        factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', 1000, current_setting('atlas_test.wage_rate_a_id')::uuid, 100, 100
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'anonymous users cannot INSERT withdrawals',
    '42501',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.labourer_a_id')::uuid,
        date '2026-08-10', 10
      )
    $sql$
  );
end;
$$;

reset role;
rollback;
