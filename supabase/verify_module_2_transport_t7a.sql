-- Atlas Chamber Transport T7A balance and controlled-withdrawal verifier.
-- Run after applying 20260818000006_create_transport_withdrawals.sql.
-- Requires one existing public.factory_users row. All fixtures and mapping
-- changes are transactional and discarded by the final rollback.

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
  raise exception 'FAIL: % unexpectedly succeeded', test_label
    using errcode = 'P9999';
exception
  when others then
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
  table_rls_enabled boolean;
  create_definition text;
  balance_definition text;
  production_definition text;
  mud_definition text;
  create_routine record;
  balance_routine record;
  table_name text;
begin
  select relrowsecurity
    into table_rls_enabled
  from pg_catalog.pg_class
  where oid = 'public.transport_withdrawals'::regclass;

  if not table_rls_enabled then
    raise exception 'FAIL: RLS is not enabled on transport_withdrawals';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_withdrawals'::regclass
      and conname = 'transport_withdrawals_date_check'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_withdrawals'::regclass
      and conname = 'transport_withdrawals_amount_check'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_withdrawals'::regclass
      and conname = 'transport_withdrawals_worker_factory_fkey'
  ) then
    raise exception 'FAIL: transport withdrawal date, amount, or same-factory constraint is missing';
  end if;

  if not has_table_privilege(
    'authenticated', 'public.transport_withdrawals', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.transport_withdrawals', 'INSERT'
  ) or has_table_privilege(
    'authenticated', 'public.transport_withdrawals', 'UPDATE'
  ) or has_table_privilege(
    'authenticated', 'public.transport_withdrawals', 'DELETE'
  ) or has_table_privilege(
    'anon', 'public.transport_withdrawals', 'SELECT'
  ) then
    raise exception 'FAIL: transport withdrawal table grants are incorrect';
  end if;

  select procedure.prosecdef, procedure.proconfig
    into create_routine
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)'::regprocedure;

  select procedure.prosecdef, procedure.proconfig
    into balance_routine
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.get_transport_worker_available_balance(uuid,uuid,date)'::regprocedure;

  if not create_routine.prosecdef
    or not balance_routine.prosecdef
    or not coalesce(create_routine.proconfig, array[]::text[])
      @> array['search_path=pg_catalog, public']
    or not coalesce(balance_routine.proconfig, array[]::text[])
      @> array['search_path=pg_catalog, public']
    or not has_function_privilege(
      'authenticated',
      'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.get_transport_worker_available_balance(uuid,uuid,date)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.get_transport_worker_available_balance(uuid,uuid,date)',
      'EXECUTE'
    ) then
    raise exception 'FAIL: transport financial RPC security or grants are incorrect';
  end if;

  select lower(pg_get_functiondef(
    'public.create_transport_worker_withdrawal(uuid,uuid,date,numeric)'::regprocedure
  )) into create_definition;

  select lower(pg_get_functiondef(
    'public.get_transport_worker_available_balance(uuid,uuid,date)'::regprocedure
  )) into balance_definition;

  if create_definition not like '%pg_advisory_xact_lock%'
    or create_definition not like '%transport_worker_withdrawal:%'
    or position('pg_advisory_xact_lock' in create_definition)
      > position('transport_weekly_earnings' in create_definition)
    or create_definition not like '%week_start + 6 <= p_withdrawal_date%'
    or create_definition not like '%withdrawal_date <= p_withdrawal_date%'
    or create_definition like '%transport_daily_entries%'
    or create_definition like '%transport_daily_attendance%'
    or create_definition like '%transport_crew_wage_rates%'
    or create_definition like '%transport_crew_memberships%'
    or balance_definition not like '%week_start + 6 <= p_as_of_date%'
    or balance_definition not like '%withdrawal_date <= p_as_of_date%'
    or balance_definition like '%transport_daily_entries%'
    or balance_definition like '%transport_daily_attendance%'
    or balance_definition like '%transport_crew_wage_rates%'
    or balance_definition like '%transport_crew_memberships%' then
    raise exception 'FAIL: transport balance source, completed-week rule, or worker lock is incorrect';
  end if;

  foreach table_name in array array[
    'transport_weekly_earnings',
    'transport_weekly_earning_details'
  ] loop
    if not has_table_privilege(
      'authenticated', format('public.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'UPDATE'
    ) or has_table_privilege(
      'authenticated', format('public.%I', table_name), 'DELETE'
    ) then
      raise exception 'FAIL: immutable T5 grants changed on public.%', table_name;
    end if;
  end loop;

  if to_regprocedure(
    'public.save_transport_daily_entry(uuid,uuid,date,numeric,uuid[])'
  ) is null or to_regprocedure(
    'public.create_transport_crew_wage_rate(uuid,uuid,date,numeric)'
  ) is null or to_regprocedure(
    'public.calculate_transport_weekly_wages(uuid,date)'
  ) is null or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.transport_crew_memberships'::regclass
      and conname = 'transport_crew_memberships_no_overlapping_dates'
  ) then
    raise exception 'FAIL: a T1-T6 transport foundation is missing';
  end if;

  select lower(pg_get_functiondef(
    'public.calculate_production_wages(uuid,date)'::regprocedure
  )) into production_definition;
  select lower(pg_get_functiondef(
    'public.calculate_mud_supply_wages(uuid,uuid,date)'::regprocedure
  )) into mud_definition;

  if production_definition like '%transport_%'
    or mud_definition like '%transport_%'
    or not has_function_privilege(
      'authenticated',
      'public.create_labourer_withdrawal(uuid,uuid,date,numeric)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.create_labour_group_withdrawal(uuid,uuid,date,numeric)',
      'EXECUTE'
    )
    or has_table_privilege('authenticated', 'public.withdrawals', 'INSERT')
    or has_table_privilege('authenticated', 'public.withdrawals', 'UPDATE')
    or has_table_privilege('authenticated', 'public.withdrawals', 'DELETE') then
    raise exception 'FAIL: existing production or mud financial controls changed';
  end if;

  raise notice 'PASS: T7A schema, RPC source-of-truth, lock, grants, and T1-T6 regressions are structurally correct';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  basic_worker_id uuid := gen_random_uuid();
  carry_worker_id uuid := gen_random_uuid();
  overdraw_worker_id uuid := gen_random_uuid();
  inactive_worker_id uuid := gen_random_uuid();
  factory_b_worker_id uuid := gen_random_uuid();
  brick_type_id uuid := gen_random_uuid();
  labourer_id uuid := gen_random_uuid();
  labour_group_id uuid := gen_random_uuid();
  production_rate_id uuid := gen_random_uuid();
  mud_rate_id uuid := gen_random_uuid();
