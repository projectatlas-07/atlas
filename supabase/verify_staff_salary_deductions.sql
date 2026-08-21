-- Staff salary deduction verifier. Run after migrations through 20260820000003.

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

  business_today date := (now() at time zone 'Asia/Kolkata')::date;

begin

  select id, user_id into mapping_id, test_user_id

  from public.factory_users order by created_at, id limit 1 for update;

  if test_user_id is null then

    raise exception 'FAIL: verifier requires one existing factory_users row';

  end if;

  insert into public.factories (id, name) values

    (factory_a_id, format('Staff deduction verifier A %s', factory_a_id)),

    (factory_b_id, format('Staff deduction verifier B %s', factory_b_id));

  update public.factory_users set factory_id = factory_a_id, is_active = true

  where id = mapping_id;

  insert into public.staff_categories (id, factory_id, name)

  values (category_b_id, factory_b_id, 'Factory B deduction Staff');

  insert into public.staff_workers (id, factory_id, name, staff_category_id)

  values (worker_b_id, factory_b_id, 'Factory B deduction worker', category_b_id);

  insert into public.staff_salary_deductions (

    factory_id, staff_worker_id, deduction_date, amount, reason

  ) values (factory_b_id, worker_b_id, business_today, 100, 'Factory B adjustment');

  perform set_config('atlas_test.user_id', test_user_id::text, true);

  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);

  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);

  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);

  perform set_config('atlas_test.business_today', business_today::text, true);

  perform set_config('atlas_test.business_month', date_trunc('month', business_today)::date::text, true);

  perform set_config('atlas_test.start_month', (date_trunc('month', business_today)::date - interval '2 months')::date::text, true);

  perform set_config('atlas_test.previous_month', (date_trunc('month', business_today)::date - interval '1 month')::date::text, true);

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

  basic_worker public.staff_workers%rowtype;

  full_worker public.staff_workers%rowtype;

  interaction_worker public.staff_workers%rowtype;

  withdrawal_first_worker public.staff_workers%rowtype;

  deduction_race_worker public.staff_workers%rowtype;

  automatic_worker public.staff_workers%rowtype;

  inactive_worker public.staff_workers%rowtype;

  gap_worker public.staff_workers%rowtype;

  deduction record;

  withdrawal record;

  summary record;

  before_count integer;

