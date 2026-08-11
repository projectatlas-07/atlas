-- Run after 20260811000000_fix_wage_rate_carry_forward.sql.
-- All fixtures and the temporary factory-user mapping are removed by ROLLBACK.

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
  function_definition text;
  function_record record;
  public_can_execute boolean;
begin
  select pg_get_functiondef('public.create_wage_rate(uuid, text, numeric, date)'::regprocedure)
    into function_definition;

  if function_definition not ilike '%set effective_to = p_effective_from - 1%' then
    raise exception 'FAIL: create_wage_rate does not close the previous rate one day before its replacement';
  end if;

  select procedure.prosecdef, procedure.proconfig, procedure.proacl, procedure.proowner
    into function_record
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'public.create_wage_rate(uuid, text, numeric, date)'::regprocedure;

  select exists (
    select 1
    from aclexplode(coalesce(function_record.proacl, acldefault('f', function_record.proowner))) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) into public_can_execute;

  if not function_record.prosecdef
    or not coalesce(function_record.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public']
    or not has_function_privilege(
      'authenticated',
      'public.create_wage_rate(uuid, text, numeric, date)'::regprocedure,
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.create_wage_rate(uuid, text, numeric, date)'::regprocedure,
      'EXECUTE'
    )
    or public_can_execute then
    raise exception 'FAIL: create_wage_rate security or execution grants changed';
  end if;

  if exists (
    with ordered_rates as (
      select
        wage_rates.id,
        wage_rates.factory_id,
        wage_rates.applies_to,
        wage_rates.effective_from,
        wage_rates.effective_to,
        lead(wage_rates.effective_from) over (
          partition by wage_rates.factory_id, wage_rates.applies_to
          order by wage_rates.effective_from, wage_rates.id
        ) as next_effective_from
      from public.wage_rates
    )
    select 1
    from ordered_rates
    where ordered_rates.effective_to = ordered_rates.effective_from + 6
      and (
        ordered_rates.next_effective_from is null
        or ordered_rates.next_effective_from > ordered_rates.effective_to + 1
      )
      and not exists (
        select 1
        from public.wage_rates as overlapping_rate
        where overlapping_rate.factory_id = ordered_rates.factory_id
          and overlapping_rate.applies_to = ordered_rates.applies_to
          and overlapping_rate.id <> ordered_rates.id
          and overlapping_rate.effective_from <= ordered_rates.effective_to
          and (
            overlapping_rate.effective_to is null
            or overlapping_rate.effective_to >= ordered_rates.effective_from
          )
      )
  ) then
    raise exception 'FAIL: a legacy one-week-capped rate still creates a carry-forward gap';
  end if;

  if has_table_privilege('authenticated', 'public.wage_rates', 'INSERT')
    or has_table_privilege('authenticated', 'public.wage_rates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.wage_rates', 'DELETE')
    or not has_table_privilege('authenticated', 'public.wage_rates', 'SELECT') then
    raise exception 'FAIL: wage_rates browser permissions changed';
  end if;

  raise notice 'PASS: legacy bug rows are corrected and create_wage_rate remains authoritative and secure';
end;
$$;

do $$
declare
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_type_a_id uuid := gen_random_uuid();
  labourer_a_id uuid := gen_random_uuid();
  group_a_id uuid := gen_random_uuid();
begin
  select user_id into test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;

  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories (id, name)
  values
    (factory_a_id, 'Module 2.11B1 Factory A ' || factory_a_id),
    (factory_b_id, 'Module 2.11B1 Factory B ' || factory_b_id);

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where user_id = test_user_id;

  insert into public.brick_types (id, factory_id, name)
  values (brick_type_a_id, factory_a_id, 'Carry-forward audit brick');

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active)
  values (labourer_a_id, factory_a_id, 'Carry-forward audit labourer', brick_type_a_id, true);

  insert into public.labour_groups (id, factory_id, name, member_count, is_active)
  values (group_a_id, factory_a_id, 'Carry-forward audit mud group', 8, true);

  insert into public.wage_rates (
    factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values
    (factory_b_id, 'production', 900, date '2026-07-27'),
    (factory_b_id, 'mud_supply', 900, date '2026-07-27');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.group_a_id', group_a_id::text, true);
  perform set_config('request.jwt.claim.sub', test_user_id::text, true);

  raise notice 'PASS: isolated carry-forward fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  production_rate public.wage_rates%rowtype;
  mud_rate public.wage_rates%rowtype;
  visible_factory_b_rates integer;
begin
  select * into production_rate
  from public.create_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    'production', 500::numeric, date '2026-07-27'
  );

  select * into mud_rate
  from public.create_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    'mud_supply', 230::numeric, date '2026-07-27'
  );

  if production_rate.effective_to is not null or mud_rate.effective_to is not null then
    raise exception 'FAIL: first rates are not open-ended';
  end if;

  if not exists (
    select 1 from public.wage_rates
    where id = production_rate.id
      and effective_from <= date '2026-08-03'
      and (effective_to is null or effective_to >= date '2026-08-03')
  ) or not exists (
    select 1 from public.wage_rates
    where id = mud_rate.id
      and effective_from <= date '2026-08-03'
      and (effective_to is null or effective_to >= date '2026-08-03')
  ) then
    raise exception 'FAIL: 2026-07-27 rates do not carry through the unchanged week of 2026-08-03';
  end if;

  select count(*) into visible_factory_b_rates
  from public.wage_rates
  where factory_id = current_setting('atlas_test.factory_b_id')::uuid;
  if visible_factory_b_rates <> 0 then
    raise exception 'FAIL: Factory A can read Factory B rate history';
  end if;

  perform set_config('atlas_test.production_old_rate_id', production_rate.id::text, true);
  perform set_config('atlas_test.mud_old_rate_id', mud_rate.id::text, true);
  raise notice 'PASS: production and mud rates carry across a week with no replacement';
