-- Mud Phase 4B rollback verifier. Run only on confirmed Test Atlas Clean.

begin;

create or replace function pg_temp.expect_error(test_label text, expected_sqlstate text, statement_to_test text)
returns void language plpgsql as $$
begin
  execute statement_to_test;
  raise exception 'FAIL: % unexpectedly succeeded', test_label using errcode = 'P9999';
exception when others then
  if sqlstate = expected_sqlstate then
    raise notice 'PASS: %', test_label;
  else
    raise exception 'FAIL: % expected SQLSTATE %, received % (%)', test_label, expected_sqlstate, sqlstate, sqlerrm;
  end if;
end;
$$;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  real_factory_id uuid;
  ready_factory_id uuid := gen_random_uuid();
  config_factory_id uuid := gen_random_uuid();
  mismatch_factory_id uuid := gen_random_uuid();
  rate_change_factory_id uuid := gen_random_uuid();
  incomplete_factory_id uuid := gen_random_uuid();
  ready_group_id uuid := gen_random_uuid();
  config_group_a_id uuid := gen_random_uuid();
  config_group_b_id uuid := gen_random_uuid();
  mismatch_group_id uuid := gen_random_uuid();
  rate_change_group_id uuid := gen_random_uuid();
  incomplete_group_id uuid := gen_random_uuid();
  fixture_factory_id uuid;
  fixture_group_id uuid;
  brick_id uuid;
  labourer_id uuid;
  legacy_rate_id uuid;
