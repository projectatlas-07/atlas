-- Staff balance and withdrawal verifier. Run after migrations through 20260820000002.

-- Requires one existing factory_users row. All fixtures are rolled back.

begin;

create or replace function pg_temp.expect_error(

  test_label text, expected_sqlstate text, statement_to_test text

)

returns void language plpgsql as $$

begin

  execute statement_to_test;

  raise exception 'FAIL: % unexpectedly succeeded', test_label using errcode = 'P9999';

exception when others then

  if sqlstate = expected_sqlstate then

    raise notice 'PASS: %', test_label;

  else

    raise exception 'FAIL: % expected SQLSTATE %, received % (%)',

      test_label, expected_sqlstate, sqlstate, sqlerrm;

  end if;

end;

$$;

do $$

declare

  mapping_id uuid;

  test_user_id uuid;

  factory_a_id uuid := gen_random_uuid();

  factory_b_id uuid := gen_random_uuid();

  category_b_id uuid := gen_random_uuid();

  worker_b_id uuid := gen_random_uuid();

  rate_b_id uuid := gen_random_uuid();

  business_today date := (now() at time zone 'Asia/Kolkata')::date;

  business_month date := date_trunc(

    'month', (now() at time zone 'Asia/Kolkata')::date

  )::date;

begin

  select id, user_id into mapping_id, test_user_id

  from public.factory_users order by created_at, id limit 1 for update;

  if test_user_id is null then

    raise exception 'FAIL: verifier requires one existing factory_users row';

  end if;

  insert into public.factories (id, name) values

    (factory_a_id, format('Staff withdrawal verifier A %s', factory_a_id)),

    (factory_b_id, format('Staff withdrawal verifier B %s', factory_b_id));

  update public.factory_users set factory_id = factory_a_id, is_active = true

  where id = mapping_id;

  insert into public.staff_categories (id, factory_id, name)

  values (category_b_id, factory_b_id, 'Factory B Staff');

  insert into public.staff_workers (id, factory_id, name, staff_category_id)

  values (worker_b_id, factory_b_id, 'Factory B worker', category_b_id);

  insert into public.staff_monthly_salary_rates (

    id, factory_id, staff_category_id, monthly_salary, effective_from

  ) values (rate_b_id, factory_b_id, category_b_id, 10000, business_month);

  insert into public.staff_monthly_earnings (

    factory_id, staff_worker_id, salary_month, credited_amount,

    salary_configuration_id, resolved_monthly_salary_snapshot,

    salary_source_snapshot, credit_source, staff_category_id_snapshot

  ) values (

    factory_b_id, worker_b_id, business_month, 10000,

    rate_b_id, 10000, 'CATEGORY_DEFAULT', 'NORMAL_SALARY', category_b_id

  );

  insert into public.staff_withdrawals (

    factory_id, staff_worker_id, withdrawal_date, amount

  ) values (factory_b_id, worker_b_id, business_today, 1000);

  perform set_config('atlas_test.user_id', test_user_id::text, true);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);

  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);

  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);

  perform set_config('atlas_test.business_today', business_today::text, true);

  perform set_config('atlas_test.business_month', business_month::text, true);

  perform set_config('atlas_test.start_month', (business_month - interval '2 months')::date::text, true);

  perform set_config('atlas_test.previous_month', (business_month - interval '1 month')::date::text, true);

end;

$$;

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$

declare

  factory_id uuid := current_setting('atlas_test.factory_a_id')::uuid;

  business_today date := current_setting('atlas_test.business_today')::date;

  business_month date := current_setting('atlas_test.business_month')::date;

  start_month date := current_setting('atlas_test.start_month')::date;

  previous_month date := current_setting('atlas_test.previous_month')::date;

  category_id uuid := gen_random_uuid();

  rate_row public.staff_monthly_salary_rates%rowtype;

  one_month_worker public.staff_workers%rowtype;

  carry_worker public.staff_workers%rowtype;

  automatic_worker public.staff_workers%rowtype;

  overdraw_worker public.staff_workers%rowtype;

  concurrent_worker public.staff_workers%rowtype;

  inactive_worker public.staff_workers%rowtype;

  gap_worker public.staff_workers%rowtype;

  summary record;

  withdrawal record;

  withdrawal_count integer;

  earning_count integer;

