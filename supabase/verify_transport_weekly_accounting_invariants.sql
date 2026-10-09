-- HISTORICAL PRE-FINALIZATION-GUARD Transport checkpoint.
-- At creation, authenticated source writers could alter calculated weeks without
-- changing immutable earnings. This verifier intentionally demonstrates that
-- original behavior. After finalized-week safeguards are introduced, its
-- post-finalization acceptance assertions are expected to fail by design.
-- Future post-policy regression coverage belongs in a separate verifier.
--
-- Atlas Security 12D1.5B: sequential Transport reconciliation and writer proof.
-- Test Atlas Clean ONLY: nfqdtygpyycaxlaegvcf.
-- Run: npx supabase db query --linked --file supabase/verify_transport_weekly_accounting_invariants.sql
-- One explicit transaction, no committed fixtures or persistent helpers.
-- The private fixture subtransaction is rolled back before same-session cleanup
-- assertions; the outer ROLLBACK also removes all pg_temp helpers/report state.
-- Separately compare read-only persistent snapshots BEFORE execution and AFTER
-- the explicit outer ROLLBACK, including every reported synthetic identifier.
-- Sequential success is NOT a concurrent mixed-snapshot reproduction.
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

-- Only aggregate counts/fingerprints leave the server; never real row contents.
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

-- Diagnostics only: live-source hypotheticals are NEVER treated as payable.
create function pg_temp.live_source_totals(factory uuid, ws date) returns jsonb
language sql as $$
  select coalesce(jsonb_object_agg(worker::text, amount::text), '{}'::jsonb)
  from (
    select a.transport_worker_id worker,
      sum(e.paya_quantity * r.rate_per_paya / c.n) amount
    from public.transport_daily_attendance a
    join public.transport_daily_entries e
      on e.id = a.transport_daily_entry_id and e.factory_id = a.factory_id
    join public.transport_crew_wage_rates r
      on r.factory_id = e.factory_id and r.transport_crew_id = e.transport_crew_id
      and r.effective_from <= e.work_date
      and (r.effective_to is null or r.effective_to >= e.work_date)
    cross join lateral (select count(*)::numeric n from public.transport_daily_attendance x
      where x.factory_id = e.factory_id and x.transport_daily_entry_id = e.id) c
    where e.factory_id = factory and e.work_date between ws and ws + 6
    group by a.transport_worker_id
  ) amounts;
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

create function pg_temp.writer_case(label text, u uuid, f uuid, ws date,
  ca uuid, cb uuid, workers uuid[]) returns jsonb language plpgsql as $$
declare financial_tables text[] := array['transport_weekly_earnings', 'transport_weekly_earning_details'];
  source_tables text[] := array['transport_daily_entries', 'transport_daily_attendance',
    'transport_crew_wage_rates', 'transport_crew_assignments'];
  saved jsonb; sources jsonb; payable jsonb; live_before jsonb; live_after jsonb;
  response jsonb; summary jsonb; answer jsonb; r record; latest record;
  before_entry uuid; source_ids uuid[]; message text; state text;
