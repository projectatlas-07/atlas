-- Atlas Sales S5B verifier. Run against the current Sales schema through S6A.
-- Requires one existing factory_users row. All fixtures are rolled back.

begin;

do $$
declare
  mapping_id uuid;
  test_user_id uuid;
  test_factory_id uuid := gen_random_uuid();
  brick_id uuid := gen_random_uuid();
begin
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
  ) values (
    test_factory_id, 'S5B Company A', 'S5B Description A',
    'S5B Factory Address A', '9000000001',
    'Village A', 'Post A', 'Police A', 'District A', 'State A'
  );
  update public.factory_users
  set factory_id = test_factory_id, is_active = true
  where id = mapping_id;
  insert into public.brick_types(id, factory_id, name)
  values (brick_id, test_factory_id, 'S5B Brick');

  perform set_config('atlas_test.user_id', test_user_id::text, true);
  perform set_config('atlas_test.factory_id', test_factory_id::text, true);
  perform set_config('atlas_test.brick_id', brick_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('atlas_test.user_id'), true);

do $$
declare
  test_factory_id uuid := current_setting('atlas_test.factory_id')::uuid;
  brick_id uuid := current_setting('atlas_test.brick_id')::uuid;
  customer public.customers%rowtype;
  challan public.challans%rowtype;
  payment public.customer_payments%rowtype;
  stored public.customer_payments%rowtype;
begin
  select * into customer from public.create_customer(
    test_factory_id, 'S5B Customer A', 'S5B Customer Address A', '9111111111'
  );
  select * into challan from public.create_challan(
    test_factory_id, date '2026-08-28', customer.id, 'S5B100', 0,
    jsonb_build_array(
      jsonb_build_object('brick_type_id', brick_id, 'quantity', 1000, 'rate', 10000)
    )
  );
  select * into payment from public.create_customer_payment(
    test_factory_id, customer.id, date '2026-08-28', 8000, 'cash', 'S5B receipt snapshot',
    jsonb_build_array(jsonb_build_object('challan_id', challan.id, 'amount', 8000))
  );

  perform public.update_customer(
    test_factory_id, customer.id, 'S5B Customer B', 'S5B Customer Address B', '9222222222'
  );
  perform public.update_factory_printable_profile(
    test_factory_id, 'S5B Company B', 'S5B Description B', 'S5B Factory Address B', '9000000002'
  );

  select * into stored from public.customer_payments where id = payment.id;
  if stored.customer_name_snapshot <> 'S5B Customer A'
    or stored.customer_address_snapshot <> 'S5B Customer Address A'
    or stored.customer_mobile_snapshot <> '9111111111'
    or stored.company_name_snapshot <> 'S5B Company A'
    or stored.company_business_description_snapshot <> 'S5B Description A'
    or stored.company_address_snapshot <> 'S5B Factory Address A'
    or stored.company_mobile_snapshot <> '9000000001' then
    raise exception 'FAIL: receipt source changed after customer/factory profiles changed';
  end if;

  if (select count(*) from public.customer_payment_allocations where payment_id = payment.id) <> 1
    or (select sum(allocated_amount) from public.customer_payment_allocations where payment_id = payment.id) <> 8000 then
    raise exception 'FAIL: payment allocation fixture is incorrect';
  end if;
  raise notice 'PASS: payment receipt source remains profile A after both profiles change to B';
end;
$$;

reset role;
rollback;
