-- Staff monthly entitlement verifier. Run after migrations through 20260820000001.
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
    (factory_a_id, format('Staff entitlement verifier A %s', factory_a_id)),
    (factory_b_id, format('Staff entitlement verifier B %s', factory_b_id));
  update public.factory_users set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.staff_categories (id, factory_id, name)
  values (category_b_id, factory_b_id, 'Factory B Staff');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.category_b_id', category_b_id::text, true);
  perform set_config('atlas_test.start_month', (business_month - interval '4 months')::date::text, true);
  perform set_config('atlas_test.middle_month', (business_month - interval '3 months')::date::text, true);
  perform set_config('atlas_test.following_month', (business_month - interval '2 months')::date::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  start_month date := current_setting('atlas_test.start_month')::date;
  middle_month date := current_setting('atlas_test.middle_month')::date;
  following_month date := current_setting('atlas_test.following_month')::date;
  category_id uuid := gen_random_uuid();
  missing_category_id uuid := gen_random_uuid();
  default_worker public.staff_workers%rowtype;
  custom_worker public.staff_workers%rowtype;
  override_worker public.staff_workers%rowtype;
  backfill_worker public.staff_workers%rowtype;
  gap_worker public.staff_workers%rowtype;
  stop_worker public.staff_workers%rowtype;
  missing_worker public.staff_workers%rowtype;
  old_rate public.staff_monthly_salary_rates%rowtype;
  new_rate public.staff_monthly_salary_rates%rowtype;
  override_rate public.staff_monthly_salary_rates%rowtype;
  ensure_result record;
  earning record;
begin
  insert into public.staff_categories (id, factory_id, name) values
    (category_id, factory_id, 'Entitlement Staff'),
    (missing_category_id, factory_id, 'Missing Salary Staff');

  select * into old_rate from public.create_staff_category_monthly_salary(
    factory_id, category_id, 10000, start_month
  );
  select * into new_rate from public.create_staff_category_monthly_salary(
    factory_id, category_id, 12000, middle_month + 14
  );

  select * into default_worker from public.create_staff_worker(
    factory_id, 'Default worker', category_id, middle_month, null
  );
  select * into custom_worker from public.create_staff_worker(
    factory_id, 'Custom first month worker', category_id, middle_month, 9000
  );
  select * into override_worker from public.create_staff_worker(
    factory_id, 'Override worker', category_id, middle_month, null
  );
  select * into backfill_worker from public.create_staff_worker(
    factory_id, 'Backfill worker', category_id, start_month, null
  );
  select * into gap_worker from public.create_staff_worker(
    factory_id, 'Inactive gap worker', category_id, start_month, null
  );
  select * into stop_worker from public.create_staff_worker(
    factory_id, 'Deactivated worker', category_id, middle_month, null
  );
  select * into missing_worker from public.create_staff_worker(
    factory_id, 'Missing salary worker', missing_category_id, middle_month, null
  );

  select * into override_rate from public.create_staff_monthly_salary_override(
    factory_id, override_worker.id, 15000, middle_month
  );

  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, default_worker.id, start_month
  );
  if ensure_result.earnings_created <> 0 then
    raise exception 'FAIL: earning was created before salary start month';
  end if;
  raise notice 'PASS: no earnings before salary start month';

  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, default_worker.id, following_month
  );
  if ensure_result.earnings_created <> 2
    or ensure_result.first_created_month <> middle_month
    or ensure_result.last_created_month <> following_month then
    raise exception 'FAIL: first eligible month materialization summary is incorrect';
  end if;

  select * into earning from public.staff_monthly_earnings
  where staff_worker_id = default_worker.id and salary_month = middle_month;
  if earning.credited_amount <> 10000
    or earning.resolved_monthly_salary_snapshot <> 10000
    or earning.salary_configuration_id <> old_rate.id
    or earning.salary_source_snapshot <> 'CATEGORY_DEFAULT'
    or earning.credit_source <> 'NORMAL_SALARY' then
    raise exception 'FAIL: salary month did not use its first-day category rate';
  end if;
  raise notice 'PASS: first eligible month and normal category salary earning';
  raise notice 'PASS: mid-month salary change does not alter that month';

  select * into earning from public.staff_monthly_earnings
  where staff_worker_id = default_worker.id and salary_month = following_month;
  if earning.credited_amount <> 12000
    or earning.salary_configuration_id <> new_rate.id then
    raise exception 'FAIL: following month did not use the new salary rate';
  end if;
  raise notice 'PASS: following month uses the mid-month replacement rate';

  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, override_worker.id, following_month
  );
  select * into earning from public.staff_monthly_earnings
  where staff_worker_id = override_worker.id and salary_month = middle_month;
  if earning.credited_amount <> 15000
    or earning.salary_source_snapshot <> 'STAFF_OVERRIDE'
    or earning.salary_configuration_id <> override_rate.id then
    raise exception 'FAIL: Staff override precedence was not snapshotted';
  end if;
  raise notice 'PASS: Staff override precedence';

  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, custom_worker.id, following_month
  );
  select * into earning from public.staff_monthly_earnings
  where staff_worker_id = custom_worker.id and salary_month = middle_month;
  if earning.credited_amount <> 9000
    or earning.resolved_monthly_salary_snapshot <> 10000
    or earning.salary_configuration_id <> old_rate.id
    or earning.credit_source <> 'FIRST_MONTH_CUSTOM' then
    raise exception 'FAIL: first-month custom salary snapshot is incorrect';
  end if;
  select * into earning from public.staff_monthly_earnings
  where staff_worker_id = custom_worker.id and salary_month = following_month;
  if earning.credited_amount <> 12000 or earning.credit_source <> 'NORMAL_SALARY' then
    raise exception 'FAIL: custom salary leaked beyond the first month';
  end if;
  raise notice 'PASS: first-month custom amount applies once and normal salary resumes';

  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, backfill_worker.id, following_month
  );
  if ensure_result.earnings_created <> 3
    or (select count(*) from public.staff_monthly_earnings
        where staff_worker_id = backfill_worker.id) <> 3 then
    raise exception 'FAIL: missing historical months were not backfilled';
  end if;
  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, backfill_worker.id, following_month
  );
  if ensure_result.earnings_created <> 0 then
    raise exception 'FAIL: repeated ensure was not idempotent';
  end if;
  raise notice 'PASS: historical backfill and repeated-call idempotency';

  perform public.deactivate_staff_worker(factory_id, gap_worker.id, start_month);
  perform public.reactivate_staff_worker(factory_id, gap_worker.id, following_month);
  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, gap_worker.id, following_month
  );
  if ensure_result.earnings_created <> 2
    or exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = gap_worker.id and salary_month = middle_month
    ) then
    raise exception 'FAIL: inactive gap received a salary earning';
  end if;
  raise notice 'PASS: deactivation month remains eligible and reactivation gap is not backfilled';

  perform public.deactivate_staff_worker(factory_id, stop_worker.id, middle_month);
  select * into ensure_result from public.ensure_staff_monthly_earnings(
    factory_id, stop_worker.id, following_month
  );
  if ensure_result.earnings_created <> 1
    or not exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = stop_worker.id and salary_month = middle_month
    )
    or exists (
      select 1 from public.staff_monthly_earnings
      where staff_worker_id = stop_worker.id and salary_month > middle_month
    ) then
    raise exception 'FAIL: deactivated worker generated a future month';
  end if;
  raise notice 'PASS: deactivation prevents new future-month earnings';

  perform pg_temp.expect_error(
    'retroactive deactivation cannot contradict immutable earnings', 'P0001',
    format('select public.deactivate_staff_worker(%L::uuid, %L::uuid, date %L)',
      factory_id, default_worker.id, middle_month)
  );

  perform pg_temp.expect_error(
    'missing salary configuration fails clearly', 'P2503',
    format('select public.ensure_staff_monthly_earnings(%L::uuid, %L::uuid, date %L)',
      factory_id, missing_worker.id, middle_month)
  );
  if exists (select 1 from public.staff_monthly_earnings where staff_worker_id = missing_worker.id) then
    raise exception 'FAIL: missing salary configuration left partial or zero earnings';
  end if;
  raise notice 'PASS: missing salary failure is atomic';

  perform pg_temp.expect_error(
    'cross-factory Staff/category creation fails', '42501',
    format('select public.create_staff_worker(%L::uuid, %L, %L::uuid, date %L, null)',
      factory_id, 'Cross factory worker', current_setting('atlas_test.category_b_id'), start_month)
  );
  perform pg_temp.expect_error(
    'Factory A user cannot ensure Factory B earnings', '42501',
    format('select public.ensure_staff_monthly_earnings(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_b_id'), default_worker.id, following_month)
  );

  perform pg_temp.expect_error(
    'authenticated clients cannot insert Staff earnings', '42501',
    format(
      'insert into public.staff_monthly_earnings (factory_id, staff_worker_id, salary_month, credited_amount, salary_configuration_id, resolved_monthly_salary_snapshot, salary_source_snapshot, credit_source, staff_category_id_snapshot) values (%L::uuid, %L::uuid, date %L, 1, %L::uuid, 1, %L, %L, %L::uuid)',
      factory_id, default_worker.id, start_month, old_rate.id,
      'CATEGORY_DEFAULT', 'NORMAL_SALARY', category_id
    )
  );

  if not exists (
    select 1 from public.staff_monthly_earnings
    where staff_worker_id = stop_worker.id and salary_month = middle_month
  ) then
    raise exception 'FAIL: inactive Staff historical earnings are not readable';
  end if;
  perform public.resolve_staff_monthly_salary(factory_id, stop_worker.id, middle_month);
  raise notice 'PASS: historical inactive Staff earnings remain readable/resolvable';

  perform set_config('atlas_test.default_worker_id', default_worker.id::text, true);
  perform set_config('atlas_test.default_earning_id', (
    select id::text from public.staff_monthly_earnings
    where staff_worker_id = default_worker.id and salary_month = middle_month
  ), true);
