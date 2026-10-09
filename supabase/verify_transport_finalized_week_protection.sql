-- Atlas Security 12D1.5D2A: POST-POLICY sequential Transport protection proof.
-- PREPARED ONLY. Execute on Test after migration 75 is reviewed/applied.
-- Run: npx supabase db query --linked --file supabase/verify_transport_finalized_week_protection.sql --output json
-- Separate from the immutable PRE-POLICY verifier and read-only drift diagnostic.
-- Synthetic fixtures only, one outer ROLLBACK, no disabled triggers/history deletes.
-- A private fixture subtransaction is deliberately rolled back before asserting
-- all 63 public tables/auth.users counts AND fingerprints match the baseline.
-- Also compare independent read-only snapshots after the outer ROLLBACK when run.
-- Sequential results do NOT prove simultaneous-session locking/deadlock freedom.
-- 12D1.5D and correction credits in 12D1.5E are ONE RELEASE UNIT:
-- never promote the freeze alone to Main. Main is not authorized here.
begin;

create function pg_temp.require(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end;
$$;

create function pg_temp.assert_identity(expected_user uuid, factory uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.require(current_user = 'authenticated'
    and auth.uid() is not distinct from expected_user,
    'authenticated role and exact synthetic auth.uid()');
  perform pg_temp.require(exists(select 1 from public.factory_users m
    where m.user_id = expected_user and m.factory_id = factory and m.is_active),
    'active synthetic factory membership visible through RLS');
end;
$$;

create function pg_temp.persistent_snapshot(excluded_factory uuid default null,
  excluded_user uuid default null) returns jsonb language plpgsql as $$
declare t record; n bigint; digest text; result jsonb := '{}';
begin
  perform pg_temp.require((select count(*) from pg_catalog.pg_tables
    where schemaname = 'public') = 63, 'exactly 63 public tables');
  for t in select schemaname, tablename from pg_catalog.pg_tables
    where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')
    order by schemaname, tablename
  loop
    execute format('select count(*), md5(coalesce(string_agg(h, '''' order by h), ''''))
      from (select md5(to_jsonb(r)::text) h from %I.%I r
        where ($1 is null or (coalesce(to_jsonb(r)->>''factory_id'', '''') <> $1::text
          and coalesce(to_jsonb(r)->>''id'', '''') <> $1::text))
        and ($2 is null or coalesce(to_jsonb(r)->>''id'', '''') <> $2::text)) s',
      t.schemaname, t.tablename) into n, digest using excluded_factory, excluded_user;
    result := result || jsonb_build_object(t.schemaname || '.' || t.tablename,
      jsonb_build_object('count', n, 'fingerprint', digest));
  end loop;
  return result;
end;
$$;

create function pg_temp.fixture_residue(ids uuid[]) returns jsonb
language plpgsql as $$
declare t record; n bigint; result jsonb := '{}';
begin
  for t in select schemaname, tablename from pg_catalog.pg_tables
    where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')
    order by schemaname, tablename
  loop
    execute format('select count(*) from %I.%I r
      where to_jsonb(r)->>''id'' = any($1)
        or to_jsonb(r)->>''factory_id'' = any($1)
        or to_jsonb(r)->>''user_id'' = any($1)', t.schemaname, t.tablename)
      into n using ids::text[];
    if n <> 0 then
      result := result || jsonb_build_object(t.schemaname || '.' || t.tablename, n);
    end if;
  end loop;
  return result;
end;
$$;

create function pg_temp.scoped_snapshot(factory uuid, tables text[]) returns jsonb
language plpgsql as $$
declare t text; n bigint; digest text; result jsonb := '{}';
begin
  foreach t in array tables loop
    execute format('select count(*), md5(coalesce(string_agg(h, '''' order by h), ''''))
      from (select md5(to_jsonb(r)::text) h from public.%I r where factory_id = $1) s', t)
      into n, digest using factory;
    result := result || jsonb_build_object(t, jsonb_build_object('count', n, 'fingerprint', digest));
  end loop;
  return result;
end;
$$;

create function pg_temp.payable_totals(factory uuid, ws date) returns jsonb
language plpgsql as $$
declare w record; b record; result jsonb := '{}';
begin
  for w in select id from public.transport_workers where factory_id = factory order by id loop
    select * into strict b from public.get_transport_worker_available_balance(factory, w.id, ws + 6);
    result := result || jsonb_build_object(w.id::text,
      jsonb_build_object('earned', b.total_earned::text, 'withdrawn', b.total_withdrawn::text,
        'available', b.available_balance::text));
  end loop;
  return result;
end;
$$;

-- Catch ONLY the exact expected rejection; any other exception fails the proof.
create function pg_temp.expect_rpc_error(statement text, expected_state text,
  expected_message text) returns jsonb language plpgsql as $$
declare actual_state text; actual_message text;
begin
  begin
    execute statement;
    raise exception using errcode = 'Z15D1', message = 'FAIL: expected RPC rejection did not occur';
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate, actual_message = message_text;
    if actual_state is distinct from expected_state
      or actual_message is distinct from expected_message then raise; end if;
  end;
  return jsonb_build_object('sqlstate', actual_state, 'message', actual_message);
end;
$$;

-- Immediate post-rejection checks, not merely relying on the eventual ROLLBACK.
create function pg_temp.protected_rejection(label text, statement text,
  expected_state text, expected_message text, u uuid, f uuid, ws date)
returns jsonb language plpgsql as $$
declare before_sources jsonb; before_financial jsonb; before_payable jsonb; response jsonb;
begin
  perform pg_temp.assert_identity(u, f);
  before_sources := pg_temp.scoped_snapshot(f, array['transport_daily_entries',
    'transport_daily_attendance', 'transport_crew_wage_rates', 'transport_crew_assignments']);
  before_financial := pg_temp.scoped_snapshot(f, array['transport_weekly_earnings',
    'transport_weekly_earning_details', 'transport_withdrawals']);
  before_payable := pg_temp.payable_totals(f, ws);
  response := pg_temp.expect_rpc_error(statement, expected_state, expected_message);
  perform pg_temp.assert_identity(u, f);
  perform pg_temp.require(before_sources = pg_temp.scoped_snapshot(f,
    array['transport_daily_entries', 'transport_daily_attendance',
      'transport_crew_wage_rates', 'transport_crew_assignments']),
    label || ': no changed quantity/attendance/rate periods/new source residue');
  perform pg_temp.require(before_financial = pg_temp.scoped_snapshot(f,
    array['transport_weekly_earnings', 'transport_weekly_earning_details', 'transport_withdrawals']),
    label || ': every financial row unchanged');
  perform pg_temp.require(before_payable = pg_temp.payable_totals(f, ws),
    label || ': authoritative balances unchanged');
  return jsonb_build_object('case', label, 'result', 'PASS', 'rejection', response,
    'immediate_atomicity_checks', true, 'source_and_financial_fingerprints_unchanged', true);
end;
$$;

do $proof$
declare
  u uuid := '12d15d20-0000-4000-8000-000000000001';
  f uuid := '12d15d20-0000-4000-8000-000000000002';
  outsider uuid := '12d15d20-0000-4000-8000-000000000003';
  other_factory uuid := '12d15d20-0000-4000-8000-000000000004';
  workers uuid[] := array['12d15d20-0000-4000-8000-000000000010'::uuid,
    '12d15d20-0000-4000-8000-000000000011'::uuid,
    '12d15d20-0000-4000-8000-000000000012'::uuid,
    '12d15d20-0000-4000-8000-000000000013'::uuid,
    '12d15d20-0000-4000-8000-000000000014'::uuid];
  ca uuid := '12d15d20-0000-4000-8000-000000000020';
  cb uuid := '12d15d20-0000-4000-8000-000000000021';
  cc uuid := '12d15d20-0000-4000-8000-000000000022';
  foreign_crew uuid := '12d15d20-0000-4000-8000-000000000030';
  foreign_worker uuid := '12d15d20-0000-4000-8000-000000000031';
  ws date := date_trunc('week', (now() at time zone 'Asia/Kolkata')::date)::date - 21;
  reserved uuid[]; generated uuid[]; ids uuid[]; entry_ids uuid[] := '{}'; rates uuid[] := '{}';
  baseline jsonb; clean jsonb; non_synthetic_baseline jsonb;
  cases jsonb := '[]'; controls jsonb := '[]'; saved jsonb; payable jsonb;
  r record; b record; fn record; sig text; source text; answer jsonb;
  partial_entry uuid; partial_header uuid; ordinary_entry uuid; worker uuid;
  caller name := current_user;
begin
  reserved := array[u, f, outsider, other_factory, ca, cb, cc, foreign_crew, foreign_worker] || workers;
  ids := reserved;
  perform pg_temp.require(caller <> 'authenticated' and auth.uid() is null,
    'privileged setup with no inherited user JWT');
  baseline := pg_temp.persistent_snapshot();
  perform pg_temp.require(pg_temp.fixture_residue(reserved) = '{}'::jsonb,
    'all reserved synthetic identifiers absent before setup');

  -- Fail before fixtures if any approved RPC loses its security/lock contract.
  foreach sig in array array[
    'public.calculate_transport_weekly_wages(uuid,date)',
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])',
    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'
  ] loop
    select p.* into strict fn from pg_catalog.pg_proc p where p.oid = sig::regprocedure;
    source := pg_catalog.pg_get_functiondef(fn.oid);
    perform pg_temp.require(fn.prosecdef and fn.provolatile = 'v'
      and fn.proconfig @> array['search_path=pg_catalog, public'],
      sig || ': SECURITY DEFINER, volatile and fixed search_path');
    perform pg_temp.require(has_function_privilege('authenticated', fn.oid, 'EXECUTE')
      and not has_function_privilege('anon', fn.oid, 'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner)))
        where grantee = 0 and privilege_type = 'EXECUTE'),
      sig || ': authenticated EXECUTE and no PUBLIC/anon EXECUTE');
    perform pg_temp.require(
      position('atlas:transport_source_accounting:' in source) > 0
      and position('atlas:transport_source_accounting:' in source)
        < position('  perform pg_advisory_xact_lock(' in source),
      sig || ': new common lock precedes preserved operation advisory lock');
  end loop;

  begin
    -- Root-only synthetic foundation; actual Transport operations run authenticated.
    insert into auth.users(id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (u, 'authenticated', 'authenticated', 'atlas-12d15d2-owner@example.invalid', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now()),
      (outsider, 'authenticated', 'authenticated', 'atlas-12d15d2-other@example.invalid', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into public.factories(id, name)
      values(f, 'Atlas 12D1.5D2 synthetic Transport'), (other_factory, 'Atlas 12D1.5D2 other factory');
    insert into public.factory_users(user_id, factory_id, is_active)
      values(u, f, true), (outsider, other_factory, true);
    insert into public.transport_crews(id, factory_id, name)
      values(foreign_crew, other_factory, 'Synthetic foreign crew');
    insert into public.transport_workers(id, factory_id, name)
      values(foreign_worker, other_factory, 'Synthetic foreign worker');
    -- The other-factory fixtures are deliberately included in this baseline:
    -- they and every non-synthetic row must remain unchanged during main tests.
    non_synthetic_baseline := pg_temp.persistent_snapshot(f, u);

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.assert_identity(u, f);
    insert into public.transport_workers(id, factory_id, name)
      select x, f, 'Synthetic worker ' || ord from unnest(workers) with ordinality w(x, ord);
    insert into public.transport_crews(id, factory_id, name)
      values(ca, f, 'Synthetic crew A'), (cb, f, 'Synthetic crew B'), (cc, f, 'Synthetic unrelated crew');
    insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
      select f, worker_id, crew_id from unnest(workers) w(worker_id)
        cross join unnest(array[ca, cb, cc]) c(crew_id);

    select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws - 14, 800);
    rates := rates || r.id;
    select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws + 2, 900);
    rates := rates || r.id;
    select * into strict r from public.create_transport_crew_wage_rate(f, cb, ws - 14, 1000);
    rates := rates || r.id;
    select * into strict r from public.create_transport_crew_wage_rate(f, cc, ws - 14, 700);
    rates := rates || r.id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws, 2.5, workers[1:2]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 1, 1, array[workers[1]]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 3, 2, workers[1:2]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, cb, ws + 4, 1,
      array[workers[1], workers[3], workers[4]]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, cb, ws + 5, 1, array[workers[3]]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.calculate_transport_weekly_wages(f, ws);
    perform pg_temp.require(r.workers_calculated = 4 and r.detail_rows_created = 9 and r.rows_skipped = 0,
      'K: four calculated workers and nine exact details');
    perform pg_temp.require(not exists(
      select 1 from (values
        (entry_ids[1], ca, ws, rates[1], 800::numeric, 2.5::numeric, 2, 2000::numeric),
        (entry_ids[2], ca, ws + 1, rates[1], 800::numeric, 1::numeric, 1, 800::numeric),
        (entry_ids[3], ca, ws + 3, rates[2], 900::numeric, 2::numeric, 2, 1800::numeric),
        (entry_ids[4], cb, ws + 4, rates[3], 1000::numeric, 1::numeric, 3, 1000::numeric),
        (entry_ids[5], cb, ws + 5, rates[3], 1000::numeric, 1::numeric, 1, 1000::numeric)
      ) expected(entry, crew, day, rate_id, rate, quantity, attendance, pool)
      left join lateral (select count(*) n, bool_and(
        d.factory_id = f and d.week_start = ws and d.transport_crew_id = expected.crew
        and d.work_date = expected.day and d.transport_crew_wage_rate_id = expected.rate_id
        and d.rate_per_paya_snapshot = expected.rate and d.paya_quantity_snapshot = expected.quantity
        and d.attendance_count_snapshot = expected.attendance and d.daily_crew_pool_snapshot = expected.pool
        and d.worker_daily_share_snapshot = expected.pool / expected.attendance
        and exists(select 1 from public.transport_daily_attendance a
          where a.factory_id = f and a.transport_daily_entry_id = expected.entry
            and a.transport_worker_id = d.transport_worker_id)
      ) exact from public.transport_weekly_earning_details d
        where d.factory_id = f and d.transport_daily_entry_id = expected.entry) actual on true
      where actual.n <> expected.attendance or actual.exact is distinct from true),
      'K: exact recorded attendance/rate/quantity/share snapshots; no rounding');
    perform pg_temp.require(not exists(select 1 from public.transport_weekly_earnings h
      left join lateral (select sum(d.worker_daily_share_snapshot) amount, count(*) n
        from public.transport_weekly_earning_details d
        where d.factory_id = h.factory_id and d.transport_weekly_earning_id = h.id
          and d.transport_worker_id = h.transport_worker_id and d.week_start = h.week_start) s on true
      where h.factory_id = f and h.week_start = ws and (s.n = 0 or h.total_amount is distinct from s.amount)),
      'K: exact header/detail reconciliation, including missing details');
    perform pg_temp.require(not exists(select 1 from
      (values(workers[1], 2700 + 1000::numeric / 3), (workers[2], 1900::numeric),
        (workers[3], 1000 + 1000::numeric / 3), (workers[4], 1000::numeric / 3)) expected(worker, amount)
      left join public.transport_weekly_earnings h on h.factory_id = f
        and h.week_start = ws and h.transport_worker_id = expected.worker
      where h.total_amount is distinct from expected.amount), 'K: exact expected per-worker totals');
    perform pg_temp.require((select sum(pool) from (
      select min(daily_crew_pool_snapshot) pool from public.transport_weekly_earning_details
      where factory_id = f and week_start = ws group by transport_daily_entry_id) pools) = 6600,
      'K: five distinct crew pools, not nine repeated pools');
    foreach worker in array workers[1:4] loop
      select * into strict b from public.get_transport_worker_available_balance(f, worker, ws + 5);
      perform pg_temp.require(b.total_earned = 0 and b.total_withdrawn = 0 and b.available_balance = 0,
        'K: Saturday excludes main-week earnings');
      select * into strict b from public.get_transport_worker_available_balance(f, worker, ws + 6);
      perform pg_temp.require(b.total_earned = (select total_amount from public.transport_weekly_earnings
        where factory_id = f and transport_worker_id = worker and week_start = ws)
        and b.total_withdrawn = 0 and b.available_balance = b.total_earned,
        'K: Sunday includes exact saved header amount');
    end loop;
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'K_RECONCILIATION',
      'result', 'PASS', 'workers', 4, 'details', 9, 'distinct_crew_pool_total', '6600',
      'fractional_division_residual', (6600 - (select sum(total_amount)
        from public.transport_weekly_earnings where factory_id = f and week_start = ws))::text));
    saved := pg_temp.scoped_snapshot(f, array['transport_weekly_earnings', 'transport_weekly_earning_details']);
    payable := pg_temp.payable_totals(f, ws);

    cases := cases || jsonb_build_array(pg_temp.protected_rejection('A_FINALIZED_QUANTITY',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,3.5,%L::uuid[])',
        f, ca, ws, workers[1:2]), 'P2621', 'ATLAS_TRANSPORT_WEEK_FINALIZED', u, f, ws));
    cases := cases || jsonb_build_array(pg_temp.protected_rejection('B_FINALIZED_ATTENDANCE',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,2,%L::uuid[])',
        f, ca, ws + 3, array[workers[1]]), 'P2621', 'ATLAS_TRANSPORT_WEEK_FINALIZED', u, f, ws));
    -- A new crew and worker have no header/detail in this otherwise finalized week.
    perform pg_temp.require(not exists(select 1 from public.transport_weekly_earnings
      where factory_id = f and week_start = ws and transport_worker_id = workers[5]),
      'C: new worker genuinely has no main-week header');
    cases := cases || jsonb_build_array(pg_temp.protected_rejection('C_NEW_FINALIZED_ENTRY',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,2,%L::uuid[])',
        f, cc, ws + 6, array[workers[5]]), 'P2621', 'ATLAS_TRANSPORT_WEEK_FINALIZED', u, f, ws));
    cases := cases || jsonb_build_array(pg_temp.protected_rejection('D_HISTORICAL_RATE',
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,1100)',
        f, ca, ws + 3), 'P2622', 'ATLAS_TRANSPORT_RATE_AFFECTS_FINALIZED_EARNINGS', u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('RATE_IDENTITY_ONLY',
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,900)',
        f, ca, ws + 3), 'P2622', 'ATLAS_TRANSPORT_RATE_AFFECTS_FINALIZED_EARNINGS', u, f, ws));

    select * into strict r from public.create_transport_crew_wage_rate(f, cc, ws + 2, 750);
    perform pg_temp.require(r.factory_id = f and r.transport_crew_id = cc
      and r.effective_from = ws + 2 and r.rate_per_paya = 750
      and (select effective_to from public.transport_crew_wage_rates where id = rates[4]) = ws + 1,
      'E: unrelated crew replacement accepted with correct period closure');
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'E_UNRELATED_CREW_RATE', 'result', 'PASS'));
    -- Same finalized week, but AFTER this crew's last saved work date. This must
    -- be allowed: using the whole Sunday cutoff would reject it unnecessarily.
    select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws + 4, 1100);
    perform pg_temp.require(r.factory_id = f and r.transport_crew_id = ca
      and r.effective_from = ws + 4 and r.rate_per_paya = 1100 and r.effective_to is null
      and (select effective_to from public.transport_crew_wage_rates where id = rates[2]) = ws + 3,
      'F: safe later rate inside same week accepted; saved last-day rate preserved');
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'F_SAFE_LATER_RATE', 'result', 'PASS'));
    perform pg_temp.require(saved = pg_temp.scoped_snapshot(f,
      array['transport_weekly_earnings', 'transport_weekly_earning_details'])
      and payable = pg_temp.payable_totals(f, ws),
      'J: rejected writes and accepted safe rates leave every saved earning/detail/balance unchanged');
    select * into strict r from public.calculate_transport_weekly_wages(f, ws);
    perform pg_temp.require(r.workers_calculated = 0 and r.detail_rows_created = 0 and r.rows_skipped = 4
      and saved = pg_temp.scoped_snapshot(f, array['transport_weekly_earnings', 'transport_weekly_earning_details']),
      'J: replay skips whole week without rewriting immutable history');
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'J_FINANCIAL_IMMUTABILITY',
      'result', 'PASS', 'whole_week_replay_skipped', 4, 'immediate_rejection_checks', true));

    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 7, 1, array[workers[1]]);
    ordinary_entry := r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 7, 2, workers[1:2]);
    perform pg_temp.require(r.daily_entry_id = ordinary_entry and r.saved_paya_quantity = 2
      and r.attendance_count = 2 and (select paya_quantity from public.transport_daily_entries
        where id = ordinary_entry and factory_id = f) = 2
      and (select count(*) from public.transport_daily_attendance
        where factory_id = f and transport_daily_entry_id = ordinary_entry) = 2
      and not exists(select 1 from public.transport_weekly_earnings
        where factory_id = f and week_start = ws + 7),
      'G: completed but uncalculated week allows both quantity and attendance correction');
    select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws + 9, 1200);
    perform pg_temp.require(r.effective_from = ws + 9 and r.rate_per_paya = 1200,
      'G: unfinalized midweek rate change remains accepted');
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'G_UNCALCULATED_EDITABLE', 'result', 'PASS'));

    select * into strict r from public.calculate_transport_weekly_wages(f, ws + 14);
    perform pg_temp.require(r.workers_calculated = 0 and r.detail_rows_created = 0 and r.rows_skipped = 0
      and not exists(select 1 from public.transport_weekly_earnings
        where factory_id = f and week_start = ws + 14), 'H: no-work calculation creates no finalization headers');
    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 14, 1, array[workers[1]]);
    perform pg_temp.require(r.saved_paya_quantity = 1 and r.attendance_count = 1,
      'H: ordinary new source save remains possible after no-work calculation');
    select * into strict r from public.calculate_transport_weekly_wages(f, ws + 14);
    perform pg_temp.require(r.workers_calculated = 1 and r.detail_rows_created = 1 and r.rows_skipped = 0,
      'H: new source then calculates normally');
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'H_NO_WORK_NOT_FINALIZED', 'result', 'PASS'));

    -- Model partial history through valid synthetic root INSERTS only. Never
    -- create a full week then delete immutable history to manufacture this case.
    select * into strict r from public.save_transport_daily_entry(f, ca, ws - 7, 1,
      array[workers[1], workers[5]]);
    partial_entry := r.daily_entry_id;
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    insert into public.transport_weekly_earnings(factory_id, transport_worker_id, week_start, total_amount)
      values(f, workers[1], ws - 7, 400) returning id into partial_header;
    insert into public.transport_weekly_earning_details(factory_id, transport_weekly_earning_id,
      transport_worker_id, week_start, transport_daily_entry_id, transport_crew_id, work_date,
      transport_crew_wage_rate_id, rate_per_paya_snapshot, paya_quantity_snapshot,
      attendance_count_snapshot, daily_crew_pool_snapshot, worker_daily_share_snapshot)
      values(f, partial_header, workers[1], ws - 7, partial_entry, ca, ws - 7,
        rates[1], 800, 1, 2, 800, 400);
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.require((select count(*) from public.transport_weekly_earnings
      where factory_id = f and week_start = ws - 7) = 1
      and not exists(select 1 from public.transport_weekly_earnings where factory_id = f
        and week_start = ws - 7 and transport_worker_id = workers[5]), 'I: genuine partial-header fixture');
    answer := pg_temp.protected_rejection('I_PARTIAL_WEEK_EXISTING_SOURCE',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,2,%L::uuid[])',
        f, ca, ws - 7, array[workers[5]]), 'P2621', 'ATLAS_TRANSPORT_WEEK_FINALIZED', u, f, ws);
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('PARTIAL_WEEK_NEW_CREW_WORKER',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,1,%L::uuid[])',
        f, cc, ws - 1, array[workers[5]]), 'P2621', 'ATLAS_TRANSPORT_WEEK_FINALIZED', u, f, ws));
    select * into strict r from public.calculate_transport_weekly_wages(f, ws - 7);
    perform pg_temp.require(r.workers_calculated = 0 and r.detail_rows_created = 0 and r.rows_skipped = 1,
      'I: partial-header replay remains whole-week skip, not history repair');
    cases := cases || jsonb_build_array(answer || jsonb_build_object('whole_week_replay_skipped', 1));

    -- Factory isolation, child IDs and ordinary validation errors remain intact.
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('FOREIGN_CREW',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,1,%L::uuid[])',
        f, foreign_crew, ws, array[workers[1]]), '42501', 'Transport crew does not belong to this factory.', u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('FOREIGN_WORKER',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,1,%L::uuid[])',
        f, ca, ws, array[foreign_worker]), '42501', 'One or more transport workers do not belong to this factory.', u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('INVALID_QUANTITY',
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,0,%L::uuid[])',
        f, ca, ws, workers[1:2]), '22023', 'paya_quantity must be greater than zero.', u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('INVALID_RATE',
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,0)',
        f, ca, ws + 3), '22023', 'rate_per_paya must be greater than zero.', u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('ORDINARY_RATE_ORDER',
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,1100)',
        f, ca, ws + 1), 'P0001',
      format('Backdated transport crew wage rates are not allowed; effective_from must be later than the latest rate start (%s).', ws + 9), u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('ORDINARY_DUPLICATE_RATE',
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,1100)',
        f, ca, ws + 9), 'P0001', format('A transport crew wage rate already starts on %s.', ws + 9), u, f, ws));
    controls := controls || jsonb_build_array(pg_temp.protected_rejection('INCOMPLETE_WEEK',
      format('select * from public.calculate_transport_weekly_wages(%L::uuid,%L::date)', f, ws + 21),
      'P0001', format('Week starting %s is not completed yet.', ws + 21), u, f, ws));
    foreach source in array array[
      format('select * from public.calculate_transport_weekly_wages(%L::uuid,%L::date)', other_factory, ws),
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,1,%L::uuid[])',
        other_factory, foreign_crew, ws, array[foreign_worker]),
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,800)',
        other_factory, foreign_crew, ws)
    ] loop
      controls := controls || jsonb_build_array(pg_temp.protected_rejection('CROSS_FACTORY',
        source, '42501', 'You do not have access to this factory.', u, f, ws));
    end loop;
    perform pg_temp.require((select count(*) from public.transport_crews
      where factory_id = other_factory) = 0, 'L: other-factory table rows remain hidden by RLS');
    perform set_config('request.jwt.claim.sub', outsider::text, true);
    perform pg_temp.assert_identity(outsider, other_factory);
    perform pg_temp.require((select count(*) from public.transport_weekly_earnings where factory_id = f) = 0,
      'L: outsider cannot read main fixture earnings');
    perform pg_temp.expect_rpc_error(
      format('select * from public.calculate_transport_weekly_wages(%L::uuid,%L::date)', f, ws),
      '42501', 'You do not have access to this factory.');
    perform set_config('request.jwt.claim.sub', '', true);
    foreach source in array array[
      format('select * from public.calculate_transport_weekly_wages(%L::uuid,%L::date)', f, ws),
      format('select * from public.save_transport_daily_entry(%L::uuid,%L::uuid,%L::date,1,%L::uuid[])',
        f, ca, ws, array[workers[1]]),
      format('select * from public.create_transport_crew_wage_rate(%L::uuid,%L::uuid,%L::date,800)', f, ca, ws)
    ] loop
      perform pg_temp.expect_rpc_error(source, '42501', 'You do not have access to this factory.');
    end loop;
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.assert_identity(u, f);
    cases := cases || jsonb_build_array(jsonb_build_object('case', 'L_AUTH_FACTORY_ISOLATION',
      'result', 'PASS', 'catalog_acl_checks', true, 'cross_factory_rejections', 3,
      'unauthenticated_identity_rejections', 3, 'bidirectional_rls', true));

    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    perform pg_temp.require(current_user = caller and auth.uid() is null, 'root restored before safety checks');
    perform pg_temp.require(pg_temp.persistent_snapshot(f, u) = non_synthetic_baseline,
      'other-factory fixture and all non-synthetic rows unchanged BEFORE fixture rollback');
    select array_agg(id) into generated from (
      select id from public.transport_weekly_earnings where factory_id = f
      union all select id from public.transport_weekly_earning_details where factory_id = f
      union all select id from public.transport_daily_entries where factory_id = f
      union all select id from public.transport_daily_attendance where factory_id = f
      union all select id from public.transport_crew_wage_rates where factory_id = f
      union all select id from public.factory_users where factory_id in (f, other_factory)
      union all select id from public.transport_crew_assignments where factory_id = f
    ) fixture_ids;
    ids := ids || generated;
    perform pg_temp.require(jsonb_array_length(cases) = 12, 'all A-L major cases completed');
    -- PL/pgSQL variables retain reports/IDs while this entire fixture rolls back.
    raise exception using errcode = 'Z15D2', message = 'Rollback entire post-policy synthetic fixture';
  exception when sqlstate 'Z15D2' then
    if sqlerrm <> 'Rollback entire post-policy synthetic fixture' then raise; end if;
  end;

  perform pg_temp.require(current_user = caller and auth.uid() is null, 'fixture rollback restores original role/JWT');
  clean := pg_temp.persistent_snapshot();
  perform pg_temp.require(clean = baseline, 'all 63 public tables/auth.users counts AND fingerprints unchanged');
  perform pg_temp.require(pg_temp.fixture_residue(ids) = '{}'::jsonb, 'no synthetic fixture identifiers remain');
  perform set_config('atlas12d15d2.report', jsonb_build_object(
    'result', 'PASS', 'cases_passed', 12, 'cases_failed', 0, 'cases', cases,
    'additional_controls', controls, 'synthetic_identifiers', to_jsonb(ids),
    'persistent_before', baseline, 'persistent_after_fixture_rollback', clean,
    'non_synthetic_fingerprints_unchanged', true, 'synthetic_residue', pg_temp.fixture_residue(ids),
    'concurrent_sessions', 'NOT TESTED', 'deadlock_freedom', 'NOT PROVEN',
    'cleanup', 'same-session fixture rollback checked; external post-outer-ROLLBACK comparison required'
  )::text, true);
end;
$proof$;

select current_setting('atlas12d15d2.report')::jsonb as execution_report;
rollback;
