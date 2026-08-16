-- Atlas Module 2 Rework R2.5B production calculator cutover verifier.
-- Run after applying 20260816000005_cut_over_production_wage_calculator.sql.
-- It requires one existing public.factory_users row. All fixtures and mapping
-- changes are discarded by the final rollback.

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
  calculator_definition text;
  mud_calculator_definition text;
begin
  select pg_get_functiondef(
    'public.calculate_production_wages(uuid, date)'::regprocedure
  ) into calculator_definition;

  select pg_get_functiondef(
    'public.calculate_mud_supply_wages(uuid, uuid, date)'::regprocedure
  ) into mud_calculator_definition;

  if calculator_definition not ilike '%resolve_production_wage_rate%'
    or calculator_definition not ilike '%production_weekly_earning_details%'
    or calculator_definition not ilike '%group by production_entries.production_date%'
    or calculator_definition not ilike '%sum(details.amount)%'
    or calculator_definition not ilike '%pg_advisory_xact_lock%'
    or calculator_definition ilike '%public.wage_rates%'
    or calculator_definition ilike '%applies_to%production%'
    or calculator_definition ilike '%labourers.is_active%'
    or calculator_definition ilike '%update public.production_entries%'
    or calculator_definition ilike '%public.withdrawals%'
    or calculator_definition ilike '%calculate_mud_supply_wages%' then
    raise exception 'FAIL: production calculator did not make the focused dated-resolver cutover';
  end if;

  if mud_calculator_definition ilike '%resolve_production_wage_rate%'
    or mud_calculator_definition ilike '%production_weekly_earning_details%'
    or mud_calculator_definition not ilike '%public.wage_rates%'
    or mud_calculator_definition not ilike '%wage_rate_id%'
    or mud_calculator_definition not ilike '%rate_used%' then
    raise exception 'FAIL: mud-supply calculator changed during production cutover';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_index
      where indexrelid = 'public.weekly_earnings_factory_labourer_week_key'::regclass
        and indisunique
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.production_weekly_earning_details'::regclass
        and conname = 'production_weekly_earning_details_parent_work_date_key'
        and contype = 'u'
    ) then
    raise exception 'FAIL: parent/detail duplicate safeguards are missing';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.calculate_production_wages(uuid, date)'::regprocedure,
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.calculate_production_wages(uuid, date)'::regprocedure,
      'EXECUTE'
    )
    or not (
      select prosecdef
      from pg_catalog.pg_proc
      where oid = 'public.calculate_production_wages(uuid, date)'::regprocedure
    ) then
    raise exception 'FAIL: production calculator RPC permissions or security mode changed';
  end if;

  raise notice 'PASS: calculator uses dated resolver snapshots, retains advisory locking, and leaves mud calculation unchanged';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  test_factory_id uuid := gen_random_uuid();
  brick_type_id uuid := gen_random_uuid();
  default_labourer_id uuid := gen_random_uuid();
  rate_change_labourer_id uuid := gen_random_uuid();
  override_labourer_id uuid := gen_random_uuid();
  crew_move_labourer_id uuid := gen_random_uuid();
  missing_rate_labourer_id uuid := gen_random_uuid();
  zero_production_labourer_id uuid := gen_random_uuid();
  historical_labourer_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  rate_change_crew_id uuid := gen_random_uuid();
  crew_without_rate_id uuid := gen_random_uuid();
  crew_a_rate_id uuid := gen_random_uuid();
  crew_b_rate_id uuid := gen_random_uuid();
  old_crew_rate_id uuid := gen_random_uuid();
  new_crew_rate_id uuid := gen_random_uuid();
  override_rate_id uuid := gen_random_uuid();
  default_assignment_id uuid := gen_random_uuid();
  legacy_production_rate_id uuid := gen_random_uuid();
  mud_rate_id uuid := gen_random_uuid();
  historical_earning_id uuid := gen_random_uuid();
  labour_group_id uuid := gen_random_uuid();
  production_entry_to_change_id uuid := gen_random_uuid();
  business_today date := (now() at time zone 'Asia/Kolkata')::date;
  current_week_start date;
  historical_week date;
  success_week date;
  missing_week date;
