-- Atlas Soil Supply T3 verifier. Run after migrations through 20260825000015.
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
  legacy_worker_id uuid := gen_random_uuid();
  legacy_rate_id uuid := gen_random_uuid();
  legacy_daily_id uuid := gen_random_uuid();
  worker_b_id uuid := gen_random_uuid();
  rate_b_id uuid := gen_random_uuid();
  daily_b_id uuid := gen_random_uuid();
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
    (factory_a_id, format('Soil T3 verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil T3 verifier B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  -- Simulate valid T2 rows that existed immediately before T3 migration/backfill.
  insert into public.soil_workers (id, factory_id, name) values
    (legacy_worker_id, factory_a_id, 'Legacy T2 Worker'),
    (worker_b_id, factory_b_id, 'Factory B Worker');
  insert into public.soil_worker_trolley_rates (
    id, factory_id, soil_worker_id, rate_per_trolley, effective_from
  ) values
    (legacy_rate_id, factory_a_id, legacy_worker_id, 150, date '2026-08-01'),
    (rate_b_id, factory_b_id, worker_b_id, 999, date '2026-08-01');
  insert into public.soil_daily_trolley_entries (
    id, factory_id, soil_worker_id, work_date, trolley_quantity,
    soil_worker_trolley_rate_id, rate_per_trolley_snapshot, base_amount_snapshot
  ) values
    (legacy_daily_id, factory_a_id, legacy_worker_id, date '2026-08-24', 2.5,
      legacy_rate_id, 150, 375),
    (daily_b_id, factory_b_id, worker_b_id, date '2026-08-24', 1,
      rate_b_id, 999, 999);

  -- Replay the migration backfill twice to prove stored-snapshot and idempotency behavior.
  insert into public.soil_earnings (
    factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date,
    event_type, event_sequence, amount, trolley_quantity_snapshot,
    rate_per_trolley_snapshot, previous_base_amount_snapshot,
    source_base_amount_snapshot, created_at
  )
  select
    daily.factory_id, daily.soil_worker_id, daily.id, daily.work_date,
    'BASE', 1, daily.base_amount_snapshot, daily.trolley_quantity,
    daily.rate_per_trolley_snapshot, 0, daily.base_amount_snapshot,
    daily.created_at
  from public.soil_daily_trolley_entries as daily
  where not exists (
    select 1 from public.soil_earnings as existing_base
    where existing_base.soil_daily_trolley_entry_id = daily.id
      and existing_base.event_type = 'BASE'
  )
  on conflict (soil_daily_trolley_entry_id) where event_type = 'BASE' do nothing;

  insert into public.soil_earnings (
    factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date,
    event_type, event_sequence, amount, trolley_quantity_snapshot,
    rate_per_trolley_snapshot, previous_base_amount_snapshot,
    source_base_amount_snapshot, created_at
  )
  select
    daily.factory_id, daily.soil_worker_id, daily.id, daily.work_date,
    'BASE', 1, daily.base_amount_snapshot, daily.trolley_quantity,
    daily.rate_per_trolley_snapshot, 0, daily.base_amount_snapshot,
    daily.created_at
  from public.soil_daily_trolley_entries as daily
  where not exists (
    select 1 from public.soil_earnings as existing_base
    where existing_base.soil_daily_trolley_entry_id = daily.id
      and existing_base.event_type = 'BASE'
  )
  on conflict (soil_daily_trolley_entry_id) where event_type = 'BASE' do nothing;

  perform set_config('atlas_test.mapping_id', mapping_id::text, true);
  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.legacy_worker_id', legacy_worker_id::text, true);
  perform set_config('atlas_test.legacy_daily_id', legacy_daily_id::text, true);
  perform set_config('atlas_test.worker_b_id', worker_b_id::text, true);
  perform set_config('atlas_test.daily_b_id', daily_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  legacy_daily_id uuid := current_setting('atlas_test.legacy_daily_id')::uuid;
  raju public.soil_workers%rowtype;
  babu public.soil_workers%rowtype;
  late_worker public.soil_workers%rowtype;
  raju_new_rate public.soil_worker_trolley_rates%rowtype;
  raju_daily public.soil_daily_trolley_entries%rowtype;
  babu_daily public.soil_daily_trolley_entries%rowtype;
  base_before public.soil_earnings%rowtype;
  base_after public.soil_earnings%rowtype;
  upward_before public.soil_earnings%rowtype;
  upward_after public.soil_earnings%rowtype;
  downward_event public.soil_earnings%rowtype;
  daily_before jsonb;
  earnings_before jsonb;
  total_before integer;
  total_after integer;
  worker_total numeric;
  source_total numeric;
  source_amounts numeric[];
  source_sequences integer[];
begin
  if (select count(*) from public.soil_earnings
      where soil_daily_trolley_entry_id = legacy_daily_id) <> 1
    or (select event_type from public.soil_earnings
        where soil_daily_trolley_entry_id = legacy_daily_id) <> 'BASE'
    or (select event_sequence from public.soil_earnings
        where soil_daily_trolley_entry_id = legacy_daily_id) <> 1
    or (select amount from public.soil_earnings
        where soil_daily_trolley_entry_id = legacy_daily_id) <> 375
    or (select trolley_quantity_snapshot from public.soil_earnings
        where soil_daily_trolley_entry_id = legacy_daily_id) <> 2.5
    or (select rate_per_trolley_snapshot from public.soil_earnings
        where soil_daily_trolley_entry_id = legacy_daily_id) <> 150 then
    raise exception 'FAIL: existing T2 row did not backfill exactly once from stored snapshots';
  end if;
  raise notice 'PASS: existing T2 row backfills idempotently to one 2.5 × ₹150 = ₹375 BASE event';

  select * into raju
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Raju', 200, date '2026-08-01'
  );
  select * into babu
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Babu', 180, date '2026-08-01'
  );
  select * into late_worker
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id, 'Late Rate Worker', 300, date '2026-09-01'
  );

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 5),
      jsonb_build_object('soil_worker_id', babu.id::text, 'trolley_quantity', 3)
    )
  );

  select * into raju_daily from public.soil_daily_trolley_entries
  where factory_id = factory_a_id and soil_worker_id = raju.id
    and work_date = date '2026-08-25';
  select * into babu_daily from public.soil_daily_trolley_entries
  where factory_id = factory_a_id and soil_worker_id = babu.id
    and work_date = date '2026-08-25';
  select * into base_before from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id and event_type = 'BASE';

  if base_before.amount <> raju_daily.base_amount_snapshot
    or base_before.amount <> 1000
    or base_before.event_sequence <> 1
    or base_before.trolley_quantity_snapshot <> 5
    or base_before.rate_per_trolley_snapshot <> 200
    or base_before.previous_base_amount_snapshot <> 0
    or base_before.source_base_amount_snapshot <> 1000
    or (select amount from public.soil_earnings
        where soil_daily_trolley_entry_id = babu_daily.id) <> 540 then
    raise exception 'FAIL: new daily rows did not create correct independent BASE earnings';
  end if;
  raise notice 'PASS: new Raju and Babu rows atomically create independent ₹1,000 and ₹540 BASE earnings';

  daily_before := to_jsonb(raju_daily);
  select count(*) into total_before from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id;
  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 5)
    )
  );
  select count(*) into total_after from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id;
  select * into raju_daily from public.soil_daily_trolley_entries
  where id = raju_daily.id;
  if total_after <> total_before or to_jsonb(raju_daily) <> daily_before then
    raise exception 'FAIL: unchanged save changed daily state or duplicated earnings';
  end if;
  raise notice 'PASS: unchanged/retried save is operationally and financially idempotent';

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 6)
    )
  );
  select * into upward_before from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id and event_sequence = 2;
  if upward_before.event_type <> 'CORRECTION'
    or upward_before.amount <> 200
    or upward_before.previous_base_amount_snapshot <> 1000
    or upward_before.source_base_amount_snapshot <> 1200
    or upward_before.trolley_quantity_snapshot <> 6
    or upward_before.rate_per_trolley_snapshot <> 200 then
    raise exception 'FAIL: upward correction event is incorrect';
  end if;

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 4)
    )
  );
  select * into downward_event from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id and event_sequence = 3;
  select * into base_after from public.soil_earnings where id = base_before.id;
  select * into upward_after from public.soil_earnings where id = upward_before.id;
  select * into raju_daily from public.soil_daily_trolley_entries
  where id = raju_daily.id;

  if downward_event.event_type <> 'CORRECTION'
    or downward_event.amount <> -400
    or downward_event.previous_base_amount_snapshot <> 1200
    or downward_event.source_base_amount_snapshot <> 800
    or downward_event.trolley_quantity_snapshot <> 4
    or downward_event.rate_per_trolley_snapshot <> 200
    or to_jsonb(base_after) <> to_jsonb(base_before)
    or to_jsonb(upward_after) <> to_jsonb(upward_before) then
    raise exception 'FAIL: downward correction or earlier event immutability is incorrect';
  end if;

  select coalesce(sum(amount), 0),
    array_agg(amount order by event_sequence),
    array_agg(event_sequence order by event_sequence)
  into source_total, source_amounts, source_sequences
  from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id;
  if source_total <> 800
    or source_total <> raju_daily.base_amount_snapshot
    or source_amounts <> array[1000::numeric, 200::numeric, -400::numeric]
    or source_sequences <> array[1, 2, 3] then
    raise exception 'FAIL: sequential corrections do not reconcile to latest daily base';
  end if;
  raise notice 'PASS: +₹1,000, +₹200, −₹400 remains immutable and reconciles exactly to ₹800';

  select jsonb_agg(to_jsonb(soil_earnings) order by event_sequence)
  into earnings_before
  from public.soil_earnings
  where soil_daily_trolley_entry_id = raju_daily.id;
  select count(*) into total_before from public.soil_earnings
  where soil_worker_id = raju.id;
  select * into raju_new_rate
  from public.create_soil_worker_trolley_rate(
    factory_a_id, raju.id, 220, date '2026-09-01'
  );
  select count(*) into total_after from public.soil_earnings
  where soil_worker_id = raju.id;
  if total_after <> total_before
    or (select jsonb_agg(to_jsonb(soil_earnings) order by event_sequence)
        from public.soil_earnings
        where soil_daily_trolley_entry_id = raju_daily.id) <> earnings_before then
    raise exception 'FAIL: T1 rate change altered or created old earnings';
  end if;

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-09-01',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 4)
    )
  );
  if (select count(*) from public.soil_earnings
      where soil_worker_id = raju.id and work_date = date '2026-09-01') <> 1
    or (select amount from public.soil_earnings
        where soil_worker_id = raju.id and work_date = date '2026-09-01') <> 880
    or (select rate_per_trolley_snapshot from public.soil_earnings
        where soil_worker_id = raju.id and work_date = date '2026-09-01') <> 220
    or (select event_type from public.soil_earnings
        where soil_worker_id = raju.id and work_date = date '2026-09-01') <> 'BASE' then
    raise exception 'FAIL: future daily row did not create correct newer-rate BASE earning';
  end if;
  raise notice 'PASS: rate change creates no earning, while new September work creates 4 × ₹220 = ₹880';

  select * into worker_total
  from public.get_soil_total_earned(factory_a_id, raju.id);
  if worker_total <> 1680
    or worker_total <> (select sum(amount) from public.soil_earnings
                        where factory_id = factory_a_id and soil_worker_id = raju.id) then
    raise exception 'FAIL: authoritative worker Total Earned is not the ledger sum';
  end if;
  raise notice 'PASS: Raju cumulative Total Earned is the authoritative ₹1,680 ledger sum';

  perform pg_temp.expect_error(
    'one missing-rate item rolls back daily and earning rows for the whole batch',
    'P2605',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1), jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-08-27',
      'soil_worker_id', babu.id::text, 'trolley_quantity',
      'soil_worker_id', late_worker.id::text, 'trolley_quantity'
    )
  );
  if exists (select 1 from public.soil_daily_trolley_entries
             where factory_id = factory_a_id and work_date = date '2026-08-27')
    or exists (select 1 from public.soil_earnings
               where factory_id = factory_a_id and work_date = date '2026-08-27') then
    raise exception 'FAIL: invalid batch left partial operational or financial state';
  end if;
  raise notice 'PASS: invalid batch rolls back both operational and financial writes';

  select count(*) into total_before from public.soil_earnings
  where soil_worker_id = raju.id and work_date = date '2026-09-01';
  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-09-01',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 4)
    )
  );
  select count(*) into total_after from public.soil_earnings
  where soil_worker_id = raju.id and work_date = date '2026-09-01';
  if total_after <> total_before then
    raise exception 'FAIL: retry duplicated a future-date BASE earning';
  end if;

  if exists (select 1 from public.soil_earnings where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B earnings';
  end if;

  perform pg_temp.expect_error(
    'authenticated direct earning insert is blocked', '42501',
    format(
      'insert into public.soil_earnings (factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date, event_type, event_sequence, amount, trolley_quantity_snapshot, rate_per_trolley_snapshot, previous_base_amount_snapshot, source_base_amount_snapshot) values (%L::uuid, %L::uuid, %L::uuid, date %L, %L, 4, 200, 5, 200, 800, 1000)',
      factory_a_id, raju.id, raju_daily.id, '2026-08-25', 'CORRECTION'
    )
  );
  perform pg_temp.expect_error(
    'authenticated direct earning update is blocked', '42501',
    format('update public.soil_earnings set amount = 1 where id = %L::uuid', base_before.id)
  );
  perform pg_temp.expect_error(
    'authenticated direct earning delete is blocked', '42501',
    format('delete from public.soil_earnings where id = %L::uuid', base_before.id)
  );

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_error(
    'unauthenticated Total Earned access is rejected', '42501',
    format('select * from public.get_soil_total_earned(%L::uuid, %L::uuid)',
      factory_a_id, raju.id)
  );
  perform set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

  perform set_config('atlas_test.raju_id', raju.id::text, true);
  perform set_config('atlas_test.babu_id', babu.id::text, true);
  perform set_config('atlas_test.raju_daily_id', raju_daily.id::text, true);
  perform set_config('atlas_test.babu_daily_id', babu_daily.id::text, true);
  perform set_config('atlas_test.raju_base_id', base_before.id::text, true);
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
    select 1 from public.soil_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
  ) then
    raise exception 'FAIL: authenticated Factory B can read Factory A earnings';
  end if;
  perform pg_temp.expect_error(
    'Factory B cannot claim Factory A Total Earned', '42501',
    format('select * from public.get_soil_total_earned(%L::uuid, %L::uuid)',
      current_setting('atlas_test.factory_a_id'), current_setting('atlas_test.raju_id'))
  );
  raise notice 'PASS: authenticated Factory B cannot read Factory A earning history or total';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  raju_id uuid := current_setting('atlas_test.raju_id')::uuid;
  babu_id uuid := current_setting('atlas_test.babu_id')::uuid;
  raju_daily_id uuid := current_setting('atlas_test.raju_daily_id')::uuid;
  babu_daily_id uuid := current_setting('atlas_test.babu_daily_id')::uuid;
  daily_b_id uuid := current_setting('atlas_test.daily_b_id')::uuid;
  base_id uuid := current_setting('atlas_test.raju_base_id')::uuid;
