-- Atlas Module 2 Rework R2.4 work-date production-rate resolver verifier.
-- Run after applying 20260816000003_create_production_wage_rate_resolver.sql.
-- It requires one existing public.factory_users row. Every fixture, temporary
-- constraint change, and mapping change is discarded by the final rollback.

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
  routine record;
  routine_definition text;
  calculator_definition text;
  public_can_execute boolean;
  required_error_code text;
begin
  select procedure.prosecdef, procedure.provolatile, procedure.proconfig,
    procedure.proacl, procedure.proowner
    into routine
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure;

  select pg_get_functiondef(
    'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure
  ) into routine_definition;

  select exists (
    select 1
    from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) into public_can_execute;

  if routine.prosecdef
    or routine.provolatile <> 's'
    or not coalesce(routine.proconfig, array[]::text[])
      @> array['search_path=pg_catalog, public']
    or has_function_privilege('authenticated',
      'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure,
      'EXECUTE')
    or has_function_privilege('anon',
      'public.resolve_production_wage_rate(uuid, uuid, date)'::regprocedure,
      'EXECUTE')
    or public_can_execute then
    raise exception 'FAIL: internal resolver volatility, search_path, or privileges are incorrect';
  end if;

  if routine_definition ilike '%is_active%'
    or routine_definition ilike '%isodow%'
    or routine_definition ilike '%order by%'
    or routine_definition ilike '%limit 1%'
    or routine_definition ilike '%weekly_earnings%'
    or routine_definition ilike '%production_entries%'
    or routine_definition ilike '%withdrawals%'
    or routine_definition ilike '%public.wage_rates%' then
    raise exception 'FAIL: resolver contains forbidden lifecycle, weekday, arbitrary-choice, or legacy logic';
  end if;

  foreach required_error_code in array array[
    'P2401', 'P2402', 'P2403', 'P2404', 'P2405', 'P2406'
  ] loop
    if routine_definition not ilike format('%%%s%%', required_error_code) then
      raise exception 'FAIL: resolver is missing structured error code %', required_error_code;
    end if;
  end loop;

  if routine_definition not ilike '%matching_rate_count > 1%'
    or routine_definition not ilike '%matching_assignment_count > 1%' then
    raise exception 'FAIL: resolver does not explicitly detect ambiguous cardinality';
  end if;

  select pg_get_functiondef(
    'public.calculate_production_wages(uuid, date)'::regprocedure
  ) into calculator_definition;

  if calculator_definition ilike '%resolve_production_wage_rate%'
    or calculator_definition not ilike '%public.wage_rates%' then
    raise exception 'FAIL: production calculator changed during resolver milestone';
  end if;

  raise notice 'PASS: internal resolver security, structured errors, cardinality checks, and calculator isolation are correct';
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_type_a_id uuid := gen_random_uuid();
  brick_type_b_id uuid := gen_random_uuid();
  labourer_a_id uuid := gen_random_uuid();
  moved_labourer_id uuid := gen_random_uuid();
  returned_labourer_id uuid := gen_random_uuid();
  override_only_labourer_id uuid := gen_random_uuid();
  unassigned_labourer_id uuid := gen_random_uuid();
  missing_rate_labourer_id uuid := gen_random_uuid();
  ambiguous_override_labourer_id uuid := gen_random_uuid();
  ambiguous_assignment_labourer_id uuid := gen_random_uuid();
  ambiguous_crew_rate_labourer_id uuid := gen_random_uuid();
  labourer_b_id uuid := gen_random_uuid();
  crew_a_id uuid := gen_random_uuid();
  crew_b_id uuid := gen_random_uuid();
  crew_without_rate_id uuid := gen_random_uuid();
  ambiguous_rate_crew_id uuid := gen_random_uuid();
  production_entry_id uuid := gen_random_uuid();
  legacy_wage_rate_id uuid := gen_random_uuid();
  weekly_earning_id uuid := gen_random_uuid();
  withdrawal_id uuid := gen_random_uuid();
  crew_a_old_rate_id uuid := gen_random_uuid();
  crew_a_new_rate_id uuid := gen_random_uuid();
  crew_b_rate_id uuid := gen_random_uuid();
  labourer_override_id uuid := gen_random_uuid();
  override_only_rate_id uuid := gen_random_uuid();
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
    (factory_a_id, format('R2.4 verification Factory A %s', factory_a_id)),
    (factory_b_id, format('R2.4 verification Factory B %s', factory_b_id));

  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.brick_types (id, factory_id, name)
  values
    (brick_type_a_id, factory_a_id, 'R2.4 verification brick A'),
    (brick_type_b_id, factory_b_id, 'R2.4 verification brick B');

  insert into public.labourers (
    id, factory_id, name, assigned_brick_type_id, is_active
  ) values
    (labourer_a_id, factory_a_id, 'R2.4 historical labourer', brick_type_a_id, false),
    (moved_labourer_id, factory_a_id, 'R2.4 moved labourer', brick_type_a_id, true),
    (returned_labourer_id, factory_a_id, 'R2.4 returned labourer', brick_type_a_id, true),
    (override_only_labourer_id, factory_a_id, 'R2.4 override-only labourer', brick_type_a_id, true),
    (unassigned_labourer_id, factory_a_id, 'R2.4 unassigned labourer', brick_type_a_id, true),
    (missing_rate_labourer_id, factory_a_id, 'R2.4 missing-rate labourer', brick_type_a_id, true),
    (ambiguous_override_labourer_id, factory_a_id, 'R2.4 ambiguous-override labourer', brick_type_a_id, true),
    (ambiguous_assignment_labourer_id, factory_a_id, 'R2.4 ambiguous-assignment labourer', brick_type_a_id, true),
    (ambiguous_crew_rate_labourer_id, factory_a_id, 'R2.4 ambiguous-crew-rate labourer', brick_type_a_id, true),
    (labourer_b_id, factory_b_id, 'R2.4 Factory B labourer', brick_type_b_id, true);

  insert into public.production_crews (id, factory_id, name, is_active)
  values
    (crew_a_id, factory_a_id, 'R2.4 Crew A', false),
    (crew_b_id, factory_a_id, 'R2.4 Crew B', true),
    (crew_without_rate_id, factory_a_id, 'R2.4 Crew Without Rate', true),
    (ambiguous_rate_crew_id, factory_a_id, 'R2.4 Ambiguous Rate Crew', true);

  insert into public.production_crew_assignments (
    factory_id, labourer_id, production_crew_id, effective_from, effective_to
  ) values
    (factory_a_id, labourer_a_id, crew_a_id, date '2026-08-01', null),
    (factory_a_id, moved_labourer_id, crew_a_id, date '2026-08-01', date '2026-08-10'),
    (factory_a_id, moved_labourer_id, crew_b_id, date '2026-08-11', null),
    (factory_a_id, returned_labourer_id, crew_a_id, date '2026-08-01', date '2026-08-05'),
    (factory_a_id, returned_labourer_id, crew_b_id, date '2026-08-10', null),
    (factory_a_id, missing_rate_labourer_id, crew_without_rate_id, date '2026-08-01', null),
    (factory_a_id, ambiguous_assignment_labourer_id, crew_a_id, date '2026-08-01', null),
    (factory_a_id, ambiguous_crew_rate_labourer_id, ambiguous_rate_crew_id, date '2026-08-01', null);

  insert into public.production_wage_rates (
    id, factory_id, production_crew_id, labourer_id,
    rate_per_1000_bricks, effective_from, effective_to
  ) values
    (crew_a_old_rate_id, factory_a_id, crew_a_id, null, 520, date '2026-08-01', date '2026-08-05'),
    (crew_a_new_rate_id, factory_a_id, crew_a_id, null, 530, date '2026-08-06', null),
    (crew_b_rate_id, factory_a_id, crew_b_id, null, 610, date '2026-08-01', null),
    (labourer_override_id, factory_a_id, null, labourer_a_id, 540, date '2026-08-05', date '2026-08-20'),
    (override_only_rate_id, factory_a_id, null, override_only_labourer_id, 555, date '2026-08-01', null),
    (gen_random_uuid(), factory_a_id, null, ambiguous_override_labourer_id, 700, date '2026-08-01', null),
    (gen_random_uuid(), factory_a_id, ambiguous_rate_crew_id, null, 710, date '2026-08-01', null);

  insert into public.production_entries (
    id, factory_id, labourer_id, brick_type_id, production_date, quantity
  ) values (
    production_entry_id, factory_a_id, labourer_a_id,
    brick_type_a_id, date '2026-08-04', 1000
  );

  insert into public.wage_rates (
    id, factory_id, applies_to, rate_per_1000_bricks, effective_from
  ) values (
    legacy_wage_rate_id, factory_a_id, 'production', 500, date '2026-08-03'
  );

  insert into public.weekly_earnings (
    id, factory_id, labourer_id, week_start, quantity_used,
    wage_rate_id, rate_used, amount
  ) values (
    weekly_earning_id, factory_a_id, labourer_a_id,
    date '2026-08-03', 1000, legacy_wage_rate_id, 500, 500
  );

  insert into public.withdrawals (
    id, factory_id, labourer_id, withdrawal_date, amount, note
  ) values (
    withdrawal_id, factory_a_id, labourer_a_id,
    date '2026-08-08', 25, 'R2.4 preservation fixture'
  );

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_type_a_id', brick_type_a_id::text, true);
  perform set_config('atlas_test.labourer_a_id', labourer_a_id::text, true);
  perform set_config('atlas_test.moved_labourer_id', moved_labourer_id::text, true);
  perform set_config('atlas_test.returned_labourer_id', returned_labourer_id::text, true);
  perform set_config('atlas_test.override_only_labourer_id', override_only_labourer_id::text, true);
  perform set_config('atlas_test.unassigned_labourer_id', unassigned_labourer_id::text, true);
  perform set_config('atlas_test.missing_rate_labourer_id', missing_rate_labourer_id::text, true);
  perform set_config('atlas_test.ambiguous_override_labourer_id', ambiguous_override_labourer_id::text, true);
  perform set_config('atlas_test.ambiguous_assignment_labourer_id', ambiguous_assignment_labourer_id::text, true);
  perform set_config('atlas_test.ambiguous_crew_rate_labourer_id', ambiguous_crew_rate_labourer_id::text, true);
  perform set_config('atlas_test.labourer_b_id', labourer_b_id::text, true);
  perform set_config('atlas_test.crew_a_id', crew_a_id::text, true);
  perform set_config('atlas_test.crew_b_id', crew_b_id::text, true);
  perform set_config('atlas_test.ambiguous_rate_crew_id', ambiguous_rate_crew_id::text, true);
  perform set_config('atlas_test.production_entry_id', production_entry_id::text, true);
  perform set_config('atlas_test.legacy_wage_rate_id', legacy_wage_rate_id::text, true);
  perform set_config('atlas_test.weekly_earning_id', weekly_earning_id::text, true);
  perform set_config('atlas_test.withdrawal_id', withdrawal_id::text, true);
  perform set_config('atlas_test.crew_a_old_rate_id', crew_a_old_rate_id::text, true);
  perform set_config('atlas_test.crew_a_new_rate_id', crew_a_new_rate_id::text, true);
  perform set_config('atlas_test.crew_b_rate_id', crew_b_rate_id::text, true);
  perform set_config('atlas_test.labourer_override_id', labourer_override_id::text, true);
  perform set_config('atlas_test.override_only_rate_id', override_only_rate_id::text, true);

  raise notice 'PASS: rollback-only R2.4 historical fixtures created';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