end;
$$;

reset role;

insert into public.weekly_earnings (
  factory_id, labourer_id, week_start, quantity_used, wage_rate_id, rate_used, amount
) values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.labourer_a_id')::uuid,
  date '2026-08-03',
  1000,
  current_setting('atlas_test.production_old_rate_id')::uuid,
  500,
  500
);

select set_config(
  'atlas_test.locked_earning_id',
  (
    select id::text from public.weekly_earnings
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
      and week_start = date '2026-08-03'
  ),
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  production_rate public.wage_rates%rowtype;
  mud_rate public.wage_rates%rowtype;
  week_to_check date;
  matching_rates integer;
begin
  select * into production_rate
  from public.create_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    'production', 530::numeric, date '2026-08-10'
  );

  select * into mud_rate
  from public.create_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    'mud_supply', 240::numeric, date '2026-08-10'
  );

  if not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_test.production_old_rate_id')::uuid
      and effective_to = date '2026-08-09'
  ) or not exists (
    select 1 from public.wage_rates
    where id = current_setting('atlas_test.mud_old_rate_id')::uuid
      and effective_to = date '2026-08-09'
  ) then
    raise exception 'FAIL: replacement did not close previous rates on 2026-08-09';
  end if;

  if production_rate.effective_from <> date '2026-08-10'
    or production_rate.effective_to is not null
    or mud_rate.effective_from <> date '2026-08-10'
    or mud_rate.effective_to is not null then
    raise exception 'FAIL: replacement rates are not open-ended from 2026-08-10';
  end if;

  foreach week_to_check in array array[
    date '2026-07-27', date '2026-08-03', date '2026-08-10'
  ] loop
    select count(*) into matching_rates
    from public.wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'production'
      and effective_from <= week_to_check
      and (effective_to is null or effective_to >= week_to_check);
    if matching_rates <> 1 then
      raise exception 'FAIL: production history resolves % rates for week %', matching_rates, week_to_check;
    end if;

    select count(*) into matching_rates
    from public.wage_rates
    where factory_id = current_setting('atlas_test.factory_a_id')::uuid
      and applies_to = 'mud_supply'
      and effective_from <= week_to_check
      and (effective_to is null or effective_to >= week_to_check);
    if matching_rates <> 1 then
      raise exception 'FAIL: mud history resolves % rates for week %', matching_rates, week_to_check;
    end if;
  end loop;

  raise notice 'PASS: replacements close on the prior Sunday with no production or mud rate gap';
end;
$$;

do $$
begin
  if not exists (
    select 1 from public.weekly_earnings
    where id = current_setting('atlas_test.locked_earning_id')::uuid
      and quantity_used = 1000
      and wage_rate_id = current_setting('atlas_test.production_old_rate_id')::uuid
      and rate_used = 500
      and amount = 500
  ) then
    raise exception 'FAIL: locked weekly earning changed when the rate history changed';
  end if;

  perform pg_temp.expect_error(
    'Factory A cannot create a Factory B replacement rate',
    '42501',
    $sql$
      select public.create_wage_rate(
        current_setting('atlas_test.factory_b_id')::uuid,
        'production', 910::numeric, date '2026-08-10'
      )
    $sql$
  );

  raise notice 'PASS: locked earnings stay unchanged and rate creation remains factory-scoped';
end;
$$;

reset role;

insert into public.wage_rates (
  factory_id, applies_to, rate_per_1000_bricks, effective_from
) values
  (current_setting('atlas_test.factory_a_id')::uuid, 'production', 540, date '2026-08-03'),
  (current_setting('atlas_test.factory_a_id')::uuid, 'mud_supply', 250, date '2026-08-03');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'production calculation still rejects overlapping rates',
    'P0001',
    $sql$
      select * from public.calculate_production_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        date '2026-08-03'
      )
    $sql$
  );

  perform pg_temp.expect_error(
    'mud calculation still rejects overlapping rates',
    'P0001',
    $sql$
      select * from public.calculate_mud_supply_wages(
        current_setting('atlas_test.factory_a_id')::uuid,
        current_setting('atlas_test.group_a_id')::uuid,
        date '2026-08-03'
      )
    $sql$
  );

  raise notice 'PASS: overlapping production and mud histories remain rejected';
  raise notice 'PASS: WAGE-RATE CARRY-FORWARD VERIFICATION COMPLETED';
end;
$$;

rollback;