begin
  select states.factory_id into real_factory_id
  from public.mud_accounting_states as states
  where states.accounting_mode = 'SHADOW'
  order by states.factory_id
  limit 1;
  if real_factory_id is null then
    raise exception 'FAIL: Test Atlas Clean must have its real factory in SHADOW';
  end if;

  select users.id, users.user_id into mapping_id, test_user_id
  from public.factory_users as users
  where users.factory_id = real_factory_id and users.is_active = true
  order by users.created_at, users.id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: real SHADOW factory requires an active user mapping';
  end if;

  perform set_config('atlas_mud_cert.mapping_id', mapping_id::text, true);
  perform set_config('atlas_mud_cert.user_id', test_user_id::text, true);
  perform set_config('atlas_mud_cert.real_factory_id', real_factory_id::text, true);
  perform set_config('atlas_mud_cert.ready_factory_id', ready_factory_id::text, true);
  perform set_config('atlas_mud_cert.config_factory_id', config_factory_id::text, true);
  perform set_config('atlas_mud_cert.mismatch_factory_id', mismatch_factory_id::text, true);
  perform set_config('atlas_mud_cert.rate_change_factory_id', rate_change_factory_id::text, true);
  perform set_config('atlas_mud_cert.incomplete_factory_id', incomplete_factory_id::text, true);
  perform set_config('atlas_mud_cert.ready_group_id', ready_group_id::text, true);
  perform set_config('atlas_mud_cert.real_transition_count', (select count(*)::text from public.mud_accounting_mode_transitions as transitions where transitions.factory_id = real_factory_id), true);
  perform set_config('atlas_mud_cert.baseline_settlements', (select count(*)::text from public.mud_factory_settlements), true);
  perform set_config('atlas_mud_cert.baseline_openings', (select count(*)::text from public.mud_group_legacy_openings), true);
  perform set_config('atlas_mud_cert.baseline_withdrawals', (select count(*)::text from public.withdrawals), true);
  perform set_config('atlas_mud_cert.baseline_production_settlements', (select count(*)::text from public.production_earning_settlements), true);
  perform set_config('atlas_mud_cert.baseline_transport_earnings', (select count(*)::text from public.transport_weekly_earnings), true);
  perform set_config('atlas_mud_cert.production_function_hash', md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))), true);
  perform set_config('atlas_mud_cert.transport_function_hash', md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))), true);
  perform set_config('atlas_mud_cert.mud_wage_function_hash', md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))), true);
  perform set_config('atlas_mud_cert.mud_withdrawal_function_hash', md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))), true);

  insert into public.factories(id, name, business_description, address, mobile) values
    (ready_factory_id, format('Mud Cert Ready %s', ready_factory_id), 'Verifier', 'Verifier', '9000000011'),
    (config_factory_id, format('Mud Cert Config %s', config_factory_id), 'Verifier', 'Verifier', '9000000012'),
    (mismatch_factory_id, format('Mud Cert Mismatch %s', mismatch_factory_id), 'Verifier', 'Verifier', '9000000013'),
    (rate_change_factory_id, format('Mud Cert Rate %s', rate_change_factory_id), 'Verifier', 'Verifier', '9000000014'),
    (incomplete_factory_id, format('Mud Cert Incomplete %s', incomplete_factory_id), 'Verifier', 'Verifier', '9000000015');

  foreach fixture_factory_id in array array[ready_factory_id, config_factory_id, mismatch_factory_id, rate_change_factory_id, incomplete_factory_id]
  loop
    brick_id := gen_random_uuid();
    labourer_id := gen_random_uuid();
    insert into public.brick_types(id, factory_id, name) values (brick_id, fixture_factory_id, format('Cert Brick %s', fixture_factory_id));
    insert into public.labourers(id, factory_id, name, assigned_brick_type_id) values (labourer_id, fixture_factory_id, format('Cert Labourer %s', fixture_factory_id), brick_id);
    insert into public.production_entries(id, factory_id, labourer_id, brick_type_id, production_date, quantity)
    select gen_random_uuid(), fixture_factory_id, labourer_id, brick_id, date '2026-08-31' + days.day_offset, 1000
    from generate_series(0, 6) as days(day_offset);
  end loop;

  insert into public.labour_groups(id, factory_id, name, member_count, is_active) values
    (ready_group_id, ready_factory_id, 'Ready Group', 5, true),
    (config_group_a_id, config_factory_id, 'Config Group A', 5, true),
    (config_group_b_id, config_factory_id, 'Config Group B', 5, false),
    (mismatch_group_id, mismatch_factory_id, 'Mismatch Group', 5, true),
    (rate_change_group_id, rate_change_factory_id, 'Rate Change Group', 5, true),
    (incomplete_group_id, incomplete_factory_id, 'Incomplete Group', 5, true);

  insert into public.mud_group_terms(factory_id, labour_group_id, member_count, effective_from) values
    (ready_factory_id, ready_group_id, 5, date '2026-08-31'),
    (config_factory_id, config_group_a_id, 5, date '2026-08-31'),
    (config_factory_id, config_group_b_id, 5, date '2026-08-31'),
    (mismatch_factory_id, mismatch_group_id, 5, date '2026-08-31'),
    (rate_change_factory_id, rate_change_group_id, 5, date '2026-08-31'),
    (incomplete_factory_id, incomplete_group_id, 5, date '2026-09-14');

  insert into public.mud_group_rates(factory_id, labour_group_id, rate_per_1000_bricks, effective_from, effective_to) values
    (ready_factory_id, ready_group_id, 100, date '2026-08-31', null),
    (config_factory_id, config_group_a_id, 100, date '2026-08-31', null),
    (config_factory_id, config_group_b_id, 100, date '2026-08-31', null),
    (mismatch_factory_id, mismatch_group_id, 100, date '2026-08-31', null),
    (rate_change_factory_id, rate_change_group_id, 100, date '2026-08-31', date '2026-09-02'),
    (rate_change_factory_id, rate_change_group_id, 120, date '2026-09-03', null),
    (incomplete_factory_id, incomplete_group_id, 100, date '2026-09-14', null);

  foreach fixture_factory_id in array array[ready_factory_id, config_factory_id, mismatch_factory_id, rate_change_factory_id, incomplete_factory_id]
  loop
    legacy_rate_id := gen_random_uuid();
    insert into public.wage_rates(id, factory_id, applies_to, rate_per_1000_bricks, effective_from)
    values (legacy_rate_id, fixture_factory_id, 'mud_supply', 100, date '2026-08-31');
    fixture_group_id := case fixture_factory_id
      when ready_factory_id then ready_group_id
      when config_factory_id then config_group_a_id
      when mismatch_factory_id then mismatch_group_id
      when rate_change_factory_id then rate_change_group_id
      else incomplete_group_id
    end;
    insert into public.weekly_earnings(
      factory_id, labour_group_id, week_start, quantity_used, wage_rate_id, rate_used, amount
    ) values (
      fixture_factory_id,
      fixture_group_id,
      case when fixture_factory_id = incomplete_factory_id then date '2026-09-14' else date '2026-08-31' end,
      7000,
      legacy_rate_id,
      100,
      case when fixture_factory_id = mismatch_factory_id then 701 else 700 end
    );
  end loop;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);

