-- Coal selective seller settlement rollback verifier.
-- Run after 20260914000045_create_coal_selective_seller_settlement.sql.

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
  seller_b_id uuid := gen_random_uuid();
  coal_b_id uuid := gen_random_uuid();
  source_b_id uuid := gen_random_uuid();
  purchase_b_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users order by created_at, id limit 1 for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;
  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Coal Selective Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Coal Selective Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users set factory_id = factory_a_id, is_active = true where id = mapping_id;

  insert into public.suppliers(id, factory_id, name) values (seller_b_id, factory_b_id, 'Factory B Seller');
  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (factory_b_id, seller_b_id, 'COAL_SELLER', test_user_id);
  insert into public.coal_reference_values(id, factory_id, kind, display_value, created_by) values
    (coal_b_id, factory_b_id, 'coal_name', 'Factory B Coal', test_user_id),
    (source_b_id, factory_b_id, 'source_location', 'Factory B Source', test_user_id);
  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, description, total_amount, created_by
  ) values (
    purchase_b_id, factory_b_id, date '2026-09-10', 'purchase', seller_b_id,
    'Factory B Seller', 'Factory B Coal', 1000, test_user_id
  );
  insert into public.coal_purchases(
    id, factory_id, coal_name_reference_id, source_reference_id,
    coal_name_snapshot, source_location_snapshot, coal_challan_number,
    vehicle_number_snapshot, quantity, rate, coal_amount,
    separate_freight_amount, created_by
  ) values (
    purchase_b_id, factory_b_id, coal_b_id, source_b_id,
    'Factory B Coal', 'Factory B Source', 'B-1', 'WB 00 B 0001',
    1, 1000, 1000, 0, test_user_id
  );

  perform set_config('atlas_coal_selective.user_id', test_user_id::text, true);
  perform set_config('atlas_coal_selective.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_coal_selective.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_coal_selective.seller_b_id', seller_b_id::text, true);
  perform set_config('atlas_coal_selective.purchase_b_id', purchase_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_coal_selective.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_coal_selective.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_coal_selective.factory_b_id')::uuid;
  seller_b_id uuid := current_setting('atlas_coal_selective.seller_b_id')::uuid;
  purchase_b_id uuid := current_setting('atlas_coal_selective.purchase_b_id')::uuid;
  seller public.suppliers%rowtype;
  other_seller public.suppliers%rowtype;
  coal_name public.coal_reference_values%rowtype;
  source_name public.coal_reference_values%rowtype;
  selected_full public.coal_purchase_detail;
  unselected public.coal_purchase_detail;
  selected_partial public.coal_purchase_detail;
  outside_range public.coal_purchase_detail;
  other_purchase public.coal_purchase_detail;
  fully_paid public.coal_purchase_detail;
  voided public.coal_purchase_detail;
  stale public.coal_purchase_detail;
  batch_payment public.expense_payments%rowtype;
  before_payment_count bigint;
  before_allocation_count bigint;
  before_seller_outstanding numeric;
  after_seller_outstanding numeric;
  payment_row record;
  cash_row record;
begin
  perform public.initialize_cash_book(factory_a_id, date '2026-08-01', 10000000);
  select * into seller from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Selective Coal Seller', 'Main Road', null
  );
  select * into other_seller from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Other Coal Seller', null, null
  );
  select * into coal_name from public.create_coal_reference_value(factory_a_id, 'coal_name', 'Assam Coal');
  select * into source_name from public.create_coal_reference_value(factory_a_id, 'source_location', 'Raniganj');

  select * into selected_full from public.create_coal_purchase(
    factory_a_id, date '2026-09-02', seller.id, coal_name.id, source_name.id,
    '51', 'WB 01 A 0001', 8, 100000, null, 0, 0, null
  );
  select * into unselected from public.create_coal_purchase(
    factory_a_id, date '2026-09-06', seller.id, coal_name.id, source_name.id,
    '54', 'WB 01 A 0002', 12, 100000, null, 0, 0, null
  );
  select * into selected_partial from public.create_coal_purchase(
    factory_a_id, date '2026-09-11', seller.id, coal_name.id, source_name.id,
    '59', 'WB 01 A 0003', 20, 100000, null, 0, 500000, 'upi'
  );
  select * into outside_range from public.create_coal_purchase(
    factory_a_id, date '2026-08-31', seller.id, coal_name.id, source_name.id,
    'OUT', 'WB 01 A 0004', 1, 100, null, 0, 0, null
  );
  select * into other_purchase from public.create_coal_purchase(
    factory_a_id, date '2026-09-05', other_seller.id, coal_name.id, source_name.id,
    'OTHER', 'WB 01 A 0005', 1, 100, null, 0, 0, null
  );
  select * into fully_paid from public.create_coal_purchase(
    factory_a_id, date '2026-09-07', seller.id, coal_name.id, source_name.id,
    'PAID', 'WB 01 A 0006', 1, 100, null, 0, 100, 'cash'
  );
  select * into voided from public.create_coal_purchase(
    factory_a_id, date '2026-09-08', seller.id, coal_name.id, source_name.id,
    'VOID', 'WB 01 A 0007', 1, 100, null, 0, 0, null
  );
  select * into voided from public.void_coal_purchase(factory_a_id, voided.id);

  select coalesce(sum(outstanding_amount), 0) into before_seller_outstanding
  from public.list_coal_purchases(factory_a_id, seller.id) where status = 'active';

  select * into batch_payment from public.create_coal_selective_payment(
    factory_a_id, seller.id, date '2026-09-01', date '2026-09-30',
    date '2026-09-30', 'bank_transfer', 'Explicit September settlement',
    jsonb_build_array(
      jsonb_build_object('purchase_id', selected_full.id, 'amount', 800000),
      jsonb_build_object('purchase_id', selected_partial.id, 'amount', 500000)
    )
  );
  if batch_payment.amount <> 1300000
    or (select count(*) from public.expense_payment_allocations where payment_id = batch_payment.id) <> 2
    or (select allocated_amount from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id = selected_full.id) <> 800000
    or (select allocated_amount from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id = selected_partial.id) <> 500000 then
    raise exception 'FAIL: explicit mixed full and partial allocations are wrong';
  end if;
  select * into selected_full from public.list_coal_purchases(factory_a_id, seller.id) where id = selected_full.id;
  select * into selected_partial from public.list_coal_purchases(factory_a_id, seller.id) where id = selected_partial.id;
  if selected_full.outstanding_amount <> 0 or selected_full.payment_state <> 'paid' or not selected_full.is_locked
    or selected_partial.total_paid <> 1000000 or selected_partial.outstanding_amount <> 1000000
    or selected_partial.payment_state <> 'partially_paid' or not selected_partial.is_locked then
    raise exception 'FAIL: individual Paid, Outstanding, status, or financial locks are wrong';
  end if;
  if (select outstanding_amount from public.list_coal_purchases(factory_a_id, seller.id) where id = unselected.id) <> 1200000
    or (select outstanding_amount from public.list_coal_purchases(factory_a_id, seller.id) where id = outside_range.id) <> 100
    or (select outstanding_amount from public.list_coal_purchases(factory_a_id, other_seller.id) where id = other_purchase.id) <> 100
    or exists (select 1 from public.expense_payment_allocations where payment_id = batch_payment.id and expense_record_id in (unselected.id, outside_range.id, other_purchase.id, fully_paid.id, voided.id)) then
    raise exception 'FAIL: unselected, outside range, other seller, fully paid, or void purchase was touched';
  end if;
  select coalesce(sum(outstanding_amount), 0) into after_seller_outstanding
  from public.list_coal_purchases(factory_a_id, seller.id) where status = 'active';
  if before_seller_outstanding - after_seller_outstanding <> 1300000 then
    raise exception 'FAIL: seller Outstanding did not decrease by the exact selected payment';
  end if;
  raise notice 'PASS: explicit selected obligations received mixed full and partial allocations';
  raise notice 'PASS: unselected, outside range, other seller, fully paid, and void purchases remain untouched';

  select * into payment_row from public.list_coal_selective_payments(factory_a_id, seller.id)
  where payment_id = batch_payment.id;
  if not found or payment_row.amount <> 1300000 or payment_row.allocation_count <> 2
    or jsonb_array_length(payment_row.allocations) <> 2
    or (select count(*) from public.list_coal_selective_payments(factory_a_id, seller.id) where payment_id = batch_payment.id) <> 1 then
    raise exception 'FAIL: seller payment history did not show one payment with its allocation breakdown';
  end if;
  select * into cash_row from public.list_cash_book_day_entries(factory_a_id, date '2026-09-30')
  where source_type = 'expense_payment' and source_id = batch_payment.id;
  if not found or cash_row.amount <> 1300000 or cash_row.direction <> 'out'
    or cash_row.description <> 'Coal seller settlement · 2 purchases'
    or (select count(*) from public.list_cash_book_day_entries(factory_a_id, date '2026-09-30')
        where source_type = 'expense_payment' and source_id = batch_payment.id) <> 1 then
    raise exception 'FAIL: settlement did not create exactly one concise Cash Book Money Out';
  end if;
  raise notice 'PASS: seller payment history shows the payment once with details';
  raise notice 'PASS: one payment header and multiple allocations derive exactly one Cash Book Money Out';

  select count(*) into before_payment_count from public.expense_payments where factory_id = factory_a_id;
  select count(*) into before_allocation_count from public.expense_payment_allocations where factory_id = factory_a_id;
  perform pg_temp.expect_error('per-purchase over-allocation rejected', 'P4105', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',1000000.01)))',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30', selected_partial.id
  ));
  perform pg_temp.expect_error('zero allocation rejected', '22023', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',0)))',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30', selected_partial.id
  ));
  perform pg_temp.expect_error('negative allocation rejected', '22023', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',-1)))',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30', selected_partial.id
  ));
  perform pg_temp.expect_error('no selected purchases rejected', '22023', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,''[]''::jsonb)',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30'
  ));
  perform pg_temp.expect_error('invalid From after To rejected', '22023', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',1)))',
    factory_a_id, seller.id, '2026-09-30', '2026-09-01', '2026-09-30', selected_partial.id
  ));
  perform pg_temp.expect_error('outside range selection rejected', 'P4210', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',1)))',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30', outside_range.id
  ));
  perform pg_temp.expect_error('other seller selection rejected', 'P4210', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',1)))',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30', other_purchase.id
  ));
  if (select count(*) from public.expense_payments where factory_id = factory_a_id) <> before_payment_count
    or (select count(*) from public.expense_payment_allocations where factory_id = factory_a_id) <> before_allocation_count then
    raise exception 'FAIL: atomic rejected settlements left partial payment or allocation rows';
  end if;
  raise notice 'PASS: invalid and atomic settlement failures create no partial financial rows';

  select * into stale from public.create_coal_purchase(
    factory_a_id, date '2026-09-20', seller.id, coal_name.id, source_name.id,
    'STALE', 'WB 01 A 0008', 1, 100, null, 0, 0, null
  );
  perform public.create_coal_payment(factory_a_id, stale.id, date '2026-09-20', 60, 'cash', null);
  perform pg_temp.expect_error('stale outstanding recheck rejects complete settlement atomically', 'P4105', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',100)))',
    factory_a_id, seller.id, '2026-09-01', '2026-09-30', '2026-09-30', stale.id
  ));
  raise notice 'PASS: locked current outstanding is rechecked for stale/concurrent protection';

  perform pg_temp.expect_error('Factory A cannot settle Factory B Coal', '42501', format(
    'select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,''cash'',null,jsonb_build_array(jsonb_build_object(''purchase_id'',%L::uuid,''amount'',1)))',
    factory_b_id, seller_b_id, '2026-09-01', '2026-09-30', '2026-09-30', purchase_b_id
  ));
  if exists (select 1 from public.coal_purchases where id = purchase_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Coal';
  end if;
  raise notice 'PASS: selective settlement and history remain factory-isolated';
end;
$$;

reset role;

do $$
begin
  if has_function_privilege('anon',
    'public.create_coal_selective_payment(uuid,uuid,date,date,date,text,text,jsonb)', 'EXECUTE') then
    raise exception 'FAIL: anonymous role can execute selective Coal settlement';
  end if;
  if not pg_get_functiondef(
    'public.create_coal_selective_payment(uuid,uuid,date,date,date,text,text,jsonb)'::regprocedure
  ) ~ 'order by records.id[[:space:]]+for update of records' then
    raise exception 'FAIL: deterministic selected-obligation lock is missing';
  end if;
  raise notice 'PASS: RPC authorization and deterministic locking remain authoritative';
end;
$$;

rollback;

select 'PASS: Coal selective settlement verifier completed and rolled back all fixtures.' as result;