begin
  select id, user_id
    into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, format('Transport T7A Factory A %s', factory_a_id)),
    (factory_b_id, format('Transport T7A Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.transport_workers (id, factory_id, name, is_active)
  values
    (basic_worker_id, factory_a_id, 'T7A balance worker', true),
    (carry_worker_id, factory_a_id, 'T7A carry worker', true),
    (overdraw_worker_id, factory_a_id, 'T7A overdraw worker', true),
    (inactive_worker_id, factory_a_id, 'T7A inactive worker', false),
    (factory_b_worker_id, factory_b_id, 'T7A Factory B worker', true);

  insert into public.transport_weekly_earnings (
    factory_id, transport_worker_id, week_start, total_amount
  ) values
    (factory_a_id, basic_worker_id, date '2026-07-27', 5000),
    (factory_a_id, basic_worker_id, date '2026-08-03', 3000),
    (factory_a_id, basic_worker_id, date '2026-08-10', 9999),
    (factory_a_id, carry_worker_id, date '2026-07-27', 5000),
    (factory_a_id, carry_worker_id, date '2026-08-03', 3000),
    (factory_a_id, overdraw_worker_id, date '2026-07-27', 1000),
    (factory_a_id, inactive_worker_id, date '2026-07-27', 700),
    (factory_b_id, factory_b_worker_id, date '2026-07-27', 900);

  insert into public.transport_withdrawals (
    factory_id, transport_worker_id, withdrawal_date, amount
  ) values (
    factory_b_id, factory_b_worker_id, date '2026-08-02', 100
  );

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_id, factory_a_id, 'T7A production regression brick');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id
  ) values (
    labourer_id, factory_a_id, 'T7A production regression labourer', brick_type_id
  );

  insert into public.labour_groups (id, factory_id, name)
  values (labour_group_id, factory_a_id, 'T7A mud regression group');

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values
    (production_rate_id, factory_a_id, 'production', 1000, date '2026-07-27'),
    (mud_rate_id, factory_a_id, 'mud_supply', 1000, date '2026-07-27');

  insert into public.weekly_earnings (
    factory_id,
    labourer_id,
    week_start,
    quantity_used,
    wage_rate_id,
    rate_used,
    amount
  ) values (
    factory_a_id,
    labourer_id,
    date '2026-07-27',
    100,
    production_rate_id,
    1000,
    100
  );

  insert into public.weekly_earnings (
    factory_id,
    labour_group_id,
    week_start,
    quantity_used,
    wage_rate_id,
    rate_used,
    amount
  ) values (
    factory_a_id,
    labour_group_id,
    date '2026-07-27',
    200,
    mud_rate_id,
    1000,
    200
  );

  perform set_config('atlas_t7a.mapping_id', mapping_id::text, true);
  perform set_config('atlas_t7a.user_id', test_user_id::text, true);
  perform set_config('atlas_t7a.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_t7a.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_t7a.basic_worker_id', basic_worker_id::text, true);
  perform set_config('atlas_t7a.carry_worker_id', carry_worker_id::text, true);
  perform set_config('atlas_t7a.overdraw_worker_id', overdraw_worker_id::text, true);
  perform set_config('atlas_t7a.inactive_worker_id', inactive_worker_id::text, true);
  perform set_config('atlas_t7a.factory_b_worker_id', factory_b_worker_id::text, true);
  perform set_config('atlas_t7a.labourer_id', labourer_id::text, true);
  perform set_config('atlas_t7a.labour_group_id', labour_group_id::text, true);

  raise notice 'PASS: rollback-only T7A fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_t7a.user_id'), true);

