-- Dedicated Coal Purchase module verifier.
-- Run after 20260914000041_create_supplier_roles.sql.
-- Requires one existing factory_users row. Every fixture and mapping change rolls back.

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
  supplier_b_id uuid := gen_random_uuid();
  name_b_id uuid := gen_random_uuid();
  source_b_id uuid := gen_random_uuid();
  purchase_b_id uuid := gen_random_uuid();
begin
  select id, user_id into mapping_id, test_user_id
  from public.factory_users
  order by created_at, id
  limit 1
  for update;
  if test_user_id is null then
    raise exception 'FAIL: verifier requires one existing factory_users row';
  end if;

  insert into public.factories(id, name, business_description, address, mobile) values
    (factory_a_id, format('Coal Factory A %s', factory_a_id), 'Brick maker A', 'Address A', '9000000001'),
    (factory_b_id, format('Coal Factory B %s', factory_b_id), 'Brick maker B', 'Address B', '9000000002');
  update public.factory_users
  set factory_id = factory_a_id, is_active = true
  where id = mapping_id;

  insert into public.suppliers(id, factory_id, name)
  values (supplier_b_id, factory_b_id, 'Factory B Coal Seller');
  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (factory_b_id, supplier_b_id, 'COAL_SELLER', test_user_id);
  insert into public.coal_reference_values(
    id, factory_id, kind, display_value, created_by
  ) values
    (name_b_id, factory_b_id, 'coal_name', 'Factory B Coal', test_user_id),
    (source_b_id, factory_b_id, 'source_location', 'Factory B Source', test_user_id);
  insert into public.expense_records(
    id, factory_id, business_date, kind, supplier_id,
    counterparty_name_snapshot, description, total_amount, created_by
  ) values (
    purchase_b_id, factory_b_id, date '2026-09-10', 'purchase', supplier_b_id,
    'Factory B Coal Seller', 'Factory B secret coal', 50000, test_user_id
  );
  insert into public.coal_purchases(
    id, factory_id, coal_name_reference_id, source_reference_id,
    coal_name_snapshot, source_location_snapshot, coal_challan_number,
    vehicle_number_snapshot, quantity, rate, coal_amount,
    separate_freight_amount, created_by
  ) values (
    purchase_b_id, factory_b_id, name_b_id, source_b_id,
    'Factory B Coal', 'Factory B Source', '11', 'WB 00 B 0001',
    10, 5000, 50000, 0, test_user_id
  );

  perform set_config('atlas_coal.user_id', test_user_id::text, true);
  perform set_config('atlas_coal.factory_a_id', factory_a_id::text, true);
  perform set_config('atlas_coal.factory_b_id', factory_b_id::text, true);
  perform set_config('atlas_coal.purchase_b_id', purchase_b_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_coal.user_id'), true);

do $$
declare
  factory_a_id uuid := current_setting('atlas_coal.factory_a_id')::uuid;
  factory_b_id uuid := current_setting('atlas_coal.factory_b_id')::uuid;
  purchase_b_id uuid := current_setting('atlas_coal.purchase_b_id')::uuid;
  seller public.suppliers%rowtype;
  other_seller public.suppliers%rowtype;
  coal_name public.coal_reference_values%rowtype;
  coal_name_again public.coal_reference_values%rowtype;
  source_name public.coal_reference_values%rowtype;
  unpaid public.coal_purchase_detail;
  partial public.coal_purchase_detail;
  fully_paid public.coal_purchase_detail;
  other_purchase public.coal_purchase_detail;
  payment public.expense_payments%rowtype;
  listed public.coal_purchase_detail;
  payment_row record;
  cash_row record;
begin
  perform public.initialize_cash_book(factory_a_id, date '2026-09-10', 500000);
  select * into seller from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Eastern Coal Traders', 'Old Address', '9111111111'
  );
  select * into other_seller from public.create_or_assign_supplier_role(
    factory_a_id, 'COAL_SELLER', 'Second Coal Seller', null, null
  );
  select * into coal_name from public.create_coal_reference_value(
    factory_a_id, 'coal_name', '  Steam   Coal '
  );
  select * into coal_name_again from public.create_coal_reference_value(
    factory_a_id, 'coal_name', 'steam coal'
  );
  select * into source_name from public.create_coal_reference_value(
    factory_a_id, 'source_location', 'Raniganj'
  );
  if coal_name.display_value <> 'Steam Coal' or coal_name_again.id <> coal_name.id then
    raise exception 'FAIL: remembered Coal Name was not normalized and reused';
  end if;
  raise notice 'PASS: Coal Name and Source masters are remembered per factory';

  -- Quantity + rate derives amount; blank Challan stays null; freight defaults to zero.
  select * into unpaid from public.create_coal_purchase(
    factory_a_id, date '2026-09-10', seller.id, coal_name.id, source_name.id,
    null, 'wb 37 a 1234', 10, 5000, null, 0, 0, null
  );
  if unpaid.quantity <> 10 or unpaid.rate <> 5000 or unpaid.coal_amount <> 50000
    or unpaid.final_total <> 50000 or unpaid.coal_challan_number is not null
    or unpaid.vehicle_number_snapshot <> 'WB 37 A 1234'
    or unpaid.payment_state <> 'unpaid' or unpaid.is_locked then
    raise exception 'FAIL: quantity + rate purchase is wrong: %', row_to_json(unpaid);
  end if;

  -- Quantity + amount derives rate; freight is separate; initial payment locks the source.
  select * into partial from public.create_coal_purchase(
    factory_a_id, date '2026-09-11', seller.id, coal_name.id, source_name.id,
    '11', 'WB 37 A 5678', 20, null, 80000, 1000, 12500, 'upi'
  );
  if partial.rate <> 4000 or partial.coal_amount <> 80000
    or partial.separate_freight_amount <> 1000 or partial.final_total <> 81000
    or partial.total_paid <> 12500 or partial.outstanding_amount <> 68500
    or partial.payment_state <> 'partially_paid' or not partial.is_locked then
    raise exception 'FAIL: quantity + amount purchase is wrong: %', row_to_json(partial);
  end if;

  -- Rate + amount derives quantity; duplicate visible Challan number is allowed.
  select * into fully_paid from public.create_coal_purchase(
    factory_a_id, date '2026-09-12', seller.id, coal_name.id, source_name.id,
    '11', 'WB 37 A 9012', null, 4000, 40000, 0, 40000, 'bank_transfer'
  );
  if fully_paid.quantity <> 10 or fully_paid.final_total <> 40000
    or fully_paid.outstanding_amount <> 0 or fully_paid.payment_state <> 'paid'
    or fully_paid.id = partial.id
    or (select count(*) from public.coal_purchases
        where factory_id = factory_a_id and coal_challan_number = '11') <> 2 then
    raise exception 'FAIL: rate + amount or duplicate Challan behavior is wrong';
  end if;
  select * into cash_row from public.list_cash_book_day_entries(
    factory_a_id, date '2026-09-11'
  ) where source_type = 'expense_payment'
    and source_id in (
      select allocations.payment_id
      from public.expense_payment_allocations as allocations
      where allocations.expense_record_id = partial.id
    );
  if not found or cash_row.direction <> 'out' or cash_row.amount <> 12500
    or cash_row.payment_mode <> 'upi' then
    raise exception 'FAIL: partial initial payment did not create its Cash Book Money Out';
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-09-12'
    ) where source_type = 'expense_payment'
      and source_id in (
        select allocations.payment_id
        from public.expense_payment_allocations as allocations
        where allocations.expense_record_id = fully_paid.id
      )) <> 1 then
    raise exception 'FAIL: full initial payment did not create exactly one Cash Book Money Out';
  end if;
  raise notice 'PASS: all three calculation pairs, optional freight, initial paid, and duplicate/blank Challans work';
  raise notice 'PASS: partial and full initial payments each derive one Cash Book Money Out';

  -- Seller snapshots do not follow later edits to the shared supplier master.
  perform public.update_supplier(
    factory_a_id, seller.id, 'Eastern Coal Traders Renamed', 'New Address', '9222222222'
  );
  select * into listed from public.list_coal_purchases(factory_a_id, seller.id)
  where id = unpaid.id;
  if listed.seller_name_snapshot <> 'Eastern Coal Traders'
    or listed.seller_address_snapshot <> 'Old Address'
    or listed.seller_mobile_snapshot <> '9111111111' then
    raise exception 'FAIL: seller master edit rewrote a historical Coal snapshot';
  end if;

  -- Unpaid purchase can be corrected through Coal, but not via the generic editor.
  select * into unpaid from public.update_coal_purchase(
    factory_a_id, unpaid.id, date '2026-09-10', seller.id,
    coal_name.id, source_name.id, null, 'WB 37 A 1234', 12, 5000, null, 0
  );
  if unpaid.coal_amount <> 60000 or unpaid.final_total <> 60000 then
    raise exception 'FAIL: unpaid Coal correction did not update atomically';
  end if;
  perform pg_temp.expect_error(
    'generic editor cannot mutate structured Coal', 'P4207',
    format(
      'select * from public.update_expense_record(%L::uuid,%L::uuid,date %L,''purchase'',%L::uuid,null,''Bypass'',60000,null)',
      factory_a_id, unpaid.id, '2026-09-10', seller.id
    )
  );
  perform pg_temp.expect_error(
    'generic void cannot mutate structured Coal', 'P4207',
    format('select * from public.void_expense_record(%L::uuid,%L::uuid)', factory_a_id, unpaid.id)
  );

  -- Later payment targets exactly one purchase and creates exactly one Money Out.
  select * into payment from public.create_coal_payment(
    factory_a_id, partial.id, date '2026-09-13', 10000, 'cash', 'Second instalment'
  );
  select * into partial from public.list_coal_purchases(factory_a_id, seller.id)
  where id = partial.id;
  if partial.total_paid <> 22500 or partial.outstanding_amount <> 58500
    or partial.payment_state <> 'partially_paid' then
    raise exception 'FAIL: later Coal payment state is wrong: %', row_to_json(partial);
  end if;
  select * into payment_row from public.list_coal_payments(factory_a_id, seller.id)
  where payment_id = payment.id;
  if not found or payment_row.purchase_id <> partial.id or payment_row.amount <> 10000
    or payment_row.seller_name_snapshot <> 'Eastern Coal Traders' then
    raise exception 'FAIL: seller payment history did not preserve the payment allocation';
  end if;
  select * into cash_row from public.list_cash_book_day_entries(
    factory_a_id, date '2026-09-13'
  ) where source_type = 'expense_payment' and source_id = payment.id;
  if not found or cash_row.direction <> 'out' or cash_row.amount <> 10000
    or cash_row.payment_mode <> 'cash'
    or cash_row.counterparty <> 'Eastern Coal Traders' then
    raise exception 'FAIL: Coal payment did not derive one correct Cash Book Money Out';
  end if;
  if (select count(*) from public.list_cash_book_day_entries(
      factory_a_id, date '2026-09-13'
    ) where source_type = 'expense_payment' and source_id = payment.id) <> 1 then
    raise exception 'FAIL: one Coal payment produced duplicate Cash Book rows';
  end if;
  perform pg_temp.expect_error(
    'Coal overpayment is rejected', 'P4105',
    format(
      'select * from public.create_coal_payment(%L::uuid,%L::uuid,date %L,58500.01,''cash'',null)',
      factory_a_id, partial.id, '2026-09-13'
    )
  );
  perform pg_temp.expect_error(
    'generic payment cannot bypass Coal payment RPC', 'P4207',
    format(
      'select * from public.create_expense_payment(%L::uuid,date %L,1,''cash'',null,jsonb_build_array(jsonb_build_object(''expense_record_id'',%L::uuid,''amount'',1)))',
      factory_a_id, '2026-09-13', partial.id
    )
  );
  perform pg_temp.expect_error(
    'paid Coal purchase cannot be corrected', 'P4104',
    format(
      'select * from public.update_coal_purchase(%L::uuid,%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,10,5000,null,0)',
      factory_a_id, fully_paid.id, '2026-09-12', seller.id,
      coal_name.id, source_name.id, '11', 'WB 37 A 9012'
    )
  );
  perform pg_temp.expect_error(
    'paid Coal purchase cannot be voided', 'P4104',
    format('select * from public.void_coal_purchase(%L::uuid,%L::uuid)', factory_a_id, fully_paid.id)
  );
  raise notice 'PASS: later payments, seller history, Money Out, overpayment, and paid locks work';

  -- A second seller proves seller filtering; unpaid dedicated void remains historical.
  select * into other_purchase from public.create_coal_purchase(
    factory_a_id, date '2026-09-14', other_seller.id, coal_name.id, source_name.id,
    'OTHER-1', 'WB 37 B 0001', 1, 1000, null, 0, 0, null
  );
  if (select count(*) from public.list_coal_purchases(factory_a_id, seller.id)) <> 3
    or (select count(*) from public.list_coal_purchases(factory_a_id, other_seller.id)) <> 1 then
    raise exception 'FAIL: seller-filtered Coal Purchase history is wrong';
  end if;
  if exists (
    select 1 from public.list_expense_records(factory_a_id, null)
    where expense_record_id in (unpaid.id, partial.id, fully_paid.id, other_purchase.id)
  ) then
    raise exception 'FAIL: structured Coal leaked into generic Expense/Purchase editor';
  end if;
  select * into other_purchase from public.void_coal_purchase(factory_a_id, other_purchase.id);
  if other_purchase.status <> 'void' or other_purchase.outstanding_amount <> 0 then
    raise exception 'FAIL: unpaid Coal void did not remain historical with zero due';
  end if;
  raise notice 'PASS: seller filtering, generic-list exclusion, correction, and unpaid void work';

  -- Factory A cannot read or call into Factory B Coal data.
  if exists (select 1 from public.coal_purchases where id = purchase_b_id)
    or exists (select 1 from public.coal_reference_values where factory_id = factory_b_id) then
    raise exception 'FAIL: RLS exposed Factory B Coal data';
  end if;
  perform pg_temp.expect_error(
    'Factory A cannot list Factory B Coal', '42501',
    format('select * from public.list_coal_purchases(%L::uuid,null)', factory_b_id)
  );
  perform pg_temp.expect_error(
    'Factory A cannot pay Factory B Coal', '42501',
    format(
      'select * from public.create_coal_payment(%L::uuid,%L::uuid,date %L,1,''cash'',null)',
      factory_b_id, purchase_b_id, '2026-09-14'
    )
  );
  raise notice 'PASS: Coal references, purchases, statements, and payments are factory-isolated';
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('authenticated', 'public.coal_reference_values', 'INSERT')
    or has_table_privilege('authenticated', 'public.coal_reference_values', 'UPDATE')
    or has_table_privilege('authenticated', 'public.coal_reference_values', 'DELETE')
    or has_table_privilege('authenticated', 'public.coal_purchases', 'INSERT')
    or has_table_privilege('authenticated', 'public.coal_purchases', 'UPDATE')
    or has_table_privilege('authenticated', 'public.coal_purchases', 'DELETE') then
    raise exception 'FAIL: authenticated role has direct Coal mutation privileges';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'coal_purchases_expense_record_factory_fkey'
      and contype = 'f'
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'coal_payment_allocations_guard_insert' and not tgisinternal
  ) then
    raise exception 'FAIL: Coal ownership or payment guard invariant is missing';
  end if;
  raise notice 'PASS: direct mutation is denied and database ownership/guard invariants hold';
end;
$$;

rollback;

select 'PASS: Coal Purchase verifier completed and rolled back all fixtures.' as result;
