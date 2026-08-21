-- Staff worker lifecycle/delete verifier. Run after migration 20260820000005.
-- Requires one existing factory_users row. All fixture changes are rolled back.

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
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name) values
    (factory_a_id, format('Staff delete verifier A %s', factory_a_id)),
    (factory_b_id, format('Staff delete verifier B %s', factory_b_id));
  update public.factory_users set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.staff_categories (id, factory_id, name)
  values (category_b_id, factory_b_id, 'Other factory category');
  insert into public.staff_workers (id, factory_id, name, staff_category_id)
  values (worker_b_id, factory_b_id, 'Other factory worker', category_b_id);

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  business_month date := date_trunc(
    'month', (now() at time zone 'Asia/Kolkata')::date
  )::date;
  first_month date := (business_month - interval '2 months')::date;
  deactivation_month date := (business_month - interval '1 month')::date;
  future_month date := (business_month + interval '1 month')::date;
  category_id uuid := gen_random_uuid();
  category_rate public.staff_monthly_salary_rates%rowtype;
  lifecycle_worker public.staff_workers%rowtype;
  mistaken_worker public.staff_workers%rowtype;
  same_name_worker public.staff_workers%rowtype;
  earning_worker public.staff_workers%rowtype;
  withdrawal_worker public.staff_workers%rowtype;
  deduction_worker public.staff_workers%rowtype;
  deleted_worker_id uuid;
  earning_worker_rows integer;
  withdrawal_worker_rows integer;
  deduction_worker_rows integer;
