-- Atlas Soil Supply final T1-T8 verifier.
-- Run after migrations through 20260825000019. All fixtures are rolled back.

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
  factory_b_worker_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: final verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name) values
    (factory_a_id, format('Soil final verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil final verifier B %s', factory_b_id));
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.soil_workers (id, factory_id, name)
  values (factory_b_worker_id, factory_b_id, 'Factory B Soil Worker Final');
  insert into public.soil_worker_trolley_rates (
    factory_id, soil_worker_id, rate_per_trolley, effective_from
  ) values (
    factory_b_id, factory_b_worker_id, 90, date '2026-08-01'
  );

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.factory_b_worker_id', factory_b_worker_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  factory_b_worker_id uuid := current_setting('atlas_test.factory_b_worker_id')::uuid;
  raju public.soil_workers%rowtype;
  babu public.soil_workers%rowtype;
  unused_worker public.soil_workers%rowtype;
  initial_rate public.soil_worker_trolley_rates%rowtype;
  future_rate public.soil_worker_trolley_rates%rowtype;
  resolved_rate public.soil_worker_trolley_rates%rowtype;
  daily_row public.soil_daily_trolley_entries%rowtype;
  payment record;
  addition record;
  deduction record;
  summary record;
  archived_worker public.soil_workers%rowtype;
  restored_worker public.soil_workers%rowtype;
  history_before jsonb;
  history_after jsonb;
  summary_before jsonb;
  summary_after jsonb;
  deleted_id uuid;
