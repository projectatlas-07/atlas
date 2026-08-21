-- Staff Salary legacy rate-boundary repair verifier.
-- Run after migration 20260820000004. All fixture changes are rolled back.

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
  values (verifier_factory_id, format('Staff boundary verifier %s', verifier_factory_id));
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
  driver_category uuid := gen_random_uuid();
  fireman_category uuid := gen_random_uuid();
  other_category uuid := gen_random_uuid();
  overlap_category uuid := gen_random_uuid();
  driver_rate public.staff_monthly_salary_rates%rowtype;
  corrected_driver_rate public.staff_monthly_salary_rates%rowtype;
  fireman_rate public.staff_monthly_salary_rates%rowtype;
  other_rate public.staff_monthly_salary_rates%rowtype;
  overlap_latest public.staff_monthly_salary_rates%rowtype;
  driver_worker public.staff_workers%rowtype;
  custom_worker public.staff_workers%rowtype;
  fireman_worker public.staff_workers%rowtype;
  future_fireman public.staff_workers%rowtype;
  conflict_worker public.staff_workers%rowtype;
  override_worker public.staff_workers%rowtype;
  conflict_override public.staff_monthly_salary_rates%rowtype;
  isolated_override public.staff_monthly_salary_rates%rowtype;
  resolved record;
  summary record;
  earning_before public.staff_monthly_earnings%rowtype;
  earning_after public.staff_monthly_earnings%rowtype;
