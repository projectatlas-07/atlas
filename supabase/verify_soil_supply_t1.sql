-- Atlas Soil Supply T1 verifier. Run after migration 20260825000013.
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
    (factory_a_id, format('Soil T1 verifier A %s', factory_a_id)),
    (factory_b_id, format('Soil T1 verifier B %s', factory_b_id));

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
  worker_a public.soil_workers%rowtype;
  initial_rate public.soil_worker_trolley_rates%rowtype;
  initial_rate_after public.soil_worker_trolley_rates%rowtype;
  future_rate public.soil_worker_trolley_rates%rowtype;
  resolved_rate public.soil_worker_trolley_rates%rowtype;
  initial_rate_id uuid;
  initial_rate_amount numeric;
  initial_rate_start date;
  initial_rate_created_at timestamptz;
begin
  select * into worker_a
  from public.create_soil_worker_with_initial_trolley_rate(
    factory_a_id,
    '  Raju   Kumar  ',
    200,
    date '2026-08-01'
  );

  select * into initial_rate
  from public.soil_worker_trolley_rates
  where factory_id = factory_a_id
    and soil_worker_id = worker_a.id;

  if worker_a.name <> 'Raju Kumar'
    or not worker_a.is_active
    or initial_rate.rate_per_trolley <> 200
    or initial_rate.effective_from <> date '2026-08-01'
    or initial_rate.effective_to is not null
    or initial_rate.factory_id <> worker_a.factory_id
    or initial_rate.soil_worker_id <> worker_a.id
    or (select count(*) from public.soil_workers where id = worker_a.id) <> 1
    or (select count(*) from public.soil_worker_trolley_rates
        where soil_worker_id = worker_a.id) <> 1 then
    raise exception 'FAIL: atomic Soil worker and initial-rate creation is incorrect';
  end if;
  raise notice 'PASS: Factory A created one normalized Soil worker atomically with one ₹200 initial rate';

  initial_rate_id := initial_rate.id;
  initial_rate_amount := initial_rate.rate_per_trolley;
  initial_rate_start := initial_rate.effective_from;
  initial_rate_created_at := initial_rate.created_at;

  select * into future_rate
  from public.create_soil_worker_trolley_rate(
    factory_a_id,
    worker_a.id,
    220,
    date '2026-09-01'
  );

  select * into initial_rate_after
  from public.soil_worker_trolley_rates
  where id = initial_rate_id;

  if future_rate.rate_per_trolley <> 220
    or future_rate.effective_from <> date '2026-09-01'
    or future_rate.effective_to is not null
    or initial_rate_after.id <> initial_rate_id
    or initial_rate_after.rate_per_trolley <> initial_rate_amount
    or initial_rate_after.effective_from <> initial_rate_start
    or initial_rate_after.created_at <> initial_rate_created_at
    or initial_rate_after.effective_to <> date '2026-08-31'
    or (select count(*) from public.soil_worker_trolley_rates
        where soil_worker_id = worker_a.id) <> 2 then
    raise exception 'FAIL: future rate did not preserve and close the preceding historical period';
  end if;
  raise notice 'PASS: ₹220 future rate closes only the prior boundary; historical ID, amount, start, and timestamp remain stable';

  select * into resolved_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, worker_a.id, date '2026-08-25'
  );
  if resolved_rate.id <> initial_rate_id or resolved_rate.rate_per_trolley <> 200 then
    raise exception 'FAIL: 2026-08-25 did not deterministically resolve ₹200';
  end if;

  select * into resolved_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, worker_a.id, date '2026-08-31'
  );
  if resolved_rate.id <> initial_rate_id or resolved_rate.rate_per_trolley <> 200 then
    raise exception 'FAIL: old rate end boundary did not resolve ₹200';
  end if;

  select * into resolved_rate
  from public.resolve_soil_worker_trolley_rate(
    factory_a_id, worker_a.id, date '2026-09-01'
  );
  if resolved_rate.id <> future_rate.id or resolved_rate.rate_per_trolley <> 220 then
    raise exception 'FAIL: 2026-09-01 did not deterministically resolve ₹220';
  end if;
  raise notice 'PASS: rate resolution returns ₹200 through 31 Aug and ₹220 from 1 Sep';

  perform pg_temp.expect_error(
    'a zero initial rate fails', '22023',
    format(
      'select public.create_soil_worker_with_initial_trolley_rate(%L::uuid, %L, 0, date %L)',
      factory_a_id, 'Atomic Zero Failure', '2026-08-01'
    )
  );
  if exists (
    select 1 from public.soil_workers
    where factory_id = factory_a_id and name = 'Atomic Zero Failure'
  ) then
    raise exception 'FAIL: failed initial-rate creation left a partial Soil worker';
  end if;
  raise notice 'PASS: invalid initial rate leaves no partially created worker';

  perform pg_temp.expect_error(
    'a negative replacement rate fails', '22023',
    format(
      'select public.create_soil_worker_trolley_rate(%L::uuid, %L::uuid, -1, date %L)',
      factory_a_id, worker_a.id, '2026-10-01'
    )
  );
  perform pg_temp.expect_error(
    'a malformed effective date fails', '22007',
    format(
      'select public.create_soil_worker_trolley_rate(%L::uuid, %L::uuid, 230, %L::date)',
      factory_a_id, worker_a.id, 'not-a-date'
    )
  );
  perform pg_temp.expect_error(
    'an infinite effective date fails', '22023',
    format(
      'select public.create_soil_worker_trolley_rate(%L::uuid, %L::uuid, 230, %L::date)',
      factory_a_id, worker_a.id, 'infinity'
    )
  );
  perform pg_temp.expect_error(
    'a null resolution date fails', '22023',
    format(
      'select public.resolve_soil_worker_trolley_rate(%L::uuid, %L::uuid, null)',
      factory_a_id, worker_a.id
    )
  );
  perform pg_temp.expect_error(
    'a date before initial coverage has no rate', 'P2605',
    format(
      'select public.resolve_soil_worker_trolley_rate(%L::uuid, %L::uuid, date %L)',
      factory_a_id, worker_a.id, '2026-07-31'
    )
  );

  perform pg_temp.expect_error(
    'a competing duplicate rate start is rejected', 'P2603',
    format(
      'select public.create_soil_worker_trolley_rate(%L::uuid, %L::uuid, 221, date %L)',
      factory_a_id, worker_a.id, '2026-09-01'
    )
  );
  if (select count(*) from public.soil_worker_trolley_rates
      where soil_worker_id = worker_a.id) <> 2 then
    raise exception 'FAIL: competing rate attempt changed rate history';
  end if;

  perform pg_temp.expect_error(
    'Factory A cannot add a rate to Factory B worker', 'P2602',
    format(
      'select public.create_soil_worker_trolley_rate(%L::uuid, %L::uuid, 1, date %L)',
      factory_a_id, worker_b_id, '2026-09-01'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot resolve Factory B worker rate', 'P2602',
    format(
      'select public.resolve_soil_worker_trolley_rate(%L::uuid, %L::uuid, date %L)',
      factory_a_id, worker_b_id, '2026-08-25'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot claim Factory B for worker creation', '42501',
    format(
      'select public.create_soil_worker_with_initial_trolley_rate(%L::uuid, %L, 1, date %L)',
      factory_b_id, 'No Access', '2026-08-01'
    )
  );

  if exists (select 1 from public.soil_workers where id = worker_b_id)
    or exists (
      select 1 from public.soil_worker_trolley_rates
      where soil_worker_id = worker_b_id
    ) then
    raise exception 'FAIL: Factory A can read Factory B Soil data';
  end if;
  raise notice 'PASS: Factory B Soil workers and rates are hidden and cannot be mutated by Factory A';

  perform pg_temp.expect_error(
    'direct Soil worker insert is blocked', '42501',
    format(
      'insert into public.soil_workers (factory_id, name) values (%L::uuid, %L)',
      factory_a_id, 'Unsafe Direct Worker'
    )
  );
  perform pg_temp.expect_error(
    'direct Soil worker update is blocked', '42501',
    format(
      'update public.soil_workers set name = %L where id = %L::uuid',
      'Unsafe Rename', worker_a.id
    )
  );
  perform pg_temp.expect_error(
    'direct Soil worker delete is blocked', '42501',
    format('delete from public.soil_workers where id = %L::uuid', worker_a.id)
  );
  perform pg_temp.expect_error(
    'direct Soil rate insert is blocked', '42501',
    format(
      'insert into public.soil_worker_trolley_rates (factory_id, soil_worker_id, rate_per_trolley, effective_from) values (%L::uuid, %L::uuid, 1, date %L)',
      factory_a_id, worker_a.id, '2026-10-01'
    )
  );
  perform pg_temp.expect_error(
    'direct Soil rate update is blocked', '42501',
    format(
      'update public.soil_worker_trolley_rates set rate_per_trolley = 1 where id = %L::uuid',
      initial_rate_id
    )
  );
  perform pg_temp.expect_error(
    'direct Soil rate delete is blocked', '42501',
    format(
      'delete from public.soil_worker_trolley_rates where id = %L::uuid',
      initial_rate_id
    )
  );
  raise notice 'PASS: authenticated clients have read-only table access; controlled writes use RPCs';

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_error(
    'an unauthenticated RPC call is rejected', '42501',
    format(
      'select public.create_soil_worker_with_initial_trolley_rate(%L::uuid, %L, 1, date %L)',
      factory_a_id, 'No Session', '2026-08-01'
    )
  );
  perform set_config(
    'request.jwt.claim.sub',
    current_setting('atlas_test.user_id'),
    true
  );

  perform set_config('atlas_test.worker_a_id', worker_a.id::text, true);
  perform set_config('atlas_test.initial_rate_id', initial_rate_id::text, true);
end;
$$;

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  worker_a_id uuid := current_setting('atlas_test.worker_a_id')::uuid;
  worker_b_id uuid := current_setting('atlas_test.worker_b_id')::uuid;
begin
  perform pg_temp.expect_error(
    'database exclusion constraint rejects an overlapping historical period',
    '23P01',
    format(
      'insert into public.soil_worker_trolley_rates (factory_id, soil_worker_id, rate_per_trolley, effective_from, effective_to) values (%L::uuid, %L::uuid, 210, date %L, date %L)',
      factory_a_id, worker_a_id, '2026-08-15', '2026-09-15'
    )
  );
  perform pg_temp.expect_error(
    'composite foreign key rejects a Factory A rate for Factory B worker',
    '23503',
    format(
      'insert into public.soil_worker_trolley_rates (factory_id, soil_worker_id, rate_per_trolley, effective_from, effective_to) values (%L::uuid, %L::uuid, 1, date %L, date %L)',
      factory_a_id, worker_b_id, '2026-07-01', '2026-07-31'
    )
  );
  perform pg_temp.expect_error(
    'worker delete cannot orphan trolley rates',
    '23503',
    format('delete from public.soil_workers where id = %L::uuid', worker_a_id)
  );

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.soil_worker_trolley_rates'::regclass
      and conname = 'soil_worker_trolley_rates_no_overlapping_dates'
      and contype = 'x'
  ) then
    raise exception 'FAIL: Soil rate exclusion constraint is missing';
  end if;

  if position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)'::regprocedure
    )
  ) = 0 then
    raise exception 'FAIL: Soil replacement-rate RPC does not serialize worker writes';
  end if;
  raise notice 'PASS: competing writes are serialized per worker and independently guarded by the exclusion constraint';

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.create_soil_worker_with_initial_trolley_rate(uuid,text,numeric,date)'::regprocedure
      and prosecdef
      and array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%'
  ) or not exists (
    select 1
    from pg_proc
    where oid = 'public.create_soil_worker_trolley_rate(uuid,uuid,numeric,date)'::regprocedure
      and prosecdef
      and array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%'
  ) or not exists (
    select 1
    from pg_proc
    where oid = 'public.resolve_soil_worker_trolley_rate(uuid,uuid,date)'::regprocedure
      and prosecdef
      and array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%'
  ) then
    raise exception 'FAIL: Soil RPC security-definer/search-path hardening is incomplete';
  end if;

  if has_table_privilege('authenticated', 'public.soil_workers', 'INSERT')
    or has_table_privilege('authenticated', 'public.soil_workers', 'UPDATE')
    or has_table_privilege('authenticated', 'public.soil_workers', 'DELETE')
    or has_table_privilege('authenticated', 'public.soil_worker_trolley_rates', 'INSERT')
    or has_table_privilege('authenticated', 'public.soil_worker_trolley_rates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.soil_worker_trolley_rates', 'DELETE')
    or has_table_privilege('anon', 'public.soil_workers', 'SELECT')
    or has_table_privilege('anon', 'public.soil_worker_trolley_rates', 'SELECT') then
    raise exception 'FAIL: unsafe Soil table privileges are present';
  end if;
  raise notice 'PASS: RPC hardening, RLS grants, and direct mutation permissions are correct';

  if to_regclass('public.factories') is null
    or to_regclass('public.labourers') is null
    or to_regclass('public.wage_rates') is null
    or to_regclass('public.transport_workers') is null
    or to_regclass('public.staff_workers') is null then
    raise exception 'FAIL: an existing Production, Mud, Transport, or Staff object is missing';
  end if;

  if to_regclass('public.soil_trolley_entries') is not null
    or to_regclass('public.soil_earnings') is not null
    or to_regclass('public.soil_payments') is not null
    or to_regclass('public.soil_adjustments') is not null then
    raise exception 'FAIL: a post-T1 Soil object was created early';
  end if;
  raise notice 'PASS: existing modules remain intact and no T2+ Soil financial/entry tables exist';
end;
$$;

rollback;