do $$
declare
  balance_result record;
  withdrawal_result record;
  ordered_amounts numeric[];
begin
  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.basic_worker_id')::uuid,
    date '2026-08-09'
  );

  if balance_result.total_earned <> 8000
    or balance_result.total_withdrawn <> 0
    or balance_result.available_balance <> 8000 then
    raise exception 'FAIL: two eligible weeks did not produce available balance 8000';
  end if;

  select * into withdrawal_result
  from public.create_transport_worker_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.basic_worker_id')::uuid,
    date '2026-08-09',
    2000
  );
  if withdrawal_result.available_balance <> 6000
    or withdrawal_result.withdrawal_amount <> 2000 then
    raise exception 'FAIL: first partial withdrawal did not return balance 6000';
  end if;

  select * into withdrawal_result
  from public.create_transport_worker_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.basic_worker_id')::uuid,
    date '2026-08-10',
    1500
  );
  if withdrawal_result.available_balance <> 4500 then
    raise exception 'FAIL: second withdrawal did not return balance 4500';
  end if;

  select * into withdrawal_result
  from public.create_transport_worker_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.basic_worker_id')::uuid,
    date '2026-08-11',
    4500
  );
  if withdrawal_result.available_balance <> 0 then
    raise exception 'FAIL: exact full withdrawal did not return zero balance';
  end if;

  perform pg_temp.expect_error(
    'positive withdrawal after full balance is rejected',
    'P0001',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.basic_worker_id'),
      '2026-08-11'
    )
  );

  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.basic_worker_id')::uuid,
    date '2026-08-09'
  );
  if balance_result.available_balance <> 6000 then
    raise exception 'FAIL: later-dated withdrawals reduced historical as-of balance';
  end if;

  select array_agg(amount order by withdrawal_date desc, created_at desc, id desc)
    into ordered_amounts
  from public.transport_withdrawals
  where factory_id = current_setting('atlas_t7a.factory_a_id')::uuid
    and transport_worker_id = current_setting('atlas_t7a.basic_worker_id')::uuid;

  if ordered_amounts <> array[4500, 1500, 2000]::numeric[] then
    raise exception 'FAIL: exact withdrawal history amounts/newest-first order are incorrect: %', ordered_amounts;
  end if;

  raise notice 'PASS: balance 8000, partial/second/full withdrawals, historical as-of, and exact history are correct';
