-- Atlas Soil Supply T2 verifier. Run after migrations through 20260825000014.
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
    (factory_a_id, format('Soil T2 verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil T2 verifier B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.soil_workers (id, factory_id, name)
  values (worker_b_id, factory_b_id, 'Factory B Soil Worker');
  insert into public.soil_worker_trolley_rates (
    factory_id, soil_worker_id, rate_per_trolley, effective_from
  ) values (
    factory_b_id, worker_b_id, 999, date '2026-08-01'
  );

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
  babu public.soil_workers%rowtype;
  late_worker public.soil_workers%rowtype;
  raju_initial_rate public.soil_worker_trolley_rates%rowtype;
  babu_initial_rate public.soil_worker_trolley_rates%rowtype;
  raju_new_rate public.soil_worker_trolley_rates%rowtype;
  raju_entry public.soil_daily_trolley_entries%rowtype;
  babu_entry public.soil_daily_trolley_entries%rowtype;
  original_entry_id uuid;
  original_rate_id uuid;
  original_rate_snapshot numeric;
  original_created_at timestamptz;
begin
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

  select * into raju_initial_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, raju.id, date '2026-08-25'
  );
  select * into babu_initial_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, babu.id, date '2026-08-25'
  );

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 5),
      jsonb_build_object('soil_worker_id', babu.id::text, 'trolley_quantity', 3.5)
    )
  );

  select * into raju_entry
  from public.soil_daily_trolley_entries
  where factory_id = factory_a_id
    and soil_worker_id = raju.id
    and work_date = date '2026-08-25';
  select * into babu_entry
  from public.soil_daily_trolley_entries
  where factory_id = factory_a_id
    and soil_worker_id = babu.id
    and work_date = date '2026-08-25';

  if (select count(*) from public.soil_daily_trolley_entries
      where factory_id = factory_a_id and work_date = date '2026-08-25') <> 2
    or raju_entry.trolley_quantity <> 5
    or raju_entry.soil_worker_trolley_rate_id <> raju_initial_rate.id
    or raju_entry.rate_per_trolley_snapshot <> 200
    or raju_entry.base_amount_snapshot <> 1000
    or babu_entry.trolley_quantity <> 3.5
    or babu_entry.soil_worker_trolley_rate_id <> babu_initial_rate.id
    or babu_entry.rate_per_trolley_snapshot <> 180
    or babu_entry.base_amount_snapshot <> 630 then
    raise exception 'FAIL: multi-worker initial save or worker-specific snapshots are incorrect';
  end if;
  raise notice 'PASS: one batch records Raju 5 × ₹200 = ₹1,000 and Babu 3.5 × ₹180 = ₹630';

  original_entry_id := raju_entry.id;
  original_rate_id := raju_entry.soil_worker_trolley_rate_id;
  original_rate_snapshot := raju_entry.rate_per_trolley_snapshot;
  original_created_at := raju_entry.created_at;

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-26',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 2)
    )
  );
  if (select count(*) from public.soil_daily_trolley_entries
      where factory_id = factory_a_id and soil_worker_id = raju.id) <> 2
    or (select base_amount_snapshot from public.soil_daily_trolley_entries
        where factory_id = factory_a_id and soil_worker_id = raju.id
          and work_date = date '2026-08-26') <> 400 then
    raise exception 'FAIL: same worker could not be recorded independently on another date';
  end if;
  raise notice 'PASS: one Soil worker can have independent daily rows on different dates';

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-08-25',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 6)
    )
  );
  select * into raju_entry
  from public.soil_daily_trolley_entries
  where factory_id = factory_a_id
    and soil_worker_id = raju.id
    and work_date = date '2026-08-25';

  if raju_entry.id <> original_entry_id
    or raju_entry.trolley_quantity <> 6
    or raju_entry.soil_worker_trolley_rate_id <> original_rate_id
    or raju_entry.rate_per_trolley_snapshot <> original_rate_snapshot
    or raju_entry.base_amount_snapshot <> 1200
    or raju_entry.created_at <> original_created_at
    or raju_entry.updated_at < raju_entry.created_at
    or (select count(*) from public.soil_daily_trolley_entries
        where factory_id = factory_a_id and soil_worker_id = raju.id
          and work_date = date '2026-08-25') <> 1 then
    raise exception 'FAIL: quantity correction did not preserve identity/rate or recompute base amount';
  end if;
  raise notice 'PASS: re-save updates 5 to 6 without duplication and preserves ₹200 to recompute ₹1,200';

  select * into raju_new_rate
  from public.create_soil_worker_trolley_rate(
    factory_a_id, raju.id, 220, date '2026-09-01'
  );
  select * into raju_entry
  from public.soil_daily_trolley_entries
  where id = original_entry_id;
  if raju_entry.rate_per_trolley_snapshot <> 200
    or raju_entry.base_amount_snapshot <> 1200
    or raju_entry.soil_worker_trolley_rate_id <> original_rate_id then
    raise exception 'FAIL: later rate change rewrote an existing daily snapshot';
  end if;

  perform * from public.save_soil_daily_trolley_entries(
    factory_a_id,
    date '2026-09-01',
    jsonb_build_array(
      jsonb_build_object('soil_worker_id', raju.id::text, 'trolley_quantity', 4)
    )
  );
  select * into raju_entry
  from public.soil_daily_trolley_entries
  where factory_id = factory_a_id
    and soil_worker_id = raju.id
    and work_date = date '2026-09-01';
  if raju_entry.soil_worker_trolley_rate_id <> raju_new_rate.id
    or raju_entry.rate_per_trolley_snapshot <> 220
    or raju_entry.base_amount_snapshot <> 880 then
    raise exception 'FAIL: new date did not snapshot the later applicable rate';
  end if;
  raise notice 'PASS: later rate leaves August frozen at ₹200 and a new September row snapshots ₹220';

  perform pg_temp.expect_error(
    'zero trolley quantity fails', '22023',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 0)))',
      factory_a_id, '2026-08-28', 'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'negative trolley quantity fails', '22023',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, -1)))',
      factory_a_id, '2026-08-28', 'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'over-precision trolley quantity fails', '22023',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1.2345)))',
      factory_a_id, '2026-08-28', 'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'malformed trolley quantity fails', '22023',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, %L)))',
      factory_a_id, '2026-08-28', 'soil_worker_id', raju.id::text, 'trolley_quantity', 'NaN'
    )
  );
  perform pg_temp.expect_error(
    'malformed work date fails', '22007',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, %L::date, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, 'not-a-date', 'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'infinite work date fails', '22023',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, %L::date, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, 'infinity', 'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'duplicate worker IDs in one batch fail', '22023',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1), jsonb_build_object(%L, %L, %L, 2)))',
      factory_a_id, '2026-08-28',
      'soil_worker_id', raju.id::text, 'trolley_quantity',
      'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot record Factory B worker', 'P2602',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-08-28', 'soil_worker_id', worker_b_id::text, 'trolley_quantity'
    )
  );

  perform pg_temp.expect_error(
    'missing applicable rate fails the whole batch', 'P2605',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1), jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-08-27',
      'soil_worker_id', babu.id::text, 'trolley_quantity',
      'soil_worker_id', late_worker.id::text, 'trolley_quantity'
    )
  );
  if exists (
    select 1 from public.soil_daily_trolley_entries
    where factory_id = factory_a_id and work_date = date '2026-08-27'
  ) then
    raise exception 'FAIL: invalid batch left a partial daily entry';
  end if;
  raise notice 'PASS: one missing rate rolls back every otherwise-valid row in its batch';

  if exists (select 1 from public.soil_daily_trolley_entries where factory_id = factory_b_id) then
    raise exception 'FAIL: Factory A can read Factory B Soil daily entries';
  end if;

  perform pg_temp.expect_error(
    'direct daily insert is blocked', '42501',
    format(
      'insert into public.soil_daily_trolley_entries (factory_id, soil_worker_id, work_date, trolley_quantity, soil_worker_trolley_rate_id, rate_per_trolley_snapshot, base_amount_snapshot) values (%L::uuid, %L::uuid, date %L, 1, %L::uuid, 200, 200)',
      factory_a_id, raju.id, '2026-08-29', original_rate_id
    )
  );
  perform pg_temp.expect_error(
    'direct daily update is blocked', '42501',
    format(
      'update public.soil_daily_trolley_entries set trolley_quantity = 1 where id = %L::uuid',
      original_entry_id
    )
  );
  perform pg_temp.expect_error(
    'direct daily delete is blocked', '42501',
    format(
      'delete from public.soil_daily_trolley_entries where id = %L::uuid',
      original_entry_id
    )
  );

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_error(
    'unauthenticated daily save is rejected', '42501',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-08-29', 'soil_worker_id', raju.id::text, 'trolley_quantity'
    )
  );
  perform set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

  perform set_config('atlas_test.raju_id', raju.id::text, true);
  perform set_config('atlas_test.raju_initial_rate_id', original_rate_id::text, true);
  perform set_config('atlas_test.raju_entry_id', original_entry_id::text, true);