begin
  perform pg_temp.expect_error(
    'cross-factory source reference fails', '23503',
    format(
      'insert into public.soil_earnings (factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date, event_type, event_sequence, amount, trolley_quantity_snapshot, rate_per_trolley_snapshot, previous_base_amount_snapshot, source_base_amount_snapshot) values (%L::uuid, %L::uuid, %L::uuid, date %L, %L, 2, 999, 2, 999, 999, 1998)',
      factory_a_id, raju_id, daily_b_id, '2026-08-24', 'CORRECTION'
    )
  );
  perform pg_temp.expect_error(
    'worker and source-daily mismatch fails', '23503',
    format(
      'insert into public.soil_earnings (factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date, event_type, event_sequence, amount, trolley_quantity_snapshot, rate_per_trolley_snapshot, previous_base_amount_snapshot, source_base_amount_snapshot) values (%L::uuid, %L::uuid, %L::uuid, date %L, %L, 4, 200, 5, 200, 800, 1000)',
      factory_a_id, babu_id, raju_daily_id, '2026-08-25', 'CORRECTION'
    )
  );
  perform pg_temp.expect_error(
    'invalid earning event math fails', '23514',
    format(
      'insert into public.soil_earnings (factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date, event_type, event_sequence, amount, trolley_quantity_snapshot, rate_per_trolley_snapshot, previous_base_amount_snapshot, source_base_amount_snapshot) values (%L::uuid, %L::uuid, %L::uuid, date %L, %L, 2, 999, 4, 180, 540, 720)',
      factory_a_id, babu_id, babu_daily_id, '2026-08-25', 'CORRECTION'
    )
  );

  perform pg_temp.expect_error(
    'database trigger rejects earning update even for table owner', 'P2701',
    format('update public.soil_earnings set amount = amount where id = %L::uuid', base_id)
  );
  perform pg_temp.expect_error(
    'database trigger rejects earning delete even for table owner', 'P2701',
    format('delete from public.soil_earnings where id = %L::uuid', base_id)
  );

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'soil_earnings_one_base_per_daily_entry_idx'
      and indexdef like '%UNIQUE%'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.soil_earnings'::regclass
      and conname = 'soil_earnings_source_sequence_key'
      and contype = 'u'
  ) then
    raise exception 'FAIL: base uniqueness or event sequence constraint is missing';
  end if;

  if position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.save_soil_daily_trolley_entries(uuid,date,jsonb)'::regprocedure
    )
  ) = 0 or position(
    'CORRECTION' in pg_get_functiondef(
      'public.save_soil_daily_trolley_entries(uuid,date,jsonb)'::regprocedure
    )
  ) = 0 then
    raise exception 'FAIL: daily save lacks serialized earning integration';
  end if;
  raise notice 'PASS: serialized saves, one BASE, and monotonic event sequences protect competing writes';

  if has_table_privilege('authenticated', 'public.soil_earnings', 'INSERT')
    or has_table_privilege('authenticated', 'public.soil_earnings', 'UPDATE')
    or has_table_privilege('authenticated', 'public.soil_earnings', 'DELETE')
    or has_table_privilege('anon', 'public.soil_earnings', 'SELECT') then
    raise exception 'FAIL: unsafe Soil earnings privileges are present';
  end if;

  if to_regprocedure('public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)') is null
    or to_regprocedure('public.resolve_soil_worker_trolley_rate(uuid,uuid,date)') is null
    or to_regprocedure('public.save_soil_daily_trolley_entries(uuid,date,jsonb)') is null
    or to_regclass('public.soil_daily_trolley_entries') is null then
    raise exception 'FAIL: T1/T2 Soil runtime is incomplete';
  end if;

  if to_regclass('public.factories') is null
    or to_regclass('public.labourers') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.transport_workers') is null
    or to_regclass('public.staff_workers') is null then
    raise exception 'FAIL: an existing Production, Mud, Transport, or Staff object is missing';
  end if;

  if to_regclass('public.soil_payments') is not null
    or to_regclass('public.soil_balances') is not null
    or to_regclass('public.soil_adjustments') is not null
    or to_regclass('public.soil_withdrawals') is not null then
    raise exception 'FAIL: a T4+ Soil financial table was created early';
  end if;
  raise notice 'PASS: T1/T2 and existing modules remain intact with no T4+ financial objects';
end;
$$;

rollback;