begin

  insert into public.staff_categories (id, factory_id, name)

  values (category_id, factory_id, 'Withdrawal Staff');

  select * into rate_row from public.create_staff_category_monthly_salary(

    factory_id, category_id, 20000, start_month

  );

  select * into one_month_worker from public.create_staff_worker(

    factory_id, 'One month worker', category_id, business_month, null

  );

  select * into carry_worker from public.create_staff_worker(

    factory_id, 'Carry worker', category_id, start_month, null

  );

  select * into automatic_worker from public.create_staff_worker(

    factory_id, 'Automatic worker', category_id, start_month, null

  );

  select * into overdraw_worker from public.create_staff_worker(

    factory_id, 'Overdraw worker', category_id, business_month, null

  );

  select * into concurrent_worker from public.create_staff_worker(

    factory_id, 'Concurrent worker', category_id, business_month, null

  );

  select * into inactive_worker from public.create_staff_worker(

    factory_id, 'Inactive worker', category_id, previous_month, null

  );

  select * into gap_worker from public.create_staff_worker(

    factory_id, 'Inactive gap worker', category_id, start_month, null

  );

  select * into summary from public.get_staff_financial_summary(

    factory_id, one_month_worker.id

  );

  if summary.total_earnings <> 20000 or summary.total_withdrawn <> 0

    or summary.available_balance <> 20000 then

    raise exception 'FAIL: one monthly earning balance is incorrect';

  end if;

  raise notice 'PASS: one monthly earning produces the correct balance';

  select * into summary from public.get_staff_financial_summary(

    factory_id, carry_worker.id

  );

  if summary.total_earnings <> 60000 or summary.available_balance <> 60000

    or (select count(*) from public.staff_monthly_earnings

        where staff_worker_id = carry_worker.id) <> 3 then

    raise exception 'FAIL: multiple monthly earnings did not accumulate';

  end if;

  raise notice 'PASS: multiple earnings and unwithdrawn balance carry across months';

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, carry_worker.id, business_today, 10000

  );

  if withdrawal.total_earnings <> 60000 or withdrawal.total_withdrawn <> 10000

    or withdrawal.available_balance <> 50000 then

    raise exception 'FAIL: partial withdrawal balance is incorrect';

  end if;

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, carry_worker.id, business_today, 3000

  );

  if withdrawal.total_withdrawn <> 13000 or withdrawal.available_balance <> 47000 then

    raise exception 'FAIL: multiple withdrawals did not aggregate';

  end if;

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, carry_worker.id, business_today, 47000

  );

  if withdrawal.total_withdrawn <> 60000 or withdrawal.available_balance <> 0 then

    raise exception 'FAIL: full available-balance withdrawal did not reach zero';

  end if;

  raise notice 'PASS: partial, multiple, and exact-full withdrawals';

  if exists (select 1 from public.staff_monthly_earnings

             where staff_worker_id = automatic_worker.id) then

    raise exception 'FAIL: automatic-withdrawal fixture already had earnings';

  end if;

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, automatic_worker.id, business_today, 10000

  );

  select count(*) into earning_count from public.staff_monthly_earnings

  where staff_worker_id = automatic_worker.id;

  if earning_count <> 3 or withdrawal.total_earnings <> 60000

    or withdrawal.available_balance <> 50000 then

    raise exception 'FAIL: withdrawal did not automatically continue salary';

  end if;

  select * into summary from public.get_staff_financial_summary(

    factory_id, automatic_worker.id

  );

  if (select count(*) from public.staff_monthly_earnings

      where staff_worker_id = automatic_worker.id) <> 3

    or exists (

      select 1 from public.staff_monthly_earnings

      where staff_worker_id = automatic_worker.id and salary_month > business_month

    ) then

    raise exception 'FAIL: repeated access duplicated or future-dated earnings';

  end if;

  raise notice 'PASS: withdrawal and balance access materialize missing months exactly once';

  raise notice 'PASS: no future salary month is generated';

  select * into summary from public.get_staff_financial_summary(

    factory_id, overdraw_worker.id

  );

  select count(*) into withdrawal_count from public.staff_withdrawals

  where staff_worker_id = overdraw_worker.id;

  perform pg_temp.expect_error(

    'withdrawal above available balance fails', 'P0001',

    format('select public.create_staff_withdrawal(%L::uuid, %L::uuid, date %L, 20000.01)',

      factory_id, overdraw_worker.id, business_today)

  );

  if (select count(*) from public.staff_withdrawals

      where staff_worker_id = overdraw_worker.id) <> withdrawal_count then

    raise exception 'FAIL: failed overdraw created a withdrawal';

  end if;

  select * into summary from public.get_staff_financial_summary(

    factory_id, overdraw_worker.id

  );

  if summary.total_earnings <> 20000 or summary.total_withdrawn <> 0

    or summary.available_balance <> 20000 then

    raise exception 'FAIL: failed overdraw changed financial state';

  end if;

  raise notice 'PASS: overdraw fails without changing financial state';

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, concurrent_worker.id, business_today, 15000

  );

  perform pg_temp.expect_error(

    'collective concurrent-equivalent overdraw fails', 'P0001',

    format('select public.create_staff_withdrawal(%L::uuid, %L::uuid, date %L, 6000)',

      factory_id, concurrent_worker.id, business_today)

  );

  select * into summary from public.get_staff_financial_summary(

    factory_id, concurrent_worker.id

  );

  if summary.total_withdrawn <> 15000 or summary.available_balance <> 5000

    or (select count(*) from public.staff_withdrawals

        where staff_worker_id = concurrent_worker.id) <> 1 then

    raise exception 'FAIL: collective withdrawal protection is incorrect';

  end if;

  raise notice 'PASS: serialized withdrawals cannot collectively overdraw';

  perform public.deactivate_staff_worker(

    factory_id, inactive_worker.id, previous_month

  );

  select * into summary from public.get_staff_financial_summary(

    factory_id, inactive_worker.id

  );

  if summary.total_earnings <> 20000

    or exists (

      select 1 from public.staff_monthly_earnings

      where staff_worker_id = inactive_worker.id and salary_month = business_month

    ) then

    raise exception 'FAIL: deactivated Staff received a future salary';

  end if;

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, inactive_worker.id, business_today, 20000

  );

  if withdrawal.available_balance <> 0 then

    raise exception 'FAIL: inactive Staff balance was not withdrawable';

  end if;

  raise notice 'PASS: deactivated Staff receives no future salary and can withdraw owed balance';

  perform public.deactivate_staff_worker(factory_id, gap_worker.id, start_month);

  perform public.reactivate_staff_worker(factory_id, gap_worker.id, business_month);

  select * into summary from public.get_staff_financial_summary(factory_id, gap_worker.id);

  if summary.total_earnings <> 40000

    or exists (

      select 1 from public.staff_monthly_earnings

      where staff_worker_id = gap_worker.id and salary_month = previous_month

    ) then

    raise exception 'FAIL: inactive gap month was materialized';

  end if;

  raise notice 'PASS: inactive gap remains excluded after reactivation';

  perform pg_temp.expect_error(

    'future withdrawal date is rejected', '22023',

    format('select public.create_staff_withdrawal(%L::uuid, %L::uuid, date %L, 1)',

      factory_id, one_month_worker.id, business_today + 1)

  );

  perform pg_temp.expect_error(

    'cross-factory withdrawal attempt fails', 'P2502',

    format('select public.create_staff_withdrawal(%L::uuid, %L::uuid, date %L, 1)',

      factory_id, current_setting('atlas_test.worker_b_id'), business_today)

  );

  if exists (

    select 1
    from public.staff_withdrawals sw
    where sw.factory_id = current_setting('atlas_test.factory_b_id')::uuid

  ) then

    raise exception 'FAIL: Factory A user can read Factory B withdrawals';

  end if;

  raise notice 'PASS: cross-factory reads and withdrawal attempts fail';

  perform pg_temp.expect_error(

    'authenticated clients cannot directly insert Staff withdrawals', '42501',

    format('insert into public.staff_withdrawals (factory_id, staff_worker_id, withdrawal_date, amount) values (%L::uuid, %L::uuid, date %L, 1)',

      factory_id, one_month_worker.id, business_today)

  );

  if not exists (

    select 1 from public.staff_withdrawals

    where staff_worker_id = inactive_worker.id

  ) then

    raise exception 'FAIL: inactive Staff withdrawal history is not readable';

  end if;

  raise notice 'PASS: historical inactive Staff earnings and withdrawals remain readable';

  perform set_config('atlas_test.withdrawal_id', withdrawal.withdrawal_id::text, true);