end;
$$;

reset role;

-- Re-map the same authenticated fixture to Factory B and prove Factory A is hidden.
update public.factory_users
set factory_id = current_setting('atlas_test.factory_b_id')::uuid
where id = current_setting('atlas_test.mapping_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
begin
  if exists (
    select 1 from public.soil_daily_trolley_entries
    where factory_id = factory_a_id
  ) then
    raise exception 'FAIL: authenticated Factory B can read Factory A daily entries';
  end if;
  perform pg_temp.expect_error(
    'Factory B cannot claim Factory A in the batch RPC', '42501',
    format(
      'select * from public.save_soil_daily_trolley_entries(%L::uuid, date %L, jsonb_build_array(jsonb_build_object(%L, %L, %L, 1)))',
      factory_a_id, '2026-08-29', 'soil_worker_id', current_setting('atlas_test.raju_id'), 'trolley_quantity'
    )
  );
  raise notice 'PASS: authenticated Factory B cannot read or save Factory A Soil trolley data';
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  raju_id uuid := current_setting('atlas_test.raju_id')::uuid;
  rate_id uuid := current_setting('atlas_test.raju_initial_rate_id')::uuid;
begin
  perform pg_temp.expect_error(
    'database uniqueness rejects a duplicate worker/date row', '23505',
    format(
      'insert into public.soil_daily_trolley_entries (factory_id, soil_worker_id, work_date, trolley_quantity, soil_worker_trolley_rate_id, rate_per_trolley_snapshot, base_amount_snapshot) values (%L::uuid, %L::uuid, date %L, 1, %L::uuid, 200, 200)',
      factory_a_id, raju_id, '2026-08-25', rate_id
    )
  );
  perform pg_temp.expect_error(
    'database constraint rejects infinite quantity', '23514',
    format(
      'insert into public.soil_daily_trolley_entries (factory_id, soil_worker_id, work_date, trolley_quantity, soil_worker_trolley_rate_id, rate_per_trolley_snapshot, base_amount_snapshot) values (%L::uuid, %L::uuid, date %L, %L::numeric, %L::uuid, 200, %L::numeric)',
      factory_a_id, raju_id, '2026-08-29', 'Infinity', rate_id, 'Infinity'
    )
  );
  perform pg_temp.expect_error(
    'database constraint rejects a client-invented base amount', '23514',
    format(
      'insert into public.soil_daily_trolley_entries (factory_id, soil_worker_id, work_date, trolley_quantity, soil_worker_trolley_rate_id, rate_per_trolley_snapshot, base_amount_snapshot) values (%L::uuid, %L::uuid, date %L, 1, %L::uuid, 200, 999)',
      factory_a_id, raju_id, '2026-08-29', rate_id
    )
  );

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.soil_daily_trolley_entries'::regclass
      and conname = 'soil_daily_trolley_entries_worker_date_key'
      and contype = 'u'
  ) then
    raise exception 'FAIL: daily worker/date uniqueness constraint is missing';
  end if;

  if position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.save_soil_daily_trolley_entries(uuid,date,jsonb)'::regprocedure
    )
  ) = 0 then
    raise exception 'FAIL: batch RPC does not serialize competing saves';
  end if;
  raise notice 'PASS: competing saves are serialized and uniqueness independently prevents duplicates';

  if not exists (
    select 1 from pg_proc
    where oid = 'public.save_soil_daily_trolley_entries(uuid,date,jsonb)'::regprocedure
      and prosecdef
      and array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%'
  ) then
    raise exception 'FAIL: batch RPC security-definer/search-path hardening is incomplete';
  end if;

  if has_table_privilege('authenticated', 'public.soil_daily_trolley_entries', 'INSERT')
    or has_table_privilege('authenticated', 'public.soil_daily_trolley_entries', 'UPDATE')
    or has_table_privilege('authenticated', 'public.soil_daily_trolley_entries', 'DELETE')
    or has_table_privilege('anon', 'public.soil_daily_trolley_entries', 'SELECT') then
    raise exception 'FAIL: unsafe Soil daily table privileges are present';
  end if;

  if to_regprocedure('public.create_soil_worker_with_initial_trolley_rate(uuid,text,numeric,date)') is null
    or to_regprocedure('public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)') is null
    or to_regprocedure('public.resolve_soil_worker_trolley_rate(uuid,uuid,date)') is null then
    raise exception 'FAIL: a T1 Soil worker/rate RPC is missing';
  end if;

  if to_regclass('public.factories') is null
    or to_regclass('public.labourers') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.transport_workers') is null
    or to_regclass('public.staff_workers') is null then
    raise exception 'FAIL: an existing Production, Mud, Transport, or Staff object is missing';
  end if;

  if to_regclass('public.soil_earnings') is not null
    or to_regclass('public.soil_payments') is not null
    or to_regclass('public.soil_adjustments') is not null
    or to_regclass('public.soil_balances') is not null then
    raise exception 'FAIL: a T3+ Soil financial table was created early';
  end if;
  raise notice 'PASS: T1 and existing modules remain intact and no T3+ financial tables exist';
end;
$$;

rollback;