begin

  insert into public.staff_categories (id, factory_id, name)

  values (category_id, factory_id, 'Deduction Staff');

  perform public.create_staff_category_monthly_salary(

    factory_id, category_id, 20000, start_month

  );

  select * into basic_worker from public.create_staff_worker(

    factory_id, 'Basic deduction worker', category_id, business_month, null

  );

  select * into full_worker from public.create_staff_worker(

    factory_id, 'Full deduction worker', category_id, business_month, null

  );

  select * into interaction_worker from public.create_staff_worker(

    factory_id, 'Deduction then withdrawal worker', category_id, business_month, null

  );

  select * into withdrawal_first_worker from public.create_staff_worker(

    factory_id, 'Withdrawal then deduction worker', category_id, business_month, null

  );

  select * into deduction_race_worker from public.create_staff_worker(

    factory_id, 'Concurrent deduction worker', category_id, business_month, null

  );

  select * into automatic_worker from public.create_staff_worker(

    factory_id, 'Automatic deduction worker', category_id, start_month, null

  );

  select * into inactive_worker from public.create_staff_worker(

    factory_id, 'Inactive deduction worker', category_id, previous_month, null

  );

  select * into gap_worker from public.create_staff_worker(

    factory_id, 'Gap deduction worker', category_id, start_month, null

  );

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, basic_worker.id, business_today, 1500, '  Absent for several days  '

  );

  if deduction.deduction_amount <> 1500

    or deduction.deduction_reason <> 'Absent for several days'

    or deduction.total_earnings <> 20000

    or deduction.total_deductions <> 1500

    or deduction.total_withdrawn <> 0

    or deduction.available_balance <> 18500 then

    raise exception 'FAIL: positive deduction or reason persistence is incorrect';

  end if;

  raise notice 'PASS: positive deduction succeeds and trimmed reason persists';

  perform pg_temp.expect_error(

    'zero deduction is rejected', '22023',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, 0, null)',

      factory_id, basic_worker.id, business_today)

  );

  perform pg_temp.expect_error(

    'negative deduction is rejected', '22023',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, -1, null)',

      factory_id, basic_worker.id, business_today)

  );

  perform pg_temp.expect_error(

    'future deduction date is rejected', '22023',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, 1, null)',

      factory_id, basic_worker.id, business_today + 1)

  );

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, full_worker.id, business_today, 2000, null

  );

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, full_worker.id, business_today, 3000, '   '

  );

  if deduction.deduction_reason is not null or deduction.total_deductions <> 5000

    or deduction.available_balance <> 15000 then

    raise exception 'FAIL: multiple deductions or blank optional reason is incorrect';

  end if;

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, full_worker.id, business_today, 15000, 'Final correction'

  );

  if deduction.total_deductions <> 20000 or deduction.available_balance <> 0 then

    raise exception 'FAIL: exact-full-balance deduction was not allowed';

  end if;

  raise notice 'PASS: multiple deductions aggregate and exact-full deduction reaches zero';

  select count(*) into before_count from public.staff_salary_deductions

  where staff_worker_id = basic_worker.id;

  perform pg_temp.expect_error(

    'deduction above available balance fails', 'P0001',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, 18500.01, null)',

      factory_id, basic_worker.id, business_today)

  );

  if (select count(*) from public.staff_salary_deductions

      where staff_worker_id = basic_worker.id) <> before_count then

    raise exception 'FAIL: failed overdeduction created a row';

  end if;

  select * into summary from public.get_staff_financial_summary(factory_id, basic_worker.id);

  if summary.total_deductions <> 1500 or summary.available_balance <> 18500 then

    raise exception 'FAIL: failed overdeduction changed financial state';

  end if;

  raise notice 'PASS: overdeduction fails without changing financial state';

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, interaction_worker.id, business_today, 5000, 'Manual correction'

  );

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, interaction_worker.id, business_today, 10000

  );

  if withdrawal.total_earnings <> 20000 or withdrawal.total_deductions <> 5000

    or withdrawal.total_withdrawn <> 10000 or withdrawal.available_balance <> 5000 then

    raise exception 'FAIL: withdrawal did not include existing deductions';

  end if;

  perform pg_temp.expect_error(

    'withdrawal cannot exceed deduction-adjusted balance', 'P0001',

    format('select public.create_staff_withdrawal(%L::uuid, %L::uuid, date %L, 5000.01)',

      factory_id, interaction_worker.id, business_today)

  );

  raise notice 'PASS: earnings minus deductions minus withdrawals is authoritative';

  select * into withdrawal from public.create_staff_withdrawal(

    factory_id, withdrawal_first_worker.id, business_today, 12000

  );

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, withdrawal_first_worker.id, business_today, 8000, 'Final adjustment'

  );

  if deduction.total_withdrawn <> 12000 or deduction.total_deductions <> 8000

    or deduction.available_balance <> 0 then

    raise exception 'FAIL: deduction did not include existing withdrawals';

  end if;

  perform pg_temp.expect_error(

    'deduction plus withdrawal cannot collectively overdraw', 'P0001',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, 1, null)',

      factory_id, withdrawal_first_worker.id, business_today)

  );

  raise notice 'PASS: deduction sees withdrawals and collective overdraw is prevented';

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, deduction_race_worker.id, business_today, 15000, null

  );

  perform pg_temp.expect_error(

    'concurrent-equivalent deductions cannot overdraw', 'P0001',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, 6000, null)',

      factory_id, deduction_race_worker.id, business_today)

  );

  select * into summary from public.get_staff_financial_summary(factory_id, deduction_race_worker.id);

  if summary.total_deductions <> 15000 or summary.available_balance <> 5000

    or (select count(*) from public.staff_salary_deductions

        where staff_worker_id = deduction_race_worker.id) <> 1 then

    raise exception 'FAIL: serialized deduction protection is incorrect';

  end if;

  raise notice 'PASS: serialized deductions cannot collectively overdraw';

  if exists (select 1 from public.staff_monthly_earnings

             where staff_worker_id = automatic_worker.id) then

    raise exception 'FAIL: automatic deduction fixture already had earnings';

  end if;

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, automatic_worker.id, business_today, 1000, 'Current adjustment'

  );

  if deduction.total_earnings <> 60000 or deduction.available_balance <> 59000

    or (select count(*) from public.staff_monthly_earnings

        where staff_worker_id = automatic_worker.id) <> 3

    or exists (

      select 1 from public.staff_monthly_earnings

      where staff_worker_id = automatic_worker.id and salary_month > business_month

    ) then

    raise exception 'FAIL: deduction did not safely materialize current entitlements';

  end if;

  raise notice 'PASS: deduction ensures missing months once without creating future salary';

  perform public.deactivate_staff_worker(factory_id, inactive_worker.id, previous_month);

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, inactive_worker.id, business_today, 1000, 'Final settlement correction'

  );

  if deduction.total_earnings <> 20000 or deduction.available_balance <> 19000

    or exists (

      select 1 from public.staff_monthly_earnings

      where staff_worker_id = inactive_worker.id and salary_month = business_month

    ) then

    raise exception 'FAIL: inactive Staff deduction or entitlement stop is incorrect';

  end if;

  raise notice 'PASS: deactivated Staff can receive deduction without future salary';

  perform public.deactivate_staff_worker(factory_id, gap_worker.id, start_month);

  perform public.reactivate_staff_worker(factory_id, gap_worker.id, business_month);

  select * into deduction from public.create_staff_salary_deduction(

    factory_id, gap_worker.id, business_today, 1000, null

  );

  if deduction.total_earnings <> 40000

    or exists (

      select 1 from public.staff_monthly_earnings

      where staff_worker_id = gap_worker.id and salary_month = previous_month

    ) then

    raise exception 'FAIL: deduction materialized an inactive-gap month';

  end if;

  raise notice 'PASS: inactive-gap eligibility remains correct';

  perform pg_temp.expect_error(

    'cross-factory deduction attempt fails', 'P2502',

    format('select public.create_staff_salary_deduction(%L::uuid, %L::uuid, date %L, 1, null)',

      factory_id, current_setting('atlas_test.worker_b_id'), business_today)

  );

  if exists (

    select 1 from public.staff_salary_deductions

    where public.staff_salary_deductions.factory_id = current_setting('atlas_test.factory_b_id')::uuid

  ) then

    raise exception 'FAIL: Factory A user can read Factory B deductions';

  end if;

  raise notice 'PASS: cross-factory deduction and read access fail';

  perform pg_temp.expect_error(

    'authenticated clients cannot directly insert Staff deductions', '42501',

    format('insert into public.staff_salary_deductions (factory_id, staff_worker_id, deduction_date, amount) values (%L::uuid, %L::uuid, date %L, 1)',

      factory_id, basic_worker.id, business_today)

  );

  if not exists (

    select 1 from public.staff_salary_deductions

    where staff_worker_id = inactive_worker.id

  ) then

    raise exception 'FAIL: historical inactive Staff deductions are not readable';

  end if;

  raise notice 'PASS: historical deductions remain readable';

  perform set_config('atlas_test.deduction_id', deduction.deduction_id::text, true);