begin
  perform pg_temp.expect_error(
    'authenticated clients cannot execute the internal resolver',
    '42501',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-10'
    )
  );
end;
$$;

reset role;

do $$
declare
  resolved record;
begin
  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-04'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.crew_a_old_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 520
    or resolved.rate_source <> 'crew_default'
    or resolved.production_crew_id
      is distinct from current_setting('atlas_test.crew_a_id')::uuid then
    raise exception 'FAIL: pre-override work date did not resolve the inactive historical crew default';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-05'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.labourer_override_id')::uuid
    or resolved.rate_per_1000_bricks <> 540
    or resolved.rate_source <> 'individual_override'
    or resolved.production_crew_id is not null then
    raise exception 'FAIL: exact mid-week override start did not take precedence';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-10'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.labourer_override_id')::uuid
    or resolved.rate_per_1000_bricks <> 540
    or resolved.rate_source <> 'individual_override' then
    raise exception 'FAIL: simultaneous override did not beat crew default';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.labourer_a_id')::uuid,
    date '2026-08-21'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.crew_a_new_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 530
    or resolved.rate_source <> 'crew_default' then
    raise exception 'FAIL: expired override did not fall back to the crew default';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.override_only_labourer_id')::uuid,
    date '2026-08-02'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.override_only_rate_id')::uuid
    or resolved.rate_source <> 'individual_override'
    or resolved.rate_per_1000_bricks <> 555 then
    raise exception 'FAIL: override without a crew assignment did not resolve';
  end if;

  raise notice 'PASS: override precedence, exact start, expiry fallback, and override-only resolution are correct';