end;

$$;

reset role;

select pg_temp.expect_error(

  'Staff withdrawal rows reject updates even for table owner', 'P2520',

  format('update public.staff_withdrawals set amount = 1 where id = %L::uuid',

    current_setting('atlas_test.withdrawal_id'))

);

select pg_temp.expect_error(

  'Staff withdrawal rows reject deletes even for table owner', 'P2520',

  format('delete from public.staff_withdrawals where id = %L::uuid',

    current_setting('atlas_test.withdrawal_id'))

);

do $$

declare

  ensure_definition text;

  withdrawal_definition text;

begin

  select pg_get_functiondef(

    'public.ensure_staff_monthly_earnings(uuid,uuid,date)'::regprocedure

  ) into ensure_definition;

  select pg_get_functiondef(

    'public.create_staff_withdrawal(uuid,uuid,date,numeric)'::regprocedure

  ) into withdrawal_definition;

  if position('staff_salary_lifecycle:' in ensure_definition) = 0

    or position('staff_salary_lifecycle:' in withdrawal_definition) = 0

    or position('pg_advisory_xact_lock' in withdrawal_definition) = 0 then

    raise exception 'FAIL: entitlement and withdrawal RPCs do not share one worker lock';

  end if;

  raise notice 'PASS: entitlement and withdrawals share the worker-scoped concurrency lock';

  if has_table_privilege('anon', 'public.staff_withdrawals', 'select')

    or has_function_privilege('anon', 'public.get_staff_financial_summary(uuid,uuid)', 'execute')

    or has_function_privilege('anon', 'public.create_staff_withdrawal(uuid,uuid,date,numeric)', 'execute') then

    raise exception 'FAIL: anonymous Staff financial access exists';

  end if;

  raise notice 'PASS: anonymous Staff financial access is denied';

  raise notice 'PASS: Staff withdrawal verifier completed';

end;

$$;

rollback;