end;

$$;

reset role;

select pg_temp.expect_error(

  'Staff deduction rows reject updates even for table owner', 'P2530',

  format('update public.staff_salary_deductions set amount = 1 where id = %L::uuid',

    current_setting('atlas_test.deduction_id'))

);

select pg_temp.expect_error(

  'Staff deduction rows reject deletes even for table owner', 'P2530',

  format('delete from public.staff_salary_deductions where id = %L::uuid',

    current_setting('atlas_test.deduction_id'))

);

do $$

declare

  deduction_definition text;

  withdrawal_definition text;

begin

  select pg_get_functiondef(

    'public.create_staff_salary_deduction(uuid,uuid,date,numeric,text)'::regprocedure

  ) into deduction_definition;

  select pg_get_functiondef(

    'public.create_staff_withdrawal(uuid,uuid,date,numeric)'::regprocedure

  ) into withdrawal_definition;

  if position('staff_salary_lifecycle:' in deduction_definition) = 0

    or position('staff_salary_lifecycle:' in withdrawal_definition) = 0

    or position('pg_advisory_xact_lock' in deduction_definition) = 0 then

    raise exception 'FAIL: deductions and withdrawals do not share one worker lock';

  end if;

  raise notice 'PASS: deductions and withdrawals share the worker-scoped lock';

  if has_table_privilege('anon', 'public.staff_salary_deductions', 'select')

    or has_function_privilege('anon', 'public.create_staff_salary_deduction(uuid,uuid,date,numeric,text)', 'execute') then

    raise exception 'FAIL: anonymous Staff deduction access exists';

  end if;

  raise notice 'PASS: anonymous deduction access is denied';

  raise notice 'PASS: Staff salary deduction verifier completed';

end;

$$;

rollback;