end;
$$;

do $$
declare
  balance_result record;
  withdrawal_result record;
begin
  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.carry_worker_id')::uuid,
    date '2026-08-02'
  );
  if balance_result.available_balance <> 5000 then
    raise exception 'FAIL: first completed carry week did not produce 5000';
  end if;

  select * into withdrawal_result
  from public.create_transport_worker_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.carry_worker_id')::uuid,
    date '2026-08-02',
    2000
  );
  if withdrawal_result.available_balance <> 3000 then
    raise exception 'FAIL: carry worker first withdrawal did not leave 3000';
  end if;

  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.carry_worker_id')::uuid,
    date '2026-08-09'
  );
  if balance_result.available_balance <> 6000
    or balance_result.total_earned <> 8000
    or balance_result.total_withdrawn <> 2000 then
    raise exception 'FAIL: unused 3000 plus later 3000 did not carry forward to 6000';
  end if;

  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.basic_worker_id')::uuid,
    date '2026-08-12'
  );
  if balance_result.total_earned <> 8000 then
    raise exception 'FAIL: incomplete week was included before its Sunday ended';
  end if;

  raise notice 'PASS: completed-week eligibility, incomplete-week exclusion, and carry-forward are correct';
end;
$$;

do $$
declare
  row_count_before bigint;
  balance_result record;
  inactive_result record;
begin
  select count(*) into row_count_before
  from public.transport_withdrawals
  where factory_id = current_setting('atlas_t7a.factory_a_id')::uuid
    and transport_worker_id = current_setting('atlas_t7a.overdraw_worker_id')::uuid;

  perform pg_temp.expect_error(
    '1000.01 withdrawal against 1000 is rejected',
    'P0001',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,1000.01)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );

  if row_count_before <> (
    select count(*)
    from public.transport_withdrawals
    where factory_id = current_setting('atlas_t7a.factory_a_id')::uuid
      and transport_worker_id = current_setting('atlas_t7a.overdraw_worker_id')::uuid
  ) then
    raise exception 'FAIL: rejected overdraw inserted a withdrawal row';
  end if;

  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.overdraw_worker_id')::uuid,
    date '2026-08-02'
  );
  if balance_result.available_balance <> 1000 then
    raise exception 'FAIL: rejected overdraw changed the available balance';
  end if;

  select * into balance_result
  from public.get_transport_worker_available_balance(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.inactive_worker_id')::uuid,
    date '2026-08-02'
  );
  if balance_result.available_balance <> 700 then
    raise exception 'FAIL: inactive worker historical earnings were not preserved';
  end if;

  select * into inactive_result
  from public.create_transport_worker_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.inactive_worker_id')::uuid,
    date '2026-08-02',
    100
  );
  if inactive_result.available_balance <> 600 then
    raise exception 'FAIL: inactive worker did not mirror existing labourer withdrawal policy';
  end if;

  raise notice 'PASS: overdraw is atomic and inactive-worker historical finance remains available';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'zero transport withdrawal is rejected', '22023',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,0)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'negative transport withdrawal is rejected', '22023',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,-1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'numeric NaN transport withdrawal is rejected', '22023',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,%L::numeric)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02',
      'NaN'
    )
  );
  perform pg_temp.expect_error(
    'infinite transport withdrawal date is rejected', '22023',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,%L::date,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      'infinity'
    )
  );
  perform pg_temp.expect_error(
    'cross-factory transport worker is rejected', '42501',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.factory_b_worker_id'),
      '2026-08-02'
    )
  );

  raise notice 'PASS: amount, date, and cross-factory validation are correct';
end;
$$;

do $$
declare
  labourer_result record;
  group_result record;
