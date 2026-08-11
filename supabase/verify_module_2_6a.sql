-- Run this entire file in the Supabase SQL Editor after applying Module 2.6A.
-- It requires one existing public.factory_users row. Every fixture and temporary
-- mapping change is discarded by the final rollback.

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
  factory_a_brick_type_id uuid := gen_random_uuid();
  factory_b_brick_type_id uuid := gen_random_uuid();
  primary_labourer_id uuid := gen_random_uuid();
  competing_labourer_id uuid := gen_random_uuid();
  factory_b_labourer_id uuid := gen_random_uuid();
  wage_rate_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  completed_week_start date;
begin
  current_week_start := business_today - (extract(isodow from business_today)::integer - 1);
  completed_week_start := current_week_start - 7;

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
    (factory_a_id, format('Module 2.6A verification Factory A %s', factory_a_id)),
    (factory_b_id, format('Module 2.6A verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where user_id = test_user_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (factory_a_brick_type_id, factory_a_id, 'Module 2.6A Factory A brick type'),
    (factory_b_brick_type_id, factory_b_id, 'Module 2.6A Factory B brick type');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active, is_placeholder)
  values
    (primary_labourer_id, factory_a_id, 'Module 2.6A primary labourer', factory_a_brick_type_id, true, false),
    (competing_labourer_id, factory_a_id, 'Module 2.6A competing labourer', factory_a_brick_type_id, true, false),
    (factory_b_labourer_id, factory_b_id, 'Module 2.6A Factory B labourer', factory_b_brick_type_id, true, false);

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  )
  values (
    wage_rate_id, factory_a_id, 'production', 1000, completed_week_start
  );

  insert into public.weekly_earnings (
    factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
  )
  values
    (factory_a_id, primary_labourer_id, completed_week_start, 1000, wage_rate_id, 1000, 1000),
    (factory_a_id, competing_labourer_id, completed_week_start, 1000, wage_rate_id, 1000, 1000);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.primary_labourer_id', primary_labourer_id::text, true);
  perform set_config('atlas_test.competing_labourer_id', competing_labourer_id::text, true);
  perform set_config('atlas_test.factory_b_labourer_id', factory_b_labourer_id::text, true);
  perform set_config('atlas_test.wage_rate_id', wage_rate_id::text, true);
  perform set_config('atlas_test.withdrawal_date', business_today::text, true);
  perform set_config('atlas_test.completed_week_start', completed_week_start::text, true);

  raise notice 'PASS: rollback-only withdrawal fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'missing withdrawal date is rejected',
    '22023',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.primary_labourer_id')::uuid,
        null,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'zero withdrawal amount is rejected',
    '22023',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.primary_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        0
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'negative withdrawal amount is rejected',
    '22023',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.primary_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        -1
      )
    $sql$
  );
end;
$$;

do $$
declare
  created_result record;
  stored_withdrawal public.withdrawals%rowtype;
begin
  select *
    into created_result
    from public.create_labourer_withdrawal(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.primary_labourer_id')::uuid,
      current_setting('atlas_test.withdrawal_date')::date,
      400
    );

  select *
    into stored_withdrawal
    from public.withdrawals
    where id = created_result.withdrawal_id;

  if created_result.withdrawal_factory_id <> current_setting('atlas_test.factory_a_id')::uuid
    or created_result.withdrawal_labourer_id <> current_setting('atlas_test.primary_labourer_id')::uuid
    or created_result.withdrawal_date <> current_setting('atlas_test.withdrawal_date')::date
    or created_result.withdrawal_amount <> 400
    or created_result.available_balance <> 600
    or stored_withdrawal.amount <> 400 then
    raise exception 'FAIL: successful partial withdrawal returned or stored incorrect values';
  end if;

  if (
    select count(*)
    from public.withdrawals
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.primary_labourer_id')::uuid
  ) <> 1 then
    raise exception 'FAIL: partial withdrawal did not insert exactly one row';
  end if;

  raise notice 'PASS: partial withdrawal inserts once and returns resulting balance 600';
end;
$$;

do $$
declare
  row_count_before bigint;
begin
  select count(*)
    into row_count_before
    from public.withdrawals
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.primary_labourer_id')::uuid;

  perform pg_temp.expect_error(
    'withdrawal above available balance is rejected',
    'P0001',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.primary_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        601
      )
    $sql$
  );

  if row_count_before <> (
    select count(*)
    from public.withdrawals
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.primary_labourer_id')::uuid
  ) then
    raise exception 'FAIL: rejected overdraw inserted a withdrawal';
  end if;

  raise notice 'PASS: rejected overdraw leaves withdrawals unchanged';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'Factory A user cannot withdraw for a Factory B labourer',
    '42501',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.factory_b_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        1
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'authenticated users cannot directly INSERT withdrawals',
    '42501',
    $sql$
      insert into public.withdrawals (factory_id, labourer_id, withdrawal_date, amount)
      values (
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.primary_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        1
      )
    $sql$
  );
end;
$$;

do $$
declare
  first_result record;
begin
  select *
    into first_result
    from public.create_labourer_withdrawal(
      current_setting('atlas_test.factory_a_id')::uuid,
      current_setting('atlas_test.competing_labourer_id')::uuid,
      current_setting('atlas_test.withdrawal_date')::date,
      600
    );

  if first_result.available_balance <> 400 then
    raise exception 'FAIL: first competing withdrawal returned balance % instead of 400', first_result.available_balance;
  end if;

  perform pg_temp.expect_error(
    'second competing withdrawal cannot overdraw the serialized balance',
    'P0001',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.competing_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        500
      )
    $sql$
  );

  if (
    select coalesce(sum(amount), 0)
    from public.withdrawals
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.competing_labourer_id')::uuid
  ) <> 600 then
    raise exception 'FAIL: competing withdrawals produced an incorrect or negative balance';
  end if;

  raise notice 'PASS: competing withdrawal invariant preserves a non-negative balance';
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous users cannot execute create_labourer_withdrawal',
    '42501',
    $sql$
      select * from public.create_labourer_withdrawal(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.primary_labourer_id')::uuid,
        current_setting('atlas_test.withdrawal_date')::date,
        1
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
  select pg_get_functiondef('public.create_labourer_withdrawal(uuid, uuid, date, numeric)'::regprocedure)
    into function_definition;

  if position('pg_advisory_xact_lock' in function_definition) = 0 then
    raise exception 'FAIL: create_labourer_withdrawal does not use a transaction-level advisory lock';
  end if;

  if position('weekly_earnings' in function_definition) = 0
    or position('production_entries' in function_definition) > 0
    or position('wage_rates' in function_definition) > 0 then
    raise exception 'FAIL: balance source is not limited to locked weekly earnings and withdrawals';
  end if;

  raise notice 'PASS: RPC uses a labourer-scoped transaction lock and stored snapshots only';
end;
$$;

rollback;
