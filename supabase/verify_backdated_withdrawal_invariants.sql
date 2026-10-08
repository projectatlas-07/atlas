-- Atlas 12D1.1: sequential date-order proof, NOT a concurrency test.
-- Run only against Test Atlas Clean via npx supabase db query --linked --file.
-- No persistent helper, migration, real-user fixture, or committed test data.
-- All setup/execution occurs in this one transaction; final statement ROLLBACK.
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

create function pg_temp.money_pair(module text, factory uuid, account uuid, d1 date, d2 date)
returns jsonb language sql as $$
  select jsonb_build_object('D+1', pg_temp.money_at(module, factory, account, d1),
    'D+2', pg_temp.money_at(module, factory, account, d2));
$$;

create function pg_temp.attempt_withdrawal(module text, factory uuid, account uuid,
  expected_user uuid, request_id uuid, request_date date, cutoff date, d1 date, d2 date)
returns jsonb language plpgsql as $$
declare before_money jsonb; after_money jsonb; response jsonb;
  rejected_state text; rejected_message text; balance_rejection boolean := false;
begin
  perform pg_temp.assert_identity(expected_user);
  before_money := pg_temp.money_pair(module, factory, account, d1, d2);
  -- Exception subtransaction rolls back a rejected writer's effects, not the
  -- earlier successful withdrawal. Identity assertion is outside the handler.
  begin
    if module = 'M1' then
      select to_jsonb(r) into strict response
        from public.create_labour_group_withdrawal(factory, account, request_date, 800) r;
    elsif module = 'M2' then
      select to_jsonb(r) into strict response
        from public.create_mud_settlement_withdrawal(factory, request_id, account,
          request_date, cutoff, 800) r;
    else
      select to_jsonb(r) into strict response
        from public.create_transport_worker_withdrawal(factory, account, request_date, 800) r;
    end if;
  exception when others then
    get stacked diagnostics rejected_state = returned_sqlstate, rejected_message = message_text;
  end;
  balance_rejection := coalesce(
    (module in ('M1', 'T1') and rejected_state = 'P0001'
      and rejected_message ~ format('^Withdrawal amount 800(\.0+)? exceeds available balance 200(\.0+)? as of %s\.$', request_date))
    or (module = 'M2' and rejected_state = 'P3303'
      and rejected_message = 'Withdrawal amount exceeds earnings settled through the requested cutoff.'), false);
  after_money := pg_temp.money_pair(module, factory, account, d1, d2);
  return jsonb_build_object('request_date', request_date, 'requested_amount', 800,
    'client_withdrawal_uuid', case when module = 'M2' then request_id else null end,
    'settlement_cutoff', case when module = 'M2' then cutoff else null end,
    'role', current_user, 'auth_uid', auth.uid(), 'identity_asserted', true,
    'before', before_money, 'after', after_money,
    'succeeded', rejected_state is null, 'response', response,
    'rejection_sqlstate', rejected_state, 'stable_error_message', rejected_message,
    'balance_invariant_rejection', balance_rejection,
    'rejection_rule', case when balance_rejection and module = 'M2'
      then 'settled available_balance < 0 after proposed withdrawal (P3303)'
      when balance_rejection then 'requested amount > available balance at withdrawal_date (P0001)'
      when rejected_state is not null then 'FIXTURE-INVALID: not the insufficient-balance rule'
      else null end);
end;
$$;

-- Exact grants on session-only INVOKER helpers; no public schema ACL changes.
grant execute on function pg_temp.assert_identity(uuid),
  pg_temp.money_at(text, uuid, uuid, date),
  pg_temp.money_pair(text, uuid, uuid, date, date),
  pg_temp.attempt_withdrawal(text, uuid, uuid, uuid, uuid, date, date, date, date)
  to authenticated;

do $proof$
#variable_conflict use_variable
declare
  baseline jsonb := pg_temp.persistent_snapshot('{}'::uuid[], '{}'::uuid[]);
  after_rollback jsonb; real_rows_before_rollback jsonb;
  reports jsonb := '[]'::jsonb; decisions jsonb := '[]'::jsonb;
  users uuid[] := '{}'::uuid[]; factories uuid[] := '{}'::uuid[];
  module text; scenario text; owner_id uuid; factory_id uuid; account_id uuid;
  source_labourer uuid; crew_id uuid; request1 uuid; request2 uuid;
  -- Fully completed Monday-Sunday week, safely before both withdrawal dates.
  cutoff date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date - 8;
  week_start date; d1 date; d2 date; r record;
  initial_money jsonb; first_attempt jsonb; second_attempt jsonb; final_money jsonb;
  fixture_valid boolean; outcome_valid boolean; classification text;
  setup_state text; setup_message text; manifest jsonb := '[]'::jsonb;