begin
  select * into raju
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, '  Raju   Final  ', 100, date '2026-08-01'
  );
  select * into babu
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Babu Final', 80, date '2026-08-01'
  );
  if raju.name <> 'Raju Final' or not raju.is_active or not babu.is_active then
    raise exception 'FAIL: worker creation normalization or active default is incorrect';
  end if;
  raise notice 'PASS: worker creation and atomic initial rates';

  select * into initial_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, raju.id, date '2026-08-25'
  );
  select * into future_rate
  from public.create_soil_worker_trolley_rate(
    factory_a_id, raju.id, 120, date '2026-09-01'
  );
  select * into resolved_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, raju.id, date '2026-09-02'
  );
  select * into initial_rate
  from public.soil_worker_trolley_rates
  where factory_id = factory_a_id
    and soil_worker_id = raju.id
    and effective_from = date '2026-08-01';
  if initial_rate.rate_per_trolley <> 100
    or initial_rate.effective_to <> date '2026-08-31'
    or future_rate.rate_per_trolley <> 120
    or resolved_rate.id <> future_rate.id then
    raise exception 'FAIL: effective-dated rate replacement or historical resolution is incorrect';
  end if;
  raise notice 'PASS: future rate change preserves historical rate resolution';

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 5),
      jsonb_build_object('soil_worker_id', babu.id::text, 'trolley_quantity', 2)
    )
  );
  if (select count(*) from public.soil_daily_trolley_entries
      where factory_id = factory_a_id and work_date = date '2026-08-25') <> 2
    or (select count(*) from public.soil_earnings
        where factory_id = factory_a_id and work_date = date '2026-08-25'
          and event_type = 'BASE') <> 2 then
    raise exception 'FAIL: multi-worker trolley save did not atomically create two base earnings';
  end if;
  select * into daily_row
  from public.soil_daily_trolley_entries
  where factory_id = factory_a_id
    and soil_worker_id = raju.id
    and work_date = date '2026-08-25';
  if daily_row.trolley_quantity <> 5
    or daily_row.rate_per_trolley_snapshot <> 100
    or daily_row.base_amount_snapshot <> 500
    or daily_row.soil_worker_trolley_rate_id <> initial_rate.id then
    raise exception 'FAIL: T2 rate/base snapshots are incorrect';
  end if;
  raise notice 'PASS: multi-worker quantities use stored applicable rate/base snapshots';

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 4)
    )
  );
  select * into daily_row
  from public.soil_daily_trolley_entries
  where factory_id = factory_a_id
    and soil_worker_id = raju.id
    and work_date = date '2026-08-25';
  if daily_row.trolley_quantity <> 4
    or daily_row.rate_per_trolley_snapshot <> 100
    or daily_row.base_amount_snapshot <> 400
    or (select count(*) from public.soil_earnings
        where soil_daily_trolley_entry_id = daily_row.id) <> 2
    or (select sum(amount) from public.soil_earnings
        where soil_daily_trolley_entry_id = daily_row.id) <> 400
    or (select rate_per_trolley_snapshot from public.soil_earnings
        where soil_daily_trolley_entry_id = daily_row.id
          and event_type = 'CORRECTION') <> 100 then
    raise exception 'FAIL: correction ledger does not reconcile or preserve the original rate snapshot';
  end if;
  raise notice 'PASS: trolley correction creates an immutable signed event using the original rate snapshot';

  select * into payment
  from public.create_soil_payment(
    factory_a_id, raju.id, date '2026-08-26', 100
  );
  select * into addition
  from public.create_soil_financial_adjustment(
    factory_a_id, raju.id, 'ADDITION', date '2026-08-26', 50,
    'Final verifier addition'
  );
  select * into deduction
  from public.create_soil_financial_adjustment(
    factory_a_id, raju.id, 'DEDUCTION', date '2026-08-26', 25,
    'Final verifier deduction'
  );
  select * into summary
  from public.get_soil_financial_summary(factory_a_id, raju.id);
  if summary.total_earned <> 400
    or summary.total_additions <> 50
    or summary.total_deductions <> 25
    or summary.total_paid <> 100
    or summary.available_balance <> 325 then
    raise exception 'FAIL: authoritative financial formula is incorrect';
  end if;
  raise notice 'PASS: payment, addition, deduction, and authoritative available balance';

  perform pg_temp.expect_error(
    'overpayment is rejected', 'P2802',
    format('select * from public.create_soil_payment(%L::uuid, %L::uuid, date %L, 326)',
      factory_a_id, raju.id, '2026-08-27')
  );
  perform pg_temp.expect_error(
    'over-deduction is rejected', 'P2902',
    format('select * from public.create_soil_financial_adjustment(%L::uuid, %L::uuid, %L, date %L, 326, %L)',
      factory_a_id, raju.id, 'DEDUCTION', '2026-08-27', 'Too much')
  );

  perform pg_temp.expect_error(
    'downward earning correction cannot overdraw financial balance', 'P2A05',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 0.5)))',
      factory_a_id, '2026-08-25', 'soil_worker_id', raju.id::text,
      'trolley_quantity'
    )
  );
  if (select trolley_quantity from public.soil_daily_trolley_entries
      where id = daily_row.id) <> 4
    or (select sum(amount) from public.soil_earnings
        where soil_daily_trolley_entry_id = daily_row.id) <> 400 then
    raise exception 'FAIL: rejected correction partially changed T2/T3 state';
  end if;
  raise notice 'PASS: shared financial lock protects payments, deductions, and downward earnings corrections';

  select jsonb_build_object(
    'rates', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_worker_trolley_rates as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'daily', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_daily_trolley_entries as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'earnings', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_earnings as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'payments', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_payments as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'adjustments', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_financial_adjustments as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id)
  ) into history_before;
  select to_jsonb(current_summary) into summary_before
  from public.get_soil_financial_summary(factory_a_id, raju.id) as current_summary;

  select * into archived_worker
  from public.archive_soil_worker(factory_a_id, raju.id);
  if archived_worker.is_active
    or exists (select 1 from public.soil_workers
      where id = raju.id and factory_id = factory_a_id and is_active) then
    raise exception 'FAIL: archived worker remains active';
  end if;
  perform pg_temp.expect_error(
    'archived worker cannot receive new work', 'P2A03',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-09-02', 'soil_worker_id', raju.id::text,
      'trolley_quantity'
    )
  );
  select jsonb_build_object(
    'rates', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_worker_trolley_rates as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'daily', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_daily_trolley_entries as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'earnings', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_earnings as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'payments', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_payments as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id),
    'adjustments', (select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.soil_financial_adjustments as row_value
      where row_value.factory_id = factory_a_id and row_value.soil_worker_id = raju.id)
  ) into history_after;
  select to_jsonb(current_summary) into summary_after
  from public.get_soil_financial_summary(factory_a_id, raju.id) as current_summary;
  if history_after <> history_before or summary_after <> summary_before then
    raise exception 'FAIL: archive changed operational or financial history';
  end if;
  raise notice 'PASS: archive hides new work while preserving all history and totals';

  select * into restored_worker
  from public.restore_soil_worker(factory_a_id, raju.id);
  if not restored_worker.is_active then
    raise exception 'FAIL: restore did not reactivate worker';
  end if;
  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-09-02',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 1)
    )
  );
  if (select rate_per_trolley_snapshot from public.soil_daily_trolley_entries
      where factory_id = factory_a_id and soil_worker_id = raju.id
        and work_date = date '2026-09-02') <> 120 then
    raise exception 'FAIL: restored worker did not resume with authoritative future rate';
  end if;
  raise notice 'PASS: restore enables future trolley work without inventing a rate';

  select * into unused_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Unused Final Worker', 70, date '2026-08-01'
  );
  select public.delete_unused_soil_worker(factory_a_id, unused_worker.id)
  into deleted_id;
  if deleted_id <> unused_worker.id
    or exists (select 1 from public.soil_workers where id = unused_worker.id)
    or exists (select 1 from public.soil_worker_trolley_rates
      where soil_worker_id = unused_worker.id) then
    raise exception 'FAIL: unused worker deletion left worker or setup-rate rows';
  end if;
  perform pg_temp.expect_error(
    'historical worker deletion is blocked', 'P2A04',
    format('select public.delete_unused_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, raju.id)
  );
  raise notice 'PASS: unused deletion is clean and historical deletion is guarded';

  perform pg_temp.expect_error(
    'cross-factory rate reference is rejected', 'P2602',
    format('select * from public.create_soil_worker_trolley_rate(%L::uuid, %L::uuid, 100, date %L)',
      factory_a_id, factory_b_worker_id, '2026-09-01')
  );
  perform pg_temp.expect_error(
    'cross-factory trolley worker is rejected', 'P2602',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-08-25', 'soil_worker_id', factory_b_worker_id::text,
      'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B RPC access', '42501',
    format('select * from public.get_soil_financial_summary(%L::uuid, %L::uuid)',
      factory_b_id, factory_b_worker_id)
  );
  if exists (select 1 from public.soil_workers where factory_id = factory_b_id)
    or exists (select 1 from public.soil_worker_trolley_rates where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B Soil rows';
  end if;
  raise notice 'PASS: RLS, RPC validation, and composite references isolate factories';

  perform pg_temp.expect_error(
    'authenticated direct worker update is denied', '42501',
    format('update public.soil_workers set is_active = false where id = %L::uuid', raju.id)
  );
  perform pg_temp.expect_error(
    'authenticated direct payment insert is denied', '42501',
    format('insert into public.soil_payments (factory_id, soil_worker_id, payment_date, amount) values (%L::uuid, %L::uuid, date %L, 1)',
      factory_a_id, raju.id, '2026-08-27')
  );

  perform set_config('atlas_test.raju_id', raju.id::text, true);
  perform set_config('atlas_test.earning_id', (
    select id::text from public.soil_earnings
    where factory_id = factory_a_id and soil_worker_id = raju.id
    order by event_sequence limit 1
  ), true);
  perform set_config('atlas_test.payment_id', payment.payment_id::text, true);
  perform set_config('atlas_test.adjustment_id', addition.adjustment_id::text, true);
end;
$$;

reset role;

set local role anon;
do $$
begin
  perform pg_temp.expect_error(
    'anonymous Soil table read is denied', '42501',
    'select * from public.soil_workers'
  );
  perform pg_temp.expect_error(
    'anonymous Soil RPC execution is denied', '42501',
    format('select * from public.get_soil_financial_summary(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.raju_id'))
  );
end;
$$;
reset role;

do $$
declare
  required_policy_count integer;
  soil_table_name text;
  routine_oid oid;
  payment_definition text := pg_get_functiondef(
    'public.create_soil_payment(uuid,uuid,date,numeric)'::regprocedure
  );
  adjustment_definition text := pg_get_functiondef(
    'public.create_soil_financial_adjustment(uuid,uuid,text,date,numeric,text)'::regprocedure
  );
  financial_guard_definition text := pg_get_functiondef(
    'public.guard_soil_daily_financial_balance()'::regprocedure
  );
begin
  perform pg_temp.expect_error(
    'earning update is blocked by immutability trigger', 'P2701',
    format('update public.soil_earnings set amount = amount where id = %L::uuid',
      current_setting('atlas_test.earning_id'))
  );
  perform pg_temp.expect_error(
    'payment delete is blocked by immutability trigger', 'P2801',
    format('delete from public.soil_payments where id = %L::uuid',
      current_setting('atlas_test.payment_id'))
  );
  perform pg_temp.expect_error(
    'adjustment update is blocked by immutability trigger', 'P2901',
    format('update public.soil_financial_adjustments set amount = amount where id = %L::uuid',
      current_setting('atlas_test.adjustment_id'))
  );
  raise notice 'PASS: earnings, payments, and adjustments are independently immutable';

  if payment_definition !~ 'soil_financial:'
    or adjustment_definition !~ 'soil_financial:'
    or financial_guard_definition !~ 'soil_financial:' then
    raise exception 'FAIL: Soil financial writers do not share one lock namespace';
  end if;

  if exists (
    select 1
    from pg_class
    where oid = any(array[
      'public.soil_workers'::regclass,
      'public.soil_worker_trolley_rates'::regclass,
      'public.soil_daily_trolley_entries'::regclass,
      'public.soil_earnings'::regclass,
      'public.soil_payments'::regclass,
      'public.soil_financial_adjustments'::regclass
    ]) and not relrowsecurity
  ) then
    raise exception 'FAIL: one or more Soil tables do not have RLS enabled';
  end if;
  select count(*) into required_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array[
      'soil_workers',
      'soil_worker_trolley_rates',
      'soil_daily_trolley_entries',
      'soil_earnings',
      'soil_payments',
      'soil_financial_adjustments'
    ]);
  if required_policy_count <> 6 then
    raise exception 'FAIL: expected six factory-read Soil RLS policies, found %',
      required_policy_count;
  end if;

  foreach soil_table_name in array array[
    'soil_workers',
    'soil_worker_trolley_rates',
    'soil_daily_trolley_entries',
    'soil_earnings',
    'soil_payments',
    'soil_financial_adjustments'
  ] loop
    if has_table_privilege(
        'authenticated', format('public.%I', soil_table_name), 'INSERT'
      ) or has_table_privilege(
        'authenticated', format('public.%I', soil_table_name), 'UPDATE'
      ) or has_table_privilege(
        'authenticated', format('public.%I', soil_table_name), 'DELETE'
      ) or has_table_privilege(
        'anon', format('public.%I', soil_table_name), 'SELECT'
      ) then
      raise exception 'FAIL: unsafe direct privilege exists on %', soil_table_name;
    end if;
  end loop;

  if to_regclass('public.soil_workers_factory_name_idx') is null
    or to_regclass('public.soil_worker_trolley_rates_factory_worker_from_idx') is null
    or to_regclass('public.soil_daily_trolley_entries_factory_date_worker_idx') is null
    or to_regclass('public.soil_earnings_one_base_per_daily_entry_idx') is null
    or to_regclass('public.soil_earnings_factory_worker_history_idx') is null
    or to_regclass('public.soil_payments_factory_worker_history_idx') is null
    or to_regclass('public.soil_financial_adjustments_factory_worker_history_idx') is null then
    raise exception 'FAIL: a required Soil index is missing';
  end if;

  if not exists (select 1 from pg_constraint
      where conname = 'soil_worker_trolley_rates_no_overlapping_dates')
    or not exists (select 1 from pg_constraint
      where conname = 'soil_daily_trolley_entries_worker_date_key')
    or not exists (select 1 from pg_constraint
      where conname = 'soil_earnings_source_sequence_key')
    or not exists (select 1 from pg_constraint
      where conname = 'soil_earnings_event_math_check')
    or not exists (select 1 from pg_trigger
      where tgname = 'soil_daily_trolley_entries_financial_lock' and not tgisinternal)
    or not exists (select 1 from pg_trigger
      where tgname = 'soil_daily_trolley_entries_require_active_worker' and not tgisinternal) then
    raise exception 'FAIL: a required Soil constraint or guard trigger is missing';
  end if;

  if to_regprocedure('public.create_soil_worker_with_initial_trolley_rate(uuid,text,numeric,date)') is null
    or to_regprocedure('public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)') is null
    or to_regprocedure('public.resolve_soil_worker_trolley_rate(uuid,uuid,date)') is null
    or to_regprocedure('public.save_soil_daily_trolley_entries(uuid,date,jsonb)') is null
    or to_regprocedure('public.get_soil_total_earned(uuid,uuid)') is null
    or to_regprocedure('public.get_soil_financial_summary(uuid,uuid)') is null
    or to_regprocedure('public.create_soil_payment(uuid,uuid,date,numeric)') is null
    or to_regprocedure('public.create_soil_financial_adjustment(uuid,uuid,text,date,numeric,text)') is null
    or to_regprocedure('public.archive_soil_worker(uuid,uuid)') is null
    or to_regprocedure('public.restore_soil_worker(uuid,uuid)') is null
    or to_regprocedure('public.delete_unused_soil_worker(uuid,uuid)') is null then
    raise exception 'FAIL: a required Soil RPC is missing';
  end if;

  foreach routine_oid in array array[
    'public.create_soil_worker_with_initial_trolley_rate(uuid,text,numeric,date)'::regprocedure,
    'public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)'::regprocedure,
    'public.resolve_soil_worker_trolley_rate(uuid,uuid,date)'::regprocedure,
    'public.save_soil_daily_trolley_entries(uuid,date,jsonb)'::regprocedure,
    'public.get_soil_total_earned(uuid,uuid)'::regprocedure,
    'public.get_soil_financial_summary(uuid,uuid)'::regprocedure,
    'public.create_soil_payment(uuid,uuid,date,numeric)'::regprocedure,
    'public.create_soil_financial_adjustment(uuid,uuid,text,date,numeric,text)'::regprocedure,
    'public.archive_soil_worker(uuid,uuid)'::regprocedure,
    'public.restore_soil_worker(uuid,uuid)'::regprocedure,
    'public.delete_unused_soil_worker(uuid,uuid)'::regprocedure
  ] loop
    if not (select procedure.prosecdef from pg_proc as procedure
        where procedure.oid = routine_oid)
      or not coalesce((select procedure.proconfig from pg_proc as procedure
        where procedure.oid = routine_oid), array[]::text[])
        @> array['search_path=pg_catalog, public']
      or has_function_privilege('anon', routine_oid, 'EXECUTE') then
      raise exception 'FAIL: Soil RPC % has unsafe security metadata', routine_oid::regprocedure;
    end if;
  end loop;
  raise notice 'PASS: required RLS, policies, privileges, indexes, constraints, triggers, and RPCs exist';

  if to_regclass('public.production_entries') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.transport_workers') is null
    or to_regclass('public.transport_daily_entries') is null
    or to_regclass('public.staff_workers') is null
    or to_regclass('public.staff_payments') is null then
    raise exception 'FAIL: an unrelated Production, Mud, Chamber Transport, or Staff object is missing';
  end if;
  raise notice 'PASS: Production, Mud, Chamber Transport, and Staff remain intact';
end;
$$;

rollback;