end;
$$;

do $$
declare
  resolved record;
begin
  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.moved_labourer_id')::uuid,
    date '2026-08-05'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.crew_a_old_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 520 then
    raise exception 'FAIL: Wednesday did not resolve the pre-change crew rate';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.moved_labourer_id')::uuid,
    date '2026-08-06'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.crew_a_new_rate_id')::uuid
    or resolved.rate_per_1000_bricks <> 530 then
    raise exception 'FAIL: Thursday did not resolve the exact mid-week replacement rate';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.moved_labourer_id')::uuid,
    date '2026-08-08'
  );

  if resolved.production_crew_id
      is distinct from current_setting('atlas_test.crew_a_id')::uuid
    or resolved.rate_per_1000_bricks <> 530 then
    raise exception 'FAIL: old work date did not resolve Crew A history';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.moved_labourer_id')::uuid,
    date '2026-08-12'
  );

  if resolved.production_wage_rate_id
      is distinct from current_setting('atlas_test.crew_b_rate_id')::uuid
    or resolved.production_crew_id
      is distinct from current_setting('atlas_test.crew_b_id')::uuid
    or resolved.rate_per_1000_bricks <> 610 then
    raise exception 'FAIL: later work date did not resolve Crew B history';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.returned_labourer_id')::uuid,
    date '2026-08-04'
  );

  if resolved.production_crew_id
      is distinct from current_setting('atlas_test.crew_a_id')::uuid
    or resolved.rate_per_1000_bricks <> 520 then
    raise exception 'FAIL: pre-leave work date did not resolve Crew A';
  end if;

  select * into resolved
  from public.resolve_production_wage_rate(
    current_setting('atlas_test.factory_a_id')::uuid,
    current_setting('atlas_test.returned_labourer_id')::uuid,
    date '2026-08-12'
  );

  if resolved.production_crew_id
      is distinct from current_setting('atlas_test.crew_b_id')::uuid
    or resolved.rate_per_1000_bricks <> 610 then
    raise exception 'FAIL: post-return work date did not resolve Crew B';
  end if;

  raise notice 'PASS: mid-week changes, crew moves, and leave/return history resolve by exact work date';