begin
  insert into public.staff_categories (id, factory_id, name) values
    (driver_category, target_factory_id, 'Tractor Driver'),
    (fireman_category, target_factory_id, 'Fireman'),
    (other_category, target_factory_id, 'Manager'),
    (overlap_category, target_factory_id, 'Overlap fixture');

  select * into driver_rate from public.create_staff_category_monthly_salary(
    target_factory_id, driver_category, 10500, legacy_day
  );
  select * into corrected_driver_rate from public.create_staff_category_monthly_salary(
    target_factory_id, driver_category, 10500, business_month
  );

  if corrected_driver_rate.id <> driver_rate.id
    or corrected_driver_rate.monthly_salary <> 10500
    or corrected_driver_rate.effective_from <> business_month
    or corrected_driver_rate.effective_to is not null
    or (select count(*) from public.staff_monthly_salary_rates
        where factory_id = target_factory_id and staff_category_id = driver_category) <> 1 then
    raise exception 'FAIL: legacy category boundary was not corrected in place';
  end if;
  raise notice 'PASS: legacy August-20-style category rate safely moved to month start with amount preserved';

  select * into driver_worker from public.create_staff_worker(
    target_factory_id, 'Bappi', driver_category, business_month, null
  );
  select * into resolved from public.resolve_staff_monthly_salary(
    target_factory_id, driver_worker.id, business_month
  );
  if resolved.monthly_salary <> 10500
    or resolved.source <> 'CATEGORY_DEFAULT'
    or resolved.salary_configuration_id <> driver_rate.id then
    raise exception 'FAIL: corrected Tractor Driver salary does not resolve on month start';
  end if;

  select * into summary from public.get_staff_financial_summary(target_factory_id, driver_worker.id);
  if summary.total_earnings <> 10500 or summary.available_balance <> 10500 then
    raise exception 'FAIL: current-month Tractor Driver entitlement is incorrect';
  end if;
  raise notice 'PASS: current-month Staff receives the corrected category entitlement and balance';

  select * into custom_worker from public.create_staff_worker(
    target_factory_id, 'Custom Bappi', driver_category, business_month, 9000
  );
  select * into summary from public.get_staff_financial_summary(target_factory_id, custom_worker.id);
  if summary.total_earnings <> 9000 or summary.available_balance <> 9000 then
    raise exception 'FAIL: first-month custom salary was not preserved';
  end if;
  raise notice 'PASS: first-month custom amount still overrides only the credited amount';

  select * into fireman_rate from public.create_staff_category_monthly_salary(
    target_factory_id, fireman_category, 80000, legacy_day
  );
  select * into fireman_rate from public.create_staff_category_monthly_salary(
    target_factory_id, fireman_category, 80000, business_month
  );
  select * into fireman_worker from public.create_staff_worker(
    target_factory_id, 'Current Fireman', fireman_category, business_month, null
  );
  select * into summary from public.get_staff_financial_summary(target_factory_id, fireman_worker.id);
  if summary.available_balance <> 80000 then
    raise exception 'FAIL: current-month Fireman balance is incorrect';
  end if;

  select * into future_fireman from public.create_staff_worker(
    target_factory_id, 'Future Fireman', fireman_category, future_month, null
  );
  select * into resolved from public.resolve_staff_monthly_salary(
    target_factory_id, future_fireman.id, business_month
  );
  select * into summary from public.get_staff_financial_summary(target_factory_id, future_fireman.id);
  if resolved.monthly_salary <> 80000
    or summary.total_earnings <> 0
    or summary.available_balance <> 0
    or exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = future_fireman.id
    ) then
    raise exception 'FAIL: future-start Staff behavior is incorrect';
  end if;
  raise notice 'PASS: future-start Staff shows configured salary without early earnings';

  select * into other_rate from public.create_staff_category_monthly_salary(
    target_factory_id, other_category, 30000, business_month
  );
  if other_rate.monthly_salary <> 30000
    or other_rate.effective_from <> business_month
    or (select monthly_salary from public.staff_monthly_salary_rates
        where id = driver_rate.id) <> 10500
    or (select monthly_salary from public.staff_monthly_salary_rates
        where id = fireman_rate.id) <> 80000 then
    raise exception 'FAIL: category salary correction leaked across categories';
  end if;
  raise notice 'PASS: Tractor Driver, Fireman, and other category salary tracks remain isolated';

  perform public.create_staff_category_monthly_salary(
    target_factory_id, overlap_category, 10000,
    (business_month - interval '2 months')::date
  );
  select * into overlap_latest from public.create_staff_category_monthly_salary(
    target_factory_id, overlap_category, 12000, legacy_day
  );
  perform pg_temp.expect_error(
    'category correction creating an overlap is rejected', 'P0001',
    format('select public.create_staff_category_monthly_salary(%L::uuid, %L::uuid, 12000, %L::date)',
      target_factory_id, overlap_category, (business_month - interval '1 month')::date)
  );
  if overlap_latest.effective_from <> (
    select effective_from from public.staff_monthly_salary_rates where id = overlap_latest.id
  ) then
    raise exception 'FAIL: rejected overlap changed salary history';
  end if;

  select * into conflict_worker from public.create_staff_worker(
    target_factory_id, 'Immutable conflict worker', driver_category, business_month, null
  );
  perform public.ensure_staff_monthly_earnings(target_factory_id, conflict_worker.id, business_month);
  select * into earning_before from public.staff_monthly_earnings
  where staff_worker_id = conflict_worker.id and salary_month = business_month;
  select * into conflict_override from public.create_staff_monthly_salary_override(
    target_factory_id, conflict_worker.id, 12000, legacy_day
  );
  perform pg_temp.expect_error(
    'override correction conflicting with immutable earnings is rejected', 'P2511',
    format('select public.create_staff_monthly_salary_override(%L::uuid, %L::uuid, 12000, %L::date)',
      target_factory_id, conflict_worker.id, business_month)
  );
  select * into earning_after from public.staff_monthly_earnings
  where id = earning_before.id;
  if earning_after is distinct from earning_before
    or (select effective_from from public.staff_monthly_salary_rates
        where id = conflict_override.id) <> legacy_day then
    raise exception 'FAIL: rejected correction rewrote immutable financial history';
  end if;
  raise notice 'PASS: immutable earning conflict rejects the correction without mutation';

  select * into override_worker from public.create_staff_worker(
    target_factory_id, 'Isolated override worker', driver_category, business_month, null
  );
  select * into isolated_override from public.create_staff_monthly_salary_override(
    target_factory_id, override_worker.id, 13000, legacy_day
  );
  select * into isolated_override from public.create_staff_monthly_salary_override(
    target_factory_id, override_worker.id, 13000, business_month
  );
  select * into resolved from public.resolve_staff_monthly_salary(
    target_factory_id, override_worker.id, business_month
  );
  if resolved.source <> 'STAFF_OVERRIDE'
    or resolved.monthly_salary <> 13000
    or isolated_override.effective_from <> business_month
    or (select monthly_salary from public.staff_monthly_salary_rates
        where id = driver_rate.id) <> 10500 then
    raise exception 'FAIL: individual override correction is not isolated';
  end if;
  raise notice 'PASS: individual override correction remains worker-scoped';

  perform pg_temp.expect_error(
    'boundary correction cannot change salary amount', 'P0001',
    format('select public.create_staff_category_monthly_salary(%L::uuid, %L::uuid, 99999, %L::date)',
      target_factory_id, driver_category, (business_month - interval '1 month')::date)
  );

  raise notice 'PASS: Staff salary rate boundary repair verifier completed';
end;
$$;

rollback;