end;
$$;

reset role;

select pg_temp.expect_error(
  'earning rows reject updates even for table owner', 'P2510',
  format('update public.staff_monthly_earnings set credited_amount = 1 where id = %L::uuid',
    current_setting('atlas_test.default_earning_id'))
);
select pg_temp.expect_error(
  'earning rows reject deletes even for table owner', 'P2510',
  format('delete from public.staff_monthly_earnings where id = %L::uuid',
    current_setting('atlas_test.default_earning_id'))
);
select pg_temp.expect_error(
  'one earning maximum per Staff/month', '23505',
  format(
    'insert into public.staff_monthly_earnings (factory_id, staff_worker_id, salary_month, credited_amount, salary_configuration_id, resolved_monthly_salary_snapshot, salary_source_snapshot, credit_source, staff_category_id_snapshot) select factory_id, staff_worker_id, salary_month, credited_amount, salary_configuration_id, resolved_monthly_salary_snapshot, salary_source_snapshot, credit_source, staff_category_id_snapshot from public.staff_monthly_earnings where id = %L::uuid',
    current_setting('atlas_test.default_earning_id')
  )
);

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.ensure_staff_monthly_earnings(uuid,uuid,date)'::regprocedure
  ) into function_definition;
  if position('pg_advisory_xact_lock' in function_definition) = 0 then
    raise exception 'FAIL: ensure RPC lacks transaction-scoped concurrency lock';
  end if;
  raise notice 'PASS: advisory lock plus unique worker/month key protects concurrent calls';

  if has_table_privilege('anon', 'public.staff_monthly_earnings', 'select')
    or has_table_privilege('anon', 'public.staff_salary_eligibility_periods', 'select')
    or has_function_privilege('anon', 'public.ensure_staff_monthly_earnings(uuid,uuid,date)', 'execute') then
    raise exception 'FAIL: anonymous Staff entitlement access exists';
  end if;
  raise notice 'PASS: anonymous entitlement access is denied';
  raise notice 'PASS: Staff monthly entitlement verifier completed';
end;
$$;

rollback;