end;
$$;

do $$
begin
  perform pg_temp.expect_error(
    'missing crew assignment fails clearly',
    'P2402',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.unassigned_labourer_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'leave-period date without an assignment fails clearly',
    'P2402',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.returned_labourer_id'),
      '2026-08-08'
    )
  );

  perform pg_temp.expect_error(
    'missing crew default rate fails clearly',
    'P2403',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.missing_rate_labourer_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'wrong-factory labourer fails clearly',
    'P2401',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_b_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'missing work_date is rejected',
    '22023',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, null::date)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id')
    )
  );
end;
$$;

-- The exclusion constraints make ambiguity impossible through normal writes.
-- Drop them only inside this rollback-only transaction to prove the resolver
-- fails explicitly against corrupted/legacy data instead of choosing a row.
alter table public.production_wage_rates
  drop constraint production_wage_rates_no_overlapping_labourer_dates;

alter table public.production_crew_assignments
  drop constraint production_crew_assignments_no_overlapping_dates;

alter table public.production_wage_rates
  drop constraint production_wage_rates_no_overlapping_crew_dates;

insert into public.production_wage_rates (
  factory_id, labourer_id, rate_per_1000_bricks, effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.ambiguous_override_labourer_id')::uuid,
  705,
  date '2026-08-01'
);