begin
  select * into labourer_result
  from public.create_labourer_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.labourer_id')::uuid,
    date '2026-08-02',
    40
  );
  if labourer_result.available_balance <> 60 then
    raise exception 'FAIL: existing production labourer balance/withdrawal changed';
  end if;

  select * into group_result
  from public.create_labour_group_withdrawal(
    current_setting('atlas_t7a.factory_a_id')::uuid,
    current_setting('atlas_t7a.labour_group_id')::uuid,
    date '2026-08-02',
    50
  );
  if group_result.available_balance <> 150 then
    raise exception 'FAIL: existing mud-group balance/withdrawal changed';
  end if;

  raise notice 'PASS: production labourer and mud-group financial behavior remains functional';
end;
$$;

do $$
declare
  visible_factory_b_rows bigint;
begin
  select count(*) into visible_factory_b_rows
  from public.transport_withdrawals
  where factory_id = current_setting('atlas_t7a.factory_b_id')::uuid;
  if visible_factory_b_rows <> 0 then
    raise exception 'FAIL: Factory A can read Factory B transport withdrawals';
  end if;

  perform pg_temp.expect_error(
    'Factory A cannot read Factory B transport balance', '42501',
    format(
      'select * from public.get_transport_worker_available_balance(%L::uuid,%L::uuid,date %L)',
      current_setting('atlas_t7a.factory_b_id'),
      current_setting('atlas_t7a.factory_b_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'Factory A cannot withdraw Factory B transport balance', '42501',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_b_id'),
      current_setting('atlas_t7a.factory_b_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'authenticated cannot directly insert transport withdrawals', '42501',
    format(
      'insert into public.transport_withdrawals (factory_id,transport_worker_id,withdrawal_date,amount) values (%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'authenticated cannot update transport withdrawal history', '42501',
    format(
      'update public.transport_withdrawals set amount = amount + 1 where factory_id = %L::uuid',
      current_setting('atlas_t7a.factory_a_id')
    )
  );
  perform pg_temp.expect_error(
    'authenticated cannot delete transport withdrawal history', '42501',
    format(
      'delete from public.transport_withdrawals where factory_id = %L::uuid',
      current_setting('atlas_t7a.factory_a_id')
    )
  );
  perform pg_temp.expect_error(
    'authenticated cannot insert transport weekly earnings', '42501',
    format(
      'insert into public.transport_weekly_earnings (factory_id,transport_worker_id,week_start,total_amount) values (%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-17'
    )
  );
  perform pg_temp.expect_error(
    'authenticated cannot update transport weekly earnings', '42501',
    format(
      'update public.transport_weekly_earnings set total_amount = total_amount + 1 where factory_id = %L::uuid',
      current_setting('atlas_t7a.factory_a_id')
    )
  );
  perform pg_temp.expect_error(
    'authenticated cannot delete transport weekly earning details', '42501',
    format(
      'delete from public.transport_weekly_earning_details where factory_id = %L::uuid',
      current_setting('atlas_t7a.factory_a_id')
    )
  );

  raise notice 'PASS: Factory A/B isolation and direct financial immutability are enforced';
end;
$$;

select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

do $$
begin
  perform pg_temp.expect_error(
    'unmapped authenticated user cannot read transport balance', '42501',
    format(
      'select * from public.get_transport_worker_available_balance(%L::uuid,%L::uuid,date %L)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'unmapped authenticated user cannot create transport withdrawal', '42501',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  perform pg_temp.expect_error(
    'anonymous cannot read transport withdrawals', '42501',
    'select count(*) from public.transport_withdrawals'
  );
  perform pg_temp.expect_error(
    'anonymous cannot read transport balance RPC', '42501',
    format(
      'select * from public.get_transport_worker_available_balance(%L::uuid,%L::uuid,date %L)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );
  perform pg_temp.expect_error(
    'anonymous cannot execute transport withdrawal RPC', '42501',
    format(
      'select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,1)',
      current_setting('atlas_t7a.factory_a_id'),
      current_setting('atlas_t7a.overdraw_worker_id'),
      '2026-08-02'
    )
  );

  raise notice 'PASS: anonymous transport financial access is blocked';
end;
$$;

reset role;

do $$
begin
  raise notice 'PASS: T7A DATABASE VERIFIER COMPLETED';
  raise notice 'PASS: all T7A fixtures and mapping changes will now be rolled back';
end;
$$;

rollback;