begin
  perform pg_temp.assert_identity(u, f);
  saved := pg_temp.scoped_snapshot(f, financial_tables);
  sources := pg_temp.scoped_snapshot(f, source_tables);
  payable := pg_temp.payable_totals(f, ws);
  live_before := pg_temp.live_source_totals(f, ws);
  begin
    if label = 'A_QUANTITY_CORRECTION' then
      select id into strict before_entry from public.transport_daily_entries
        where factory_id = f and transport_crew_id = ca and work_date = ws;
      select * into strict r from public.save_transport_daily_entry(f, ca, ws, 3.5, workers[1:2]);
      response := to_jsonb(r);
      perform pg_temp.require(r.daily_entry_id = before_entry and r.saved_paya_quantity = 3.5
        and r.attendance_count = 2, 'A correction RPC response');
      perform pg_temp.require((select paya_quantity from public.transport_daily_entries
        where id = before_entry and factory_id = f) = 3.5, 'A real source quantity corrected');
    elsif label = 'B_ATTENDANCE_REPLACEMENT' then
      select id into strict before_entry from public.transport_daily_entries
        where factory_id = f and transport_crew_id = ca and work_date = ws + 3;
      select * into strict r from public.save_transport_daily_entry(f, ca, ws + 3, 2, array[workers[1]]);
      response := to_jsonb(r);
      perform pg_temp.require(r.daily_entry_id = before_entry and r.saved_paya_quantity = 2
        and r.attendance_count = 1, 'B attendance RPC response');
      perform pg_temp.require((select count(*) from public.transport_daily_attendance
        where factory_id = f and transport_daily_entry_id = before_entry) = 1
        and exists(select 1 from public.transport_daily_attendance where factory_id = f
          and transport_daily_entry_id = before_entry and transport_worker_id = workers[1]),
        'B recorded attendance actually replaced');
    elsif label = 'C_NEW_DAILY_ENTRY' then
      perform pg_temp.require(not exists(select 1 from public.transport_daily_entries
        where factory_id = f and transport_crew_id = cb and work_date = ws + 6),
        'C entry absent before real save');
      select * into strict r from public.save_transport_daily_entry(f, cb, ws + 6, 2,
        array[workers[2], workers[4]]);
      response := to_jsonb(r);
      perform pg_temp.require(r.daily_entry_id is not null and r.saved_paya_quantity = 2
        and r.attendance_count = 2 and exists(select 1 from public.transport_daily_entries
          where id = r.daily_entry_id and factory_id = f and work_date = ws + 6),
        'C new source and response exist');
    elsif label = 'D_ELIGIBLE_BACKDATED_RATE' then
      select * into strict latest from public.transport_crew_wage_rates
        where factory_id = f and transport_crew_id = ca
        order by effective_from desc, id desc limit 1;
      perform pg_temp.require(latest.effective_from = ws + 2 and latest.effective_to is null
        and ws + 3 > latest.effective_from and isfinite(ws + 3)
        and ws + 3 between ws and ws + 6 and 1100 > 0,
        'D replacement strictly later than latest start, open history, valid inside completed week');
      perform pg_temp.require(exists(select 1 from public.transport_daily_entries e
        join public.transport_weekly_earning_details d on d.transport_daily_entry_id = e.id
        where e.factory_id = f and e.transport_crew_id = ca and e.work_date = ws + 3
          and d.factory_id = f and d.rate_per_paya_snapshot = 900
          and d.transport_crew_wage_rate_id = latest.id and d.rate_per_paya_snapshot <> 1100),
        'D rate would affect an actual previously finalized contribution');
      select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws + 3, 1100);
      response := to_jsonb(r);
      perform pg_temp.require(r.effective_from = ws + 3 and r.effective_to is null
        and r.rate_per_paya = 1100 and r.factory_id = f and r.transport_crew_id = ca
        and (select effective_to from public.transport_crew_wage_rates where id = latest.id) = ws + 2,
        'D valid backdated replacement accepted and previous period closed');
    else
      raise exception 'FAIL: unknown writer case';
    end if;
    perform pg_temp.assert_identity(u, f);
    live_after := pg_temp.live_source_totals(f, ws);
    perform pg_temp.require(live_after <> live_before, 'actual source-state financial hypothetical changed');
    perform pg_temp.require(pg_temp.scoped_snapshot(f, financial_tables) = saved,
      'accepted writer did not change any saved header/detail row');
    perform pg_temp.require(pg_temp.payable_totals(f, ws) = payable,
      'payable remains header-authoritative, not rewritten from changed sources');
    select * into strict r from public.calculate_transport_weekly_wages(f, ws);
    summary := to_jsonb(r);
    perform pg_temp.require(r.workers_calculated = 0 and r.detail_rows_created = 0 and r.rows_skipped = 4
      and pg_temp.scoped_snapshot(f, financial_tables) = saved, 'recalculation skips unchanged four headers');
    select array_agg(id order by id) into source_ids from (
      select id from public.transport_daily_entries where factory_id = f
      union all select id from public.transport_daily_attendance where factory_id = f
      union all select id from public.transport_crew_wage_rates where factory_id = f
    ) ids;
    answer := jsonb_build_object('case', label, 'result', 'PASS', 'accepted', true,
      'sqlstate', null, 'error_message', null, 'rpc_response', response,
      'role', current_user, 'auth_uid', auth.uid(), 'headers_changed', false,
      'details_changed', false, 'new_source_reflected_in_payable', false,
      'payable', payable, 'live_source_hypothetical_before', live_before,
      'live_source_hypothetical_after', live_after, 'recalculation', summary,
      'synthetic_source_ids', to_jsonb(source_ids));
    -- This exact private marker rolls back only this accepted writer scenario.
    raise exception using errcode = 'Z15B1', message = 'Rollback isolated writer scenario';
  exception when sqlstate 'Z15B1' then
    get stacked diagnostics message = message_text, state = returned_sqlstate;
    if message <> 'Rollback isolated writer scenario' then raise; end if;
  end;
  perform pg_temp.assert_identity(u, f);
  perform pg_temp.require(pg_temp.scoped_snapshot(f, financial_tables) = saved
    and pg_temp.scoped_snapshot(f, source_tables) = sources
    and pg_temp.payable_totals(f, ws) = payable,
    'isolated case rollback preserved prior assertions and original fixture');
  return answer || jsonb_build_object('case_rollback_verified', true, 'transaction_usable', true);
