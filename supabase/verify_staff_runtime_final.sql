-- Atlas Staff S6 final release verifier. Run after migrations through 00012.
-- Requires one existing factory_users row. Every fixture is rolled back.

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
  category_a_id uuid := gen_random_uuid();
  category_b_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name) values
    (factory_a_id, format('Staff release verifier A %s', factory_a_id)),
    (factory_b_id, format('Staff release verifier B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.staff_categories (id, factory_id, name) values
    (category_a_id, factory_a_id, 'Tractor Driver'),
    (category_b_id, factory_b_id, 'Factory B Category');

  insert into public.staff_workers (
    id, factory_id, name, staff_category_id, reference_salary
  ) values (
    worker_b_id, factory_b_id, 'Factory B Staff', category_b_id, 90000
  );

  insert into public.staff_payments (
    factory_id, staff_worker_id, payment_date, amount, note
  ) values (
    factory_b_id, worker_b_id, business_today, 99, 'Hidden Factory B payment'
  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.category_a_id', category_a_id::text, true);
  perform set_config('atlas_test.category_b_id', category_b_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
  perform set_config('atlas_test.business_today', business_today::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  category_a_id uuid := current_setting('atlas_test.category_a_id')::uuid;
  category_b_id uuid := current_setting('atlas_test.category_b_id')::uuid;
  worker_b_id uuid := current_setting('atlas_test.worker_b_id')::uuid;
  business_today date := current_setting('atlas_test.business_today')::date;
  paid_worker public.staff_workers%rowtype;
  zero_worker public.staff_workers%rowtype;
  changed_worker public.staff_workers%rowtype;
  renamed_category public.staff_categories%rowtype;
  payment_one record;
  payment_two record;
  payment_three record;
  summary record;
  payment_amounts numeric[];
  mistake_category_id uuid;
  unused_category_id uuid;
  deleted_id uuid;
begin
  select * into paid_worker
  from public.create_staff_worker_with_reference_salary(
    factory_a_id, '  Staff A  ', category_a_id, 120000
  );
  insert into public.staff_categories (factory_id, name)
  values (factory_a_id, 'Mistaken Staff Category')
  returning id into mistake_category_id;
  select * into zero_worker
  from public.create_staff_worker_with_reference_salary(
    factory_a_id, 'Mistaken zero-payment Staff', mistake_category_id, 70000
  );

  select * into summary
  from public.get_staff_payment_summary(factory_a_id, paid_worker.id);
  if paid_worker.name <> 'Staff A'
    or paid_worker.reference_salary <> 120000
    or not paid_worker.is_active
    or summary.total_paid <> 0 then
    raise exception 'FAIL: Staff creation or zero Total Paid state is incorrect';
  end if;
  raise notice 'PASS: Staff A is created with ₹1,20,000 reference salary and ₹0 Total Paid';

  select * into payment_one
  from public.record_staff_payment(
    factory_a_id, paid_worker.id, business_today - 7, 3000, '  First payment  '
  );
  select * into payment_two
  from public.record_staff_payment(
    factory_a_id, paid_worker.id, business_today - 1, 2500, '   '
  );
  select * into summary
  from public.get_staff_payment_summary(factory_a_id, paid_worker.id);
  select array_agg(amount order by payment_date desc, created_at desc, id desc)
  into payment_amounts
  from public.staff_payments
  where factory_id = factory_a_id and staff_worker_id = paid_worker.id;
  if payment_one.payment_note <> 'First payment'
    or payment_two.payment_note is not null
    or summary.total_paid <> 5500
    or payment_amounts <> array[2500::numeric, 3000::numeric] then
    raise exception 'FAIL: two arbitrary payments did not produce ordered ₹5,500 history';
  end if;
  raise notice 'PASS: ₹3,000 and ₹2,500 remain individually visible newest-first and Total Paid is ₹5,500';

  select * into changed_worker
  from public.update_staff_reference_salary(factory_a_id, paid_worker.id, 130000);
  select * into summary
  from public.get_staff_payment_summary(factory_a_id, paid_worker.id);
  if changed_worker.reference_salary <> 130000
    or summary.total_paid <> 5500
    or (select count(*) from public.staff_payments
        where factory_id = factory_a_id and staff_worker_id = paid_worker.id) <> 2
    or (select sum(amount) from public.staff_payments
        where factory_id = factory_a_id and staff_worker_id = paid_worker.id) <> 5500 then
    raise exception 'FAIL: reference salary update changed payment history or Total Paid';
  end if;
  raise notice 'PASS: reference salary changes to ₹1,30,000 without changing payments or Total Paid';

  select * into renamed_category
  from public.update_staff_category(
    factory_a_id, category_a_id, '  Tractor Operator  '
  );
  if renamed_category.id <> category_a_id
    or renamed_category.name <> 'Tractor Operator'
    or (select staff_category_id from public.staff_workers where id = paid_worker.id)
      <> category_a_id
    or (select reference_salary from public.staff_workers where id = paid_worker.id)
      <> 130000
    or (select sum(amount) from public.staff_payments
        where factory_id = factory_a_id and staff_worker_id = paid_worker.id) <> 5500 then
    raise exception 'FAIL: category rename changed Staff identity or financial history';
  end if;
  raise notice 'PASS: category rename preserves category UUID, Staff identity, salary, and payment history';

  perform pg_temp.expect_error(
    'blank category rename fails', '22023',
    format(
      'select public.update_staff_category(%L::uuid, %L::uuid, %L)',
      factory_a_id, category_a_id, '   '
    )
  );
  insert into public.staff_categories (factory_id, name)
  values (factory_a_id, 'Duplicate Category');
  perform pg_temp.expect_error(
    'duplicate category rename fails', '23505',
    format(
      'select public.update_staff_category(%L::uuid, %L::uuid, %L)',
      factory_a_id, category_a_id, 'Duplicate Category'
    )
  );
  perform pg_temp.expect_error(
    'category used by active Staff cannot be deleted', 'P2570',
    format(
      'select public.delete_staff_category(%L::uuid, %L::uuid)',
      factory_a_id, category_a_id
    )
  );

  select * into changed_worker
  from public.archive_staff_worker(factory_a_id, paid_worker.id);
  select * into summary
  from public.get_staff_payment_summary(factory_a_id, paid_worker.id);
  if changed_worker.is_active
    or changed_worker.reference_salary <> 130000
    or summary.total_paid <> 5500
    or (select count(*) from public.staff_payments
        where factory_id = factory_a_id and staff_worker_id = paid_worker.id) <> 2 then
    raise exception 'FAIL: archive changed Staff reference or payment history';
  end if;
  perform pg_temp.expect_error(
    'archived Staff cannot receive payments', 'P2562',
    format(
      'select public.record_staff_payment(%L::uuid, %L::uuid, %L::date, 1, null)',
      factory_a_id, paid_worker.id, business_today
    )
  );
  perform pg_temp.expect_error(
    'category referenced only by archived Staff cannot be deleted', 'P2570',
    format(
      'select public.delete_staff_category(%L::uuid, %L::uuid)',
      factory_a_id, category_a_id
    )
  );
  raise notice 'PASS: archive preserves ₹5,500 history and blocks payment and category deletion';

  select * into changed_worker
  from public.restore_staff_worker(factory_a_id, paid_worker.id);
  select * into payment_three
  from public.record_staff_payment(
    factory_a_id, paid_worker.id, business_today, 4000, 'After restore'
  );
  select * into summary
  from public.get_staff_payment_summary(factory_a_id, paid_worker.id);
  select array_agg(amount order by payment_date desc, created_at desc, id desc)
  into payment_amounts
  from public.staff_payments
  where factory_id = factory_a_id and staff_worker_id = paid_worker.id;
  if not changed_worker.is_active
    or payment_three.total_paid <> 9500
    or summary.total_paid <> 9500
    or payment_amounts <> array[4000::numeric, 2500::numeric, 3000::numeric] then
    raise exception 'FAIL: restored Staff did not resume with complete ₹9,500 history';
  end if;
  raise notice 'PASS: restore requires no date, creates no finance, and payments resume at ₹9,500 Total Paid';

  perform pg_temp.expect_error(
    'zero payment fails', '22023',
    format(
      'select public.record_staff_payment(%L::uuid, %L::uuid, %L::date, 0, null)',
      factory_a_id, paid_worker.id, business_today
    )
  );
  perform pg_temp.expect_error(
    'future payment fails using Atlas business date', '22023',
    format(
      'select public.record_staff_payment(%L::uuid, %L::uuid, %L::date, 1, null)',
      factory_a_id, paid_worker.id, business_today + 1
    )
  );
  perform pg_temp.expect_error(
    'paid Staff cannot be deleted', 'P2540',
    format(
      'select public.delete_staff_worker(%L::uuid, %L::uuid)',
      factory_a_id, paid_worker.id
    )
  );

  select public.delete_staff_worker(factory_a_id, zero_worker.id) into deleted_id;
  if deleted_id <> zero_worker.id
    or exists (select 1 from public.staff_workers where id = zero_worker.id) then
    raise exception 'FAIL: zero-payment Staff deletion failed';
  end if;
  raise notice 'PASS: paid Staff is protected and mistaken zero-payment Staff is permanently deleted';

  insert into public.staff_categories (factory_id, name)
  values (factory_a_id, 'Unused Category')
  returning id into unused_category_id;
  select public.delete_staff_category(factory_a_id, unused_category_id)
  into deleted_id;
  if deleted_id <> unused_category_id
    or exists (select 1 from public.staff_categories where id = unused_category_id) then
    raise exception 'FAIL: unused category deletion failed';
  end if;
  raise notice 'PASS: category create/list path works and an unused category can be deleted';

  if exists (select 1 from public.staff_workers where id = worker_b_id)
    or exists (select 1 from public.staff_payments where staff_worker_id = worker_b_id)
    or exists (select 1 from public.staff_categories where id = category_b_id) then
    raise exception 'FAIL: Factory A can view Factory B Staff data';
  end if;

  perform pg_temp.expect_error(
    'cross-factory payment fails', 'P2502',
    format(
      'select public.record_staff_payment(%L::uuid, %L::uuid, %L::date, 1, null)',
      factory_a_id, worker_b_id, business_today
    )
  );
  perform pg_temp.expect_error(
    'cross-factory reference salary update fails', 'P2502',
    format(
      'select public.update_staff_reference_salary(%L::uuid, %L::uuid, 1)',
      factory_a_id, worker_b_id
    )
  );
  perform pg_temp.expect_error(
    'cross-factory archive fails', 'P2502',
    format(
      'select public.archive_staff_worker(%L::uuid, %L::uuid)',
      factory_a_id, worker_b_id
    )
  );
  perform pg_temp.expect_error(
    'cross-factory restore fails', 'P2502',
    format(
      'select public.restore_staff_worker(%L::uuid, %L::uuid)',
      factory_a_id, worker_b_id
    )
  );
  perform pg_temp.expect_error(
    'cross-factory Staff delete fails', 'P2502',
    format(
      'select public.delete_staff_worker(%L::uuid, %L::uuid)',
      factory_a_id, worker_b_id
    )
  );
  perform pg_temp.expect_error(
    'cross-factory category rename fails', 'P2504',
    format(
      'select public.update_staff_category(%L::uuid, %L::uuid, %L)',
      factory_a_id, category_b_id, 'No access'
    )
  );
  perform pg_temp.expect_error(
    'cross-factory category delete fails', 'P2504',
    format(
      'select public.delete_staff_category(%L::uuid, %L::uuid)',
      factory_a_id, category_b_id
    )
  );
  perform pg_temp.expect_error(
    'Factory A user cannot claim Factory B access', '42501',
    format(
      'select public.get_staff_payment_summary(%L::uuid, %L::uuid)',
      factory_b_id, worker_b_id
    )
  );
  perform pg_temp.expect_error(
    'cross-factory category insert fails RLS', '42501',
    format(
      'insert into public.staff_categories (factory_id, name) values (%L::uuid, %L)',
      factory_b_id, 'No access'
    )
  );
  raise notice 'PASS: Factory A cannot view or mutate any Factory B Staff object';

  perform pg_temp.expect_error(
    'direct Staff payment insert is blocked', '42501',
    format(
      'insert into public.staff_payments (factory_id, staff_worker_id, payment_date, amount) values (%L::uuid, %L::uuid, %L::date, 1)',
      factory_a_id, paid_worker.id, business_today
    )
  );
  perform pg_temp.expect_error(
    'direct Staff payment update is blocked', '42501',
    format(
      'update public.staff_payments set amount = 1 where id = %L::uuid',
      payment_one.payment_id
    )
  );
  perform pg_temp.expect_error(
    'direct Staff payment delete is blocked', '42501',
    format(
      'delete from public.staff_payments where id = %L::uuid',
      payment_one.payment_id
    )
  );
  perform pg_temp.expect_error(
    'direct Staff profile update is blocked', '42501',
    format(
      'update public.staff_workers set reference_salary = 1 where id = %L::uuid',
      paid_worker.id
    )
  );
  perform pg_temp.expect_error(
    'direct category update is blocked', '42501',
    format(
      'update public.staff_categories set name = %L where id = %L::uuid',
      'Bypass', category_a_id
    )
  );
  perform pg_temp.expect_error(
    'direct category delete is blocked', '42501',
    format('delete from public.staff_categories where id = %L::uuid', category_a_id)
  );

  perform set_config('atlas_test.payment_id', payment_one.payment_id::text, true);
end;
$$;

reset role;

do $$
declare
  signature text;
  function_oid regprocedure;
  function_is_definer boolean;
  function_config text[];
  expected_functions text[] := array[
    'public.create_staff_worker_with_reference_salary(uuid,text,uuid,numeric)',
    'public.update_staff_reference_salary(uuid,uuid,numeric)',
    'public.record_staff_payment(uuid,uuid,date,numeric,text)',
    'public.get_staff_payment_summary(uuid,uuid)',
    'public.archive_staff_worker(uuid,uuid)',
    'public.restore_staff_worker(uuid,uuid)',
    'public.delete_staff_worker(uuid,uuid)',
    'public.update_staff_category(uuid,uuid,text)',
    'public.delete_staff_category(uuid,uuid)'
  ];
begin
  if to_regclass('public.staff_categories') is null
    or to_regclass('public.staff_workers') is null
    or to_regclass('public.staff_payments') is null then
    raise exception 'FAIL: an authoritative Staff table is missing';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.staff_workers'::regclass
      and attname = 'reference_salary'
      and attnotnull
      and not attisdropped
  ) then
    raise exception 'FAIL: final Staff reference salary is still nullable';
  end if;
  raise notice 'PASS: every final Staff worker must own a reference salary';

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_categories'
      and column_name = 'is_active'
  ) or to_regclass('public.staff_categories_factory_active_idx') is not null then
    raise exception 'FAIL: obsolete Staff category archive state remains';
  end if;
  raise notice 'PASS: final categories are organizational edit/delete records with no archive state';

  foreach signature in array expected_functions loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then
      raise exception 'FAIL: authoritative Staff RPC % is missing', signature;
    end if;

    select prosecdef, proconfig
    into function_is_definer, function_config
    from pg_proc where oid = function_oid::oid;

    if not function_is_definer
      or not coalesce('search_path=pg_catalog, public' = any(function_config), false) then
      raise exception 'FAIL: Staff RPC % lacks SECURITY DEFINER or safe search_path', signature;
    end if;
    if has_function_privilege('anon', signature, 'execute') then
      raise exception 'FAIL: anon can execute Staff RPC %', signature;
    end if;
    if not has_function_privilege('authenticated', signature, 'execute') then
      raise exception 'FAIL: authenticated role cannot execute Staff RPC %', signature;
    end if;
  end loop;
  raise notice 'PASS: all nine authoritative RPCs have safe definitions and locked-down grants';

  if exists (
    select 1 from pg_class
    where oid in (
      'public.staff_categories'::regclass,
      'public.staff_workers'::regclass,
      'public.staff_payments'::regclass
    ) and not relrowsecurity
  ) then
    raise exception 'FAIL: RLS is not enabled on every Staff table';
  end if;

  if not has_table_privilege('authenticated', 'public.staff_categories', 'select')
    or not has_table_privilege('authenticated', 'public.staff_categories', 'insert')
    or has_table_privilege('authenticated', 'public.staff_categories', 'update')
    or has_table_privilege('authenticated', 'public.staff_categories', 'delete')
    or not has_table_privilege('authenticated', 'public.staff_workers', 'select')
    or has_table_privilege('authenticated', 'public.staff_workers', 'insert')
    or has_table_privilege('authenticated', 'public.staff_workers', 'update')
    or has_table_privilege('authenticated', 'public.staff_workers', 'delete')
    or not has_table_privilege('authenticated', 'public.staff_payments', 'select')
    or has_table_privilege('authenticated', 'public.staff_payments', 'insert')
    or has_table_privilege('authenticated', 'public.staff_payments', 'update')
    or has_table_privilege('authenticated', 'public.staff_payments', 'delete') then
    raise exception 'FAIL: final Staff table grants allow an unauthorized write path';
  end if;
  raise notice 'PASS: RLS and table grants expose only category creation and factory-scoped reads directly';

  if not exists (select 1 from pg_constraint where conname = 'staff_categories_factory_name_key')
    or not exists (select 1 from pg_constraint where conname = 'staff_workers_reference_salary_check')
    or not exists (select 1 from pg_constraint where conname = 'staff_payments_date_check')
    or not exists (select 1 from pg_constraint where conname = 'staff_payments_amount_check')
    or not exists (select 1 from pg_constraint where conname = 'staff_payments_note_check') then
    raise exception 'FAIL: a final Staff value or uniqueness constraint is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_workers_category_factory_fkey'
      and conrelid = 'public.staff_workers'::regclass
      and confrelid = 'public.staff_categories'::regclass
      and confdeltype = 'r'
  ) or not exists (
    select 1 from pg_constraint
    where conname = 'staff_payments_worker_factory_fkey'
      and conrelid = 'public.staff_payments'::regclass
      and confrelid = 'public.staff_workers'::regclass
      and confdeltype = 'r'
  ) then
    raise exception 'FAIL: an authoritative cross-factory RESTRICT FK is missing';
  end if;

  if to_regclass('public.staff_payments_worker_history_idx') is null
    or not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.staff_payments'::regclass
        and tgname = 'staff_payments_are_immutable'
        and tgenabled <> 'D'
    ) or not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.staff_workers'::regclass
        and tgname = 'staff_workers_prevent_reassignment'
        and tgenabled <> 'D'
    ) then
    raise exception 'FAIL: final Staff index or integrity trigger is missing';
  end if;
  raise notice 'PASS: constraints, RESTRICT FKs, history index, and integrity triggers are intact';

  if exists (
    select 1 from public.staff_workers as worker
    left join public.staff_categories as category
      on category.id = worker.staff_category_id
      and category.factory_id = worker.factory_id
    where category.id is null
  ) or exists (
    select 1 from public.staff_payments as payment
    left join public.staff_workers as worker
      on worker.id = payment.staff_worker_id
      and worker.factory_id = payment.factory_id
    where worker.id is null
  ) then
    raise exception 'FAIL: orphaned Staff/category/payment data exists';
  end if;
  raise notice 'PASS: no Staff, category, or payment record is orphaned';

  if to_regclass('public.staff_monthly_salary_rates') is not null
    or to_regclass('public.staff_salary_eligibility_periods') is not null
    or to_regclass('public.staff_monthly_earnings') is not null
    or to_regclass('public.staff_withdrawals') is not null
    or to_regclass('public.staff_salary_deductions') is not null
    or to_regprocedure('public.create_staff_category_monthly_salary(uuid,uuid,numeric,date)') is not null
    or to_regprocedure('public.create_staff_monthly_salary_override(uuid,uuid,numeric,date)') is not null
    or to_regprocedure('public.resolve_staff_monthly_salary(uuid,uuid,date)') is not null
    or to_regprocedure('public.ensure_staff_monthly_earnings(uuid,uuid,date)') is not null
    or to_regprocedure('public.get_staff_financial_summary(uuid,uuid)') is not null
    or to_regprocedure('public.create_staff_withdrawal(uuid,uuid,date,numeric)') is not null
    or to_regprocedure('public.create_staff_salary_deduction(uuid,uuid,date,numeric,text)') is not null
    or to_regprocedure('public.create_staff_worker(uuid,text,uuid,date,numeric)') is not null
    or to_regprocedure('public.deactivate_staff_worker(uuid,uuid,date)') is not null
    or to_regprocedure('public.reactivate_staff_worker(uuid,uuid,date)') is not null then
    raise exception 'FAIL: a legacy Staff salary object still exists';
  end if;
  raise notice 'PASS: legacy Staff salary, entitlement, balance, withdrawal, and deduction engine is absent';

  if to_regclass('public.production_entries') is null
    or to_regclass('public.labour_groups') is null
    or to_regclass('public.transport_daily_entries') is null
    or to_regprocedure('public.calculate_production_wages(uuid,date)') is null
    or to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)') is null
    or to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)') is null then
    raise exception 'FAIL: Production, Mud, or Chamber Transport architecture is missing';
  end if;
  raise notice 'PASS: Production, Mud, and Chamber Transport architecture remains untouched';
