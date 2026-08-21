-- Staff salary display/creation month-start verifier. Run after migration 00006.
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
  verifier_factory_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name)
  values (verifier_factory_id, format('Staff month-start verifier %s', verifier_factory_id));
  update public.factory_users set factory_id = verifier_factory_id, is_active = true
  where id = mapping_id;

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_id', verifier_factory_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  target_factory_id uuid := current_setting('atlas_test.factory_id')::uuid;
  business_month date := date_trunc(
    'month', (now() at time zone 'Asia/Kolkata')::date
  )::date;
  legacy_day date := business_month + 19;
  future_month date := (business_month + interval '1 month')::date;
  driver_category_id uuid := gen_random_uuid();
  fireman_category_id uuid := gen_random_uuid();
  missing_category_id uuid := gen_random_uuid();
  driver_rate public.staff_monthly_salary_rates%rowtype;
  dholu public.staff_workers%rowtype;
  custom_worker public.staff_workers%rowtype;
  future_worker public.staff_workers%rowtype;
  resolution record;
  summary record;
  earning public.staff_monthly_earnings%rowtype;
begin
  insert into public.staff_categories (id, factory_id, name) values
    (driver_category_id, target_factory_id, 'Tractor Driver'),
    (fireman_category_id, target_factory_id, 'Fireman'),
    (missing_category_id, target_factory_id, 'Missing salary category');

  select * into driver_rate from public.create_staff_category_monthly_salary(
    target_factory_id, driver_category_id, 10500, legacy_day
  );
  select * into driver_rate from public.create_staff_category_monthly_salary(
    target_factory_id, driver_category_id, 10500, business_month
  );
  select * into resolution from public.staff_monthly_salary_rates
  where id = driver_rate.id;
  if resolution.monthly_salary <> 10500
    or resolution.effective_from <> business_month
    or resolution.effective_to is not null then
    raise exception 'FAIL: corrected Tractor Driver rate does not cover month start';
  end if;
  raise notice 'PASS: Tractor Driver 10500 saved for the month resolves from its first day';

  select * into dholu from public.create_staff_worker(
    target_factory_id, 'Dholu', driver_category_id, business_month, null
  );
  select * into resolution from public.resolve_staff_monthly_salary(
    target_factory_id, dholu.id, business_month
  );
  select * into summary from public.get_staff_financial_summary(
    target_factory_id, dholu.id
  );
  if resolution.monthly_salary <> 10500
    or resolution.source <> 'CATEGORY_DEFAULT'
    or summary.total_earnings <> 10500
    or summary.available_balance <> 10500 then
    raise exception 'FAIL: current-month salary display and entitlement disagree';
  end if;
  raise notice 'PASS: current-month card resolution and entitlement share month-start salary';

  select * into custom_worker from public.create_staff_worker(
    target_factory_id, 'Custom first month', driver_category_id, business_month, 9000
  );
  select * into summary from public.get_staff_financial_summary(
    target_factory_id, custom_worker.id
  );
  select * into earning from public.staff_monthly_earnings
  where staff_worker_id = custom_worker.id and salary_month = business_month;
  if summary.total_earnings <> 9000
    or summary.available_balance <> 9000
    or earning.credited_amount <> 9000
    or earning.resolved_monthly_salary_snapshot <> 10500
    or earning.credit_source <> 'FIRST_MONTH_CUSTOM' then
    raise exception 'FAIL: first-month custom and normal monthly salary meanings were mixed';
  end if;
  raise notice 'PASS: custom 9000 credit retains the normal 10500 monthly salary snapshot';

  perform public.create_staff_category_monthly_salary(
    target_factory_id, fireman_category_id, 80000, business_month
  );
  select * into future_worker from public.create_staff_worker(
    target_factory_id, 'Future Fireman', fireman_category_id, future_month, null
  );
  select * into resolution from public.resolve_staff_monthly_salary(
    target_factory_id, future_worker.id, future_month
  );
  select * into summary from public.get_staff_financial_summary(
    target_factory_id, future_worker.id
  );
  if resolution.monthly_salary <> 80000
    or summary.total_earnings <> 0
    or summary.available_balance <> 0
    or exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = future_worker.id
    ) then
    raise exception 'FAIL: future salary display materialized money early';
  end if;
  raise notice 'PASS: future-start salary displays at its start month with zero current balance';

  perform pg_temp.expect_error(
    'missing start-month salary rejects normal Staff creation', 'P2505',
    format('select public.create_staff_worker(%L::uuid, %L, %L::uuid, %L::date, null)',
      target_factory_id, 'Broken normal worker', missing_category_id, business_month)
  );
  perform pg_temp.expect_error(
    'custom first-month credit still requires a normal salary snapshot', 'P2505',
    format('select public.create_staff_worker(%L::uuid, %L, %L::uuid, %L::date, 9000)',
      target_factory_id, 'Broken custom worker', missing_category_id, business_month)
  );
  if exists (
    select 1 from public.staff_workers
    where factory_id = target_factory_id
      and name in ('Broken normal worker', 'Broken custom worker')
  ) or exists (
    select 1 from public.staff_salary_eligibility_periods as eligibility
    join public.staff_workers as worker on worker.id = eligibility.staff_worker_id
    where worker.factory_id = target_factory_id
      and worker.name in ('Broken normal worker', 'Broken custom worker')
  ) then
    raise exception 'FAIL: rejected Staff creation left partial setup';
  end if;
  raise notice 'PASS: missing start-month salary leaves no invalid worker or eligibility';

  if (select monthly_salary from public.staff_monthly_salary_rates where id = driver_rate.id) <> 10500
    or (select staff_category_id from public.staff_workers where id = future_worker.id) <> fireman_category_id then
    raise exception 'FAIL: category or worker UUID isolation changed';
  end if;
  raise notice 'PASS: Staff salary month-start consistency verifier completed';
end;
$$;

rollback;