end;
$$;

do $proof$
declare
  u uuid := '12d15b00-0000-4000-8000-000000000001';
  f uuid := '12d15b00-0000-4000-8000-000000000002';
  w uuid[] := array['12d15b00-0000-4000-8000-000000000003'::uuid,
    '12d15b00-0000-4000-8000-000000000004'::uuid,
    '12d15b00-0000-4000-8000-000000000005'::uuid,
    '12d15b00-0000-4000-8000-000000000006'::uuid];
  ca uuid := '12d15b00-0000-4000-8000-000000000007';
  cb uuid := '12d15b00-0000-4000-8000-000000000008';
  ids uuid[]; generated uuid[]; ws date; baseline jsonb; clean jsonb;
  reports jsonb := '[]'; reconciliation jsonb; pools jsonb; payable jsonb;
  r record; b record; rates uuid[]; label text; answer jsonb; before_rows jsonb;
  rejected_state text; rejected_message text; original_total numeric; allocated_total numeric;
  header_total numeric; detail_total numeric; worker uuid; entry_ids uuid[] := '{}';
  caller name := current_user;
begin
  ws := date_trunc('week', (now() at time zone 'Asia/Kolkata')::date)::date - 14;
  ids := array[u, f, ca, cb] || w;
  perform pg_temp.require(caller <> 'authenticated' and auth.uid() is null,
    'privileged synthetic root setup has no inherited user identity');
  baseline := pg_temp.persistent_snapshot();
  perform pg_temp.require(pg_temp.fixture_residue(ids) = '{}'::jsonb, 'all reserved fixture identifiers absent');
  begin
    -- Established security-verifier root setup, only inside this subtransaction.
    insert into auth.users(id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(u, 'authenticated', 'authenticated', 'atlas-12d15b@example.invalid', now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into public.factories(id, name) values(f, 'Atlas 12D1.5B synthetic Transport');
    insert into public.factory_users(user_id, factory_id, is_active) values(u, f, true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.assert_identity(u, f);
    -- Current application-permitted master-data writes, not historical memberships.
    insert into public.transport_workers(id, factory_id, name)
      select x, f, 'Synthetic worker ' || ord from unnest(w) with ordinality workers(x, ord);
    insert into public.transport_crews(id, factory_id, name)
      values(ca, f, 'Synthetic crew A'), (cb, f, 'Synthetic crew B');
    insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
      select f, worker_id, crew_id from unnest(w) workers(worker_id)
        cross join unnest(array[ca, cb]) crews(crew_id);
    -- Rates, recorded quantities and attendance use ONLY current RPCs.
    select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws - 7, 800);
    rates := array[r.id];
    select * into strict r from public.create_transport_crew_wage_rate(f, ca, ws + 2, 900);
    rates := rates || r.id;
    select * into strict r from public.create_transport_crew_wage_rate(f, cb, ws - 7, 1000);
    rates := rates || r.id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws, 2.5, w[1:2]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 1, 1, array[w[1]]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, ca, ws + 3, 2, w[1:2]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, cb, ws + 4, 1, array[w[1], w[3], w[4]]);
    entry_ids := entry_ids || r.daily_entry_id;
    select * into strict r from public.save_transport_daily_entry(f, cb, ws + 5, 1, array[w[3]]);
    entry_ids := entry_ids || r.daily_entry_id;
    perform pg_temp.assert_identity(u, f);
    select * into strict r from public.calculate_transport_weekly_wages(f, ws);
    perform pg_temp.require(r.workers_calculated = 4 and r.detail_rows_created = 9 and r.rows_skipped = 0,
      'four workers, nine daily contributions, no skipped rows');
    perform pg_temp.require((select count(*) from public.transport_weekly_earnings
      where factory_id = f and week_start = ws) = 4
      and not exists(select 1 from public.transport_weekly_earnings
        where factory_id = f and week_start = ws group by transport_worker_id having count(*) <> 1),
      'exactly one header per worker/week');
    perform pg_temp.require(not exists(select 1 from public.transport_weekly_earnings h
      left join lateral (select count(*) n, sum(d.worker_daily_share_snapshot) amount
        from public.transport_weekly_earning_details d where d.transport_weekly_earning_id = h.id) s on true
      where h.factory_id = f and h.week_start = ws
        and (s.n = 0 or h.total_amount is distinct from s.amount)),
      'EVERY header equals its actual detail-ID sum, including missing-detail protection');
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
          and exists(select 1 from public.transport_daily_attendance a where a.factory_id = f
            and a.transport_daily_entry_id = expected.entry and a.transport_worker_id = d.transport_worker_id)
        ) exact from public.transport_weekly_earning_details d
        where d.factory_id = f and d.transport_daily_entry_id = expected.entry) actual on true
      where actual.n <> expected.attendance or actual.exact is distinct from true),
      'all nine allocations have exact rate/quantity/count/share/worker snapshots');
    perform pg_temp.require(not exists(select 1 from
      (values(w[1], 2700 + 1000::numeric / 3), (w[2], 1900::numeric),
        (w[3], 1000 + 1000::numeric / 3), (w[4], 1000::numeric / 3)) expected(worker, amount)
      left join public.transport_weekly_earnings h on h.factory_id = f
        and h.week_start = ws and h.transport_worker_id = expected.worker
      where h.total_amount is distinct from expected.amount), 'exact intended per-worker shares');
    select jsonb_agg(jsonb_build_object('worker_uuid', h.transport_worker_id,
      'header', h.total_amount::text, 'detail_sum', s.amount::text, 'detail_rows', s.n)
      order by h.transport_worker_id), sum(h.total_amount), sum(s.amount)
      into reconciliation, header_total, detail_total
      from public.transport_weekly_earnings h cross join lateral (
        select sum(d.worker_daily_share_snapshot) amount, count(*) n
        from public.transport_weekly_earning_details d where d.transport_weekly_earning_id = h.id) s
      where h.factory_id = f and h.week_start = ws;
    perform pg_temp.require(header_total is not distinct from detail_total, 'exact week header/detail total');
    -- Deduplicate the repeated crew pool by entry, never sum it per worker.
    select sum(pool), sum(allocated), jsonb_agg(jsonb_build_object('entry_uuid', entry,
      'original_pool', pool::text, 'allocated', allocated::text,
      'fractional_division_remainder', (pool - allocated)::text) order by entry)
      into original_total, allocated_total, pools from (
        select transport_daily_entry_id entry, min(daily_crew_pool_snapshot) pool,
          sum(worker_daily_share_snapshot) allocated
        from public.transport_weekly_earning_details where factory_id = f and week_start = ws
        group by transport_daily_entry_id) daily;
    perform pg_temp.require(original_total = 6600 and allocated_total = detail_total,
      'five distinct crew pools, no repeated-pool double counting');
    reports := reports || jsonb_build_array(jsonb_build_object('case', 'EXACT_RECONCILIATION',
      'result', 'PASS', 'workers', reconciliation, 'header_total', header_total::text,
      'detail_total', detail_total::text, 'original_crew_pools', original_total::text,
      'fractional_division_remainder', (original_total - allocated_total)::text,
      'pools', pools, 'calculation', to_jsonb(r)));
    payable := pg_temp.payable_totals(f, ws);
    foreach worker in array w loop
      select * into strict b from public.get_transport_worker_available_balance(f, worker, ws + 5);
      perform pg_temp.require(b.total_earned = 0 and b.total_withdrawn = 0 and b.available_balance = 0,
        'Saturday excludes this week');
      select * into strict b from public.get_transport_worker_available_balance(f, worker, ws + 6);
      perform pg_temp.require(b.total_earned = (select total_amount from public.transport_weekly_earnings
        where factory_id = f and transport_worker_id = worker and week_start = ws)
        and b.total_withdrawn = 0 and b.available_balance = b.total_earned,
        'Sunday includes exact header-authoritative earnings');
    end loop;
    reports := reports || jsonb_build_array(jsonb_build_object('case', 'SUNDAY_ELIGIBILITY',
      'result', 'PASS', 'saturday_earned_each', '0', 'sunday_payable', payable));
    before_rows := pg_temp.scoped_snapshot(f, array['transport_weekly_earnings', 'transport_weekly_earning_details']);
    select * into strict r from public.calculate_transport_weekly_wages(f, ws);
    perform pg_temp.require(r.workers_calculated = 0 and r.detail_rows_created = 0 and r.rows_skipped = 4
      and before_rows = pg_temp.scoped_snapshot(f, array['transport_weekly_earnings', 'transport_weekly_earning_details']),
      'initial replay skips all four unchanged headers');
    reports := reports || jsonb_build_array(jsonb_build_object('case', 'REPLAY', 'result', 'PASS', 'response', to_jsonb(r)));
    foreach label in array array['A_QUANTITY_CORRECTION', 'B_ATTENDANCE_REPLACEMENT',
      'C_NEW_DAILY_ENTRY', 'D_ELIGIBLE_BACKDATED_RATE'] loop
      answer := pg_temp.writer_case(label, u, f, ws, ca, cb, w);
      select array_agg(x::uuid) into generated from jsonb_array_elements_text(answer->'synthetic_source_ids') x;
      ids := ids || generated;
      reports := reports || jsonb_build_array(answer);
    end loop;
    -- Negative control only: ordinary rate ordering is NOT finalized-week protection.
    begin
      perform public.create_transport_crew_wage_rate(f, ca, ws + 1, 1100);
      raise exception 'FAIL: ordinary earlier-rate rejection unexpectedly succeeded';
    exception when sqlstate 'P0001' then
      get stacked diagnostics rejected_state = returned_sqlstate, rejected_message = message_text;
      if rejected_message <> format('Backdated transport crew wage rates are not allowed; effective_from must be later than the latest rate start (%s).', ws + 2) then raise; end if;
    end;
    perform pg_temp.assert_identity(u, f);
    perform pg_temp.require(before_rows = pg_temp.scoped_snapshot(f, array['transport_weekly_earnings', 'transport_weekly_earning_details'])
      and (select count(*) from public.transport_crew_wage_rates where factory_id = f) = 3,
      'negative-control rollback preserves financial assertions and all original rates');
    reports := reports || jsonb_build_array(jsonb_build_object('case', 'ORDINARY_RATE_ORDER_NEGATIVE_CONTROL',
      'result', 'PASS', 'accepted', false, 'sqlstate', rejected_state, 'error_message', rejected_message,
      'violated_rule', 'replacement starts before latest rate start', 'related_to_finalization', false));
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    perform pg_temp.require(current_user = caller and auth.uid() is null, 'root restored before read-only persistent checks');
    select array_agg(id) into generated from (
      select id from public.transport_weekly_earnings where factory_id = f
      union all select id from public.transport_weekly_earning_details where factory_id = f
      union all select id from public.factory_users where factory_id = f
      union all select id from public.transport_crew_assignments where factory_id = f) all_ids;
    ids := ids || generated || entry_ids || rates;
    perform pg_temp.require(pg_temp.persistent_snapshot(f, u) = baseline,
      'all non-synthetic counts AND row fingerprints unchanged before fixture rollback');
    raise exception using errcode = 'Z15B2', message = 'Rollback entire synthetic fixture';
  exception when sqlstate 'Z15B2' then
    if sqlerrm <> 'Rollback entire synthetic fixture' then raise; end if;
  end;
  perform pg_temp.require(current_user = caller and auth.uid() is null,
    'fixture rollback restores original role/JWT');
  clean := pg_temp.persistent_snapshot();
  perform pg_temp.require(clean = baseline, 'all 63 public tables and auth.users counts/fingerprints unchanged after fixture rollback');
  perform pg_temp.require(pg_temp.fixture_residue(ids) = '{}'::jsonb,
    'ALL synthetic identifiers absent across all public tables/auth.users');
  select array_agg(distinct x order by x) into ids from unnest(ids) x;
  perform pg_temp.require(jsonb_array_length(reports) = 8, 'all eight major proof cases completed');
  perform set_config('atlas12d15b.report', jsonb_build_object('result', 'PASS', 'week_start', ws,
    'cases_passed', 8, 'cases_failed', 0, 'cases', reports,
    'runner_isolation', current_setting('transaction_isolation'),
    'runner_default_isolation', current_setting('default_transaction_isolation'),
    'hosted_rpc_isolation', 'UNPROVEN', 'concurrent_races', 'NOT REPRODUCED',
    'synthetic_identifiers', to_jsonb(ids), 'persistent_before', baseline, 'persistent_after_fixture_rollback', clean,
    'non_synthetic_fingerprints_unchanged', true, 'synthetic_residue', pg_temp.fixture_residue(ids),
    'cleanup', 'same-session fixture rollback proved; external check after outer ROLLBACK also required')::text, true);
end;
$proof$;

select current_setting('atlas12d15b.report')::jsonb as execution_report;
rollback;