end;
$$;

select pg_temp.expect_error(
  'payment UPDATE remains immutable even for a privileged writer',
  'P2550',
  format(
    'update public.staff_payments set amount = amount + 1 where id = %L::uuid',
    current_setting('atlas_test.payment_id')
  )
);
select pg_temp.expect_error(
  'payment DELETE remains immutable even for a privileged writer',
  'P2550',
  format(
    'delete from public.staff_payments where id = %L::uuid',
    current_setting('atlas_test.payment_id')
  )
);

do $$
declare
  payment_definition text;
  archive_definition text;
  restore_definition text;
  worker_delete_definition text;
  category_delete_definition text;
begin
  select pg_get_functiondef(
    'public.record_staff_payment(uuid,uuid,date,numeric,text)'::regprocedure
  ) into payment_definition;
  select pg_get_functiondef(
    'public.archive_staff_worker(uuid,uuid)'::regprocedure
  ) into archive_definition;
  select pg_get_functiondef(
    'public.restore_staff_worker(uuid,uuid)'::regprocedure
  ) into restore_definition;
  select pg_get_functiondef(
    'public.delete_staff_worker(uuid,uuid)'::regprocedure
  ) into worker_delete_definition;
  select pg_get_functiondef(
    'public.delete_staff_category(uuid,uuid)'::regprocedure
  ) into category_delete_definition;

  if payment_definition !~ 'staff_payment:'
    or archive_definition !~ 'staff_payment:'
    or restore_definition !~ 'staff_payment:'
    or worker_delete_definition !~ 'staff_payment:'
    or payment_definition !~* 'for update'
    or worker_delete_definition !~* 'for update' then
    raise exception 'FAIL: payment/archive/restore/delete race serialization is incomplete';
  end if;
  if category_delete_definition !~* 'for update'
    or category_delete_definition !~* 'from public.staff_workers' then
    raise exception 'FAIL: category-delete/worker-create race protection is incomplete';
  end if;
  raise notice 'PASS: payment, archive, restore, worker-delete, and category-delete races are serialized';
  raise notice 'PASS: Atlas Staff S6 final release verifier completed';
end;
$$;

rollback;
