-- Atlas Soil Supply T7 verifier. Run after migrations through 20260825000018.
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
  payment_worker_id uuid := gen_random_uuid();
  adjustment_worker_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Soil T7 verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil T7 verifier B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.soil_workers (id, factory_id, name) values
    (worker_b_id, factory_b_id, 'Factory B Soil Worker T7'),
    (payment_worker_id, factory_a_id, 'Payment History Worker T7'),
    (adjustment_worker_id, factory_a_id, 'Adjustment History Worker T7');

  insert into public.soil_worker_trolley_rates (
    factory_id, soil_worker_id, rate_per_trolley, effective_from
  ) values
    (factory_b_id, worker_b_id, 100, date '2026-08-01'),
    (factory_a_id, payment_worker_id, 100, date '2026-08-01'),
    (factory_a_id, adjustment_worker_id, 100, date '2026-08-01');

  -- Independent payment/adjustment delete guards do not need earned balance;
  -- these owner-created fixtures verify the lifecycle guard itself.
  insert into public.soil_payments (
    factory_id, soil_worker_id, payment_date, amount
  ) values (
    factory_a_id, payment_worker_id, date '2026-08-25', 1
  );
  insert into public.soil_financial_adjustments (
    factory_id, soil_worker_id, adjustment_type, adjustment_date, amount, reason
  ) values (
    factory_a_id, adjustment_worker_id, 'ADDITION', date '2026-08-25', 1,
    'T7 independent adjustment guard'
  );

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
  perform set_config('atlas_test.payment_worker_id', payment_worker_id::text, true);
  perform set_config('atlas_test.adjustment_worker_id', adjustment_worker_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  worker_b_id uuid := current_setting('atlas_test.worker_b_id')::uuid;
  payment_worker_id uuid := current_setting('atlas_test.payment_worker_id')::uuid;
  adjustment_worker_id uuid := current_setting('atlas_test.adjustment_worker_id')::uuid;
  history_worker public.soil_workers%rowtype;
  unused_worker public.soil_workers%rowtype;
  daily_worker public.soil_workers%rowtype;
  earnings_worker public.soil_workers%rowtype;
  archived_worker public.soil_workers%rowtype;
  restored_worker public.soil_workers%rowtype;
  deleted_id uuid;
  summary_before jsonb;
  summary_after jsonb;
  history_before jsonb;
  history_after jsonb;
  setup_rate_count bigint;
begin
  select * into history_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Lifecycle History Worker T7', 100, date '2026-08-01'
  );
  select * into unused_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Unused Worker T7', 110, date '2026-08-01'
  );
  select * into daily_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Daily Blocker T7', 120, date '2026-08-01'
  );
  select * into earnings_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Earnings Blocker T7', 130, date '2026-08-01'
  );

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', history_worker.id::text, 'trolley_quantity', 5),
      jsonb_build_object('soil_worker_id', daily_worker.id::text, 'trolley_quantity', 1),
      jsonb_build_object('soil_worker_id', earnings_worker.id::text, 'trolley_quantity', 1)
    )
  );
  perform * from public.create_soil_payment(
    factory_a_id, history_worker.id, date '2026-08-26', 100
  );
  perform * from public.create_soil_financial_adjustment(
    factory_a_id, history_worker.id, 'ADDITION', date '2026-08-26', 50,
    'T7 archive preservation addition'
  );
  perform * from public.create_soil_financial_adjustment(
    factory_a_id, history_worker.id, 'DEDUCTION', date '2026-08-26', 25,
    'T7 archive preservation deduction'
  );

  select to_jsonb(summary) into summary_before
  from public.get_soil_financial_summary(factory_a_id, history_worker.id) as summary;
  select jsonb_build_object(
    'rates', (select jsonb_agg(to_jsonb(rate_row) order by rate_row.id)
      from public.soil_worker_trolley_rates as rate_row
      where rate_row.factory_id = factory_a_id
        and rate_row.soil_worker_id = history_worker.id),
    'daily', (select jsonb_agg(to_jsonb(daily_row) order by daily_row.id)
      from public.soil_daily_trolley_entries as daily_row
      where daily_row.factory_id = factory_a_id
        and daily_row.soil_worker_id = history_worker.id),
    'earnings', (select jsonb_agg(to_jsonb(earning_row) order by earning_row.id)
      from public.soil_earnings as earning_row
      where earning_row.factory_id = factory_a_id
        and earning_row.soil_worker_id = history_worker.id),
    'payments', (select jsonb_agg(to_jsonb(payment_row) order by payment_row.id)
      from public.soil_payments as payment_row
      where payment_row.factory_id = factory_a_id
        and payment_row.soil_worker_id = history_worker.id),
    'adjustments', (select jsonb_agg(to_jsonb(adjustment_row) order by adjustment_row.id)
      from public.soil_financial_adjustments as adjustment_row
      where adjustment_row.factory_id = factory_a_id
        and adjustment_row.soil_worker_id = history_worker.id)
  ) into history_before;

  select * into archived_worker
  from public.archive_soil_worker(factory_a_id, history_worker.id);
  if archived_worker.is_active then
    raise exception 'FAIL: archive did not mark the Soil worker inactive';
  end if;
  if exists (
    select 1 from public.soil_workers
    where factory_id = factory_a_id
      and id = history_worker.id
      and is_active = true
  ) then
    raise exception 'FAIL: archived worker remains in active population';
  end if;
  raise notice 'PASS: archived worker is excluded from active population';

  select to_jsonb(summary) into summary_after
  from public.get_soil_financial_summary(factory_a_id, history_worker.id) as summary;
  select jsonb_build_object(
    'rates', (select jsonb_agg(to_jsonb(rate_row) order by rate_row.id)
      from public.soil_worker_trolley_rates as rate_row
      where rate_row.factory_id = factory_a_id
        and rate_row.soil_worker_id = history_worker.id),
    'daily', (select jsonb_agg(to_jsonb(daily_row) order by daily_row.id)
      from public.soil_daily_trolley_entries as daily_row
      where daily_row.factory_id = factory_a_id
        and daily_row.soil_worker_id = history_worker.id),
    'earnings', (select jsonb_agg(to_jsonb(earning_row) order by earning_row.id)
      from public.soil_earnings as earning_row
      where earning_row.factory_id = factory_a_id
        and earning_row.soil_worker_id = history_worker.id),
    'payments', (select jsonb_agg(to_jsonb(payment_row) order by payment_row.id)
      from public.soil_payments as payment_row
      where payment_row.factory_id = factory_a_id
        and payment_row.soil_worker_id = history_worker.id),
    'adjustments', (select jsonb_agg(to_jsonb(adjustment_row) order by adjustment_row.id)
      from public.soil_financial_adjustments as adjustment_row
      where adjustment_row.factory_id = factory_a_id
        and adjustment_row.soil_worker_id = history_worker.id)
  ) into history_after;
  if history_after <> history_before or summary_after <> summary_before then
    raise exception 'FAIL: archive changed historical rows or financial summary';
  end if;
  raise notice 'PASS: archive preserves historical rows and financial summary';

  if (select count(*) from public.soil_payments
      where factory_id = factory_a_id and soil_worker_id = history_worker.id) <> 1
    or (select count(*) from public.soil_financial_adjustments
        where factory_id = factory_a_id and soil_worker_id = history_worker.id) <> 2 then
    raise exception 'FAIL: archived financial histories are not readable';
  end if;
  raise notice 'PASS: archived payments and adjustments remain readable';

  perform pg_temp.expect_error(
    'archived worker cannot receive trolley entries', 'P2A03',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 2)))',
      factory_a_id, '2026-08-27', 'soil_worker_id', history_worker.id::text,
      'trolley_quantity'
    )
  );

  select * into restored_worker
  from public.restore_soil_worker(factory_a_id, history_worker.id);
  if not restored_worker.is_active then
    raise exception 'FAIL: restore did not mark the Soil worker active';
  end if;
  select jsonb_build_object(
    'rates', (select jsonb_agg(to_jsonb(rate_row) order by rate_row.id)
      from public.soil_worker_trolley_rates as rate_row
      where rate_row.factory_id = factory_a_id
        and rate_row.soil_worker_id = history_worker.id),
    'daily', (select jsonb_agg(to_jsonb(daily_row) order by daily_row.id)
      from public.soil_daily_trolley_entries as daily_row
      where daily_row.factory_id = factory_a_id
        and daily_row.soil_worker_id = history_worker.id),
    'earnings', (select jsonb_agg(to_jsonb(earning_row) order by earning_row.id)
      from public.soil_earnings as earning_row
      where earning_row.factory_id = factory_a_id
        and earning_row.soil_worker_id = history_worker.id),
    'payments', (select jsonb_agg(to_jsonb(payment_row) order by payment_row.id)
      from public.soil_payments as payment_row
      where payment_row.factory_id = factory_a_id
        and payment_row.soil_worker_id = history_worker.id),
    'adjustments', (select jsonb_agg(to_jsonb(adjustment_row) order by adjustment_row.id)
      from public.soil_financial_adjustments as adjustment_row
      where adjustment_row.factory_id = factory_a_id
        and adjustment_row.soil_worker_id = history_worker.id)
  ) into history_after;
  if history_after <> history_before then
    raise exception 'FAIL: restore changed pre-existing history';
  end if;
  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-27',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', history_worker.id::text, 'trolley_quantity', 2)
    )
  );
  if (select count(*) from public.soil_daily_trolley_entries
      where factory_id = factory_a_id and soil_worker_id = history_worker.id) <> 2 then
    raise exception 'FAIL: restored worker could not receive future trolley work';
  end if;
  raise notice 'PASS: restore preserves history and enables future work';

  select count(*) into setup_rate_count
  from public.soil_worker_trolley_rates
  where factory_id = factory_a_id and soil_worker_id = unused_worker.id;
  if setup_rate_count <> 1 then
    raise exception 'FAIL: unused fixture does not have exactly one setup rate';
  end if;
  select public.delete_unused_soil_worker(factory_a_id, unused_worker.id)
  into deleted_id;
  if deleted_id <> unused_worker.id
    or exists (select 1 from public.soil_workers where id = unused_worker.id)
    or exists (select 1 from public.soil_worker_trolley_rates
      where soil_worker_id = unused_worker.id) then
    raise exception 'FAIL: unused worker or setup rate survived deletion';
  end if;
  raise notice 'PASS: unused worker and setup rates are deleted';

  perform pg_temp.expect_error(
    'daily history blocks permanent deletion', 'P2A04',
    format('select public.delete_unused_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, daily_worker.id)
  );
  perform pg_temp.expect_error(
    'earnings history blocks permanent deletion', 'P2A04',
    format('select public.delete_unused_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, earnings_worker.id)
  );
  perform pg_temp.expect_error(
    'payment history blocks permanent deletion', 'P2A04',
    format('select public.delete_unused_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, payment_worker_id)
  );
  perform pg_temp.expect_error(
    'adjustment history blocks permanent deletion', 'P2A04',
    format('select public.delete_unused_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, adjustment_worker_id)
  );

  if exists (
    select 1
    from public.soil_worker_trolley_rates as rates
    left join public.soil_workers as workers
      on workers.id = rates.soil_worker_id
      and workers.factory_id = rates.factory_id
    where workers.id is null
  ) then
    raise exception 'FAIL: lifecycle operations left orphan trolley-rate rows';
  end if;
  raise notice 'PASS: lifecycle operations leave no orphan records';

  perform pg_temp.expect_error(
    'cross-factory archive fails', 'P2602',
    format('select * from public.archive_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, worker_b_id)
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B lifecycle access', '42501',
    format('select * from public.archive_soil_worker(%L::uuid, %L::uuid)',
      factory_b_id, worker_b_id)
  );
  if exists (select 1 from public.soil_workers where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B Soil workers';
  end if;

  perform pg_temp.expect_error(
    'authenticated direct lifecycle update fails', '42501',
    format('update public.soil_workers set is_active = false where id = %L::uuid',
      history_worker.id)
  );
  raise notice 'PASS: cross-factory lifecycle actions and direct writes are denied';

  perform pg_temp.expect_error(
    'already-active restore is deterministic', 'P2A02',
    format('select * from public.restore_soil_worker(%L::uuid, %L::uuid)',
      factory_a_id, history_worker.id)
  );

  perform set_config('atlas_test.history_worker_id', history_worker.id::text, true);
end;
$$;

reset role;

set local role anon;
do $$
begin
  perform pg_temp.expect_error(
    'anonymous archive RPC fails', '42501',
    format('select * from public.archive_soil_worker(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.history_worker_id'))
  );
  perform pg_temp.expect_error(
    'anonymous delete RPC fails', '42501',
    format('select public.delete_unused_soil_worker(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.history_worker_id'))
  );
end;
$$;
reset role;

do $$
declare
  archive_definition text := pg_get_functiondef(
    'public.archive_soil_worker(uuid,uuid)'::regprocedure
  );
  restore_definition text := pg_get_functiondef(
    'public.restore_soil_worker(uuid,uuid)'::regprocedure
  );
  delete_definition text := pg_get_functiondef(
    'public.delete_unused_soil_worker(uuid,uuid)'::regprocedure
  );
begin
  if archive_definition !~* 'security definer'
    or restore_definition !~* 'security definer'
    or delete_definition !~* 'security definer'
    or archive_definition !~ 'soil_lifecycle:'
    or restore_definition !~ 'soil_lifecycle:'
    or delete_definition !~ 'soil_lifecycle:'
    or archive_definition !~* 'for update'
    or restore_definition !~* 'for update'
    or delete_definition !~* 'for update' then
    raise exception 'FAIL: lifecycle RPC security or concurrency guards are incomplete';
  end if;
  raise notice 'PASS: concurrent lifecycle actions serialize to one deterministic worker state';

  if to_regclass('public.soil_workers') is null
    or to_regclass('public.soil_worker_trolley_rates') is null
    or to_regclass('public.soil_daily_trolley_entries') is null
    or to_regclass('public.soil_earnings') is null
    or to_regclass('public.soil_payments') is null
    or to_regclass('public.soil_financial_adjustments') is null
    or to_regprocedure('public.create_soil_worker_with_initial_trolley_rate(uuid,text,numeric,date)') is null
    or to_regprocedure('public.save_soil_daily_trolley_entries(uuid,date,jsonb)') is null
    or to_regprocedure('public.get_soil_total_earned(uuid,uuid)') is null
    or to_regprocedure('public.get_soil_financial_summary(uuid,uuid)') is null
    or to_regclass('public.production_entries') is null
    or to_regclass('public.staff_workers') is null
    or to_regclass('public.transport_workers') is null then
    raise exception 'FAIL: T7 removed a T1-T6 or unrelated Atlas object';
  end if;
  raise notice 'PASS: T1 through T6 and unrelated Atlas modules remain present';
end;
$$;

rollback;