do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.real_factory_id')::uuid);
  if certification.certification_status <> 'WAITING_FOR_COMPLETED_WEEK'
    or certification.certification_week is not null then
    raise exception 'FAIL: real factory without a completed locked week was not waiting';
  end if;
  raise notice 'PASS: real Test Atlas Clean factory is waiting for a completed locked parity week';
end;
$$;

select pg_temp.expect_error(
  'direct SHADOW to SETTLEMENT blocked outside atomic cutover authority',
  'P3201',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', current_setting('atlas_mud_cert.real_factory_id'), 'SETTLEMENT')
);

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cert.ready_factory_id')::uuid
where id = current_setting('atlas_mud_cert.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);

do $$
declare certification record;
begin
  perform public.transition_mud_accounting_mode(current_setting('atlas_mud_cert.ready_factory_id')::uuid, 'SHADOW');
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.ready_factory_id')::uuid);
  if certification.certification_status <> 'READY'
    or certification.certification_week <> date '2026-08-31'
    or certification.legacy_earning <> 700
    or certification.new_engine_earning <> 700
    or certification.difference <> 0
    or certification.parity_status <> 'PARITY_OK' then
    raise exception 'FAIL: constant-rate single-group completed week was not READY: %', row_to_json(certification);
  end if;
  raise notice 'PASS: valid real-style constant-rate single-group week is READY with exact parity';
end;
$$;

select pg_temp.expect_error(
  'factory isolation for certification read model',
  '42501',
  format('select * from public.get_mud_shadow_certification_status(%L::uuid)', current_setting('atlas_mud_cert.config_factory_id'))
);

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cert.config_factory_id')::uuid
where id = current_setting('atlas_mud_cert.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);
select * from public.transition_mud_accounting_mode(current_setting('atlas_mud_cert.config_factory_id')::uuid, 'SHADOW');

do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.config_factory_id')::uuid);
  if certification.certification_status <> 'CONFIGURATION_ERROR'
    or certification.parity_status <> 'CONFIGURATION_ERROR' then
    raise exception 'FAIL: multi-group completed week did not block as CONFIGURATION_ERROR: %', row_to_json(certification);
  end if;
  raise notice 'PASS: multi-group completed week cannot certify';
end;
$$;
select pg_temp.expect_error(
  'CONFIGURATION_ERROR factory cannot bypass atomic cutover authority', 'P3201',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', current_setting('atlas_mud_cert.config_factory_id'), 'SETTLEMENT')
);

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cert.mismatch_factory_id')::uuid
where id = current_setting('atlas_mud_cert.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);
select * from public.transition_mud_accounting_mode(current_setting('atlas_mud_cert.mismatch_factory_id')::uuid, 'SHADOW');

do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.mismatch_factory_id')::uuid);
  if certification.certification_status <> 'UNEXPECTED_MISMATCH'
    or certification.legacy_earning <> 701
    or certification.new_engine_earning <> 700
    or certification.difference <> -1 then
    raise exception 'FAIL: unexpected mismatch did not block with exact figures: %', row_to_json(certification);
  end if;
  raise notice 'PASS: UNEXPECTED_MISMATCH blocks certification';
end;
$$;
select pg_temp.expect_error(
  'UNEXPECTED_MISMATCH factory cannot bypass atomic cutover authority', 'P3201',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', current_setting('atlas_mud_cert.mismatch_factory_id'), 'SETTLEMENT')
);

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cert.rate_change_factory_id')::uuid
where id = current_setting('atlas_mud_cert.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);
select * from public.transition_mud_accounting_mode(current_setting('atlas_mud_cert.rate_change_factory_id')::uuid, 'SHADOW');

do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.rate_change_factory_id')::uuid);
  if certification.certification_status <> 'WAITING_FOR_COMPLETED_WEEK'
    or certification.parity_status <> 'EXPECTED_RATE_CHANGE_DIFFERENCE'
    or certification.legacy_earning <> 700
    or certification.new_engine_earning <> 780
    or certification.difference <> 80 then
    raise exception 'FAIL: expected rate-change difference was not kept separate: %', row_to_json(certification);
  end if;
  raise notice 'PASS: EXPECTED_RATE_CHANGE_DIFFERENCE remains correct but does not certify';
end;
$$;
select pg_temp.expect_error(
  'EXPECTED_RATE_CHANGE_DIFFERENCE cannot bypass atomic cutover authority', 'P3201',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', current_setting('atlas_mud_cert.rate_change_factory_id'), 'SETTLEMENT')
);

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cert.incomplete_factory_id')::uuid
where id = current_setting('atlas_mud_cert.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);
select * from public.transition_mud_accounting_mode(current_setting('atlas_mud_cert.incomplete_factory_id')::uuid, 'SHADOW');

do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.incomplete_factory_id')::uuid);
  if certification.certification_status <> 'WAITING_FOR_COMPLETED_WEEK'
    or certification.certification_week is not null then
    raise exception 'FAIL: incomplete week incorrectly certified: %', row_to_json(certification);
  end if;
  raise notice 'PASS: incomplete week does not certify';
end;
$$;

reset role;
update public.factory_users set factory_id = current_setting('atlas_mud_cert.real_factory_id')::uuid
where id = current_setting('atlas_mud_cert.mapping_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_mud_cert.user_id'), true);

do $$
declare certification record;
begin
  select * into certification from public.get_mud_shadow_certification_status(current_setting('atlas_mud_cert.real_factory_id')::uuid);
  if certification.certification_status <> 'WAITING_FOR_COMPLETED_WEEK' then
    raise exception 'FAIL: rollback-only READY fixture leaked certification to the real factory';
  end if;
  raise notice 'PASS: verifier-only fixture parity does not certify the real factory';
end;
$$;
select pg_temp.expect_error(
  'real factory remains blocked outside atomic cutover authority', 'P3201',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L::public.mud_accounting_mode)', current_setting('atlas_mud_cert.real_factory_id'), 'SETTLEMENT')
);

reset role;

do $$
declare real_factory_id uuid := current_setting('atlas_mud_cert.real_factory_id')::uuid;
begin
  if (select accounting_mode from public.mud_accounting_states where factory_id = real_factory_id) <> 'SHADOW'
    or (select count(*) from public.mud_accounting_mode_transitions where factory_id = real_factory_id) <> current_setting('atlas_mud_cert.real_transition_count')::bigint
    or exists (select 1 from public.mud_accounting_states where accounting_mode = 'SETTLEMENT') then
    raise exception 'FAIL: verifier changed the real mode/audit or created a SETTLEMENT mode';
  end if;
  if (select count(*) from public.mud_factory_settlements) <> current_setting('atlas_mud_cert.baseline_settlements')::bigint
    or (select count(*) from public.mud_group_legacy_openings) <> current_setting('atlas_mud_cert.baseline_openings')::bigint
    or (select count(*) from public.withdrawals) <> current_setting('atlas_mud_cert.baseline_withdrawals')::bigint then
    raise exception 'FAIL: certification changed Mud financial rows';
  end if;
  if (select count(*) from public.production_earning_settlements) <> current_setting('atlas_mud_cert.baseline_production_settlements')::bigint
    or (select count(*) from public.transport_weekly_earnings) <> current_setting('atlas_mud_cert.baseline_transport_earnings')::bigint
    or md5(pg_get_functiondef(to_regprocedure('public.get_production_labourer_account(uuid,uuid,date)'))) <> current_setting('atlas_mud_cert.production_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.calculate_transport_weekly_wages(uuid,date)'))) <> current_setting('atlas_mud_cert.transport_function_hash') then
    raise exception 'FAIL: Production or Chamber Transport changed';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.calculate_mud_supply_wages(uuid,uuid,date)'))) <> current_setting('atlas_mud_cert.mud_wage_function_hash')
    or md5(pg_get_functiondef(to_regprocedure('public.create_labour_group_withdrawal(uuid,uuid,date,numeric)'))) <> current_setting('atlas_mud_cert.mud_withdrawal_function_hash') then
    raise exception 'FAIL: legacy Mud accounting authority changed';
  end if;
  raise notice 'PASS: no SETTLEMENT transition, financial change, Production change, or Chamber Transport change';
end;
$$;

rollback;

select 'PASS: Mud Phase 4B certification verifier completed and every fixture was rolled back.' as result;
