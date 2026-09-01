-- Atlas Soil Supply T5 verifier. Run after migrations through 20260825000017.
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
    (factory_a_id, format('Soil T5 verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil T5 verifier B %s', factory_b_id));

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
  competing_worker public.soil_workers%rowtype;
  addition record;
  deduction record;
  summary record;
  payment record;
  first_adjustment_before jsonb;
  first_adjustment_after jsonb;
  first_payment_before jsonb;
  first_payment_after jsonb;
  daily_before jsonb;
  daily_after jsonb;
  earnings_before jsonb;
  earnings_after jsonb;
  adjustment_count_before bigint;
  adjustment_count_after bigint;
begin
  select * into raju
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Raju T5', 200, date '2026-08-01'
  );
  select * into competing_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Payment Deduction Race T5', 100, date '2026-08-01'
  );

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 5),
      jsonb_build_object('soil_worker_id', competing_worker.id::text, 'trolley_quantity', 5)
    )
  );

  select * into payment
  from public.create_soil_payment(
    factory_a_id, raju.id, date '2026-08-26', 200
  );
  if payment.total_earned <> 1000
    or payment.total_paid <> 200
    or payment.available_balance <> 800 then
    raise exception 'FAIL: T4 payment baseline is incorrect';
  end if;
  select to_jsonb(existing_payment) into first_payment_before
  from public.soil_payments as existing_payment
  where existing_payment.id = payment.payment_id;

  select jsonb_agg(to_jsonb(daily) order by daily.id)
  into daily_before
  from public.soil_daily_trolley_entries as daily
  where daily.factory_id = factory_a_id;
  select jsonb_agg(to_jsonb(earning) order by earning.id)
  into earnings_before
  from public.soil_earnings as earning
  where earning.factory_id = factory_a_id;

  select * into addition
  from public.create_soil_financial_adjustment(
    factory_a_id,
    raju.id,
    'ADDITION',
    date '2026-08-27',
    500,
    '  Festival bonus  '
  );
  if addition.adjustment_type <> 'ADDITION'
    or addition.adjustment_amount <> 500
    or addition.adjustment_reason <> 'Festival bonus'
    or addition.total_earned <> 1000
    or addition.total_additions <> 500
    or addition.total_deductions <> 0
    or addition.total_paid <> 200
    or addition.available_balance <> 1300 then
    raise exception 'FAIL: valid normalized addition is incorrect';
  end if;
  select to_jsonb(existing_adjustment) into first_adjustment_before
  from public.soil_financial_adjustments as existing_adjustment
  where existing_adjustment.id = addition.adjustment_id;
  raise notice 'PASS: normalized ₹500 addition increases balance from ₹800 to ₹1,300';

  select * into deduction
  from public.create_soil_financial_adjustment(
    factory_a_id,
    raju.id,
    'DEDUCTION',
    date '2026-08-28',
    300,
    'Absent part of day'
  );
  if deduction.adjustment_type <> 'DEDUCTION'
    or deduction.adjustment_amount <> 300
    or deduction.total_additions <> 500
    or deduction.total_deductions <> 300
    or deduction.available_balance <> 1000 then
    raise exception 'FAIL: valid deduction is incorrect';
  end if;
  raise notice 'PASS: valid ₹300 deduction reduces balance to ₹1,000';

  perform * from public.create_soil_financial_adjustment(
    factory_a_id, raju.id, 'ADDITION', date '2026-08-29', 200, 'Extra duty'
  );
  perform * from public.create_soil_financial_adjustment(
    factory_a_id, raju.id, 'DEDUCTION', date '2026-08-30', 100, 'Meal recovery'
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, raju.id);
  if summary.total_earned <> 1000
    or summary.total_additions <> 700
    or summary.total_deductions <> 400
    or summary.total_paid <> 200
    or summary.available_balance <> 1100
    or (select count(*) from public.soil_financial_adjustments
        where factory_id = factory_a_id and soil_worker_id = raju.id) <> 4 then
    raise exception 'FAIL: multiple adjustment accumulation or summary formula is incorrect';
  end if;
  select to_jsonb(existing_adjustment) into first_adjustment_after
  from public.soil_financial_adjustments as existing_adjustment
  where existing_adjustment.id = addition.adjustment_id;
  select to_jsonb(existing_payment) into first_payment_after
  from public.soil_payments as existing_payment
  where existing_payment.id = payment.payment_id;
  if first_adjustment_after <> first_adjustment_before
    or first_payment_after <> first_payment_before then
    raise exception 'FAIL: later adjustments rewrote adjustment or payment history';
  end if;
  raise notice 'PASS: multiple additions/deductions accumulate without rewriting T4 payment or earlier adjustment history';

  select count(*) into adjustment_count_before
  from public.soil_financial_adjustments
  where factory_id = factory_a_id and soil_worker_id = raju.id;
  perform pg_temp.expect_error(
    'deduction cannot make balance negative', 'P2902',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1101, %L)',
      factory_a_id, raju.id, 'DEDUCTION', '2026-08-31', 'Excessive deduction'
    )
  );
  select count(*) into adjustment_count_after
  from public.soil_financial_adjustments
  where factory_id = factory_a_id and soil_worker_id = raju.id;
  if adjustment_count_after <> adjustment_count_before then
    raise exception 'FAIL: failed deduction inserted a partial adjustment row';
  end if;

  perform pg_temp.expect_error(
    'blank reason fails', '22023',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1, %L)',
      factory_a_id, raju.id, 'ADDITION', '2026-08-31', '   '
    )
  );
  perform pg_temp.expect_error(
    'null reason fails', '22023',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1, null)',
      factory_a_id, raju.id, 'ADDITION', '2026-08-31'
    )
  );
  perform pg_temp.expect_error(
    'zero adjustment fails', '22023',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 0, %L)',
      factory_a_id, raju.id, 'ADDITION', '2026-08-31', 'Invalid zero'
    )
  );
  perform pg_temp.expect_error(
    'negative adjustment fails', '22023',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, -1, %L)',
      factory_a_id, raju.id, 'ADDITION', '2026-08-31', 'Invalid negative'
    )
  );
  perform pg_temp.expect_error(
    'invalid adjustment type fails', '22023',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1, %L)',
      factory_a_id, raju.id, 'BONUS', '2026-08-31', 'Invalid type'
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
    raise exception 'FAIL: adjustments or payments mutated T2/T3 history';
  end if;
  raise notice 'PASS: adjustment activity never mutates T2 daily or T3 earning history';

  select * into payment
  from public.create_soil_payment(
    factory_a_id, raju.id, date '2026-09-01', 500
  );
  if payment.total_paid <> 700 or payment.available_balance <> 600 then
    raise exception 'FAIL: payment did not consume adjustment-aware available balance';
  end if;

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-09-02',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 2)
    )
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, raju.id);
  if summary.total_earned <> 1400
    or summary.total_additions <> 700
    or summary.total_deductions <> 400
    or summary.total_paid <> 700
    or summary.available_balance <> 1000 then
    raise exception 'FAIL: later earnings did not increase adjustment-aware balance';
  end if;
  raise notice 'PASS: payments reduce and later earnings increase the full T5 balance correctly';

  select * into payment
  from public.create_soil_payment(
    factory_a_id, competing_worker.id, date '2026-08-26', 500
  );
  perform pg_temp.expect_error(
    'payment versus deduction cannot consume the same balance twice', 'P2902',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 500, %L)',
      factory_a_id, competing_worker.id, 'DEDUCTION', '2026-08-26', 'Competing deduction'
    )
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, competing_worker.id);
  if summary.total_earned <> 500
    or summary.total_paid <> 500
    or summary.total_deductions <> 0
    or summary.available_balance <> 0 then
    raise exception 'FAIL: payment/deduction competition overdraw protection is incorrect';
  end if;
  raise notice 'PASS: one ₹500 payment consumes ₹500 balance and the competing deduction fails';

  perform pg_temp.expect_error(
    'cross-factory worker adjustment fails', 'P2602',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1, %L)',
      factory_a_id, worker_b_id, 'ADDITION', '2026-08-26', 'Cross factory'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B adjustment access', '42501',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1, %L)',
      factory_b_id, worker_b_id, 'ADDITION', '2026-08-26', 'Cross factory'
    )
  );

  if exists (
    select 1 from public.soil_financial_adjustments
    where factory_id = factory_b_id
  ) then
    raise exception 'FAIL: Factory A can read Factory B adjustments';
  end if;

  perform pg_temp.expect_error(
    'authenticated direct adjustment insert fails', '42501',
    format(
      'insert into public.soil_financial_adjustments (factory_id, soil_worker_id, adjustment_type, adjustment_date, amount, reason) values (%L::uuid, %L::uuid, %L, date %L, 1, %L)',
      factory_a_id, raju.id, 'ADDITION', '2026-08-26', 'Direct write'
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct adjustment update fails', '42501',
    format(
      'update public.soil_financial_adjustments set amount = amount where id = %L::uuid',
      addition.adjustment_id
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct adjustment delete fails', '42501',
    format(
      'delete from public.soil_financial_adjustments where id = %L::uuid',
      addition.adjustment_id
    )
  );

  perform set_config('atlas_test.raju_id', raju.id::text, true);
  perform set_config('atlas_test.adjustment_id', addition.adjustment_id::text, true);
end;
$$;

reset role;

set local role anon;
do $$
begin
  perform pg_temp.expect_error(
    'anonymous adjustment history access fails', '42501',
    'select * from public.soil_financial_adjustments'
  );
  perform pg_temp.expect_error(
    'anonymous adjustment creation access fails', '42501',
    format(
      'select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 1, %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.raju_id'),
      'ADDITION',
      '2026-08-26',
      'Anonymous'
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
    select 1 from public.soil_financial_adjustments
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: Factory B can read Factory A adjustments';
  end if;
  perform pg_temp.expect_error(
    'Factory B cannot claim Factory A T5 financial summary', '42501',
    format(
      'select * from public.get_soil_financial_summary(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.raju_id')
    )
  );
  raise notice 'PASS: Factory B cannot read Factory A adjustments or financial summary';
end;
$$;

reset role;

do $$
declare
  adjustment_id uuid := current_setting('atlas_test.adjustment_id')::uuid;
  payment_definition text := pg_get_functiondef(
    'public.create_soil_payment(uuid,uuid,date,numeric)'::regprocedure
  );
  adjustment_definition text := pg_get_functiondef(
    'public.create_soil_financial_adjustment(uuid,uuid,text,date,numeric,text)'::regprocedure
  );
begin
  perform pg_temp.expect_error(
    'database trigger rejects adjustment update even for table owner', 'P2901',
    format(
      'update public.soil_financial_adjustments set amount = amount where id = %L::uuid',
      adjustment_id
    )
  );
  perform pg_temp.expect_error(
    'database trigger rejects adjustment delete even for table owner', 'P2901',
    format(
      'delete from public.soil_financial_adjustments where id = %L::uuid',
      adjustment_id
    )
  );

  if position('soil_financial:' in payment_definition) = 0
    or position('soil_financial:' in adjustment_definition) = 0
    or position('pg_advisory_xact_lock' in payment_definition) = 0
    or position('pg_advisory_xact_lock' in adjustment_definition) = 0
    or position('soil_payment:' in payment_definition) > 0 then
    raise exception 'FAIL: payments and adjustments do not share one financial lock namespace';
  end if;

  if has_table_privilege(
      'authenticated', 'public.soil_financial_adjustments', 'INSERT'
    )
    or has_table_privilege(
      'authenticated', 'public.soil_financial_adjustments', 'UPDATE'
    )
    or has_table_privilege(
      'authenticated', 'public.soil_financial_adjustments', 'DELETE'
    )
    or has_table_privilege(
      'anon', 'public.soil_financial_adjustments', 'SELECT'
    ) then
    raise exception 'FAIL: unsafe Soil adjustment privileges are present';
  end if;
  raise notice 'PASS: payments, additions, and deductions share one immutable worker-financial boundary';

  if to_regprocedure('public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)') is null
    or to_regprocedure('public.save_soil_daily_trolley_entries(uuid,date,jsonb)') is null
    or to_regprocedure('public.get_soil_total_earned(uuid,uuid)') is null
    or to_regprocedure('public.create_soil_payment(uuid,uuid,date,numeric)') is null
    or to_regclass('public.soil_earnings') is null
    or to_regclass('public.soil_payments') is null then
    raise exception 'FAIL: T1-T4 Soil runtime is incomplete';
  end if;

  if to_regclass('public.factories') is null
    or to_regclass('public.labourers') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.transport_workers') is null
    or to_regclass('public.staff_workers') is null then
    raise exception 'FAIL: an existing Production, Mud, Transport, or Staff object is missing';
  end if;

  if to_regclass('public.soil_financial_dashboard') is not null
    or to_regclass('public.soil_financial_cards') is not null
    or to_regclass('public.soil_financial_reports') is not null
    or to_regclass('public.soil_financial_exports') is not null then
    raise exception 'FAIL: a T6 UI/reporting database object was created early';
  end if;
  raise notice 'PASS: T1-T4 and unrelated modules remain intact with no T6 UI/reporting objects';
end;
$$;

rollback;
