-- Atlas 12D1.1 originally confirmed the backdated-withdrawal vulnerability.
-- 12D1.3A now REQUIRES rejection of that exploit; legitimate safe backdating
-- must continue to succeed. Sequential event-date proof, NOT a concurrency test.
-- Main promotion requires a separate READ-ONLY negative-account scan for M1/M2/T1.
-- Run only against Test Atlas Clean via npx supabase db query --linked --file.
-- No persistent helper, migration, real-user fixture, or committed test data.
-- All financial setup/execution stays in one rollback transaction; a session-only
-- baseline survives to verify persistent state after the outer ROLLBACK.
-- Session-local baseline only is committed; every fixture stays in the original
-- rollback transaction. Use one database session through the post-ROLLBACK proof.
create temporary table atlas_e6_backdated_baseline(s text,t text,n bigint,h text,primary key(s,t)) on commit preserve rows;
do $$declare r record; n bigint; h text;begin
  for r in select 'public'::text s,c.relname::text t from pg_class c
    where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
    union all select 'auth','users' loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into n,h;
    insert into atlas_e6_backdated_baseline values(r.s,r.t,n,h);
  end loop;
  if (select count(*) from atlas_e6_backdated_baseline where s='public')<>64
    or (select count(*) from atlas_e6_backdated_baseline)<>65 then
    raise exception 'FAIL: expected 64 public tables plus auth.users';
  end if;
end$$;
commit;

begin isolation level repeatable read;