begin
  insert into public.staff_categories (id, factory_id, name)
  values (category_id, factory_id, 'Delete verifier category');
  select * into category_rate from public.create_staff_category_monthly_salary(
    factory_id, category_id, 10000, first_month
  );

  select * into lifecycle_worker from public.create_staff_worker(
    factory_id, 'Lifecycle worker', category_id, first_month, null
  );
  perform public.deactivate_staff_worker(
    factory_id, lifecycle_worker.id, deactivation_month
  );
  perform public.ensure_staff_monthly_earnings(
    factory_id, lifecycle_worker.id, business_month
  );
  if (select is_active from public.staff_workers where id = lifecycle_worker.id)
    or not exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = lifecycle_worker.id
        and salary_month = deactivation_month
    )
    or exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = lifecycle_worker.id
        and salary_month > deactivation_month
    ) then
    raise exception 'FAIL: deactivation lifecycle behavior changed';
  end if;
  perform public.create_staff_withdrawal(
    factory_id, lifecycle_worker.id, business_today, 100
  );
  if not exists (
    select 1 from public.staff_withdrawals
    where staff_worker_id = lifecycle_worker.id and amount = 100
  ) then
    raise exception 'FAIL: inactive Staff remaining balance could not be withdrawn';
  end if;
  raise notice 'PASS: deactivation month remains eligible, history remains, and future salary stops';
  raise notice 'PASS: inactive Staff can still withdraw remaining balance';

  perform public.reactivate_staff_worker(
    factory_id, lifecycle_worker.id, business_month
  );
  perform public.ensure_staff_monthly_earnings(
    factory_id, lifecycle_worker.id, business_month
  );
  if not (select is_active from public.staff_workers where id = lifecycle_worker.id)
    or not exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = lifecycle_worker.id
        and salary_month = business_month
    )
    or (select count(*) from public.staff_monthly_earnings
        where staff_worker_id = lifecycle_worker.id) <> 3 then
    raise exception 'FAIL: reactivation lifecycle behavior changed';
  end if;
  raise notice 'PASS: inactive Staff can reactivate without losing prior history';

  select * into mistaken_worker from public.create_staff_worker(
    factory_id, 'Duplicate name', category_id, future_month, null
  );
  select * into same_name_worker from public.create_staff_worker(
    factory_id, 'Duplicate name', category_id, future_month, null
  );
  perform public.create_staff_monthly_salary_override(
    factory_id, mistaken_worker.id, 12000, future_month
  );

  select public.delete_staff_worker(factory_id, mistaken_worker.id)
  into deleted_worker_id;
  if deleted_worker_id <> mistaken_worker.id
    or exists (select 1 from public.staff_workers where id = mistaken_worker.id)
    or exists (select 1 from public.staff_salary_eligibility_periods
      where staff_worker_id = mistaken_worker.id)
    or exists (select 1 from public.staff_monthly_salary_rates
      where staff_worker_id = mistaken_worker.id)
    or exists (select 1 from public.staff_monthly_earnings
      where staff_worker_id = mistaken_worker.id)
    or not exists (select 1 from public.staff_workers where id = same_name_worker.id)
    or not exists (select 1 from public.staff_salary_eligibility_periods
      where staff_worker_id = same_name_worker.id)
    or not exists (select 1 from public.staff_categories where id = category_id)
    or not exists (select 1 from public.staff_monthly_salary_rates where id = category_rate.id) then
    raise exception 'FAIL: valid delete was not isolated to the mistaken Staff UUID';
  end if;
  raise notice 'PASS: future-start no-history Staff setup deletes without generating salary';
  raise notice 'PASS: category, category default, other worker, and duplicate name remain intact';

  select * into earning_worker from public.create_staff_worker(
    factory_id, 'Earning worker', category_id, business_month, null
  );
  perform public.ensure_staff_monthly_earnings(
    factory_id, earning_worker.id, business_month
  );
  select count(*) into earning_worker_rows
  from public.staff_monthly_earnings where staff_worker_id = earning_worker.id;
  perform pg_temp.expect_error(
    'worker with monthly earning cannot be deleted', 'P2540',
    format('select public.delete_staff_worker(%L::uuid, %L::uuid)',
      factory_id, earning_worker.id)
  );
  if not exists (select 1 from public.staff_workers where id = earning_worker.id)
    or (select count(*) from public.staff_monthly_earnings
        where staff_worker_id = earning_worker.id) <> earning_worker_rows
    or not exists (select 1 from public.staff_salary_eligibility_periods
        where staff_worker_id = earning_worker.id) then
    raise exception 'FAIL: rejected earning delete changed Staff history or setup';
  end if;

  select * into withdrawal_worker from public.create_staff_worker(
    factory_id, 'Withdrawal worker', category_id, business_month, null
  );
  perform public.ensure_staff_monthly_earnings(
    factory_id, withdrawal_worker.id, business_month
  );
  perform public.create_staff_withdrawal(
    factory_id, withdrawal_worker.id, business_today, 100
  );
  select count(*) into withdrawal_worker_rows
  from public.staff_withdrawals where staff_worker_id = withdrawal_worker.id;
  perform pg_temp.expect_error(
    'worker with withdrawal cannot be deleted', 'P2540',
    format('select public.delete_staff_worker(%L::uuid, %L::uuid)',
      factory_id, withdrawal_worker.id)
  );
  if not exists (select 1 from public.staff_workers where id = withdrawal_worker.id)
    or (select count(*) from public.staff_withdrawals
        where staff_worker_id = withdrawal_worker.id) <> withdrawal_worker_rows then
    raise exception 'FAIL: rejected withdrawal delete changed financial history';
  end if;

  select * into deduction_worker from public.create_staff_worker(
    factory_id, 'Deduction worker', category_id, business_month, null
  );
  perform public.ensure_staff_monthly_earnings(
    factory_id, deduction_worker.id, business_month
  );
  perform public.create_staff_salary_deduction(
    factory_id, deduction_worker.id, business_today, 100, 'Verifier deduction'
  );
  select count(*) into deduction_worker_rows
  from public.staff_salary_deductions where staff_worker_id = deduction_worker.id;
  perform pg_temp.expect_error(
    'worker with deduction cannot be deleted', 'P2540',
    format('select public.delete_staff_worker(%L::uuid, %L::uuid)',
      factory_id, deduction_worker.id)
  );
  if not exists (select 1 from public.staff_workers where id = deduction_worker.id)
    or (select count(*) from public.staff_salary_deductions
        where staff_worker_id = deduction_worker.id) <> deduction_worker_rows then
    raise exception 'FAIL: rejected deduction delete changed financial history';
  end if;
  raise notice 'PASS: earnings, withdrawals, and deductions each force deactivation instead';

  perform pg_temp.expect_error(
    'cross-factory Staff delete is rejected', '42501',
    format('select public.delete_staff_worker(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_b_id'),
      current_setting('atlas_test.worker_b_id'))
  );

  raise notice 'PASS: Staff worker delete verifier completed';
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('authenticated', 'public.staff_workers', 'delete')
    or has_table_privilege('anon', 'public.staff_workers', 'delete')
    or has_function_privilege('anon', 'public.delete_staff_worker(uuid,uuid)', 'execute') then
    raise exception 'FAIL: direct or anonymous Staff deletion is permitted';
  end if;
  raise notice 'PASS: direct and anonymous Staff deletion is denied';
end;
$$;

rollback;
