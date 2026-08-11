-- Run this entire file in the Supabase SQL Editor after applying Module 2.2B.
-- It requires at least one existing public.factory_users row. The final rollback
-- discards all temporary data and restores the selected user's original mapping.

begin;

create temporary table module_2_2b_verification_context (ready boolean);

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
    (factory_a_id, format('Module 2.2B verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.2B verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where user_id = test_user_id;

  insert into public.wage_rates (
    factory_id,
    applies_to,
    rate_per_1000_bricks,
    effective_from
  )
  values (
    factory_b_id,
    'production',
    99,
    date '2026-08-03'
  );

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);

  raise notice 'PASS: rollback-only Factory A/B test fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  created_rate public.wage_rates%rowtype;
  previous_rate public.wage_rates%rowtype;
  visible_rows bigint;
begin
  select *
    into created_rate
    from public.create_wage_rate(
      current_setting('atlas_test.factory_a_id')::uuid,
      'production',
      100,
      date '2026-08-03'
    );

  if created_rate.applies_to <> 'production' or created_rate.effective_to is not null then
    raise exception 'FAIL: first production rate was not created as an open-ended production rate';
  end if;

  raise notice 'PASS: first production rate can be created on a Monday';

  select *
    into created_rate
    from public.create_wage_rate(
      current_setting('atlas_test.factory_a_id')::uuid,
      'mud_supply',
      60,
      date '2026-08-03'
    );

  if created_rate.applies_to <> 'mud_supply' or created_rate.effective_to is not null then
    raise exception 'FAIL: first mud-supply rate was not created independently';
  end if;

  raise notice 'PASS: first mud-supply rate can be created independently';

  select *
    into previous_rate
    from public.wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'production';

  select *
    into created_rate
    from public.create_wage_rate(
      current_setting('atlas_test.factory_a_id')::uuid,
      'production',
      110,
      date '2026-08-10'
    );

  if created_rate.effective_to is not null then
    raise exception 'FAIL: new production rate is not open-ended';
  end if;

  select *
    into previous_rate
    from public.wage_rates
    where id = previous_rate.id;

  if previous_rate.effective_to <> date '2026-08-09' then
    raise exception 'FAIL: previous production rate did not close on the preceding Sunday';
  end if;

  raise notice 'PASS: later production rate closes the previous rate on Sunday and remains open-ended';

  select count(*) into visible_rows
  from public.wage_rates
  where factory_id = current_setting('atlas_test.factory_a_id')::uuid;

  if visible_rows <> 3 then
    raise exception 'FAIL: Factory A user cannot SELECT its three created rates';
  end if;

  select count(*) into visible_rows
  from public.wage_rates
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;

  if visible_rows <> 0 then
    raise exception 'FAIL: Factory A user can SELECT Factory B wage rates';
  end if;

  raise notice 'PASS: authenticated users retain factory-scoped wage-rate SELECT access';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'non-Monday effective_from is rejected',
    '22023',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        100,
        date '2026-08-11'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'zero wage rate is rejected',
    '22023',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        0,
        date '2026-08-17'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'negative wage rate is rejected',
    '22023',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        -1,
        date '2026-08-17'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'invalid applies_to is rejected',
    '22023',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'invalid',
        100,
        date '2026-08-17'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'same effective_from date is rejected',
    'P0001',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        120,
        date '2026-08-10'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'backdated effective_from date is rejected',
    'P0001',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        120,
        date '2026-08-03'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'Factory A user cannot create a rate for Factory B',
    '42501',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_b_id')::uuid,
        'production',
        100,
        date '2026-08-10'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot directly INSERT wage_rates',
    '42501',
    $sql$
      insert into public.wage_rates (
        factory_id,
        applies_to,
        rate_per_1000_bricks,
        effective_from
      ) values (
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        120,
        date '2026-08-17'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot directly UPDATE wage_rates',
    '42501',
    $sql$
      update public.wage_rates
      set rate_per_1000_bricks = 120
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid
        and applies_to = 'production'
    $sql$
  );

  if (
    select count(*)
    from public.wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'production'
      and effective_from in (date '2026-08-03', date '2026-08-10')
  ) <> 2 then
    raise exception 'FAIL: failed requests silently overwrote production rate history';
  end if;

  raise notice 'PASS: invalid, conflicting, and direct wage-rate writes are rejected without overwriting history';
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous users cannot execute create_wage_rate',
    '42501',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_a_id')::uuid,
        'production',
        100,
        date '2026-08-17'
      )
    $sql$
  );
end;
$$;

reset role;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.create_wage_rate(uuid, text, numeric, date)'::regprocedure)
    into function_definition;

  if position('pg_advisory_xact_lock' in function_definition) = 0 then
    raise exception 'FAIL: create_wage_rate does not use a transaction-level advisory lock';
  end if;

  raise notice 'PASS: create_wage_rate uses a transaction-level advisory lock';
end;
$$;

rollback;