-- Counts AND row fingerprints: only aggregates are reported, never real rows.
create function pg_temp.persistent_snapshot(excluded_factories uuid[], excluded_users uuid[])
returns jsonb language plpgsql as $$
declare t record; n bigint; digest text; result jsonb := '{}'::jsonb;
begin
  for t in select schemaname, tablename from pg_catalog.pg_tables
    where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')
    order by schemaname, tablename
  loop
    execute format(
      'select count(*), md5(coalesce(string_agg(row_hash, '''' order by row_hash), ''''))
       from (select md5(to_jsonb(t)::text) row_hash from %I.%I t
         where coalesce(to_jsonb(t)->>''factory_id'', '''') <> all($1)
           and coalesce(to_jsonb(t)->>''id'', '''') <> all($2)) rows',
      t.schemaname, t.tablename)
      into n, digest using excluded_factories::text[],
        (excluded_factories || excluded_users)::text[];
    result := result || jsonb_build_object(t.schemaname || '.' || t.tablename,
      jsonb_build_object('count', n, 'fingerprint', digest));
  end loop;
  return result;
end;
$$;

create function pg_temp.assert_identity(expected_user uuid) returns void
language plpgsql as $$
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from expected_user then
    raise exception 'FAIL: expected authenticated role and synthetic JWT subject.';
  end if;
end;
$$;

-- M1 duplicates the writer's exact weekly/date predicates (no frontend formula).
-- T1 uses its authoritative balance RPC. M2 mirrors the internal (not granted
-- to authenticated) calculate_mud_group_settlement_account(..., false) helper:
-- SAME settled-only tables, date predicates and cutoff; NO live earnings.
create function pg_temp.money_at(module text, factory uuid, account uuid, as_of_date date)
returns jsonb language plpgsql as $$
declare earned numeric; included numeric; available numeric; all_withdrawn numeric;
  latest_cutoff date;
begin
  if module = 'M1' then
    select coalesce(sum(e.amount), 0) into earned from public.weekly_earnings e
      where e.factory_id = factory and e.labour_group_id = account
        and e.labourer_id is null and e.week_start + 6 <= as_of_date;
    select coalesce(sum(w.amount), 0) into included from public.withdrawals w
      where w.factory_id = factory and w.labour_group_id = account
        and w.labourer_id is null and w.withdrawal_date <= as_of_date;
    available := earned - included;
  elsif module = 'M2' then
    select max(s.settled_through) into latest_cutoff
      from public.mud_factory_settlements s where s.factory_id = factory;
    if latest_cutoff is null or as_of_date < latest_cutoff then
      raise exception 'FIXTURE-INVALID: diagnostic date must cover the settlement cutoff.';
    end if;
    select coalesce((select sum(o.locked_weekly_earned)
      from public.mud_group_legacy_openings o
      where o.factory_id = factory and o.labour_group_id = account), 0)
      + coalesce((select sum(s.earned_amount) from public.mud_group_settlement_days s
      where s.factory_id = factory and s.labour_group_id = account), 0) into earned;
    select coalesce(sum(w.amount), 0) into included from public.withdrawals w
      where w.factory_id = factory and w.labour_group_id = account
        and w.labourer_id is null and w.withdrawal_date <= as_of_date;
    available := earned - included;
  elsif module = 'T1' then
    select a.total_earned, a.total_withdrawn, a.available_balance
      into earned, included, available
      from public.get_transport_worker_available_balance(factory, account, as_of_date) a;
  else
    raise exception 'FAIL: unknown proof module.';
  end if;
  if module = 'T1' then
    select coalesce(sum(w.amount), 0) into all_withdrawn from public.transport_withdrawals w
      where w.factory_id = factory and w.transport_worker_id = account;
  else
    select coalesce(sum(w.amount), 0) into all_withdrawn from public.withdrawals w
      where w.factory_id = factory and w.labour_group_id = account and w.labourer_id is null;
  end if;
  return jsonb_build_object('date', as_of_date, 'eligible_earned', earned,
    'date_included_withdrawals', included, 'available_balance', available,
    'total_withdrawals_regardless_of_date', all_withdrawn);
end;
$$;


create function pg_temp.require(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end;
$$;

-- Immediate scoped row counts AND fingerprints catch partial RPC writes before
-- the outer rollback, including headers and both factory/group snapshot tables.
create function pg_temp.financial_snapshot(factory uuid) returns jsonb
language plpgsql as $$
declare t text; n bigint; digest text; result jsonb := '{}';
begin
  foreach t in array array['withdrawals', 'transport_withdrawals',
    'mud_factory_settlements', 'mud_factory_settlement_days', 'mud_group_settlement_days'] loop
    execute format('select count(*), md5(coalesce(string_agg(h, '''' order by h), ''''))
      from (select md5(to_jsonb(r)::text) h from public.%I r where factory_id = $1) s', t)
      into n, digest using factory;
    result := result || jsonb_build_object(t,
      jsonb_build_object('count', n, 'fingerprint', digest));
  end loop;
  return result;
end;
$$;

create function pg_temp.assert_money(module text, factory uuid, account uuid,
  dates date[], balances numeric[], withdrawn numeric) returns jsonb
language plpgsql as $$
declare i integer; m jsonb; result jsonb := '[]';
begin
  perform pg_temp.require(cardinality(dates) = cardinality(balances), 'balance assertion dimensions');
  for i in 1..cardinality(dates) loop
    m := pg_temp.money_at(module, factory, account, dates[i]);
    perform pg_temp.require((m->>'available_balance')::numeric = balances[i]
      and (m->>'total_withdrawals_regardless_of_date')::numeric = withdrawn,
      format('%s balance/withdrawn at %s: expected %s/%s, got %s',
        module, dates[i], balances[i], withdrawn, m));
    result := result || jsonb_build_array(m);
  end loop;
  return result;
end;
$$;

create function pg_temp.attempt_withdrawal(module text, factory uuid, account uuid,
  expected_user uuid, request_id uuid, request_date date, cutoff date, amount numeric,
  expected_state text default null, failing_date date default null,
  headroom numeric default null) returns jsonb language plpgsql as $$
declare before_rows jsonb; after_rows jsonb; response jsonb;
  rejected_state text; rejected_message text; expected_message text;
begin
  perform pg_temp.assert_identity(expected_user);
  before_rows := pg_temp.financial_snapshot(factory);
  begin
    if module = 'M1' then
      select to_jsonb(r) into strict response
        from public.create_labour_group_withdrawal(factory, account, request_date, amount) r;
    elsif module = 'M2' then
      select to_jsonb(r) into strict response
        from public.create_mud_settlement_withdrawal(factory, request_id, account,
          request_date, cutoff, amount) r;
    else
      select to_jsonb(r) into strict response
        from public.create_transport_worker_withdrawal(factory, account, request_date, amount) r;
    end if;
  exception when others then
    get stacked diagnostics rejected_state = returned_sqlstate, rejected_message = message_text;
  end;
  after_rows := pg_temp.financial_snapshot(factory);
  if expected_state is null then
    perform pg_temp.require(rejected_state is null,
      format('%s unexpected rejection %s: %s', module, rejected_state, rejected_message));
    perform pg_temp.require((response->>'withdrawal_amount')::numeric = amount
      and (response->>'withdrawal_date')::date = request_date, 'unchanged withdrawal response meaning');
  else
    perform pg_temp.require(rejected_state = expected_state,
      format('%s expected %s, got %s (unexpected acceptance is a failure)',
        module, expected_state, coalesce(rejected_state, 'SUCCESS')));
    if expected_state = 'P0001' then
      expected_message := format(
        '^Withdrawal amount %s(\.0+)? exceeds available balance %s(\.0+)? as of %s\.$',
        amount, headroom, failing_date);
      perform pg_temp.require(rejected_message ~ expected_message,
        format('%s stable insufficient-balance message/date/headroom: %s', module, rejected_message));
    elsif expected_state = 'P3303' then
      perform pg_temp.require(rejected_message =
        'Withdrawal amount exceeds earnings settled through the requested cutoff.', 'stable P3303 message');
    elsif expected_state = 'P3304' then
      perform pg_temp.require(rejected_message =
        'Client withdrawal identity was already used for different Mud withdrawal details.', 'stable P3304 message');
    else
      raise exception 'FAIL: unsupported expected error';
    end if;
    perform pg_temp.require(before_rows = after_rows,
      'IMMEDIATE post-rejection: no withdrawal/header/factory-day/group-day residue');
    if module = 'M2' and expected_state <> 'P3304' then
      perform pg_temp.require(not exists(select 1 from public.withdrawals w where w.id = request_id)
        and not exists(select 1 from public.mud_factory_settlements s
          where s.triggering_withdrawal_id = request_id), 'rejected candidate UUID absent');
    end if;
  end if;
  return jsonb_build_object('request_date', request_date, 'amount', amount,
    'cutoff', cutoff, 'role', current_user, 'auth_uid', auth.uid(),
    'client_uuid', case when module = 'M2' then request_id else null end,
    'response', response, 'rejection_sqlstate', rejected_state,
    'stable_message', rejected_message, 'immediate_rows_unchanged',
    case when expected_state is not null then before_rows = after_rows else null end);
end;
$$;

-- Synthetic setup only. Real earnings and cutover authorities are executed as
-- authenticated + synthetic auth.uid(), not bypassed with fabricated totals.
create function pg_temp.make_fixture(module text, label text, cutoff date,
  second_group boolean default false, legacy_withdrawal numeric default 0)
returns jsonb language plpgsql as $$
declare u uuid := gen_random_uuid(); f uuid; a uuid := gen_random_uuid();
  b uuid := gen_random_uuid(); l uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  ws date := cutoff - 6; r record; initial jsonb;
begin
  perform pg_temp.require(current_user = 'postgres', 'privileged synthetic fixture setup only');
  insert into auth.users(id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values(u, 'authenticated', 'authenticated', u::text || '@example.invalid',
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform pg_temp.assert_identity(u);
  select * into strict r from public.provision_first_factory('12D1.3A ' || module || ' ' || label);
  perform pg_temp.require(r.created and r.factory_id is not null, 'fresh synthetic factory provisioned');
  f := r.factory_id;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
  if module in ('M1', 'M2') then
    insert into public.labourers(id, factory_id, name) values(l, f, 'Synthetic production');
    insert into public.labour_groups(id, factory_id, name, member_count, is_active)
      values(a, f, 'Synthetic Mud A', 5, true);
    insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
      values(f, a, 5, ws);
    insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from)
      values(f, a, 100, ws);
    insert into public.wage_rates(factory_id, applies_to, rate_per_1000_bricks, effective_from)
      values(f, 'mud_supply', 100, ws);
    insert into public.production_entries(id, factory_id, labourer_id, production_date, quantity)
      values(gen_random_uuid(), f, l, ws, 10000);
    if second_group then
      -- B has no Legacy coverage/earnings, but actual terms after the cutoff.
      insert into public.labour_groups(id, factory_id, name, member_count, is_active)
        values(b, f, 'Synthetic Mud B', 5, false);
      insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
        values(f, b, 5, cutoff + 1);
      insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from)
        values(f, b, 100, cutoff + 1);
    end if;
  else
    insert into public.transport_workers(id, factory_id, name) values(a, f, 'Synthetic Transport');
    insert into public.transport_crews(id, factory_id, name) values(c, f, 'Synthetic crew');
    insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
      values(f, a, c);
    insert into public.transport_crew_wage_rates(factory_id, transport_crew_id, effective_from, rate_per_paya)
      values(f, c, ws, 100);
  end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
  perform pg_temp.assert_identity(u);
  if module in ('M1', 'M2') then
    perform public.calculate_mud_supply_wages(f, a, ws);
    if legacy_withdrawal > 0 then
      perform pg_temp.attempt_withdrawal('M1', f, a, u, gen_random_uuid(), cutoff, cutoff, legacy_withdrawal);
    end if;
    if module = 'M2' then
      perform public.transition_mud_accounting_mode(f, 'SHADOW');
      perform public.execute_mud_settlement_cutover(f, cutoff);
      perform pg_temp.require(exists(select 1 from public.mud_accounting_states s
        where s.factory_id = f and s.accounting_mode = 'SETTLEMENT'), 'actual cutover SETTLEMENT');
    end if;
  else
    perform public.save_transport_daily_entry(f, c, ws, 10, array[a]);
    perform public.calculate_transport_weekly_wages(f, ws);
  end if;
  initial := pg_temp.assert_money(module, f, a, array[cutoff + 1, cutoff + 2],
    array[1000 - legacy_withdrawal, 1000 - legacy_withdrawal], legacy_withdrawal);
  perform pg_temp.require((initial #>> '{0,eligible_earned}')::numeric = 1000
    and (initial #>> '{1,eligible_earned}')::numeric = 1000, 'authority sees exactly 1000 earned');
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('module', module, 'scenario', label, 'user_uuid', u,
    'factory_uuid', f, 'account_uuid', a, 'other_group_uuid', case when second_group then b else null end,
    'source_labourer_uuid', l, 'crew_uuid', c, 'initial', initial);
end;
$$;

create function pg_temp.add_source(fixture jsonb, source_date date, quantity integer,
  post_week boolean default false) returns void language plpgsql as $$
declare f uuid := (fixture->>'factory_uuid')::uuid; a uuid := (fixture->>'account_uuid')::uuid;
  u uuid := (fixture->>'user_uuid')::uuid; module text := fixture->>'module';
begin
  perform pg_temp.require(current_user = 'postgres', 'synthetic source setup role');
  if module in ('M1', 'M2') then
    insert into public.production_entries(id, factory_id, labourer_id, production_date, quantity)
      values(gen_random_uuid(), f, (fixture->>'source_labourer_uuid')::uuid, source_date, quantity);
  end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
  perform pg_temp.assert_identity(u);
  if module = 'T1' then
    perform public.save_transport_daily_entry(f, (fixture->>'crew_uuid')::uuid,
      source_date, quantity, array[a]);
    if post_week then perform public.calculate_transport_weekly_wages(f, source_date); end if;
  elsif post_week then
    perform pg_temp.require(module = 'M1', 'never post Legacy wages after M2 cutover');
    perform public.calculate_mud_supply_wages(f, a, source_date);
  end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- Exact grants on session-only invoker helpers; no persistent helper/ACL change.
grant execute on function pg_temp.assert_identity(uuid),
  pg_temp.money_at(text, uuid, uuid, date), pg_temp.require(boolean, text),
  pg_temp.financial_snapshot(uuid),
  pg_temp.assert_money(text, uuid, uuid, date[], numeric[], numeric),
  pg_temp.attempt_withdrawal(text, uuid, uuid, uuid, uuid, date, date, numeric, text, date, numeric)
  to authenticated;

do $proof$
#variable_conflict use_variable
declare
  baseline jsonb := pg_temp.persistent_snapshot('{}'::uuid[], '{}'::uuid[]);
  after_rollback jsonb; real_rows jsonb; manifest jsonb := '[]'; reports jsonb := '[]';
  users uuid[] := '{}'; factories uuid[] := '{}'; x jsonb; outsider jsonb;
  module text; scenario text; u uuid; f uuid; a uuid; b uuid; request_id uuid;
  cutoff date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date - 22;
  d1 date; d2 date; candidate_date date; later_date date; new_cutoff date;
  first_result jsonb; result jsonb; replay jsonb; final_money jsonb; before_rows jsonb;
  new_credit numeric; new_pool numeric; amount numeric; all_w numeric;
  event_balances jsonb; pool_ok boolean; dates_ok boolean; old_cutoff date;
begin
  perform pg_temp.require((select count(*) from pg_catalog.pg_tables where schemaname = 'public') = 64
    and (select count(*) from jsonb_each(baseline)) = 65, '64 public tables plus auth.users');
  d1 := cutoff + 1; d2 := cutoff + 2;
  begin
    foreach module in array array['M1', 'M2', 'T1'] loop
      foreach scenario in array array['OLD-EXPLOIT', 'SAFE-BACKDATE', 'SAME-DATE'] loop
        x := pg_temp.make_fixture(module, scenario, cutoff);
        manifest := manifest || jsonb_build_array(x);
        u := (x->>'user_uuid')::uuid; f := (x->>'factory_uuid')::uuid; a := (x->>'account_uuid')::uuid;
        request_id := gen_random_uuid();
        execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
        first_result := pg_temp.attempt_withdrawal(module, f, a, u, request_id, d2, cutoff, 800);
        perform pg_temp.assert_money(module, f, a, array[d1, d2], array[1000, 200], 800);
        if module = 'M2' and scenario = 'OLD-EXPLOIT' then
          before_rows := pg_temp.financial_snapshot(f);
          replay := pg_temp.attempt_withdrawal(module, f, a, u, request_id, d2, cutoff, 800);
          perform pg_temp.require((replay #>> '{response,was_replayed}')::boolean
            and replay #>> '{response,withdrawal_id}' = first_result #>> '{response,withdrawal_id}'
            and replay #>> '{response,settlement_id}' = first_result #>> '{response,settlement_id}'
            and pg_temp.financial_snapshot(f) = before_rows, 'matching UUID replay unchanged; no new rows');
          reports := reports || jsonb_build_array(jsonb_build_object('module', module,
            'case', 'MATCHING-REPLAY', 'result', 'PASS', 'execution', replay));
          result := pg_temp.attempt_withdrawal(module, f, a, u, request_id, d2, cutoff, 801, 'P3304');
          reports := reports || jsonb_build_array(jsonb_build_object('module', module,
            'case', 'CONFLICTING-REPLAY', 'result', 'PASS', 'execution', result));
        end if;
        if scenario = 'SAFE-BACKDATE' then
          result := pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), d1, cutoff, 200);
          final_money := pg_temp.assert_money(module, f, a, array[d1, d2], array[800, 0], 1000);
          perform pg_temp.require(coalesce((result #>> '{response,available_balance}')::numeric,
            (result #>> '{response,settled_available_balance}')::numeric) = 800,
            'safe backdate return remains OWN-date balance, not later minimum');
        else
          candidate_date := case when scenario = 'SAME-DATE' then d2 else d1 end;
          result := pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(),
            candidate_date, cutoff, 800, case when module = 'M2' then 'P3303' else 'P0001' end, d2, 200);
          final_money := pg_temp.assert_money(module, f, a, array[d1, d2], array[1000, 200], 800);
        end if;
        execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
        reports := reports || jsonb_build_array(jsonb_build_object('module', module, 'case', scenario,
          'result', 'PASS', 'first', first_result, 'candidate', result, 'final', final_money));
      end loop;
    end loop;

    foreach module in array array['M1', 'T1'] loop
      foreach scenario in array array['LATER-EARNINGS', 'INTERMEDIATE-DEFICIT'] loop
        x := pg_temp.make_fixture(module, scenario, cutoff);
        manifest := manifest || jsonb_build_array(x);
        u := (x->>'user_uuid')::uuid; f := (x->>'factory_uuid')::uuid; a := (x->>'account_uuid')::uuid;
        if scenario = 'INTERMEDIATE-DEFICIT' then
          execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
          perform pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), d2, cutoff, 800);
          execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
        end if;
        -- Second completed week's earnings become eligible on cutoff + 7.
        perform pg_temp.add_source(x, cutoff + 1, case when module = 'M1' then 10000 else 10 end, true);
        execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
        later_date := cutoff + 8;
        if scenario = 'LATER-EARNINGS' then
          perform pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), later_date, cutoff, 1200);
          result := pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), d1, cutoff, 800);
          final_money := pg_temp.assert_money(module, f, a, array[d1, later_date], array[200, 0], 2000);
          perform pg_temp.require((result #>> '{response,available_balance}')::numeric = 200,
            'later recovery leaves own-date response intact');
        else
          perform pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), later_date, cutoff, 800);
          -- A 400 candidate would finish at zero, but first later date is -200.
          perform pg_temp.assert_money(module, f, a, array[d1, d2, later_date], array[1000, 200, 400], 1600);
          result := pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), d1, cutoff, 400, 'P0001', d2, 200);
          final_money := pg_temp.assert_money(module, f, a, array[d1, d2, later_date], array[1000, 200, 400], 1600);
        end if;
        reports := reports || jsonb_build_array(jsonb_build_object('module', module, 'case', scenario,
          'result', 'PASS', 'candidate', result, 'final', final_money));
        if scenario = 'INTERMEDIATE-DEFICIT' then
          result := pg_temp.attempt_withdrawal(module, f, a, u, gen_random_uuid(), d1, cutoff, 200);
          final_money := pg_temp.assert_money(module, f, a, array[d1, d2, later_date], array[800, 0, 200], 1800);
          reports := reports || jsonb_build_array(jsonb_build_object('module', module,
            'case', 'MULTIPLE-LATER-DATES-SAFE-BOUNDARY', 'result', 'PASS', 'candidate', result, 'final', final_money));
        end if;
        execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
      end loop;
    end loop;

    x := pg_temp.make_fixture('M2', 'UNSETTLED-NOT-SPENDABLE', cutoff);
    manifest := manifest || jsonb_build_array(x);
    u := (x->>'user_uuid')::uuid; f := (x->>'factory_uuid')::uuid; a := (x->>'account_uuid')::uuid;
    perform pg_temp.add_source(x, cutoff + 1, 10000);
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.assert_identity(u);
    select earned_amount into strict new_credit from public.get_mud_group_daily_allocation(f, cutoff + 1)
      where labour_group_id = a;
    perform pg_temp.require(new_credit = 1000, 'real live earnings exist but are NOT settled');
    perform pg_temp.attempt_withdrawal('M2', f, a, u, gen_random_uuid(), d2, cutoff, 800);
    result := pg_temp.attempt_withdrawal('M2', f, a, u, gen_random_uuid(), d1, cutoff, 800, 'P3303');
    final_money := pg_temp.assert_money('M2', f, a, array[d1, d2], array[1000, 200], 800);
    reports := reports || jsonb_build_array(jsonb_build_object('module', 'M2',
      'case', 'UNSETTLED-NOT-SPENDABLE', 'result', 'PASS', 'live_credit', new_credit,
      'candidate', result, 'final', final_money));
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);

    foreach scenario in array array['ADVANCING-CUTOFF-SAFE', 'ADVANCING-CUTOFF-REJECT'] loop
      -- Two groups force rollback evidence to cover other groups' newly built snapshots too.
      x := pg_temp.make_fixture('M2', scenario, cutoff, true);
      manifest := manifest || jsonb_build_array(x);
      u := (x->>'user_uuid')::uuid; f := (x->>'factory_uuid')::uuid; a := (x->>'account_uuid')::uuid;
      b := (x->>'other_group_uuid')::uuid;
      new_cutoff := cutoff + 2; candidate_date := cutoff + 3; later_date := cutoff + 4;
      amount := case when scenario = 'ADVANCING-CUTOFF-SAFE' then 800 else 400 end;
      perform pg_temp.add_source(x, cutoff + 1, case when scenario = 'ADVANCING-CUTOFF-SAFE' then 20000 else 2000 end);
      execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
      perform pg_temp.attempt_withdrawal('M2', f, a, u, gen_random_uuid(), later_date, cutoff, 800);
      select max(s.settled_through) into old_cutoff from public.mud_factory_settlements s where s.factory_id = f;
      perform pg_temp.require(old_cutoff <= new_cutoff and new_cutoff < candidate_date, 'valid advancing cutoff');
      perform pg_temp.assert_identity(u);
      select coalesce(sum(alloc.earned_amount), 0) into new_credit
        from generate_series(old_cutoff + 1, new_cutoff, interval '1 day') ds(day)
        cross join lateral public.get_mud_group_daily_allocation(f, ds.day::date) alloc
        where alloc.labour_group_id = a;
      perform pg_temp.require(new_credit = case when scenario = 'ADVANCING-CUTOFF-SAFE' then 1000 else 100 end,
        'actual newly settleable earnings, not an empty checkpoint');
      new_pool := (pg_temp.money_at('M2', f, a, later_date)->>'eligible_earned')::numeric + new_credit;
      select coalesce(sum(w.amount), 0) into all_w from public.withdrawals w
        where w.factory_id = f and w.labour_group_id = a and w.labourer_id is null;
      pool_ok := all_w + amount <= new_pool;
      -- Independent date-series comparison: actual affected withdrawal business
      -- dates, newly settled pool and cumulative dated debits. No lifetime proxy.
      select jsonb_agg(jsonb_build_object('date', event_date, 'candidate_balance', balance) order by event_date),
        bool_and(balance >= 0) into event_balances, dates_ok
      from (
        select e.event_date, new_pool - amount - coalesce((select sum(w.amount)
          from public.withdrawals w where w.factory_id = f and w.labour_group_id = a
            and w.labourer_id is null and w.withdrawal_date <= e.event_date), 0) balance
        from (select candidate_date event_date union
          select w.withdrawal_date from public.withdrawals w where w.factory_id = f
            and w.labour_group_id = a and w.labourer_id is null
            and w.withdrawal_date >= candidate_date) e
      ) balances;
      if pool_ok is distinct from dates_ok then
        raise exception 'DESIGN MISMATCH: M2 settled pool and affected-date invariants disagree.';
      end if;
      perform pg_temp.require(pool_ok = (scenario = 'ADVANCING-CUTOFF-SAFE'), 'M2 equivalence expected outcome');
      before_rows := pg_temp.financial_snapshot(f); request_id := gen_random_uuid();
      result := pg_temp.attempt_withdrawal('M2', f, a, u, request_id, candidate_date, new_cutoff, amount,
        case when pool_ok then null else 'P3303' end);
      if pool_ok then
        final_money := pg_temp.assert_money('M2', f, a, array[candidate_date, later_date], array[1200, 400], 1600);
        perform pg_temp.require((result #>> '{response,settled_earned}')::numeric = new_pool
          and (result #>> '{response,daily_snapshots}')::integer = 2
          and (result #>> '{response,group_snapshots}')::integer = 4
          and (select sum(s.earned_amount) from public.mud_group_settlement_days s
            where s.factory_id = f and s.labour_group_id = b) = 1000, 'real advanced factory/group snapshots');
      else
        final_money := pg_temp.assert_money('M2', f, a, array[candidate_date, later_date], array[1000, 200], 800);
        perform pg_temp.require(pg_temp.financial_snapshot(f) = before_rows
          and (select max(s.settled_through) from public.mud_factory_settlements s where s.factory_id = f) = old_cutoff
          and not exists(select 1 from public.mud_group_settlement_days s where s.factory_id = f),
          'IMMEDIATE advancing failure restores cutoff/pool and ALL group snapshots');
      end if;
      reports := reports || jsonb_build_array(jsonb_build_object('module', 'M2', 'case', scenario,
        'result', 'PASS', 'previous_cutoff', old_cutoff, 'new_cutoff', new_cutoff,
        'newly_settleable_credit', new_credit, 'prospective_settled_pool', new_pool,
        'all_dates_withdrawals_with_candidate', all_w + amount, 'pool_invariant', pool_ok,
        'affected_date_invariant', dates_ok, 'affected_dates', event_balances,
        'candidate', result, 'final', final_money));
      execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    end loop;

    outsider := pg_temp.make_fixture('M1', 'ISOLATION-OTHER-FACTORY', cutoff);
    manifest := manifest || jsonb_build_array(outsider);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', outsider->>'user_uuid', true);
    perform pg_temp.attempt_withdrawal('M1', (outsider->>'factory_uuid')::uuid,
      (outsider->>'account_uuid')::uuid, (outsider->>'user_uuid')::uuid,
      gen_random_uuid(), cutoff + 4, cutoff, 800);
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);

    x := pg_temp.make_fixture('M2', 'ACCOUNT-ISOLATION', cutoff, true, 100);
    manifest := manifest || jsonb_build_array(x);
    u := (x->>'user_uuid')::uuid; f := (x->>'factory_uuid')::uuid;
    a := (x->>'account_uuid')::uuid; b := (x->>'other_group_uuid')::uuid;
    perform pg_temp.add_source(x, cutoff + 1, 20000);
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.attempt_withdrawal('M2', f, a, u, gen_random_uuid(), cutoff + 4, cutoff + 2, 800);
    perform pg_temp.attempt_withdrawal('M2', f, b, u, gen_random_uuid(), cutoff + 4, cutoff + 2, 500);
    perform pg_temp.require((select sum(w.amount) from public.withdrawals w where w.factory_id = f
      and w.labour_group_id = a and w.labourer_id is null and w.withdrawal_date <= cutoff) = 100
      and (select sum(w.amount) from public.withdrawals w where w.factory_id = f
        and w.labour_group_id = b and w.labourer_id is null) = 500,
      'actual same-group Legacy 100 and other-group 500 financial rows');
    -- Privileged READ ONLY inspection of the outsider row; authenticated own
    -- account tests below still use RLS + actual financial RPCs.
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    perform pg_temp.require((select sum(w.amount) from public.withdrawals w
      where w.factory_id = (outsider->>'factory_uuid')::uuid
        and w.labour_group_id = (outsider->>'account_uuid')::uuid and w.labourer_id is null) = 800,
      'actual other-factory 800 financial row');
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);
    -- Ignoring Legacy would incorrectly permit 1200; counting other-group or
    -- other-factory debits would incorrectly reject the safe boundary 1100.
    result := pg_temp.attempt_withdrawal('M2', f, a, u, gen_random_uuid(), cutoff + 3, cutoff + 2, 1200, 'P3303');
    reports := reports || jsonb_build_array(jsonb_build_object('module', 'M2',
      'case', 'SAME-GROUP-LEGACY-COUNTS', 'result', 'PASS', 'candidate', result));
    result := pg_temp.attempt_withdrawal('M2', f, a, u, gen_random_uuid(), cutoff + 3, cutoff + 2, 1100);
    final_money := pg_temp.assert_money('M2', f, a, array[cutoff + 3, cutoff + 4], array[800, 0], 2000);
    perform pg_temp.assert_money('M2', f, b, array[cutoff + 4], array[500], 500);
    reports := reports || jsonb_build_array(jsonb_build_object('module', 'M2',
      'case', 'OTHER-GROUP-AND-FACTORY-EXCLUDED', 'result', 'PASS',
      'same_group_legacy', 100, 'other_group_withdrawals', 500, 'other_factory_withdrawals', 800,
      'candidate', result, 'final', final_money));
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);

    select array_agg((j->>'user_uuid')::uuid), array_agg((j->>'factory_uuid')::uuid)
      into users, factories from jsonb_array_elements(manifest) j;
    real_rows := pg_temp.persistent_snapshot(factories, users);
    perform pg_temp.require(real_rows = baseline, 'non-synthetic fingerprints unchanged BEFORE rollback');
    -- Only this private marker is swallowed. Unexpected SQL/errors/assertions
    -- abort the verifier, never silently classify a fixture as successful.
    raise exception using errcode = 'Z1213', message = 'Rollback all synthetic fixtures now.';
  exception when sqlstate 'Z1213' then null;
  end;

  after_rollback := pg_temp.persistent_snapshot('{}'::uuid[], '{}'::uuid[]);
  perform pg_temp.require(after_rollback = baseline, 'all 64 public tables and auth.users unchanged');
  perform pg_temp.require(not exists(select 1 from auth.users where id = any(users))
    and not exists(select 1 from public.factories where id = any(factories)),
    'no synthetic fixtures survive fixture rollback');
  perform set_config('atlas12d13a.report', jsonb_build_object('result', 'PASS', 'D', cutoff,
    'case_count', jsonb_array_length(reports), 'cases', reports,
    'synthetic_fixture_manifest', manifest, 'persistent_baseline', baseline,
    'persistent_after_fixture_rollback', after_rollback,
    'all_64_public_tables_and_auth_users_unchanged', true,
    'real_rows_unchanged_before_rollback', real_rows = baseline,
    'no_synthetic_fixtures_remain', true,
    'scope', 'sequential event-date invariants; NOT a concurrency or source/rate-race proof')::text, true);
