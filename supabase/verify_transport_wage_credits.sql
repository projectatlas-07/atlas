-- Atlas 12D1.5E2: PREPARED ONLY. DO NOT execute before migration 76 review.
-- Test Atlas Clean only: nfqdtygpyycaxlaegvcf. No Main authorization.
-- Use the established single-session, stop-on-error CLI rollback runner.
-- All real financial/source RPC calls use authenticated + synthetic auth.uid().
-- Root is used ONLY for synthetic identity/factory setup, catalog inspection,
-- complete safety snapshots, one explicit prior-day replay seed, and rejected
-- immutable-trigger mutation probes. The seed is NOT creation-API evidence.
-- No disabled triggers, no deletion of weekly history, no permanent fixtures.
-- A private subtransaction rolls fixtures back BEFORE counts/fingerprints and
-- residue are asserted; the outer transaction ALSO ends with ROLLBACK.
-- Compare the reported baseline with an independent post-outer-ROLLBACK snapshot
-- when authorized to execute. Never run individual statements in new sessions.
-- Sequential A-N cases are NOT concurrent-session or hosted isolation proof.
-- Migration 75 + audited correction credits must reach Main together.
begin isolation level repeatable read;

create function pg_temp.require(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end;
$$;

create function pg_temp.assert_identity(expected_user uuid) returns void
language plpgsql as $$
begin
  perform pg_temp.require(current_user = 'authenticated'
    and auth.uid() is not distinct from expected_user, 'exact authenticated synthetic actor');
end;
$$;

-- Aggregate fingerprints only: never emit real users, names, emails or records.
create function pg_temp.persistent_snapshot(excluded_factories uuid[] default '{}',
  excluded_users uuid[] default '{}') returns jsonb language plpgsql as $$
declare t record; n bigint; digest text; result jsonb := '{}';
begin
  perform pg_temp.require((select count(*) from pg_catalog.pg_tables
    where schemaname = 'public') = 64, '64 public tables after the single credit ledger');
  for t in select schemaname, tablename from pg_catalog.pg_tables
    where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')
    order by schemaname, tablename
  loop
    execute format('select count(*), md5(coalesce(string_agg(h, '''' order by h), ''''))
      from (select md5(to_jsonb(r)::text) h from %I.%I r
        where coalesce(to_jsonb(r)->>''factory_id'', '''') <> all($1)
          and coalesce(to_jsonb(r)->>''id'', '''') <> all($2)) s',
      t.schemaname, t.tablename) into n, digest using excluded_factories::text[],
        (excluded_factories || excluded_users)::text[];
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
      where exists (select 1 from jsonb_each_text(to_jsonb(r)) v
        where v.value = any($1))', t.schemaname, t.tablename)
      into n using ids::text[];
    if n <> 0 then result := result || jsonb_build_object(t.schemaname || '.' || t.tablename, n); end if;
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

create function pg_temp.financial_snapshot(factory uuid) returns jsonb
language sql as $$
  select pg_temp.scoped_snapshot(factory, array['transport_wage_credits',
    'transport_weekly_earnings', 'transport_weekly_earning_details', 'transport_withdrawals',
    'transport_daily_entries', 'transport_daily_attendance', 'transport_crew_wage_rates']);
$$;

-- The expected-error subtransaction also undoes an unexpectedly accepted write
-- before propagating FAIL. Immediate row fingerprints are checked on rejection.
create function pg_temp.reject_unchanged(label text, statement text, state text,
  message text, factory uuid) returns void language plpgsql as $$
declare before_rows jsonb; actual_state text; actual_message text;
begin
  before_rows := pg_temp.financial_snapshot(factory);
  begin
    execute statement;
    raise exception 'FAIL: % unexpectedly accepted', label using errcode = 'Z15E0';
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate, actual_message = message_text;
    if actual_state is distinct from state or actual_message is distinct from message then raise; end if;
  end;
  perform pg_temp.require(before_rows = pg_temp.financial_snapshot(factory),
    label || ': immediate source/earnings/credit/withdrawal fingerprints unchanged');
end;
$$;

create function pg_temp.credit_sql(factory uuid, id uuid, worker uuid, work_date date,
  amount numeric, reason text) returns text language sql as $$
  select format('select * from public.create_transport_wage_credit(%L::uuid,%L::uuid,%L::uuid,%L::date,%L::numeric,%L::text)',
    factory, id, worker, work_date, amount, reason);
$$;

create function pg_temp.withdrawal_sql(factory uuid, worker uuid, day date, amount numeric)
returns text language sql as $$
  select format('select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,%L::date,%L::numeric)',
    factory, worker, day, amount);
$$;

create function pg_temp.balance_is(factory uuid, worker uuid, day date,
  earned numeric, withdrawn numeric, available numeric) returns void language plpgsql as $$
declare b record;
begin
  select * into strict b from public.get_transport_worker_available_balance(factory, worker, day);
  perform pg_temp.require(b.total_earned = earned and b.total_withdrawn = withdrawn
    and b.available_balance = available, 'exact NUMERIC authoritative balance at ' || day::text);
end;
$$;

-- Preserve the exact existing SQLSTATE/message, including NUMERIC display
-- scale inherited from weekly division. Do not assume a balance prints as 200
-- rather than 200.0000000000000000. Check the amount mathematically as well.
create function pg_temp.reject_withdrawal(label text, factory uuid, worker uuid,
  day date, amount numeric, failure_day date, expected_headroom numeric)
returns void language plpgsql as $$
declare b record;
begin
  select * into strict b from public.get_transport_worker_available_balance(factory,worker,failure_day);
  perform pg_temp.require(b.available_balance = expected_headroom, label || ': exact rejection headroom');
  perform pg_temp.reject_unchanged(label,pg_temp.withdrawal_sql(factory,worker,day,amount),
    'P0001',format('Withdrawal amount %s exceeds available balance %s as of %s.',
      amount,b.available_balance,failure_day),factory);
end;
$$;

do $proof$
declare
  u uuid := '12d15e20-0000-4000-8000-000000000001';
  f uuid := '12d15e20-0000-4000-8000-000000000002';
  outsider uuid := '12d15e20-0000-4000-8000-000000000003';
  other_factory uuid := '12d15e20-0000-4000-8000-000000000004';
  second_actor uuid := '12d15e20-0000-4000-8000-000000000005';
  inactive_actor uuid := '12d15e20-0000-4000-8000-000000000006';
  workers uuid[] := array['12d15e20-0000-4000-8000-000000000010'::uuid,
    '12d15e20-0000-4000-8000-000000000011'::uuid,
    '12d15e20-0000-4000-8000-000000000012'::uuid,
    '12d15e20-0000-4000-8000-000000000013'::uuid,
    '12d15e20-0000-4000-8000-000000000014'::uuid,
    '12d15e20-0000-4000-8000-000000000015'::uuid,
    '12d15e20-0000-4000-8000-000000000016'::uuid];
  ca uuid := '12d15e20-0000-4000-8000-000000000020';
  cb uuid := '12d15e20-0000-4000-8000-000000000021';
  foreign_crew uuid := '12d15e20-0000-4000-8000-000000000030';
  foreign_worker uuid := '12d15e20-0000-4000-8000-000000000031';
  foreign_credit uuid := '12d15e20-0000-4000-8000-000000000048';
  historical_credit uuid := '12d15e20-0000-4000-8000-000000000049';
  credit_ids uuid[] := array['12d15e20-0000-4000-8000-000000000040'::uuid,
    '12d15e20-0000-4000-8000-000000000041'::uuid,
    '12d15e20-0000-4000-8000-000000000042'::uuid,
    '12d15e20-0000-4000-8000-000000000043'::uuid,
    '12d15e20-0000-4000-8000-000000000044'::uuid,
    '12d15e20-0000-4000-8000-000000000045'::uuid,
    '12d15e20-0000-4000-8000-000000000046'::uuid,
    '12d15e20-0000-4000-8000-000000000047'::uuid];
  today date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  ws date := date_trunc('week', today)::date - 21;
  reserved uuid[]; ids uuid[]; generated uuid[];
  baseline jsonb; non_synthetic jsonb; clean jsonb; saved_weekly jsonb;
  before_rows jsonb; before_cash jsonb; after_cash jsonb;
  cases jsonb := '[]'; rejection_count integer := 0;
  r record; first_credit record; fn record; sig text; value numeric; d date; text_value text;
  caller name := current_user;
begin
  reserved := array[u, f, outsider, other_factory, second_actor, inactive_actor,
    ca, cb, foreign_crew, foreign_worker, foreign_credit, historical_credit] || workers || credit_ids;
  ids := reserved;
  perform pg_temp.require(caller <> 'authenticated' and auth.uid() is null,
    'privileged setup without inherited JWT');
  baseline := pg_temp.persistent_snapshot();
  perform pg_temp.require(pg_temp.fixture_residue(reserved) = '{}', 'reserved IDs absent before setup');
  perform pg_temp.require((select bool_and(c.relrowsecurity) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
    'all 64 public tables retain RLS');
  foreach sig in array array[
    'public.create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text)',
    'public.get_transport_worker_available_balance(uuid,uuid,date)',
    'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)'
  ] loop
    select p.* into strict fn from pg_proc p where p.oid = sig::regprocedure;
    perform pg_temp.require(fn.prosecdef and fn.proconfig @> array['search_path=pg_catalog, public']
      and has_function_privilege('authenticated', fn.oid, 'EXECUTE')
      and not has_function_privilege('anon', fn.oid, 'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner)))
        where grantee = 0 and privilege_type = 'EXECUTE'), sig || ': authenticated, fixed-path, no anon/PUBLIC');
  end loop;
  foreach sig in array array['public.get_transport_worker_earning_events(uuid,uuid)',
    'public.prevent_transport_wage_credit_mutation()'] loop
    select p.* into strict fn from pg_proc p where p.oid = sig::regprocedure;
    perform pg_temp.require(not has_function_privilege('authenticated', fn.oid, 'EXECUTE')
      and not has_function_privilege('anon', fn.oid, 'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner)))
        where grantee = 0 and privilege_type = 'EXECUTE'), sig || ': no direct authenticated/anon/PUBLIC execution');
  end loop;
  perform pg_temp.require(has_table_privilege('authenticated', 'public.transport_wage_credits', 'SELECT')
    and not has_table_privilege('authenticated', 'public.transport_wage_credits', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('anon', 'public.transport_wage_credits', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
    'credit table read-only authenticated and inaccessible to anon');
  perform pg_temp.require((select proargnames[1:6] = array['p_factory_id','p_credit_id',
    'p_transport_worker_id','p_original_work_date','p_amount','p_reason']::text[] from pg_proc
    where oid = 'public.create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text)'::regprocedure),
    'no client actor/posting-date parameters');

  begin
    insert into auth.users(id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select x, 'authenticated', 'authenticated', 'atlas-12d15e2-' || ord || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now()
    from unnest(array[u, outsider, second_actor, inactive_actor]) with ordinality s(x, ord);
    insert into public.factories(id, name)
      values(f, 'Atlas 12D1.5E2 synthetic'), (other_factory, 'Atlas 12D1.5E2 outsider');
    insert into public.factory_users(user_id, factory_id, is_active)
      values(u, f, true), (second_actor, f, true), (inactive_actor, f, false), (outsider, other_factory, true);

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', outsider::text, true);
    perform pg_temp.assert_identity(outsider);
    insert into public.transport_workers(id, factory_id, name)
      values(foreign_worker, other_factory, 'Synthetic foreign worker');
    insert into public.transport_crews(id, factory_id, name)
      values(foreign_crew, other_factory, 'Synthetic foreign crew');
    insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
      values(other_factory, foreign_worker, foreign_crew);
    perform public.create_transport_crew_wage_rate(other_factory, foreign_crew, ws - 7, 100);
    perform public.save_transport_daily_entry(other_factory, foreign_crew, ws, 1, array[foreign_worker]);
    perform public.calculate_transport_weekly_wages(other_factory, ws);
    perform public.create_transport_wage_credit(other_factory,foreign_credit,foreign_worker,ws,25.25,'Foreign missed wages');
    perform pg_temp.require(exists(select 1 from public.transport_wage_credits
      where id = foreign_credit and factory_id = other_factory), 'outsider can read own actual credit');
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    -- Other-factory fixtures and all real rows are included in this baseline.
    non_synthetic := pg_temp.persistent_snapshot(array[f], array[u, second_actor, inactive_actor]);

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.assert_identity(u);
    insert into public.transport_workers(id, factory_id, name)
      select x, f, 'Synthetic worker ' || ord from unnest(workers) with ordinality s(x, ord);
    insert into public.transport_crews(id, factory_id, name)
      values(ca, f, 'Synthetic crew A'), (cb, f, 'Synthetic crew B');
    insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
      select f, x, ca from unnest(array[workers[1],workers[4],workers[5],workers[6]]) s(x);
    insert into public.transport_crew_assignments(factory_id, transport_worker_id, transport_crew_id)
      values(f, workers[1], cb);
    perform public.create_transport_crew_wage_rate(f, ca, ws - 7, 250);
    perform public.create_transport_crew_wage_rate(f, cb, ws - 7, 500);
    -- Worker 1 earns 500 from each crew, not 1,000 from each repeated pool.
    perform public.save_transport_daily_entry(f, ca, ws, 2, array[workers[1]]);
    perform public.save_transport_daily_entry(f, cb, ws, 1, array[workers[1]]);
    perform public.save_transport_daily_entry(f, ca, ws + 1, 4, array[workers[4]]);
    perform public.save_transport_daily_entry(f, ca, ws + 2, 4, array[workers[5]]);
    perform public.save_transport_daily_entry(f, ca, ws + 3, 4, array[workers[6]]);
    select * into strict r from public.calculate_transport_weekly_wages(f, ws);
    perform pg_temp.require(r.workers_calculated = 4 and r.detail_rows_created = 5,
      'real authenticated calculation: four 1,000 headers and five source details');
    perform pg_temp.require(not exists (
      select 1 from public.transport_weekly_earnings e
      where e.factory_id = f and (e.total_amount <> 1000 or e.total_amount is distinct from
        (select sum(d.worker_daily_share_snapshot) from public.transport_weekly_earning_details d
          where d.factory_id = e.factory_id and d.transport_weekly_earning_id = e.id
            and d.transport_worker_id = e.transport_worker_id and d.week_start = e.week_start))
    ), 'exact NUMERIC per-worker header/detail reconciliation');
    update public.transport_workers set is_active = false where id = workers[3] and factory_id = f;
    perform pg_temp.require(not exists(select 1 from public.transport_weekly_earnings
      where factory_id = f and transport_worker_id in (workers[2],workers[3])), 'omitted and archived workers have no header');
    saved_weekly := pg_temp.scoped_snapshot(f, array['transport_weekly_earnings','transport_weekly_earning_details']);
    execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
    -- Simulate an already-saved prior-day row solely to exercise cross-day
    -- replay through the real authenticated RPC. Never alter a saved row/date.
    insert into public.transport_wage_credits(id,factory_id,transport_worker_id,
      original_work_date,posting_date,amount,reason,actor_id,created_at)
    values(historical_credit,f,workers[7],ws,today-1,5,'Historical replay fixture',u,
      ((today-1)::timestamp at time zone 'Asia/Kolkata') + interval '12 hours');
    select coalesce(jsonb_agg(to_jsonb(m) order by m.source_type,m.source_id), '[]') into before_cash
      from public.get_cash_book_source_movements(f) m;
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true);

    -- A/B: server date, actor, normalized reason, exact paise and pre-posting boundary.
    perform pg_temp.balance_is(f, workers[1], today - 1, 1000, 0, 1000);
    select * into strict first_credit from public.create_transport_wage_credit(
      f, credit_ids[1], workers[1], ws + 1, 100.25, '  Missed crew allowance  ');
    perform pg_temp.require(first_credit.credit_id = credit_ids[1] and first_credit.factory_id = f
      and first_credit.transport_worker_id = workers[1] and first_credit.actor_id = u
      and first_credit.original_work_date = ws + 1 and first_credit.posting_date = today
      and first_credit.amount = 100.25 and first_credit.reason = 'Missed crew allowance'
      and first_credit.posting_date = (first_credit.created_at at time zone 'Asia/Kolkata')::date
      and not first_credit.was_replayed, 'A: authoritative saved credit, actor and posting timestamp');
    perform pg_temp.balance_is(f, workers[1], today, 1100.25, 0, 1100.25);
    cases := cases || jsonb_build_array('A_POSITIVE_CREDIT');
    perform pg_temp.balance_is(f, workers[1], today - 1, 1000, 0, 1000);
    perform pg_temp.balance_is(f, workers[1], ws, 0, 0, 0);
    cases := cases || jsonb_build_array('B_PRE_POSTING_UNCHANGED');

    before_rows := pg_temp.financial_snapshot(f);
    select * into strict r from public.create_transport_wage_credit(
      f, credit_ids[1], workers[1], ws + 1, 100.250, 'Missed crew allowance');
    perform pg_temp.require(r.was_replayed and r.credit_id = first_credit.credit_id
      and r.posting_date = first_credit.posting_date and r.created_at = first_credit.created_at
      and r.actor_id = first_credit.actor_id
      and (to_jsonb(r) - 'was_replayed') = (to_jsonb(first_credit) - 'was_replayed')
      and pg_temp.financial_snapshot(f) = before_rows,
      'C: replay retains exact original result and changes no row');
    perform pg_temp.balance_is(f, workers[1], today, 1100.25, 0, 1100.25);
    select * into strict r from public.create_transport_wage_credit(
      f,historical_credit,workers[7],ws,5,'  Historical replay fixture  ');
    perform pg_temp.require(r.was_replayed and r.posting_date = today-1
      and r.created_at = ((today-1)::timestamp at time zone 'Asia/Kolkata') + interval '12 hours'
      and pg_temp.financial_snapshot(f) = before_rows, 'C: replay preserves original prior-day posting date');
    perform pg_temp.balance_is(f,workers[7],today-2,0,0,0);
    perform pg_temp.balance_is(f,workers[7],today-1,5,0,5);
    cases := cases || jsonb_build_array('C_UUID_REPLAY');

    -- D: conflicts for every payload identity; no creation or history mutation.
    perform pg_temp.reject_unchanged('conflicting amount',
      pg_temp.credit_sql(f,credit_ids[1],workers[1],ws+1,100.26,'Missed crew allowance'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',f);
    perform pg_temp.reject_unchanged('conflicting reason',
      pg_temp.credit_sql(f,credit_ids[1],workers[1],ws+1,100.25,'Different reason'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',f);
    perform pg_temp.reject_unchanged('conflicting work date',
      pg_temp.credit_sql(f,credit_ids[1],workers[1],ws+2,100.25,'Missed crew allowance'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',f);
    perform pg_temp.reject_unchanged('conflicting worker',
      pg_temp.credit_sql(f,credit_ids[1],workers[2],ws+1,100.25,'Missed crew allowance'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',f);
    perform set_config('request.jwt.claim.sub', second_actor::text, true);
    perform pg_temp.assert_identity(second_actor);
    perform pg_temp.reject_unchanged('different actor replay',
      pg_temp.credit_sql(f,credit_ids[1],workers[1],ws+1,100.25,'Missed crew allowance'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',f);
    perform set_config('request.jwt.claim.sub', outsider::text, true);
    perform pg_temp.assert_identity(outsider);
    perform pg_temp.reject_unchanged('cross-factory UUID collision',
      pg_temp.credit_sql(other_factory,credit_ids[1],foreign_worker,ws+1,100.25,'Missed crew allowance'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',other_factory);
    perform pg_temp.require(not exists(select 1 from public.transport_wage_credits where factory_id = f),
      'outsider cannot read collided credit');
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform pg_temp.assert_identity(u);
    perform pg_temp.reject_unchanged('reverse cross-factory UUID collision',
      pg_temp.credit_sql(f,foreign_credit,workers[1],ws,25.25,'Foreign missed wages'),
      'P2632','ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT',f);
    rejection_count := rejection_count + 7;
    cases := cases || jsonb_build_array('D_CONFLICT_AND_CROSS_FACTORY_REPLAY');

    -- G: omitted worker receives explicit separate crew corrections; archived
    -- worker is eligible without assignment or any original weekly header.
    perform public.create_transport_wage_credit(f,credit_ids[2],workers[2],ws,60,'Missed crew A work');
    perform set_config('request.jwt.claim.sub', second_actor::text, true);
    perform pg_temp.assert_identity(second_actor);
    select * into strict r from public.create_transport_wage_credit(
      f,credit_ids[3],workers[2],ws,40,'Missed crew B work');
    perform pg_temp.require(r.actor_id = second_actor, 'any active member may create a fresh credit');
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform public.create_transport_wage_credit(f,credit_ids[4],workers[3],ws+2,25.50,'Missed archived worker');
    perform pg_temp.balance_is(f,workers[2],today,100,0,100);
    perform pg_temp.balance_is(f,workers[3],today,25.50,0,25.50);
    perform pg_temp.require(not exists(select 1 from public.transport_weekly_earnings
      where factory_id = f and transport_worker_id in (workers[2],workers[3]))
      and saved_weekly = pg_temp.scoped_snapshot(f,array['transport_weekly_earnings','transport_weekly_earning_details']),
      'G: multiple crew corrections do not create headers or redistribute shares');
    cases := cases || jsonb_build_array('G_ARCHIVED_OMITTED_MULTI_CREW');

    -- H: an empty completed week is not finalized even after no-work calculation.
    select * into strict r from public.calculate_transport_weekly_wages(f,ws+7);
    perform pg_temp.require(r.workers_calculated = 0 and r.detail_rows_created = 0 and r.rows_skipped = 0,
      'no-work calculation creates no finalized week');
    perform pg_temp.reject_unchanged('unfinalized original week',
      pg_temp.credit_sql(f,credit_ids[8],workers[1],ws+7,10,'Unfinalized'),
      'P2631','ATLAS_TRANSPORT_CREDIT_WEEK_NOT_FINALIZED',f);
    rejection_count := rejection_count + 1;
    cases := cases || jsonb_build_array('H_UNFINALIZED_WEEK');

    -- I: invalid values reach the actual authenticated RPC, not duplicated math.
    foreach value in array array[null::numeric,0,-1,1.001,'NaN'::numeric,
      'Infinity'::numeric,'-Infinity'::numeric] loop
      perform pg_temp.reject_unchanged('invalid amount',
        pg_temp.credit_sql(f,credit_ids[8],workers[1],ws,value,'Validation'), '22023',
        'amount must be positive, finite and have at most two decimal places.',f);
      rejection_count := rejection_count + 1;
    end loop;
    foreach d in array array[null::date,'infinity'::date,'-infinity'::date] loop
      perform pg_temp.reject_unchanged('invalid original date',
        pg_temp.credit_sql(f,credit_ids[8],workers[1],d,10,'Validation'), '22023',
        'original_work_date must be a valid finite date.',f);
      rejection_count := rejection_count + 1;
    end loop;
    perform pg_temp.reject_unchanged('future work date',
      pg_temp.credit_sql(f,credit_ids[8],workers[1],today+1,10,'Validation'), '22023',
      'original_work_date cannot be after the posting date.',f);
    foreach text_value in array array[null::text,'','   ',E'\t\n'] loop
      perform pg_temp.reject_unchanged('empty reason',
        pg_temp.credit_sql(f,credit_ids[8],workers[1],ws,10,text_value), '22023','reason is required.',f);
      rejection_count := rejection_count + 1;
    end loop;
    perform pg_temp.reject_unchanged('null credit UUID',
      pg_temp.credit_sql(f,null,workers[1],ws,10,'Validation'), '22023','credit_id is required.',f);
    rejection_count := rejection_count + 2;
    -- Exact 0.01 is accepted, not rounded, and remains a positive separate credit.
    select * into strict r from public.create_transport_wage_credit(f,credit_ids[7],workers[3],ws,0.01,'One paise');
    perform pg_temp.require(r.amount = 0.01, 'one-paise boundary accepted exactly');
    cases := cases || jsonb_build_array('I_INPUT_VALIDATION');

    -- J: auth/RLS and direct write protection. Neither code nor table input may
    -- claim a client-chosen actor or posting date through the public RPC.
    perform pg_temp.reject_unchanged('foreign worker',
      pg_temp.credit_sql(f,credit_ids[8],foreign_worker,ws,10,'Foreign'),
      '42501','Transport worker does not belong to this factory.',f);
    perform pg_temp.reject_unchanged('foreign factory',
      pg_temp.credit_sql(other_factory,credit_ids[8],foreign_worker,ws,10,'Foreign'),
      '42501','You do not have access to this factory.',f);
    perform pg_temp.require(not exists(select 1 from public.transport_weekly_earnings where factory_id = other_factory),
      'other-factory original earnings hidden by RLS');
    perform pg_temp.require(not exists(select 1 from public.transport_wage_credits where id = foreign_credit),
      'real other-factory credit hidden by RLS');
    perform pg_temp.reject_unchanged('direct insert',format(
      'insert into public.transport_wage_credits(id,factory_id,transport_worker_id,original_work_date,posting_date,amount,reason,actor_id,created_at) values(%L,%L,%L,%L,%L,10,%L,%L,now())',
      credit_ids[8],f,workers[1],ws,today-1,'Forged',second_actor),
      '42501','permission denied for table transport_wage_credits',f);
    perform pg_temp.reject_unchanged('direct update',format(
      'update public.transport_wage_credits set amount = 1 where id = %L',credit_ids[1]),
      '42501','permission denied for table transport_wage_credits',f);
    perform pg_temp.reject_unchanged('direct delete',format(
      'delete from public.transport_wage_credits where id = %L',credit_ids[1]),
      '42501','permission denied for table transport_wage_credits',f);
    perform pg_temp.reject_unchanged('direct truncate','truncate public.transport_wage_credits',
      '42501','permission denied for table transport_wage_credits',f);
    perform set_config('request.jwt.claim.sub', inactive_actor::text,true);
    perform pg_temp.assert_identity(inactive_actor);
    perform pg_temp.require(not exists(select 1 from public.transport_wage_credits where factory_id = f),
      'inactive membership reads no credits');
    perform pg_temp.reject_unchanged('inactive member',
      pg_temp.credit_sql(f,credit_ids[8],workers[1],ws,10,'Inactive'),
      '42501','You do not have access to this factory.',f);
    perform set_config('request.jwt.claim.sub','',true);
    perform pg_temp.assert_identity(null);
    perform pg_temp.reject_unchanged('missing identity',
      pg_temp.credit_sql(f,credit_ids[8],workers[1],ws,10,'Unauthenticated'),
      '42501','You do not have access to this factory.',f);
    perform set_config('request.jwt.claim.sub',u::text,true);
    rejection_count := rejection_count + 8;

    execute 'reset role'; perform set_config('request.jwt.claim.sub','',true);
    perform pg_temp.reject_unchanged('immutable update trigger',format(
      'update public.transport_wage_credits set reason = %L where id = %L','Changed',credit_ids[1]),
      'P2633','ATLAS_TRANSPORT_WAGE_CREDIT_IMMUTABLE',f);
    perform pg_temp.reject_unchanged('immutable delete trigger',format(
      'delete from public.transport_wage_credits where id = %L',credit_ids[1]),
      'P2633','ATLAS_TRANSPORT_WAGE_CREDIT_IMMUTABLE',f);
    rejection_count := rejection_count + 2;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.source_type,m.source_id), '[]') into after_cash
      from public.get_cash_book_source_movements(f) m;
    perform pg_temp.require(before_cash = after_cash and not exists(
      select 1 from public.transport_withdrawals where factory_id in (f,other_factory)),
      'L: credits and replays create neither withdrawals nor Cash Book movement');
    execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',u::text,true);
    cases := cases || jsonb_build_array('J_AUTH_RLS_IMMUTABILITY','L_NOT_A_PAYMENT');

    -- E: payable only on posting date; archived worker can withdraw later.
    perform pg_temp.balance_is(f,workers[2],today-1,0,0,0);
    perform pg_temp.reject_withdrawal('cannot spend future-posted credit',
      f,workers[2],today-1,1,today-1,0);
    perform pg_temp.reject_withdrawal('credit balance not exceeded',
      f,workers[2],today,101,today,100);
    select * into strict r from public.create_transport_worker_withdrawal(f,workers[3],today,25.51);
    perform pg_temp.require(r.withdrawal_amount = 25.51 and r.available_balance = 0,
      'archived worker real withdrawal spends exact credits');
    perform pg_temp.balance_is(f,workers[3],today,25.51,25.51,0);
    rejection_count := rejection_count + 2;
    cases := cases || jsonb_build_array('E_NO_EARLY_OR_EXCESS_SPENDING');

    -- F1: old exploit rejects at its later affected date; legitimate backdating remains.
    perform public.create_transport_worker_withdrawal(f,workers[4],today-1,800);
    perform pg_temp.reject_withdrawal('backdated 800 after later 800',
      f,workers[4],today-2,800,today-1,200);
    perform public.create_transport_worker_withdrawal(f,workers[4],today-2,200);
    perform pg_temp.balance_is(f,workers[4],today-2,1000,200,800);
    perform pg_temp.balance_is(f,workers[4],today-1,1000,1000,0);

    -- F2: same-date aggregate protects the original 1,000. A later credit is
    -- an event, not permission to ignore intermediate later withdrawal dates.
    perform public.create_transport_worker_withdrawal(f,workers[5],today,800);
    perform pg_temp.reject_withdrawal('same-date 800 plus 800',
      f,workers[5],today,800,today,200);
    perform public.create_transport_wage_credit(f,credit_ids[5],workers[5],ws+2,100,'Extra missed wages');
    perform public.create_transport_worker_withdrawal(f,workers[5],today+1,250);
    perform public.create_transport_worker_withdrawal(f,workers[5],today+2,25);
    perform pg_temp.reject_withdrawal('first later withdrawal date',
      f,workers[5],today-1,100,today+1,50);
    perform pg_temp.reject_withdrawal('second later withdrawal date',
      f,workers[5],today-1,50,today+2,25);
    perform public.create_transport_worker_withdrawal(f,workers[5],today-1,25);
    perform pg_temp.balance_is(f,workers[5],today,1100,825,275);
    perform pg_temp.balance_is(f,workers[5],today+1,1100,1075,25);
    perform pg_temp.balance_is(f,workers[5],today+2,1100,1100,0);

    -- F3: later positive posting event makes a legitimate backdated withdrawal
    -- safe, without increasing earnings available at that withdrawal's own date.
    perform public.create_transport_wage_credit(f,credit_ids[6],workers[6],ws+3,200,'Later posted recovery');
    perform public.create_transport_worker_withdrawal(f,workers[6],today+1,1100);
    select * into strict r from public.create_transport_worker_withdrawal(f,workers[6],today-1,100);
    perform pg_temp.require(r.available_balance = 900, 'own-date response excludes later-posted 200');
    perform pg_temp.balance_is(f,workers[6],today-1,1000,100,900);
    perform pg_temp.balance_is(f,workers[6],today+1,1200,1200,0);
    rejection_count := rejection_count + 4;
    cases := cases || jsonb_build_array('F_SAME_DATE_AND_LATER_INVARIANTS');

    perform pg_temp.require(saved_weekly = pg_temp.scoped_snapshot(f,
      array['transport_weekly_earnings','transport_weekly_earning_details']),
      'K: all weekly header/detail bytes unchanged after all credits and withdrawals');
    perform pg_temp.require(not exists(select 1 from public.transport_wage_credits where id = credit_ids[8]),
      'M: all rejected creations leave no candidate row');
    -- Fail closed at a midnight boundary; never change server dates for tests.
    perform pg_temp.require(today = (clock_timestamp() at time zone 'Asia/Kolkata')::date,
      'same business day throughout proof; rerun unchanged if crossing midnight');
    cases := cases || jsonb_build_array('K_ORIGINAL_SNAPSHOTS','M_REJECTION_ATOMICITY');

    execute 'reset role'; perform set_config('request.jwt.claim.sub','',true);
    perform pg_temp.require(current_user = caller and auth.uid() is null, 'root/JWT restored for safety snapshots');
    perform pg_temp.require(non_synthetic = pg_temp.persistent_snapshot(array[f],array[u,second_actor,inactive_actor]),
      'all real and other-factory rows unchanged BEFORE fixture rollback');
    select array_agg(id) into generated from (
      select id from public.factory_users where factory_id in(f,other_factory)
      union all select id from public.transport_crew_assignments where factory_id in(f,other_factory)
      union all select id from public.transport_crew_wage_rates where factory_id in(f,other_factory)
      union all select id from public.transport_daily_entries where factory_id in(f,other_factory)
      union all select id from public.transport_daily_attendance where factory_id in(f,other_factory)
      union all select id from public.transport_weekly_earnings where factory_id in(f,other_factory)
      union all select id from public.transport_weekly_earning_details where factory_id in(f,other_factory)
      union all select id from public.transport_withdrawals where factory_id in(f,other_factory)
    ) s;
    ids := ids || coalesce(generated,'{}'::uuid[]);
    perform pg_temp.require(jsonb_array_length(cases) = 13, 'A-M major cases reached');
    perform pg_temp.require(rejection_count = 40, 'all 40 exact expected rejection probes reached');
    raise exception 'Rollback all Transport wage-credit fixtures' using errcode = 'Z15E2';
  exception when sqlstate 'Z15E2' then
    if sqlerrm <> 'Rollback all Transport wage-credit fixtures' then raise; end if;
  end;

  perform pg_temp.require(current_user = caller and auth.uid() is null, 'fixture rollback restores root/JWT');
  clean := pg_temp.persistent_snapshot();
  perform pg_temp.require(clean = baseline, 'N: all 64 public tables and auth.users counts/fingerprints unchanged');
  perform pg_temp.require(pg_temp.fixture_residue(ids) = '{}', 'N: all reserved/generated synthetic IDs absent');
  cases := cases || jsonb_build_array('N_ROLLBACK_AND_RESIDUE');
  perform pg_temp.require(jsonb_array_length(cases) = 14, 'all A-N major cases complete');
  perform set_config('atlas12d15e2.report',jsonb_build_object('result','PASS',
    'major_cases',cases,'major_cases_passed',14,'expected_rejections',rejection_count,
    'public_tables',64,'persistent_before',baseline,'persistent_after_fixture_rollback',clean,
    'synthetic_identifiers',ids,'synthetic_residue',pg_temp.fixture_residue(ids),
    'concurrent_sessions','NOT TESTED','hosted_rpc_isolation','NOT PROVEN',
    'external_post_outer_rollback_comparison','REQUIRED WHEN EXECUTED')::text,true);
end;
$proof$;

select current_setting('atlas12d15e2.report')::jsonb as execution_report;
rollback;