begin
  current_week_start := business_today
    - (extract(isodow from business_today)::integer - 1);
  historical_week := current_week_start - 28;
  success_week := current_week_start - 21;
  missing_week := current_week_start - 14;

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
  values (test_factory_id, format('R2.5B verification Factory %s', test_factory_id));

  update public.factory_users
  set factory_id = test_factory_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_id, test_factory_id, 'R2.5B verification brick');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values
    (default_labourer_id, test_factory_id, 'R2.5B inactive default worker', brick_type_id, false),
    (rate_change_labourer_id, test_factory_id, 'R2.5B rate-change worker', brick_type_id, true),
    (override_labourer_id, test_factory_id, 'R2.5B override worker', brick_type_id, true),
    (crew_move_labourer_id, test_factory_id, 'R2.5B crew-move worker', brick_type_id, true),
    (missing_rate_labourer_id, test_factory_id, 'R2.5B missing-rate worker', brick_type_id, true),
    (zero_production_labourer_id, test_factory_id, 'R2.5B zero-production worker', brick_type_id, true),
    (historical_labourer_id, test_factory_id, 'R2.5B historical worker', brick_type_id, true);

  insert into public.labour_groups (id, factory_id, name, member_count, is_active)
  values (labour_group_id, test_factory_id, 'R2.5B mud group', 5, true);

  insert into public.production_crews (id, factory_id, name, is_active)
  values
    (crew_a_id, test_factory_id, 'R2.5B Crew A', true),
    (crew_b_id, test_factory_id, 'R2.5B Crew B', true),
    (rate_change_crew_id, test_factory_id, 'R2.5B Rate Change Crew', true),
    (crew_without_rate_id, test_factory_id, 'R2.5B Crew Without Rate', true);

  insert into public.production_crew_assignments (
    id, factory_id, labourer_id, production_crew_id, effective_from, effective_to
  ) values
    (default_assignment_id, test_factory_id, default_labourer_id, crew_a_id, success_week - 7, null),
    (gen_random_uuid(), test_factory_id, rate_change_labourer_id, rate_change_crew_id, success_week - 7, null),
    (gen_random_uuid(), test_factory_id, override_labourer_id, crew_a_id, success_week - 7, null),
    (gen_random_uuid(), test_factory_id, crew_move_labourer_id, crew_a_id, success_week - 7, success_week + 2),
    (gen_random_uuid(), test_factory_id, crew_move_labourer_id, crew_b_id, success_week + 3, null),
    (gen_random_uuid(), test_factory_id, missing_rate_labourer_id, crew_without_rate_id, success_week - 7, null),
    (gen_random_uuid(), test_factory_id, zero_production_labourer_id, crew_a_id, success_week - 7, null);

  insert into public.production_wage_rates (
    id, factory_id, production_crew_id, labourer_id,
    rate_per_1000_bricks, effective_from, effective_to
  ) values
    (crew_a_rate_id, test_factory_id, crew_a_id, null, 520, success_week - 7, null),
    (crew_b_rate_id, test_factory_id, crew_b_id, null, 600, success_week - 7, null),
    (old_crew_rate_id, test_factory_id, rate_change_crew_id, null, 520, success_week - 7, success_week + 2),
    (new_crew_rate_id, test_factory_id, rate_change_crew_id, null, 530, success_week + 3, null),
    (override_rate_id, test_factory_id, null, override_labourer_id, 540, success_week + 1, success_week + 2);

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values
    (legacy_production_rate_id, test_factory_id, 'production', 999, historical_week),
    (mud_rate_id, test_factory_id, 'mud_supply', 200, historical_week);

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    historical_earning_id, test_factory_id, historical_labourer_id,
    historical_week, 1000, legacy_production_rate_id, 999, 999
  );

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values
    (production_entry_to_change_id, test_factory_id, default_labourer_id, brick_type_id, success_week, 3333),
    (gen_random_uuid(), test_factory_id, rate_change_labourer_id, brick_type_id, success_week, 10000),
    (gen_random_uuid(), test_factory_id, rate_change_labourer_id, brick_type_id, success_week + 3, 10000),
    (gen_random_uuid(), test_factory_id, override_labourer_id, brick_type_id, success_week, 10000),
    (gen_random_uuid(), test_factory_id, override_labourer_id, brick_type_id, success_week + 1, 10000),
    (gen_random_uuid(), test_factory_id, override_labourer_id, brick_type_id, success_week + 3, 10000),
    (gen_random_uuid(), test_factory_id, crew_move_labourer_id, brick_type_id, success_week + 1, 10000),
    (gen_random_uuid(), test_factory_id, crew_move_labourer_id, brick_type_id, success_week + 4, 10000),
    (gen_random_uuid(), test_factory_id, default_labourer_id, brick_type_id, missing_week, 1000),
    (gen_random_uuid(), test_factory_id, missing_rate_labourer_id, brick_type_id, missing_week + 1, 1000);

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_id', test_factory_id::text, true);
  perform set_config('atlas_test.brick_type_id', brick_type_id::text, true);
  perform set_config('atlas_test.default_labourer_id', default_labourer_id::text, true);
  perform set_config('atlas_test.rate_change_labourer_id', rate_change_labourer_id::text, true);
  perform set_config('atlas_test.override_labourer_id', override_labourer_id::text, true);
  perform set_config('atlas_test.crew_move_labourer_id', crew_move_labourer_id::text, true);
  perform set_config('atlas_test.missing_rate_labourer_id', missing_rate_labourer_id::text, true);
  perform set_config('atlas_test.zero_production_labourer_id', zero_production_labourer_id::text, true);
  perform set_config('atlas_test.historical_labourer_id', historical_labourer_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.rate_change_crew_id', rate_change_crew_id::text, true);
  perform set_config('atlas_test.crew_a_rate_id', crew_a_rate_id::text, true);
  perform set_config('atlas_test.crew_b_rate_id', crew_b_rate_id::text, true);
  perform set_config('atlas_test.old_crew_rate_id', old_crew_rate_id::text, true);
  perform set_config('atlas_test.new_crew_rate_id', new_crew_rate_id::text, true);
  perform set_config('atlas_test.override_rate_id', override_rate_id::text, true);
  perform set_config('atlas_test.default_assignment_id', default_assignment_id::text, true);
  perform set_config('atlas_test.legacy_production_rate_id', legacy_production_rate_id::text, true);
  perform set_config('atlas_test.mud_rate_id', mud_rate_id::text, true);
  perform set_config('atlas_test.historical_earning_id', historical_earning_id::text, true);
  perform set_config('atlas_test.labour_group_id', labour_group_id::text, true);
  perform set_config('atlas_test.production_entry_to_change_id', production_entry_to_change_id::text, true);
  perform set_config('atlas_test.historical_week', historical_week::text, true);
  perform set_config('atlas_test.success_week', success_week::text, true);
  perform set_config('atlas_test.missing_week', missing_week::text, true);
  perform set_config('atlas_test.current_week_start', current_week_start::text, true);

  raise notice 'PASS: rollback-only dated production, crew, rate, override, legacy, and missing-rate fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  result record;
  parent_record public.weekly_earnings%rowtype;
  mud_result record;
  mud_parent public.weekly_earnings%rowtype;
  withdrawal_result record;
begin
  select * into result
  from public.calculate_production_wages(
    current_setting('atlas_test.factory_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );

  if result.labourers_calculated <> 4 or result.rows_skipped <> 0 then
    raise exception 'FAIL: first calculation did not create exactly four labourer earnings';
  end if;

  if (
    select count(*)
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_id')::uuid
      and week_start = current_setting('atlas_test.success_week')::date
      and labourer_id is not null
  ) <> 4 then
    raise exception 'FAIL: one parent per production labourer was not preserved';
  end if;

  if exists (
    select 1
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_id')::uuid
      and week_start = current_setting('atlas_test.success_week')::date
      and labourer_id is not null
      and (wage_rate_id is not null or rate_used is not null)
  ) then
    raise exception 'FAIL: a new production parent contains a misleading legacy rate';
  end if;

  if exists (
    select 1
    from public.weekly_earnings as earnings
    where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
      and earnings.week_start = current_setting('atlas_test.success_week')::date
      and earnings.labourer_id is not null
      and (
        earnings.quantity_used <> (
          select sum(details.quantity_used)::integer
          from public.production_weekly_earning_details as details
          where details.weekly_earning_id = earnings.id
        )
        or earnings.amount <> (
          select sum(details.amount)
          from public.production_weekly_earning_details as details
          where details.weekly_earning_id = earnings.id
        )
      )
  ) then
    raise exception 'FAIL: parent quantity/amount does not equal its exact detail sums';
  end if;

  select * into parent_record
  from public.weekly_earnings
  where labourer_id = current_setting('atlas_test.default_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;

  if parent_record.quantity_used <> 3333
    or parent_record.amount <> 1733.16
    or (
      select count(*) from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date
        and quantity_used = 3333
        and rate_per_1000_bricks = 520
        and rate_source = 'crew_default'
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and amount = 1733.16
    ) <> 1 then
    raise exception 'FAIL: inactive labourer crew-default calculation or same-day aggregation is incorrect';
  end if;
  perform set_config('atlas_test.default_parent_id', parent_record.id::text, true);

  select * into parent_record
  from public.weekly_earnings
  where labourer_id = current_setting('atlas_test.rate_change_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;

  if parent_record.amount <> 10500
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date
        and production_wage_rate_id = current_setting('atlas_test.old_crew_rate_id')::uuid
        and rate_per_1000_bricks = 520
        and amount = 5200
    )
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date + 3
        and production_wage_rate_id = current_setting('atlas_test.new_crew_rate_id')::uuid
        and rate_per_1000_bricks = 530
        and amount = 5300
    ) then
    raise exception 'FAIL: mid-week crew rate change did not resolve by exact work date';
  end if;

  select * into parent_record
  from public.weekly_earnings
  where labourer_id = current_setting('atlas_test.override_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;

  if parent_record.amount <> 15800
    or (
      select count(*) from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and rate_source = 'crew_default'
        and production_wage_rate_id = current_setting('atlas_test.crew_a_rate_id')::uuid
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and work_date in (
          current_setting('atlas_test.success_week')::date,
          current_setting('atlas_test.success_week')::date + 3
        )
    ) <> 2
    or (
      select count(*) from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and rate_source = 'individual_override'
        and production_wage_rate_id = current_setting('atlas_test.override_rate_id')::uuid
        and production_crew_id is null
        and work_date = current_setting('atlas_test.success_week')::date + 1
        and rate_per_1000_bricks = 540
        and amount = 5400
    ) <> 1 then
    raise exception 'FAIL: dated override precedence/fallback is incorrect';
  end if;

  select * into parent_record
  from public.weekly_earnings
  where labourer_id = current_setting('atlas_test.crew_move_labourer_id')::uuid
    and week_start = current_setting('atlas_test.success_week')::date;

  if parent_record.amount <> 11200
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date + 1
        and production_crew_id = current_setting('atlas_test.crew_a_id')::uuid
        and rate_per_1000_bricks = 520
        and amount = 5200
    )
    or not exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = parent_record.id
        and work_date = current_setting('atlas_test.success_week')::date + 4
        and production_crew_id = current_setting('atlas_test.crew_b_id')::uuid
        and rate_per_1000_bricks = 600
        and amount = 6000
    ) then
    raise exception 'FAIL: mid-week crew move did not use the dated crew defaults';
  end if;

  if exists (
    select 1 from public.weekly_earnings
    where labourer_id = current_setting('atlas_test.zero_production_labourer_id')::uuid
      and week_start = current_setting('atlas_test.success_week')::date
  ) or (
    select count(*) from public.production_weekly_earning_details as details
    join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
    where earnings.week_start = current_setting('atlas_test.success_week')::date
  ) <> 8 then
    raise exception 'FAIL: zero-production behavior or one-detail-per-work-date behavior changed';
  end if;

  if (
    select count(*) from public.production_entries
    where factory_id = current_setting('atlas_test.factory_id')::uuid
  ) <> 10 or (
    select sum(quantity) from public.production_entries
    where factory_id = current_setting('atlas_test.factory_id')::uuid
      and production_date >= current_setting('atlas_test.success_week')::date
      and production_date <= current_setting('atlas_test.success_week')::date + 6
  ) <> 73333 then
    raise exception 'FAIL: production entries were modified by calculation';
  end if;

  perform pg_temp.expect_error(
    'missing dated crew rate fails the complete calculation',
    'P2403',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_id'),
      current_setting('atlas_test.missing_week')
    )
  );

  if exists (
    select 1 from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_id')::uuid
      and week_start = current_setting('atlas_test.missing_week')::date
      and labourer_id is not null
  ) or exists (
    select 1
    from public.production_weekly_earning_details as details
    join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
    where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
      and earnings.week_start = current_setting('atlas_test.missing_week')::date
  ) then
    raise exception 'FAIL: missing-rate calculation left partial parents or details';
  end if;

  perform pg_temp.expect_error(
    'non-Monday production calculation is rejected',
    '22023',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_id'),
      (current_setting('atlas_test.success_week')::date + 1)::text
    )
  );

  perform pg_temp.expect_error(
    'incomplete production week is rejected',
    'P0001',
    format(
      'select * from public.calculate_production_wages(%L::uuid, date %L)',
      current_setting('atlas_test.factory_id'),
      current_setting('atlas_test.current_week_start')
    )
  );

  select * into mud_result
  from public.calculate_mud_supply_wages(
    current_setting('atlas_test.factory_id')::uuid,
    current_setting('atlas_test.labour_group_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );

  select * into mud_parent
  from public.weekly_earnings
  where id = mud_result.weekly_earning_id;

  if mud_result.groups_calculated <> 1
    or mud_result.rows_skipped <> 0
    or mud_parent.quantity_used <> 73333
    or mud_parent.wage_rate_id <> current_setting('atlas_test.mud_rate_id')::uuid
    or mud_parent.rate_used <> 200
    or mud_parent.amount <> 14666.6
    or exists (
      select 1 from public.production_weekly_earning_details
      where weekly_earning_id = mud_parent.id
    ) then
    raise exception 'FAIL: mud-supply calculation did not retain its legacy snapshot behavior';
  end if;

  select * into withdrawal_result
  from public.create_labourer_withdrawal(
    current_setting('atlas_test.factory_id')::uuid,
    current_setting('atlas_test.default_labourer_id')::uuid,
    current_setting('atlas_test.success_week')::date + 6,
    1000
  );

  if withdrawal_result.withdrawal_amount <> 1000
    or withdrawal_result.available_balance <> 733.16 then
    raise exception 'FAIL: withdrawal/balance logic did not consume the production parent amount';
  end if;

  raise notice 'PASS: crew defaults, rate change, override, crew move, formula, atomic failure, validation, mud, withdrawal, and production preservation are correct';
end;
$$;

reset role;

create temporary table r2_5b_locked_parents on commit drop as
select earnings.*
from public.weekly_earnings as earnings
where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
  and earnings.week_start = current_setting('atlas_test.success_week')::date
  and earnings.labourer_id is not null;

create temporary table r2_5b_locked_details on commit drop as
select details.*
from public.production_weekly_earning_details as details
join public.weekly_earnings as earnings
  on earnings.id = details.weekly_earning_id
where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
  and earnings.week_start = current_setting('atlas_test.success_week')::date;

update public.production_entries
set quantity = 99999
where id = current_setting('atlas_test.production_entry_to_change_id')::uuid;

update public.production_wage_rates
set rate_per_1000_bricks = 999
where id = current_setting('atlas_test.crew_a_rate_id')::uuid;

update public.production_crew_assignments
set production_crew_id = current_setting('atlas_test.crew_b_id')::uuid
where id = current_setting('atlas_test.default_assignment_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  result record;
begin
  select * into result
  from public.calculate_production_wages(
    current_setting('atlas_test.factory_id')::uuid,
    current_setting('atlas_test.success_week')::date
  );

  if result.labourers_calculated <> 0 or result.rows_skipped <> 4 then
    raise exception 'FAIL: idempotent rerun did not preserve four existing earnings as skips';
  end if;

  if (
    select count(*)
    from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_id')::uuid
      and week_start = current_setting('atlas_test.success_week')::date
      and labourer_id is not null
  ) <> 4 or (
    select count(*)
    from public.production_weekly_earning_details as details
    join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
    where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
      and earnings.week_start = current_setting('atlas_test.success_week')::date
  ) <> 8 then
    raise exception 'FAIL: idempotent rerun duplicated a parent or detail row';
  end if;

  raise notice 'PASS: rerun skips locked earnings without duplicate parents or details';
end;
$$;

reset role;

do $$
begin
  if exists (
      (select * from public.weekly_earnings
       where factory_id = current_setting('atlas_test.factory_id')::uuid
         and week_start = current_setting('atlas_test.success_week')::date
         and labourer_id is not null
       except select * from r2_5b_locked_parents)
      union all
      (select * from r2_5b_locked_parents
       except select * from public.weekly_earnings
       where factory_id = current_setting('atlas_test.factory_id')::uuid
         and week_start = current_setting('atlas_test.success_week')::date
         and labourer_id is not null)
    )
    or exists (
      (select details.*
       from public.production_weekly_earning_details as details
       join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
       where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
         and earnings.week_start = current_setting('atlas_test.success_week')::date
       except select * from r2_5b_locked_details)
      union all
      (select * from r2_5b_locked_details
       except select details.*
       from public.production_weekly_earning_details as details
       join public.weekly_earnings as earnings on earnings.id = details.weekly_earning_id
       where earnings.factory_id = current_setting('atlas_test.factory_id')::uuid
         and earnings.week_start = current_setting('atlas_test.success_week')::date)
    ) then
    raise exception 'FAIL: live production/rate/crew changes altered locked parents or detail snapshots';
  end if;

  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.historical_earning_id')::uuid
      and factory_id = current_setting('atlas_test.factory_id')::uuid
      and labourer_id = current_setting('atlas_test.historical_labourer_id')::uuid
      and week_start = current_setting('atlas_test.historical_week')::date
      and quantity_used = 1000
      and wage_rate_id = current_setting('atlas_test.legacy_production_rate_id')::uuid
      and rate_used = 999
      and amount = 999
  ) then
    raise exception 'FAIL: existing historical weekly earning was modified';
  end if;

  if not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_test.legacy_production_rate_id')::uuid
      and applies_to = 'production'
      and rate_per_1000_bricks = 999
  ) then
    raise exception 'FAIL: legacy production wage rate was modified or deleted';
  end if;

  raise notice 'PASS: locked parent/details and legacy history remain unchanged after live source-data changes';
end;
$$;

rollback;
