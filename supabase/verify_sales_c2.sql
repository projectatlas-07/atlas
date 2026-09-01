-- Atlas Sales correction C2 verifier.
-- Run after 20260901000030_create_vehicle_challan_snapshot_foundation.sql.
-- Requires one existing factory_users row. All fixtures and mapping changes roll back.

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
  raise exception 'FAIL: % unexpectedly succeeded', test_label using errcode = 'P9999';
exception when others then
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
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  customer_a_id uuid := gen_random_uuid();
  customer_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  factory_b_vehicle_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicles'::regclass
      and conname = 'vehicles_factory_normalized_number_key'
      and contype = 'u'
  ) then
    raise exception 'FAIL: factory-normalized Vehicle unique constraint is missing';
  end if;
  if position(
    'on conflict (factory_id, normalized_vehicle_number) do nothing'
    in lower(pg_get_functiondef(
      'public.find_or_create_vehicle(uuid,text,boolean)'::regprocedure
    ))
  ) = 0 then
    raise exception 'FAIL: find/create does not use its concurrency-safe conflict path';
  end if;
  raise notice 'PASS: database uniqueness and ON CONFLICT make Vehicle creation race-safe';

  insert into public.factories(
    id, name, business_description, village, post_office, police_station,
    district, state, address, mobile
  ) values
    (
      factory_a_id, format('C2 Factory A %s', factory_a_id), 'Brick maker',
      'Village A', 'Post A', 'Police A', 'District A', 'State A',
      'Legacy A', '9000000001'
    ),
    (
      factory_b_id, format('C2 Factory B %s', factory_b_id), 'Brick maker',
      'Village B', 'Post B', 'Police B', 'District B', 'State B',
      'Legacy B', '9000000002'
    );
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;
  insert into public.customers(id, factory_id, name, address, mobile) values
    (customer_a_id, factory_a_id, 'C2 Customer A', 'Address A', '9111111111'),
    (customer_b_id, factory_b_id, 'C2 Customer B', 'Address B', '9222222222');
  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'C2 Brick A'),
    (brick_b_id, factory_b_id, 'C2 Brick B');

  -- Same normalized identity is legal in another factory.
  insert into public.vehicles(
    id, factory_id, vehicle_number, normalized_vehicle_number,
    delivery_wage_tracking_enabled
  ) values (
    factory_b_vehicle_id, factory_b_id, 'WB12AB1234', 'WB12AB1234', true
  );

  perform set_config('atlas_c2.user_id', test_user_id::text, true);
  perform set_config('atlas_c2.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_c2.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_c2.customer_a_id', customer_a_id::text, true);
  perform set_config('atlas_c2.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_c2.factory_b_vehicle_id', factory_b_vehicle_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_c2.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_c2.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_c2.factory_b_id')::uuid;
  customer_a_id uuid := current_setting('atlas_c2.customer_a_id')::uuid;
  brick_a_id uuid := current_setting('atlas_c2.brick_a_id')::uuid;
  factory_b_vehicle_id uuid := current_setting('atlas_c2.factory_b_vehicle_id')::uuid;
  vehicle_on_a public.vehicles%rowtype;
  vehicle_on_b public.vehicles%rowtype;
  vehicle_off public.vehicles%rowtype;
  duplicate_vehicle public.vehicles%rowtype;
  no_vehicle_challan public.challans%rowtype;
  off_challan public.challans%rowtype;
  historical_on_challan public.challans%rowtype;
  future_off_challan public.challans%rowtype;
  update_target public.challans%rowtype;
  void_target public.challans%rowtype;
  financial_challan public.challans%rowtype;
  note_only public.challans%rowtype;
  payment_state record;
  payment_row public.customer_payments%rowtype;
  brick_revenue numeric;
  other_revenue numeric;
begin
  select * into vehicle_on_a from public.find_or_create_vehicle(
    factory_a_id, 'wb 12 ab 1234', true
  );
  select * into duplicate_vehicle from public.find_or_create_vehicle(
    factory_a_id, 'WB12AB1234', false
  );
  if duplicate_vehicle.id <> vehicle_on_a.id
    or duplicate_vehicle.delivery_wage_tracking_enabled <> true
    or vehicle_on_a.normalized_vehicle_number <> 'WB12AB1234' then
    raise exception 'FAIL: formatting variants did not resolve to the existing Vehicle';
  end if;
  if not exists (
    select 1 from public.vehicles
    where factory_id = factory_a_id and normalized_vehicle_number = 'WB12AB1234'
  ) or (select count(*) from public.vehicles
        where normalized_vehicle_number = 'WB12AB1234') <> 1 then
    -- RLS exposes only Factory A here; Factory B is checked below as postgres.
    raise exception 'FAIL: normalized Vehicle identity is not unique in visible factory scope';
  end if;
  raise notice 'PASS: create, normalization, and equivalent-number resolution';

  select * into vehicle_on_b from public.find_or_create_vehicle(
    factory_a_id, 'WB12ON0002', true
  );
  select * into vehicle_off from public.find_or_create_vehicle(
    factory_a_id, 'WB12OFF003', false
  );
  if (select count(*) from public.vehicles where factory_id = factory_b_id) <> 0 then
    raise exception 'FAIL: Vehicle RLS exposed another factory';
  end if;
  raise notice 'PASS: Vehicle reads are factory-isolated by RLS';

  perform pg_temp.expect_error(
    'cross-factory Vehicle attachment is rejected',
    'P3102',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-01', customer_a_id, factory_b_vehicle_id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
      )), '[]'
    )
  );

  select * into no_vehicle_challan from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, null::uuid, 999,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if no_vehicle_challan.vehicle_id is not null
    or no_vehicle_challan.vehicle_number_snapshot is not null
    or no_vehicle_challan.delivery_wage_applicable_snapshot
    or no_vehicle_challan.trip_labour_wage is not null then
    raise exception 'FAIL: no-Vehicle save retained Vehicle/wage state';
  end if;
  raise notice 'PASS: no Vehicle is valid and clears all C2 wage state';

  select * into off_challan from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, vehicle_off.id, 999,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if off_challan.vehicle_id <> vehicle_off.id
    or off_challan.vehicle_number_snapshot <> vehicle_off.vehicle_number
    or off_challan.delivery_wage_applicable_snapshot
    or off_challan.trip_labour_wage is not null then
    raise exception 'FAIL: OFF Vehicle snapshot is inconsistent';
  end if;
  raise notice 'PASS: OFF Vehicle snapshots identity and stores no stale wage';

  perform pg_temp.expect_error(
    'ON Vehicle requires Trip Labour Wage',
    'P3106',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-01', customer_a_id, vehicle_on_a.id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
      )), '[]'
    )
  );

  select * into historical_on_challan from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, vehicle_on_a.id, 750,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if historical_on_challan.vehicle_id <> vehicle_on_a.id
    or historical_on_challan.vehicle_number_snapshot <> vehicle_on_a.vehicle_number
    or not historical_on_challan.delivery_wage_applicable_snapshot
    or historical_on_challan.trip_labour_wage <> 750 then
    raise exception 'FAIL: ON Vehicle wage snapshot is inconsistent';
  end if;
  raise notice 'PASS: ON Vehicle snapshots required positive Trip Labour Wage';

  select * into vehicle_on_a from public.set_vehicle_delivery_wage_tracking(
    factory_a_id, vehicle_on_a.id, false
  );
  select * into historical_on_challan from public.challans
  where id = historical_on_challan.id;
  if not historical_on_challan.delivery_wage_applicable_snapshot
    or historical_on_challan.trip_labour_wage <> 750 then
    raise exception 'FAIL: live ON-to-OFF change rewrote historical snapshot';
  end if;
  select * into future_off_challan from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, vehicle_on_a.id, 999,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if future_off_challan.delivery_wage_applicable_snapshot
    or future_off_challan.trip_labour_wage is not null then
    raise exception 'FAIL: future save ignored current OFF setting';
  end if;
  raise notice 'PASS: live setting changes affect future saves only';

  select * into vehicle_on_a from public.set_vehicle_delivery_wage_tracking(
    factory_a_id, vehicle_on_a.id, true
  );
  select * into update_target from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, vehicle_on_a.id, 800,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  select * into update_target from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-02', customer_a_id,
    vehicle_off.id, 800,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if update_target.vehicle_id <> vehicle_off.id
    or update_target.delivery_wage_applicable_snapshot
    or update_target.trip_labour_wage is not null then
    raise exception 'FAIL: ON-to-OFF edit retained stale wage';
  end if;

  perform pg_temp.expect_error(
    'OFF-to-ON edit requires a new Trip Labour Wage',
    'P3106',
    format(
      'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L::uuid, null::numeric, %L::jsonb, %L::jsonb)',
      factory_a_id, update_target.id, '2026-09-02', customer_a_id,
      vehicle_on_b.id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
      )), '[]'
    )
  );
  select * into update_target from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-02', customer_a_id,
    vehicle_on_b.id, 900,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if update_target.vehicle_id <> vehicle_on_b.id
    or update_target.vehicle_number_snapshot <> vehicle_on_b.vehicle_number
    or update_target.trip_labour_wage <> 900 then
    raise exception 'FAIL: ON-A to ON-B edit did not snapshot Vehicle B';
  end if;
  select * into update_target from public.update_challan(
    factory_a_id, update_target.id, date '2026-09-02', customer_a_id,
    null::uuid, 900,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  if update_target.vehicle_id is not null
    or update_target.vehicle_number_snapshot is not null
    or update_target.delivery_wage_applicable_snapshot
    or update_target.trip_labour_wage is not null then
    raise exception 'FAIL: removing Vehicle did not clear C2 state';
  end if;
  raise notice 'PASS: unlocked Vehicle edits re-resolve config and clear stale state';

  select * into void_target from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, vehicle_on_b.id, 700,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
    )), '[]'::jsonb
  );
  select * into void_target from public.void_challan(factory_a_id, void_target.id);
  if void_target.status <> 'void'
    or void_target.vehicle_id <> vehicle_on_b.id
    or not void_target.delivery_wage_applicable_snapshot
    or void_target.trip_labour_wage <> 700 then
    raise exception 'FAIL: void erased historical Vehicle/wage state';
  end if;
  raise notice 'PASS: void preserves historical Vehicle and wage snapshots';

  select * into vehicle_on_b from public.archive_vehicle(factory_a_id, vehicle_on_b.id);
  if vehicle_on_b.is_active
    or exists (select 1 from public.vehicles where id = vehicle_on_b.id and is_active)
    or not exists (select 1 from public.challans where id = void_target.id
      and vehicle_id = vehicle_on_b.id) then
    raise exception 'FAIL: archive lifecycle or historical reference is inconsistent';
  end if;
  perform pg_temp.expect_error(
    'archived Vehicle is rejected for a final save',
    'P3105',
    format(
      'select * from public.create_challan(%L::uuid, date %L, %L::uuid, %L::uuid, 700, %L::jsonb, %L::jsonb)',
      factory_a_id, '2026-09-01', customer_a_id, vehicle_on_b.id,
      jsonb_build_array(jsonb_build_object(
        'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 1000
      )), '[]'
    )
  );
  select * into vehicle_on_b from public.restore_vehicle(factory_a_id, vehicle_on_b.id);
  if not vehicle_on_b.is_active then
    raise exception 'FAIL: restore did not reactivate Vehicle';
  end if;
  raise notice 'PASS: archive excludes future saves, preserves history, and restore works';

  select * into financial_challan from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, vehicle_on_a.id, 750,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000, 'rate', 100000
    )),
    jsonb_build_array(jsonb_build_object(
      'line_type', 'EXTRA_CHARGE', 'order_index', 0,
      'particulars', 'Loading', 'amount', 2000
    ))
  );
  select coalesce(sum(line_amount), 0) into brick_revenue
  from public.challan_items where challan_id = financial_challan.id;
  select coalesce(sum(amount), 0) into other_revenue
  from public.challan_flexible_lines
  where challan_id = financial_challan.id
    and line_type = 'EXTRA_CHARGE' and line_category = 'OTHER_REVENUE';
  if brick_revenue <> 100000 or other_revenue <> 2000
    or financial_challan.challan_total <> 102000
    or financial_challan.trip_labour_wage <> 750 then
    raise exception 'FAIL: customer revenue and internal Trip Labour Wage are not isolated';
  end if;
  select * into payment_state from public.get_challan_payment_state(
    factory_a_id, financial_challan.id
  );
  if payment_state.outstanding_amount <> 102000 then
    raise exception 'FAIL: Trip Labour Wage entered initial customer outstanding';
  end if;
  select * into payment_row from public.create_customer_payment(
    factory_a_id, customer_a_id, date '2026-09-01', 60000, 'cash', null,
    jsonb_build_array(jsonb_build_object(
      'challan_id', financial_challan.id, 'amount', 60000
    ))
  );
  select * into payment_state from public.get_challan_payment_state(
    factory_a_id, financial_challan.id
  );
  if payment_state.total_paid <> 60000
    or payment_state.outstanding_amount <> 42000
    or financial_challan.trip_labour_wage <> 750 then
    raise exception 'FAIL: payment/outstanding calculation included Trip Labour Wage';
  end if;
  raise notice 'PASS: ₹100,000 brick + ₹2,000 Other Revenue = ₹102,000 total; ₹750 wage remains separate; ₹60,000 payment leaves ₹42,000';

  select * into note_only from public.create_challan(
    factory_a_id, date '2026-09-01', customer_a_id, null::uuid, null::numeric,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'line_type', 'NOTE', 'order_index', 0, 'particulars', 'C2 A3 regression'
    ))
  );
  if note_only.challan_total <> 0
    or note_only.company_village_snapshot <> 'Village A'
    or not exists (select 1 from public.challan_flexible_lines
      where challan_id = note_only.id and line_type = 'NOTE') then
    raise exception 'FAIL: A1/A2/A3 structured/flexible/manual regression';
  end if;
  raise notice 'PASS: A1 structured snapshots, A2 flexible rows, A3 manual content, A4 totals, and A5 split remain intact';

  perform set_config('atlas_c2.locked_challan_id', financial_challan.id::text, true);
  perform set_config('atlas_c2.locked_vehicle_id', vehicle_on_a.id::text, true);
