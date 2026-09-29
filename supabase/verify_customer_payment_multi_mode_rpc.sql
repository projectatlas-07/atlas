-- Atlas multi-mode customer payments Step 3 verifier.
-- Run only against Test Atlas Clean after migration 20260929000069.
-- Every fixture is rolled back; no multi-mode payment persists.

begin;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  factory_a_id uuid := gen_random_uuid();
  factory_b_id uuid := gen_random_uuid();
  brick_a_id uuid := gen_random_uuid();
  brick_b_id uuid := gen_random_uuid();
  customer_b_id uuid := gen_random_uuid();
begin
  if to_regprocedure(
    'public.create_customer_payment(uuid,uuid,date,numeric,text,text,jsonb)'
  ) is null
    or to_regprocedure(
      'public.create_customer_payment_with_methods(uuid,uuid,date,numeric,jsonb,text,jsonb)'
    ) is null then
    raise exception 'FAIL: legacy or multi-mode RPC contract is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.customer_payments'::regclass
      and conname = 'customer_payments_payment_mode_check'
      and pg_get_constraintdef(oid) ilike '%multiple%'
  ) then
    raise exception 'FAIL: temporary multiple compatibility value is not constrained';
  end if;

  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(
    id, name, business_description, address, mobile,
    village, post_office, police_station, district, state
  ) values
    (factory_a_id, format('Multi-mode Factory A %s', factory_a_id),
      'Brick manufacturer A', 'Address A', '9000000001',
      'Village A', 'Post A', 'Police A', 'District A', 'State A'),
    (factory_b_id, format('Multi-mode Factory B %s', factory_b_id),
      'Brick manufacturer B', 'Address B', '9000000002',
      'Village B', 'Post B', 'Police B', 'District B', 'State B');

  update public.factory_users as mappings
  set factory_id = factory_a_id, is_active = true
  where mappings.id = mapping_id;

  insert into public.brick_types(id, factory_id, name) values
    (brick_a_id, factory_a_id, 'Multi-mode Brick A'),
    (brick_b_id, factory_b_id, 'Multi-mode Brick B');
  insert into public.customers(id, factory_id, name, address, mobile)
  values (customer_b_id, factory_b_id, 'Factory B Customer', 'Address B', '9222222222');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_test.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_test.brick_a_id', brick_a_id::text, true);
  perform set_config('atlas_test.customer_b_id', customer_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_test.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_test.factory_b_id')::uuid;
  brick_a_id uuid := current_setting('atlas_test.brick_a_id')::uuid;
  customer_b_id uuid := current_setting('atlas_test.customer_b_id')::uuid;
  customer public.customers%rowtype;
  received_now_customer public.customers%rowtype;
  legacy_challan public.challans%rowtype;
  unsplit_challan public.challans%rowtype;
  split_challan_one public.challans%rowtype;
  split_challan_two public.challans%rowtype;
  invalid_challan public.challans%rowtype;
  received_now_challan public.challans%rowtype;
  legacy_payment public.customer_payments%rowtype;
  unsplit_payment public.customer_payments%rowtype;
  split_payment public.customer_payments%rowtype;
  received_now_payment public.customer_payments%rowtype;
  payment_state record;
  payment_count_before bigint;
  method_count_before bigint;
  allocation_count_before bigint;
begin
  select * into customer from public.create_customer(
    factory_a_id, 'Multi-mode Customer', 'Address', '9111111111'
  );

  select * into legacy_challan from public.create_challan(
    factory_a_id, 'MM-LEGACY', date '2026-09-29', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 1000
    )),
    '[]'::jsonb
  );
  select * into unsplit_challan from public.create_challan(
    factory_a_id, 'MM-UNSPLIT', date '2026-09-29', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 2000
    )),
    '[]'::jsonb
  );
  select * into split_challan_one from public.create_challan(
    factory_a_id, 'MM-SPLIT-ONE', date '2026-09-29', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 60000
    )),
    '[]'::jsonb
  );
  select * into split_challan_two from public.create_challan(
    factory_a_id, 'MM-SPLIT-TWO', date '2026-09-29', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 40000
    )),
    '[]'::jsonb
  );
  select * into invalid_challan from public.create_challan(
    factory_a_id, 'MM-INVALID', date '2026-09-29', customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 1000
    )),
    '[]'::jsonb
  );

  select * into legacy_payment from public.create_customer_payment(
    factory_a_id, customer.id, date '2026-09-29', 100,
    'cash', 'Legacy compatibility',
    jsonb_build_array(jsonb_build_object(
      'challan_id', legacy_challan.id, 'amount', 100
    ))
  );
  if legacy_payment.payment_mode <> 'cash'
    or (select count(*) from public.customer_payment_methods
        where payment_id = legacy_payment.id and mode = 'cash'
          and split_amount is null) <> 1 then
    raise exception 'FAIL: legacy single-mode payment compatibility changed';
  end if;
  raise notice 'PASS: legacy scalar RPC creates one unsplit method';

  select * into unsplit_payment from public.create_customer_payment_with_methods(
    factory_a_id, customer.id, date '2026-09-29', 500,
    jsonb_build_array(
      jsonb_build_object('mode', 'upi', 'amount', null),
      jsonb_build_object('mode', 'cheque')
    ),
    'Unsplit multi-mode',
    jsonb_build_array(jsonb_build_object(
      'challan_id', unsplit_challan.id, 'amount', 500
    ))
  );
  if unsplit_payment.payment_mode <> 'multiple'
    or (select count(*) from public.customer_payment_methods
        where payment_id = unsplit_payment.id) <> 2
    or (select count(*) from public.customer_payment_methods
        where payment_id = unsplit_payment.id and split_amount is null) <> 2
    or not exists (select 1 from public.customer_payment_methods
        where payment_id = unsplit_payment.id and mode = 'upi')
    or not exists (select 1 from public.customer_payment_methods
        where payment_id = unsplit_payment.id and mode = 'cheque')
    or (select count(*) from public.customer_payment_allocations
        where payment_id = unsplit_payment.id) <> 1
    or not (select is_locked from public.challans where id = unsplit_challan.id) then
    raise exception 'FAIL: unsplit UPI + Cheque payment is incorrect';
  end if;
  raise notice 'PASS: unsplit UPI + Cheque creates one payment and two NULL method splits';

  select * into split_payment from public.create_customer_payment_with_methods(
    factory_a_id, customer.id, date '2026-09-29', 100000,
    jsonb_build_array(
      jsonb_build_object('mode', 'upi', 'amount', 10000),
      jsonb_build_object('mode', 'cheque', 'amount', 90000)
    ),
    'Explicit multi-mode split',
    jsonb_build_array(
      jsonb_build_object('challan_id', split_challan_one.id, 'amount', 60000),
      jsonb_build_object('challan_id', split_challan_two.id, 'amount', 40000)
    )
  );
  if split_payment.payment_mode <> 'multiple'
    or (select count(*) from public.customer_payment_methods
        where payment_id = split_payment.id) <> 2
    or not exists (select 1 from public.customer_payment_methods
        where payment_id = split_payment.id and mode = 'upi' and split_amount = 10000)
    or not exists (select 1 from public.customer_payment_methods
        where payment_id = split_payment.id and mode = 'cheque' and split_amount = 90000)
    or (select count(*) from public.customer_payment_allocations
        where payment_id = split_payment.id) <> 2
    or (select sum(allocated_amount) from public.customer_payment_allocations
        where payment_id = split_payment.id) <> 100000
    or not (select is_locked from public.challans where id = split_challan_one.id)
    or not (select is_locked from public.challans where id = split_challan_two.id) then
    raise exception 'FAIL: explicit method splits duplicated or changed allocations/locks';
  end if;
  select * into payment_state
  from public.get_challan_payment_state(factory_a_id, split_challan_one.id);
  if payment_state.total_paid <> 60000 or payment_state.outstanding_amount <> 0 then
    raise exception 'FAIL: payment-state calculations changed for multi-mode payment';
  end if;
  raise notice 'PASS: 10,000 UPI + 90,000 Cheque uses one header and one allocation set';

  select count(*) into payment_count_before
  from public.customer_payments where customer_id = customer.id;
  select count(*) into method_count_before
  from public.customer_payment_methods where factory_id = factory_a_id;
  select count(*) into allocation_count_before
  from public.customer_payment_allocations where factory_id = factory_a_id;

  begin
    perform public.create_customer_payment_with_methods(
      factory_a_id, customer.id, date '2026-09-29', 100,
      '[{"mode":"upi","amount":10},{"mode":"cheque","amount":null}]'::jsonb,
      null,
      jsonb_build_array(jsonb_build_object('challan_id', invalid_challan.id, 'amount', 100))
    );
    raise exception 'FAIL: partial method split unexpectedly succeeded' using errcode = 'P9999';
  exception when sqlstate 'P3201' then null;
  end;

  begin
    perform public.create_customer_payment_with_methods(
      factory_a_id, customer.id, date '2026-09-29', 100,
      '[{"mode":"upi","amount":10},{"mode":"cheque","amount":80}]'::jsonb,
      null,
      jsonb_build_array(jsonb_build_object('challan_id', invalid_challan.id, 'amount', 100))
    );
    raise exception 'FAIL: mismatched method split unexpectedly succeeded' using errcode = 'P9999';
  exception when sqlstate 'P3202' then null;
  end;

  begin
    perform public.create_customer_payment_with_methods(
      factory_a_id, customer.id, date '2026-09-29', 100,
      '[{"mode":"upi"},{"mode":"UPI"}]'::jsonb,
      null,
      jsonb_build_array(jsonb_build_object('challan_id', invalid_challan.id, 'amount', 100))
    );
    raise exception 'FAIL: duplicate normalized methods unexpectedly succeeded' using errcode = 'P9999';
  exception when sqlstate 'P3203' then null;
  end;

  begin
    perform public.create_customer_payment_with_methods(
      factory_a_id, customer.id, date '2026-09-29', 100,
      '[{"mode":"card"}]'::jsonb,
      null,
      jsonb_build_array(jsonb_build_object('challan_id', invalid_challan.id, 'amount', 100))
    );
    raise exception 'FAIL: invalid method unexpectedly succeeded' using errcode = 'P9999';
  exception when sqlstate 'P3200' then null;
  end;

  if (select count(*) from public.customer_payments where customer_id = customer.id)
      <> payment_count_before
    or (select count(*) from public.customer_payment_methods where factory_id = factory_a_id)
      <> method_count_before
    or (select count(*) from public.customer_payment_allocations where factory_id = factory_a_id)
      <> allocation_count_before
    or (select is_locked from public.challans where id = invalid_challan.id) then
    raise exception 'FAIL: rejected method input left payment data or a lock behind';
  end if;
  raise notice 'PASS: partial, mismatched, duplicate, and invalid methods fail without residue';

  select * into received_now_customer from public.create_customer(
    factory_a_id, 'Received Now Customer', 'Address', '9333333333'
  );
  select * into received_now_challan from public.create_challan_with_received_payment(
    factory_a_id, 'MM-RECEIVED-NOW', date '2026-09-29', received_now_customer.id,
    null, null,
    jsonb_build_array(jsonb_build_object(
      'brick_type_id', brick_a_id, 'quantity', 1000,
      'pricing_mode', 'RATE', 'rate', 1000
    )),
    '[]'::jsonb,
    date '2026-09-29', 250, 'bank_transfer'
  );
  select * into received_now_payment
  from public.customer_payments
  where customer_id = received_now_customer.id;
  if received_now_payment.payment_mode <> 'bank_transfer'
    or (select count(*) from public.customer_payment_methods
        where payment_id = received_now_payment.id
          and mode = 'bank_transfer' and split_amount is null) <> 1
    or not received_now_challan.is_locked then
    raise exception 'FAIL: Received Now single-mode compatibility changed';
  end if;
  raise notice 'PASS: Received Now remains one unsplit single-mode payment';

  begin
    perform public.create_customer_payment_with_methods(
      factory_b_id, customer_b_id, date '2026-09-29', 1,
      '[{"mode":"cash"}]'::jsonb,
      null,
      jsonb_build_array(jsonb_build_object('challan_id', gen_random_uuid(), 'amount', 1))
    );
    raise exception 'FAIL: cross-factory multi-mode payment unexpectedly succeeded'
      using errcode = 'P9999';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.customer_payments where factory_id = factory_b_id) then
    raise exception 'FAIL: failed cross-factory call created a payment';
  end if;
  raise notice 'PASS: multi-mode writer preserves factory isolation';

  perform public.initialize_cash_book(factory_a_id, date '2026-09-29', 0);
  if (select count(*)
      from public.list_cash_book_day_entries(factory_a_id, date '2026-09-29')
      where source_type = 'customer_payment' and source_id = split_payment.id) <> 1
    or not exists (
      select 1
      from public.list_cash_book_day_entries(factory_a_id, date '2026-09-29')
      where source_type = 'customer_payment'
        and source_id = split_payment.id
        and amount = 100000
        and payment_mode = 'multiple'
    ) then
    raise exception 'FAIL: multi-mode payment changed Cash Book one-row-per-payment behavior';
  end if;
  raise notice 'PASS: Cash Book remains one movement for the multi-mode payment header';
end;
$$;

reset role;

rollback;