end;
$proof$;

select current_setting('atlas12d13a.report')::jsonb as execution_report;
rollback;

-- Independent outer-ROLLBACK proof. Full-row hashes remain internal, not printed.
-- E7A: validate the preserved baseline before any cleanup comparison.
do $baseline_guard$
begin
  if pg_catalog.to_regclass('pg_temp.atlas_e6_backdated_baseline') is null then
    raise exception 'FAIL: preserved cleanup baseline is missing';
  end if;
  if exists (select 1 from pg_temp.atlas_e6_backdated_baseline
    where s is null or t is null or n is null or h is null) then
    raise exception 'FAIL: cleanup baseline has NULL identity, count or fingerprint';
  end if;
  if exists (select 1 from pg_temp.atlas_e6_backdated_baseline
    group by s,t having count(*) > 1) then
    raise exception 'FAIL: cleanup baseline has duplicate identities';
  end if;
  if (select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r','p')) <> 64 then
    raise exception 'FAIL: cleanup catalog must contain exactly 64 public tables';
  end if;
  if (select count(*) from pg_temp.atlas_e6_backdated_baseline) <> 65
    or (select count(distinct t) from pg_temp.atlas_e6_backdated_baseline
      where s = 'public') <> 64
    or (select count(*) from pg_temp.atlas_e6_backdated_baseline
      where s = 'auth' and t = 'users') <> 1 then
    raise exception 'FAIL: cleanup baseline requires 64 public identities plus one auth.users identity';
  end if;
  if exists (
    with expected as (
      select ns.nspname::text as schema_name,c.relname::text as table_name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r','p')
      union all select 'auth','users'
    ), actual as (
      select s as schema_name,t as table_name
      from pg_temp.atlas_e6_backdated_baseline
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'FAIL: cleanup baseline identities differ from the catalog plus auth.users';
  end if;
end;
$baseline_guard$;

do $$declare r record; n bigint; h text;begin
  for r in select * from atlas_e6_backdated_baseline order by s,t loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into n,h;
    if n<>r.n or h is distinct from r.h then
      raise exception 'FAIL: post-ROLLBACK count/hash mismatch %.%',r.s,r.t;
    end if;
  end loop;
  raise notice 'PASS [ROLLBACK]: 64 public tables plus auth.users restored in counts and full-row hashes';
end$$;
drop table atlas_e6_backdated_baseline;