end;
$$;

-- Payment creation above set the authoritative lock. Both Vehicle identity and
-- Trip Labour Wage changes must be rejected through the ordinary update RPC.
select pg_temp.expect_error(
  'payment-locked Challan cannot change Vehicle',
  'P3005',
  format(
    'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, null::uuid, null::numeric, %L::jsonb, %L::jsonb)',
    current_setting('atlas_c2.factory_a_id'),
    current_setting('atlas_c2.locked_challan_id'),
    '2026-09-02',
    current_setting('atlas_c2.customer_a_id'),
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', current_setting('atlas_c2.brick_a_id')::uuid,
      'quantity', 1000, 'rate', 100000
    )),
    '[]'
  )
);
select pg_temp.expect_error(
  'payment-locked Challan cannot change Trip Labour Wage',
  'P3005',
  format(
    'select * from public.update_challan(%L::uuid, %L::uuid, date %L, %L::uuid, %L::uuid, 999, %L::jsonb, %L::jsonb)',
    current_setting('atlas_c2.factory_a_id'),
    current_setting('atlas_c2.locked_challan_id'),
    '2026-09-02',
    current_setting('atlas_c2.customer_a_id'),
    current_setting('atlas_c2.locked_vehicle_id'),
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', current_setting('atlas_c2.brick_a_id')::uuid,
      'quantity', 1000, 'rate', 100000
    )),
    '[]'
  )
);

reset role;

do $$
declare
  factory_a_id uuid := current_setting('atlas_c2.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_c2.factory_b_id')::uuid;
begin
  if (select count(*) from public.vehicles
      where normalized_vehicle_number = 'WB12AB1234') <> 2
    or not exists (select 1 from public.vehicles
      where factory_id = factory_a_id and normalized_vehicle_number = 'WB12AB1234')
    or not exists (select 1 from public.vehicles
      where factory_id = factory_b_id and normalized_vehicle_number = 'WB12AB1234') then
    raise exception 'FAIL: same normalized number was not allowed across two factories';
  end if;
  raise notice 'PASS: same normalized Vehicle number is allowed in different factories';
  raise notice 'PASS: C2 verifier complete; all fixture writes will now roll back';
end;
$$;

rollback;