begin
  if (select count(*) from pg_catalog.pg_tables where schemaname = 'public') <> 63
    or (select count(*) from jsonb_each(baseline)) <> 64 then
    raise exception 'FAIL: expected exactly 63 public tables plus auth.users.';
  end if;
  week_start := cutoff - 6; d1 := cutoff + 1; d2 := cutoff + 2;

  -- Deliberately rolled-back PL/pgSQL subtransaction lets us inspect unchanged
  -- persistent rows BEFORE the final outer ROLLBACK. Only local JSON variables
  -- survive; fixture rows and all their trigger effects do not.
  begin
    foreach module in array array['M1', 'M2', 'T1'] loop
      foreach scenario in array array['BACKDATED', 'SAME-DATE-CONTROL'] loop
        owner_id := gen_random_uuid(); account_id := gen_random_uuid();
        source_labourer := gen_random_uuid(); crew_id := gen_random_uuid();
        request1 := gen_random_uuid(); request2 := gen_random_uuid(); factory_id := null;
        users := array_append(users, owner_id);
        initial_money := null; first_attempt := null; second_attempt := null;
        setup_state := null; setup_message := null; classification := 'FIXTURE-INVALID';
        fixture_valid := false; outcome_valid := false;
        begin
          -- Privileged synthetic prerequisites only, never upsert/reuse real rows.
          insert into auth.users(id, aud, role, email, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          values(owner_id, 'authenticated', 'authenticated', owner_id::text || '@example.invalid',
            now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
          execute 'set local role authenticated';
          perform set_config('request.jwt.claim.sub', owner_id::text, true);
          perform pg_temp.assert_identity(owner_id);
          select * into strict r from public.provision_first_factory('12D1.1 ' || module || ' ' || scenario);
          if not r.created or r.factory_id is null then
            raise exception 'FIXTURE-INVALID: expected new synthetic factory.';
          end if;
          factory_id := r.factory_id; factories := array_append(factories, factory_id);
          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          if module in ('M1', 'M2') then
            insert into public.labourers(id, factory_id, name)
              values(source_labourer, factory_id, '12D1.1 Synthetic production');
            insert into public.labour_groups(id, factory_id, name, member_count, is_active)
              values(account_id, factory_id, '12D1.1 Synthetic Mud', 5, true);
            insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from)
              values(factory_id, account_id, 5, week_start);
            insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from)
              values(factory_id, account_id, 100, week_start);
            insert into public.wage_rates(factory_id, applies_to, rate_per_1000_bricks, effective_from)
              values(factory_id, 'mud_supply', 100, week_start);
            -- Only this completed week's 10,000 bricks: exactly Rs 1,000 earned.
            insert into public.production_entries(id, factory_id, labourer_id, production_date, quantity)
              values(gen_random_uuid(), factory_id, source_labourer, week_start, 10000);
          else
            insert into public.transport_workers(id, factory_id, name)
              values(account_id, factory_id, '12D1.1 Synthetic Transport');
            insert into public.transport_crews(id, factory_id, name)
              values(crew_id, factory_id, '12D1.1 Synthetic crew');
            insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
              values(factory_id, account_id, crew_id);
            insert into public.transport_crew_wage_rates(factory_id, transport_crew_id, effective_from, rate_per_paya)
              values(factory_id, crew_id, week_start, 100);
          end if;

          execute 'set local role authenticated';
          perform set_config('request.jwt.claim.sub', owner_id::text, true);
          perform pg_temp.assert_identity(owner_id);
          if module in ('M1', 'M2') then
            perform public.calculate_mud_supply_wages(factory_id, account_id, week_start);
            if module = 'M2' then
              perform pg_temp.assert_identity(owner_id);
              perform public.transition_mud_accounting_mode(factory_id, 'SHADOW');
              perform pg_temp.assert_identity(owner_id);
              perform public.execute_mud_settlement_cutover(factory_id, cutoff);
              if not exists(select 1 from public.mud_accounting_states s
                where s.factory_id = factory_id and s.accounting_mode = 'SETTLEMENT') then
                raise exception 'FIXTURE-INVALID: atomic cutover did not enter SETTLEMENT.';
              end if;
            end if;
          else
            perform public.save_transport_daily_entry(factory_id, crew_id, week_start, 10, array[account_id]);
            perform pg_temp.assert_identity(owner_id);
            perform public.calculate_transport_weekly_wages(factory_id, week_start);
          end if;
          initial_money := pg_temp.money_pair(module, factory_id, account_id, d1, d2);
          fixture_valid := (initial_money #>> '{D+1,eligible_earned}')::numeric = 1000
            and (initial_money #>> '{D+2,eligible_earned}')::numeric = 1000
            and (initial_money #>> '{D+1,available_balance}')::numeric = 1000
            and (initial_money #>> '{D+2,available_balance}')::numeric = 1000
            and (initial_money #>> '{D+2,total_withdrawals_regardless_of_date}')::numeric = 0;
          if not fixture_valid or request1 = request2 then
            raise exception 'FIXTURE-INVALID: authority must see exactly 1000 at BOTH dates before withdrawals.';
          end if;
          first_attempt := pg_temp.attempt_withdrawal(module, factory_id, account_id,
            owner_id, request1, d2, cutoff, d1, d2);
          second_attempt := pg_temp.attempt_withdrawal(module, factory_id, account_id,
            owner_id, request2, case when scenario = 'BACKDATED' then d1 else d2 end, cutoff, d1, d2);
          final_money := second_attempt->'after';
          outcome_valid := (first_attempt->>'succeeded')::boolean
            and (first_attempt #>> '{response,withdrawal_amount}')::numeric = 800
            and (first_attempt #>> '{after,D+2,date_included_withdrawals}')::numeric = 800
            and (first_attempt #>> '{after,D+2,available_balance}')::numeric = 200;
          if fixture_valid and outcome_valid then
            if (second_attempt->>'balance_invariant_rejection')::boolean
              and (final_money #>> '{D+2,total_withdrawals_regardless_of_date}')::numeric = 800
              and final_money = first_attempt->'after' then
              classification := 'PROTECTED-BY-BALANCE-INVARIANT';
            elsif (second_attempt->>'succeeded')::boolean
              and (second_attempt #>> '{response,withdrawal_amount}')::numeric = 800
              and (final_money #>> '{D+2,total_withdrawals_regardless_of_date}')::numeric = 1600
              and (final_money #>> '{D+2,date_included_withdrawals}')::numeric = 1600
              and (final_money #>> '{D+2,available_balance}')::numeric = -600 then
              classification := 'CONFIRMED VULNERABILITY';
            end if;
          end if;
          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
        exception when others then
          get stacked diagnostics setup_state = returned_sqlstate, setup_message = message_text;
          execute 'reset role';
          perform set_config('request.jwt.claim.sub', '', true);
          classification := 'FIXTURE-INVALID';
        end;
        manifest := manifest || jsonb_build_array(jsonb_build_object('module', module,
          'scenario', scenario, 'user_uuid', owner_id, 'factory_uuid', factory_id, 'account_uuid', account_id));
        reports := reports || jsonb_build_array(jsonb_build_object('module', module,
          'scenario', scenario, 'fixture_valid', fixture_valid, 'cutoff', case when module = 'M2' then cutoff else null end,
          'initial', initial_money, 'later_dated_first', first_attempt, 'second', second_attempt,
          'setup_error_sqlstate', setup_state, 'setup_error_class', setup_message,
          'classification', classification));
        if scenario = 'BACKDATED' then
          decisions := decisions || jsonb_build_array(jsonb_build_object('module', module,
            'earned_D+1', initial_money #> '{D+1,eligible_earned}',
            'earned_D+2', initial_money #> '{D+2,eligible_earned}',
            'total_withdrawals', second_attempt #> '{after,D+2,total_withdrawals_regardless_of_date}',
            'running_balance_D+1', second_attempt #> '{after,D+1,available_balance}',
            'running_balance_D+2', second_attempt #> '{after,D+2,available_balance}',
            'withdrawals_exceed_earned', (second_attempt #>> '{after,D+2,total_withdrawals_regardless_of_date}')::numeric
              > (initial_money #>> '{D+2,eligible_earned}')::numeric,
            'first_negative_date', case
              when (second_attempt #>> '{after,D+1,available_balance}')::numeric < 0 then d1
              when (second_attempt #>> '{after,D+2,available_balance}')::numeric < 0 then d2 else null end,
            'classification', classification));
        end if;
      end loop;
    end loop;
    real_rows_before_rollback := pg_temp.persistent_snapshot(factories, users);
    if real_rows_before_rollback is distinct from baseline then
      raise exception 'FAIL: non-synthetic persistent rows changed before rollback.';
    end if;
    -- This private marker is the ONLY swallowed outer exception; actual safety
    -- errors propagate and abort the whole transaction. Local reports survive.
    raise exception using errcode = 'Z1211', message = 'Rollback all synthetic fixtures now.';
  exception when sqlstate 'Z1211' then
    null;
  end;

  after_rollback := pg_temp.persistent_snapshot('{}'::uuid[], '{}'::uuid[]);
  if after_rollback is distinct from baseline then
    raise exception 'FAIL: persistent counts/fingerprints changed after fixture rollback.';
  end if;
  if exists(select 1 from auth.users where id = any(users))
    or exists(select 1 from public.factories where id = any(factories)) then
    raise exception 'FAIL: synthetic fixtures survived rollback.';
  end if;
  perform set_config('atlas12d11.report', jsonb_build_object(
    'D', cutoff, 'D+1', d1, 'D+2', d2, 'earning_week_start', week_start,
    'synthetic_fixture_manifest', manifest, 'cases', reports,
    'persistent_baseline', baseline, 'persistent_after_fixture_rollback', after_rollback,
    'all_63_public_tables_and_auth_users_unchanged', true,
    'real_rows_unchanged_before_rollback', real_rows_before_rollback = baseline,
    'no_synthetic_fixtures_remain', true, 'decision_table', decisions)::text, true);
end;
$proof$;

-- Retained aggregate evidence; outer ROLLBACK removes session helper DDL too.
select current_setting('atlas12d11.report')::jsonb as execution_report;
rollback;
