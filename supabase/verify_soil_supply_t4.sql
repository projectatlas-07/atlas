-- Atlas Soil Supply T4 verifier. Run after migrations through 20260825000016.
-- Requires one existing factory_users row. All fixtures are rolled back.

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
  worker_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Soil T4 verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil T4 verifier B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.soil_workers (id, factory_id, name)
  values (worker_b_id, factory_b_id, 'Factory B Soil Worker');

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
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
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  worker_b_id uuid := current_setting('atlas_test.worker_b_id')::uuid;
  raju public.soil_workers%rowtype;
  zero_worker public.soil_workers%rowtype;
  competing_worker public.soil_workers%rowtype;
  first_payment record;
  second_payment record;
  summary record;
  payment_before jsonb;
  payment_after jsonb;
  daily_before jsonb;
  daily_after jsonb;
  earnings_before jsonb;
  earnings_after jsonb;
  payment_count_before bigint;
  payment_count_after bigint;
begin
  select * into raju
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Raju T4', 200, date '2026-08-01'
  );
  select * into zero_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Zero Earnings T4', 180, date '2026-08-01'
  );
  select * into competing_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Competing Payments T4', 200, date '2026-08-01'
  );

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 5),
      jsonb_build_object('soil_worker_id', competing_worker.id::text, 'trolley_quantity', 5)
    )
  );

  select * into summary
  from public.get_soil_financial_summary(factory_a_id, raju.id);
  if summary.total_earned <> 1000
    or summary.total_paid <> 0
    or summary.available_balance <> 1000 then
    raise exception 'FAIL: initial financial summary is incorrect';
  end if;
  raise notice 'PASS: financial summary starts at ₹1,000 earned, ₹0 paid, ₹1,000 available';

  select jsonb_agg(to_jsonb(daily) order by daily.id)
  into daily_before
  from public.soil_daily_trolley_entries as daily
  where daily.factory_id = factory_a_id;
  select jsonb_agg(to_jsonb(earning) order by earning.id)
  into earnings_before
  from public.soil_earnings as earning
  where earning.factory_id = factory_a_id;

  select * into first_payment
  from public.create_soil_payment(
    factory_a_id, raju.id, date '2026-08-26', 600
  );
  if first_payment.payment_amount <> 600
    or first_payment.total_earned <> 1000
    or first_payment.total_paid <> 600
    or first_payment.available_balance <> 400 then
    raise exception 'FAIL: partial payment result is incorrect';
  end if;
  select to_jsonb(payment) into payment_before
  from public.soil_payments as payment
  where payment.id = first_payment.payment_id;
  raise notice 'PASS: partial ₹600 payment leaves authoritative ₹400 available';

  select * into second_payment
  from public.create_soil_payment(
    factory_a_id, raju.id, date '2026-08-27', 400
  );
  select to_jsonb(payment) into payment_after
  from public.soil_payments as payment
  where payment.id = first_payment.payment_id;
  if second_payment.total_earned <> 1000
    or second_payment.total_paid <> 1000
    or second_payment.available_balance <> 0
    or payment_after <> payment_before
    or (select count(*) from public.soil_payments
        where factory_id = factory_a_id and soil_worker_id = raju.id) <> 2 then
    raise exception 'FAIL: full/multiple payment behavior is incorrect';
  end if;
  raise notice 'PASS: multiple payments accumulate and a full payment reaches zero balance without rewriting history';

  select count(*) into payment_count_before
  from public.soil_payments
  where factory_id = factory_a_id and soil_worker_id = raju.id;
  perform pg_temp.expect_error(
    'overpayment is rejected',
    'P2802',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 1)',
      factory_a_id, raju.id, '2026-08-28'
    )
  );
  select count(*) into payment_count_after
  from public.soil_payments
  where factory_id = factory_a_id and soil_worker_id = raju.id;
  if payment_count_after <> payment_count_before then
    raise exception 'FAIL: failed overpayment left a partial payment row';
  end if;

  perform pg_temp.expect_error(
    'zero payment fails', '22023',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 0)',
      factory_a_id, raju.id, '2026-08-28'
    )
  );
  perform pg_temp.expect_error(
    'negative payment fails', '22023',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, -1)',
      factory_a_id, raju.id, '2026-08-28'
    )
  );
  perform pg_temp.expect_error(
    'non-finite payment fails', '22023',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, %L::numeric)',
      factory_a_id, raju.id, '2026-08-28', 'Infinity'
    )
  );
  perform pg_temp.expect_error(
    'zero-earning worker cannot be paid', 'P2802',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 1)',
      factory_a_id, zero_worker.id, '2026-08-28'
    )
  );

  select jsonb_agg(to_jsonb(daily) order by daily.id)
  into daily_after
  from public.soil_daily_trolley_entries as daily
  where daily.factory_id = factory_a_id;
  select jsonb_agg(to_jsonb(earning) order by earning.id)
  into earnings_after
  from public.soil_earnings as earning
  where earning.factory_id = factory_a_id;
  if daily_after <> daily_before or earnings_after <> earnings_before then
    raise exception 'FAIL: payment activity mutated T2 or T3 history';
  end if;
  raise notice 'PASS: payment success and failure never mutate T2 daily or T3 earning history';

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-09-01',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 2)
    )
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, raju.id);
  if summary.total_earned <> 1400
    or summary.total_paid <> 1000
    or summary.available_balance <> 400 then
    raise exception 'FAIL: later earnings did not carry forward into available balance';
  end if;
  perform * from public.create_soil_payment(
    factory_a_id, raju.id, date '2026-09-02', 400
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, raju.id);
  if summary.total_earned <> 1400
    or summary.total_paid <> 1400
    or summary.available_balance <> 0 then
    raise exception 'FAIL: later earnings could not be fully paid';
  end if;
  raise notice 'PASS: later ₹400 earnings carry forward and can be fully paid';

  select * into first_payment
  from public.create_soil_payment(
    factory_a_id, competing_worker.id, date '2026-08-26', 800
  );
  perform pg_temp.expect_error(
    'serialized competing payment cannot overdraw remaining balance',
    'P2802',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 800)',
      factory_a_id, competing_worker.id, '2026-08-26'
    )
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, competing_worker.id);
  if summary.total_earned <> 1000
    or summary.total_paid <> 800
    or summary.available_balance <> 200
    or (select count(*) from public.soil_payments
        where soil_worker_id = competing_worker.id) <> 1 then
    raise exception 'FAIL: competing payment protection does not reconcile';
  end if;
  raise notice 'PASS: competing ₹800 attempts against ₹1,000 leave one payment and ₹200 available';

  perform pg_temp.expect_error(
    'cross-factory worker payment fails', 'P2602',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 1)',
      factory_a_id, worker_b_id, '2026-08-26'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B payment access', '42501',
    format(
      'select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 1)',
      factory_b_id, worker_b_id, '2026-08-26'
    )
  );

  if exists (select 1 from public.soil_payments where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B payments';
  end if;

  perform pg_temp.expect_error(
    'authenticated direct payment insert fails', '42501',
    format(
      'insert into public.soil_payments (factory_id, soil_worker_id, payment_date, amount) values (%L::uuid, %L::uuid, date %L, 1)',
      factory_a_id, raju.id, '2026-08-26'
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct payment update fails', '42501',
    format(
      'update public.soil_payments set amount = amount where id = %L::uuid',
      second_payment.payment_id
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct payment delete fails', '42501',
    format(
      'delete from public.soil_payments where id = %L::uuid',
      second_payment.payment_id
    )
  );

  perform set_config('atlas_test.raju_id', raju.id::text, true);
  perform set_config('atlas_test.payment_id', second_payment.payment_id::text, true);
end;
$$;

reset role;

set local role anon;
do $$
begin
  perform pg_temp.expect_error(
    'anonymous payment history access fails', '42501',
    'select * from public.soil_payments'
  );
  perform pg_temp.expect_error(
    'anonymous financial summary access fails', '42501',
    format(
      'select * from public.get_soil_financial_summary(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.raju_id')
    )
  );
end;
$$;
reset role;

update public.factory_users
set factory_id = current_setting('atlas_test.factory_b_id')::uuid
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  if exists (
    select 1 from public.soil_payments
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: Factory B can read Factory A payments';
  end if;
  perform pg_temp.expect_error(
    'Factory B cannot claim Factory A financial summary', '42501',
    format(
      'select * from public.get_soil_financial_summary(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.raju_id')
    )
  );
  raise notice 'PASS: Factory B cannot read Factory A payments or financial summary';
end;
$$;

reset role;

do $$
declare
  payment_id uuid := current_setting('atlas_test.payment_id')::uuid;
begin
  perform pg_temp.expect_error(
    'database trigger rejects payment update even for table owner', 'P2801',
    format('update public.soil_payments set amount = amount where id = %L::uuid', payment_id)
  );
  perform pg_temp.expect_error(
    'database trigger rejects payment delete even for table owner', 'P2801',
    format('delete from public.soil_payments where id = %L::uuid', payment_id)
  );

  if position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.create_soil_payment(uuid,uuid,date,numeric)'::regprocedure
    )
  ) = 0 or position(
    'get_soil_financial_summary' in pg_get_functiondef(
      'public.create_soil_payment(uuid,uuid,date,numeric)'::regprocedure
    )
  ) = 0 then
    raise exception 'FAIL: payment RPC lacks locked authoritative balance validation';
  end if;

  if has_table_privilege('authenticated', 'public.soil_payments', 'INSERT')
    or has_table_privilege('authenticated', 'public.soil_payments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.soil_payments', 'DELETE')
    or has_table_privilege('anon', 'public.soil_payments', 'SELECT') then
    raise exception 'FAIL: unsafe Soil payment privileges are present';
  end if;
  raise notice 'PASS: payment history is immutable and payment creation is serialized at the database boundary';

  if to_regprocedure('public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)') is null
    or to_regprocedure('public.save_soil_daily_trolley_entries(uuid,date,jsonb)') is null
    or to_regprocedure('public.get_soil_total_earned(uuid,uuid)') is null
    or to_regclass('public.soil_earnings') is null then
    raise exception 'FAIL: T1-T3 Soil runtime is incomplete';
  end if;

  if to_regclass('public.factories') is null
    or to_regclass('public.labourers') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.transport_workers') is null
    or to_regclass('public.staff_workers') is null then
    raise exception 'FAIL: an existing Production, Mud, Transport, or Staff object is missing';
  end if;

  if to_regclass('public.soil_adjustments') is not null
    or to_regclass('public.soil_additions') is not null
    or to_regclass('public.soil_deductions') is not null
    or to_regclass('public.soil_bonuses') is not null then
    raise exception 'FAIL: a T5 Soil adjustment object was created early';
  end if;
  raise notice 'PASS: T1-T3 and unrelated modules remain intact with no T5 adjustment objects';
end;
$$;

rollback;
