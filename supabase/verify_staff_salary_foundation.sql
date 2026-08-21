-- Staff Salary foundation verifier. Run after migration 20260820000000.
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
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name) values
    (factory_a_id, format('Staff verifier A %s', factory_a_id)),
    (factory_b_id, format('Staff verifier B %s', factory_b_id));
  update public.factory_users set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.staff_categories (id, factory_id, name)
  values (category_b_id, factory_b_id, 'Manager');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.category_b_id', category_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  category_a_id uuid := gen_random_uuid();
  default_worker_id uuid := gen_random_uuid();
  override_worker_id uuid := gen_random_uuid();
  old_category_rate public.staff_monthly_salary_rates%rowtype;
  new_category_rate public.staff_monthly_salary_rates%rowtype;
  old_override_rate public.staff_monthly_salary_rates%rowtype;
  new_override_rate public.staff_monthly_salary_rates%rowtype;
  resolved record;
begin
  insert into public.staff_categories (id, factory_id, name)
  values (category_a_id, current_setting('atlas_test.factory_a_id')::uuid, 'Manager');
  raise notice 'PASS: Staff category creation';

  perform pg_temp.expect_error(
    'untrimmed category name is rejected', '23514',
    format('insert into public.staff_categories (factory_id, name) values (%L::uuid, %L)',
      current_setting('atlas_test.factory_a_id'), ' Driver ')
  );
  perform pg_temp.expect_error(
    'duplicate category name in one factory is rejected', '23505',
    format('insert into public.staff_categories (factory_id, name) values (%L::uuid, %L)',
      current_setting('atlas_test.factory_a_id'), 'Manager')
  );
  if (select count(*) from public.staff_categories where name = 'Manager') <> 1 then
    raise exception 'FAIL: factory isolation exposed Factory B category';
  end if;
  raise notice 'PASS: same category name across factories and RLS isolation';

  insert into public.staff_workers (id, factory_id, name, staff_category_id)
  values
    (default_worker_id, current_setting('atlas_test.factory_a_id')::uuid, 'Asha', category_a_id),
    (override_worker_id, current_setting('atlas_test.factory_a_id')::uuid, 'Ravi', category_a_id);
  raise notice 'PASS: Staff worker creation';

  perform pg_temp.expect_error(
    'cross-factory Staff/category assignment is rejected', '23503',
    format(
      'insert into public.staff_workers (factory_id, name, staff_category_id) values (%L::uuid, %L, %L::uuid)',
      current_setting('atlas_test.factory_a_id'), 'Wrong factory', current_setting('atlas_test.category_b_id')
    )
  );
  perform pg_temp.expect_error(
    'Staff category reassignment is rejected', 'P2501',
    format('update public.staff_workers set staff_category_id = %L::uuid where id = %L::uuid',
      current_setting('atlas_test.category_b_id'), default_worker_id)
  );

  select * into old_category_rate
  from public.create_staff_category_monthly_salary(
    current_setting('atlas_test.factory_a_id')::uuid, category_a_id, 10000, date '2026-01-01'
  );
  select * into new_category_rate
  from public.create_staff_category_monthly_salary(
    current_setting('atlas_test.factory_a_id')::uuid, category_a_id, 12000, date '2026-03-01'
  );
  select * into old_category_rate from public.staff_monthly_salary_rates
  where id = old_category_rate.id;
  if old_category_rate.effective_to <> date '2026-02-28'
    or new_category_rate.effective_to is not null then
    raise exception 'FAIL: category salary history was not closed correctly';
  end if;
  raise notice 'PASS: category salary creation and effective-dated replacement';

  select * into old_override_rate
  from public.create_staff_monthly_salary_override(
    current_setting('atlas_test.factory_a_id')::uuid, override_worker_id, 15000, date '2026-02-01'
  );
  select * into new_override_rate
  from public.create_staff_monthly_salary_override(
    current_setting('atlas_test.factory_a_id')::uuid, override_worker_id, 16000, date '2026-04-01'
  );
  select * into old_override_rate from public.staff_monthly_salary_rates
  where id = old_override_rate.id;
  if old_override_rate.effective_to <> date '2026-03-31'
    or new_override_rate.effective_to is not null then
    raise exception 'FAIL: Staff override history was not closed correctly';
  end if;
  raise notice 'PASS: Staff override creation and effective-dated replacement';

  select * into resolved from public.resolve_staff_monthly_salary(
    current_setting('atlas_test.factory_a_id')::uuid, default_worker_id, date '2026-02-01'
  );
  if resolved.monthly_salary <> 10000 or resolved.source <> 'CATEGORY_DEFAULT'
    or resolved.staff_category_id <> category_a_id
    or resolved.salary_configuration_id <> old_category_rate.id then
    raise exception 'FAIL: category-default resolution is incorrect';
  end if;

  select * into resolved from public.resolve_staff_monthly_salary(
    current_setting('atlas_test.factory_a_id')::uuid, default_worker_id, date '2026-03-01'
  );
  if resolved.monthly_salary <> 12000 or resolved.salary_configuration_id <> new_category_rate.id then
    raise exception 'FAIL: category salary effective-date change is incorrect';
  end if;
  raise notice 'PASS: category-default resolver and salary changes';

  select * into resolved from public.resolve_staff_monthly_salary(
    current_setting('atlas_test.factory_a_id')::uuid, override_worker_id, date '2026-03-01'
  );
  if resolved.monthly_salary <> 15000 or resolved.source <> 'STAFF_OVERRIDE'
    or resolved.staff_category_id <> category_a_id
    or resolved.salary_configuration_id <> old_override_rate.id then
    raise exception 'FAIL: individual override precedence is incorrect';
  end if;
  raise notice 'PASS: Staff individual override precedence';

  perform pg_temp.expect_error(
    'overlapping or backdated category salary is rejected', 'P0001',
    format('select public.create_staff_category_monthly_salary(%L::uuid, %L::uuid, 11000, date %L)',
      current_setting('atlas_test.factory_a_id'), category_a_id, '2026-02-01')
  );
  perform pg_temp.expect_error(
    'non-positive salary is rejected', '22023',
    format('select public.create_staff_monthly_salary_override(%L::uuid, %L::uuid, 0, date %L)',
      current_setting('atlas_test.factory_a_id'), default_worker_id, '2026-01-01')
  );
  perform pg_temp.expect_error(
    'Factory A user cannot create Factory B salary', '42501',
    format('select public.create_staff_category_monthly_salary(%L::uuid, %L::uuid, 9000, date %L)',
      current_setting('atlas_test.factory_b_id'), current_setting('atlas_test.category_b_id'), '2026-01-01')
  );

  update public.staff_workers set is_active = false where id = override_worker_id;
  update public.staff_categories set is_active = false where id = category_a_id;
  select * into resolved from public.resolve_staff_monthly_salary(
    current_setting('atlas_test.factory_a_id')::uuid, override_worker_id, date '2026-03-01'
  );
  if resolved.monthly_salary <> 15000
    or not exists (select 1 from public.staff_workers where id = override_worker_id and not is_active)
    or not exists (select 1 from public.staff_categories where id = category_a_id and not is_active) then
    raise exception 'FAIL: inactive Staff history was not preserved';
  end if;
  raise notice 'PASS: inactive Staff/category history remains resolvable';

  perform set_config('atlas_test.category_a_id', category_a_id::text, true);
end;
$$;

reset role;

select pg_temp.expect_error(
  'database exclusion rejects overlapping category periods', '23P01',
  format(
    'insert into public.staff_monthly_salary_rates (factory_id, staff_category_id, monthly_salary, effective_from, effective_to) values (%L::uuid, %L::uuid, 9999, date %L, date %L)',
    current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.category_a_id'),
    '2026-01-15', '2026-02-15'
  )
);

do $$
begin
  if has_table_privilege('anon', 'public.staff_categories', 'select')
    or has_table_privilege('anon', 'public.staff_workers', 'select')
    or has_table_privilege('anon', 'public.staff_monthly_salary_rates', 'select')
    or has_function_privilege('anon', 'public.resolve_staff_monthly_salary(uuid,uuid,date)', 'execute') then
    raise exception 'FAIL: anonymous Staff access exists';
  end if;
  raise notice 'PASS: anonymous Staff access is denied';
  raise notice 'PASS: Staff Salary foundation verifier completed';
end;
$$;

rollback;