insert into public.production_crew_assignments (
  factory_id, labourer_id, production_crew_id, effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.ambiguous_assignment_labourer_id')::uuid,
  current_setting('atlas_test.crew_b_id')::uuid,
  date '2026-08-01'
);

insert into public.production_wage_rates (
  factory_id, production_crew_id, rate_per_1000_bricks, effective_from
)
values (
  current_setting('atlas_test.factory_a_id')::uuid,
  current_setting('atlas_test.ambiguous_rate_crew_id')::uuid,
  715,
  date '2026-08-01'
);

do $$
begin
  perform pg_temp.expect_error(
    'ambiguous individual overrides fail explicitly',
    'P2404',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.ambiguous_override_labourer_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'ambiguous crew assignments fail explicitly',
    'P2405',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.ambiguous_assignment_labourer_id'),
      '2026-08-10'
    )
  );

  perform pg_temp.expect_error(
    'ambiguous crew-default rates fail explicitly',
    'P2406',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.ambiguous_crew_rate_labourer_id'),
      '2026-08-10'
    )
  );
end;
$$;

do $$
begin
  if (select count(*) from public.weekly_earnings
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid) <> 1
    or not exists (
      select 1 from public.weekly_earnings
      where id = current_setting('atlas_test.weekly_earning_id')::uuid
        and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
        and wage_rate_id = current_setting('atlas_test.legacy_wage_rate_id')::uuid
        and week_start = date '2026-08-03'
        and quantity_used = 1000
        and rate_used = 500
        and amount = 500
    ) then
    raise exception 'FAIL: resolver created or modified weekly_earnings';
  end if;

  if (select count(*) from public.production_entries
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid) <> 1
    or not exists (
      select 1 from public.production_entries
      where id = current_setting('atlas_test.production_entry_id')::uuid
        and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
        and brick_type_id = current_setting('atlas_test.brick_type_a_id')::uuid
        and production_date = date '2026-08-04'
        and quantity = 1000
    ) then
    raise exception 'FAIL: resolver changed production entries';
  end if;

  if (select count(*) from public.withdrawals
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid) <> 1
    or not exists (
      select 1 from public.withdrawals
      where id = current_setting('atlas_test.withdrawal_id')::uuid
        and labourer_id = current_setting('atlas_test.labourer_a_id')::uuid
        and withdrawal_date = date '2026-08-08'
        and amount = 25
        and note = 'R2.4 preservation fixture'
    ) then
    raise exception 'FAIL: resolver changed withdrawals';
  end if;

  if (select count(*) from public.wage_rates
      where factory_id = current_setting('atlas_test.factory_a_id')::uuid) <> 1
    or not exists (
      select 1 from public.wage_rates
      where id = current_setting('atlas_test.legacy_wage_rate_id')::uuid
        and applies_to = 'production'
        and rate_per_1000_bricks = 500
        and effective_from = date '2026-08-03'
        and effective_to is null
    ) then
    raise exception 'FAIL: resolver changed legacy wage_rates';
  end if;

  raise notice 'PASS: resolver created no earnings and changed no production, withdrawal, or legacy-rate data';
end;
$$;

set local role anon;

do $$
begin
  perform pg_temp.expect_error(
    'anonymous clients cannot execute the internal resolver',
    '42501',
    format(
      'select * from public.resolve_production_wage_rate(%L::uuid, %L::uuid, date %L)',
      current_setting('atlas_test.factory_a_id'),
      current_setting('atlas_test.labourer_a_id'),
      '2026-08-10'
    )
  );
end;
$$;

reset role;

rollback;
