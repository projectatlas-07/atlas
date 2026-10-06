-- Atlas Security 12B2B: rollback-only runtime isolation proof.
-- Scope: 25 money-movement and authoritative financial-write RPC signatures.

create temporary table atlas_12b2b_manifest (
  id text primary key,
  module text not null,
  function_name text not null,
  identity_arguments text not null,
  definer_blocking_check text not null,
  unique (function_name, identity_arguments)
) on commit preserve rows;

insert into atlas_12b2b_manifest values
  ('PR4','Production','create_labourer_withdrawal','p_factory_id uuid, p_labourer_id uuid, p_withdrawal_date date, p_amount numeric','wrapper delegates to the five-argument overload; membership and labourer ownership are checked there'),
  ('PR5','Production','create_labourer_withdrawal','p_factory_id uuid, p_labourer_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric','active membership first; labourer lookup is constrained by factory_id'),
  ('PR10','Production','save_production_entry','p_factory_id uuid, p_entry_id uuid, p_labourer_id uuid, p_production_date date, p_quantity integer','active membership first; labourer and existing entry identity are constrained by factory_id'),
  ('MU1','Mud','calculate_mud_supply_wages','p_factory_id uuid, p_labour_group_id uuid, p_week_start date','active membership first; labour group lookup is constrained by factory_id'),
  ('MU2','Mud','create_labour_group_withdrawal','p_factory_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_amount numeric','active membership first; labour group lookup is constrained by factory_id'),
  ('MU4','Mud','create_mud_settlement_withdrawal','p_factory_id uuid, p_withdrawal_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric','active membership first; group, idempotency key, settlement and withdrawal rows are factory-scoped'),
  ('MU5','Mud','execute_mud_settlement_cutover','p_factory_id uuid, p_proposed_legacy_cutoff date','active membership first; readiness, opening and transition delegates remain factory-scoped'),
  ('SO2','Soil','create_soil_financial_adjustment','p_factory_id uuid, p_soil_worker_id uuid, p_adjustment_type text, p_adjustment_date date, p_amount numeric, p_reason text','active membership first; worker lookup is constrained by factory_id'),
  ('SO3','Soil','create_soil_payment','p_factory_id uuid, p_soil_worker_id uuid, p_payment_date date, p_amount numeric','active membership first; worker lookup is constrained by factory_id'),
  ('SO11','Soil','save_soil_daily_trolley_entries','p_factory_id uuid, p_work_date date, p_entries jsonb','active membership first; every JSON worker ID is checked against factory_id before writes'),
  ('ST6','Staff','record_staff_payment','p_factory_id uuid, p_staff_worker_id uuid, p_payment_date date, p_amount numeric, p_note text','active membership first; worker lookup is constrained by factory_id'),
  ('TR1','Transport','calculate_transport_weekly_wages','p_factory_id uuid, p_week_start date','active membership first; source crews, attendance, rates and output rows are factory-scoped'),
  ('TR3','Transport','create_transport_worker_withdrawal','p_factory_id uuid, p_transport_worker_id uuid, p_withdrawal_date date, p_amount numeric','active membership first; worker lookup is constrained by factory_id'),
  ('VW2','Vehicle Delivery Wages','record_vehicle_wage_payment','p_factory_id uuid, p_vehicle_id uuid, p_payment_date date, p_amount numeric, p_note text','active membership first; vehicle, earnings, payment and Cash Book effects are factory-scoped'),
  ('VW3','Vehicle Delivery Wages','reverse_vehicle_wage_payment','p_factory_id uuid, p_payment_id uuid, p_reversal_date date, p_reason text','active membership first; payment lookup is constrained by factory_id'),
  ('PE1','Purchases & Expenses','create_coal_payment','p_factory_id uuid, p_purchase_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','membership and purchase ownership precede checked create_expense_payment delegation'),
  ('PE2','Purchases & Expenses','create_coal_purchase','p_factory_id uuid, p_purchase_date date, p_seller_id uuid, p_coal_name_reference_id uuid, p_source_reference_id uuid, p_coal_challan_number text, p_vehicle_number text, p_quantity numeric, p_rate numeric, p_coal_amount numeric, p_separate_freight_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text','membership plus seller/reference ownership; initial payment uses checked delegation'),
  ('PE4','Purchases & Expenses','create_coal_selective_payment','p_factory_id uuid, p_seller_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_payment_mode text, p_note text, p_allocations jsonb','membership plus seller and every JSON purchase ownership check before delegation'),
  ('PE5','Purchases & Expenses','create_expense_payment','p_factory_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text, p_allocations jsonb','membership plus every JSON expense-record ownership check before payment/allocation writes'),
  ('PE6','Purchases & Expenses','create_expense_record','p_factory_id uuid, p_business_date date, p_kind text, p_supplier_id uuid, p_counterparty_name text, p_description text, p_total_amount numeric, p_note text','active membership first; optional supplier lookup is constrained by factory_id'),
  ('PE9','Purchases & Expenses','create_vehicle_fuel','p_factory_id uuid, p_fuel_date date, p_fuel_time time without time zone, p_vehicle_id uuid, p_pump_id uuid, p_fuel_type text, p_litres numeric, p_rate_per_litre numeric, p_fuel_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text','membership plus vehicle/pump ownership; initial payment uses checked delegation'),
  ('PE10','Purchases & Expenses','create_vehicle_fuel_batch_payment','p_factory_id uuid, p_pump_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','membership plus pump role/ownership; server-selected records and generated allocations remain factory-scoped'),
  ('PE11','Purchases & Expenses','create_vehicle_fuel_payment','p_factory_id uuid, p_fuel_record_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','membership and fuel-record ownership precede checked payment delegation'),
  ('PE12','Purchases & Expenses','create_vehicle_maintenance','p_factory_id uuid, p_maintenance_date date, p_vehicle_id uuid, p_garage_id uuid, p_work_description text, p_total_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text','membership plus vehicle/garage ownership; initial payment uses checked delegation'),
  ('PE13','Purchases & Expenses','create_vehicle_maintenance_batch_payment','p_factory_id uuid, p_garage_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','membership plus garage role/ownership; server-selected records and generated allocations remain factory-scoped');

create temporary table atlas_12b2b_persistent_counts (
  schema_name text not null,
  table_name text not null,
  row_count bigint not null,
  primary key (schema_name, table_name)
) on commit preserve rows;

do $$
declare target record; counted bigint;
begin
  if (select count(*) from atlas_12b2b_manifest) <> 25 then
    raise exception 'FAIL: expected 25 scoped signatures';
  end if;
  for target in
    select 'public'::text schema_name, c.relname::text table_name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    union all select 'auth','users' order by 1,2
  loop
    execute format('select count(*) from %I.%I',target.schema_name,target.table_name) into counted;
    insert into atlas_12b2b_persistent_counts values(target.schema_name,target.table_name,counted);
  end loop;
end;
$$;

commit;
begin;

create temporary table atlas_12b2b_ids(key text primary key,id uuid not null) on commit drop;
grant select,insert,update,delete on atlas_12b2b_ids to authenticated;

create function pg_temp.fixture_id(k text) returns uuid language sql stable
set search_path=pg_catalog,public as $$select id from pg_temp.atlas_12b2b_ids where key=k$$;

create function pg_temp.assert_identity(expected uuid,label text) returns void language plpgsql
set search_path=pg_catalog,public as $$
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from expected then
    raise exception 'FAIL: % role/JWT mismatch role=% uid=%',label,current_user,auth.uid();
  end if;
end$$;

create function pg_temp.factory_hash(target_factory uuid) returns text language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare target record; payload jsonb:='{}'::jsonb; rows_json jsonb;
begin
  for target in
    select distinct c.table_name
    from information_schema.columns c
    where c.table_schema='public' and c.column_name='factory_id'
    order by c.table_name
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t where factory_id=$1',target.table_name)
      into rows_json using target_factory;
    payload:=payload||jsonb_build_object(target.table_name,rows_json);
  end loop;
  return md5(payload::text);
end$$;

create function pg_temp.expect_rejection(label text,sql_to_run text,expected_state text,expected_message text)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare a uuid:=pg_temp.fixture_id('factory_a'); b uuid:=pg_temp.fixture_id('factory_b');
  before_a text;before_b text;after_a text;after_b text;got_state text;got_message text;ok boolean:=false;
begin
  if current_user in ('authenticated','anon') or auth.uid() is not null then
    raise exception 'FAIL: % did not start privileged and identity-cleared',label;
  end if;
  before_a:=pg_temp.factory_hash(a); before_b:=pg_temp.factory_hash(b);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);
  perform pg_temp.assert_identity(pg_temp.fixture_id('user_a'),label);
  begin execute sql_to_run; ok:=true; exception when others then got_state:=sqlstate;got_message:=sqlerrm; end;
  execute 'reset role'; perform set_config('request.jwt.claim.sub','',true);
  if ok then raise exception 'FAIL: % unexpectedly succeeded',label; end if;
  if got_state<>expected_state or (expected_message is not null and got_message!~expected_message) then
    raise exception 'FAIL: % incidental rejection SQLSTATE=% message=%',label,got_state,got_message;
  end if;
  after_a:=pg_temp.factory_hash(a); after_b:=pg_temp.factory_hash(b);
  if before_a is distinct from after_a or before_b is distinct from after_b then
    raise exception 'FAIL: % changed Factory A or B despite rejection',label;
  end if;
  raise notice 'PASS [EXECUTED] [ISOLATION-PROVEN] [%]: %; A/B hashes unchanged',got_state,label;
end$$;

-- Exact live catalog/grant contract.
do $$
declare matched integer;
begin
  select count(*) into matched
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join atlas_12b2b_manifest m on m.function_name=p.proname
    and m.identity_arguments=pg_get_function_identity_arguments(p.oid)
  where n.nspname='public' and p.prokind='f';
  if matched<>25 then raise exception 'FAIL: live scoped signatures matched %/25',matched; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join atlas_12b2b_manifest m on m.function_name=p.proname
      and m.identity_arguments=pg_get_function_identity_arguments(p.oid)
    where n.nspname='public' and (
      not p.prosecdef
      or not has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('anon',p.oid,'EXECUTE')
      or not (p.proconfig @> array['search_path=pg_catalog, public'])
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) g where g.grantee=0 and g.privilege_type='EXECUTE')
    )
  ) then raise exception 'FAIL: scoped function security/grant/search_path contract changed'; end if;
  raise notice 'PASS [EXECUTED]: live scope 25/25; SECURITY DEFINER 25; auth 25; anon/PUBLIC 0';
end$$;

-- Only confirmed synthetic Auth roots require privileged setup.
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('12d00000-0000-4000-8000-000000000001','authenticated','authenticated','atlas-12b2b-a@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('12d00000-0000-4000-8000-000000000002','authenticated','authenticated','atlas-12b2b-b@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into atlas_12b2b_ids values
 ('user_a','12d00000-0000-4000-8000-000000000001'),('user_b','12d00000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);
select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'provision A');
do $$declare r record;begin select * into r from public.provision_first_factory('Atlas 12B2B Factory A'); if not r.created then raise exception 'FAIL: A not provisioned';end if;insert into pg_temp.atlas_12b2b_ids values('factory_a',r.factory_id);end$$;
reset role;select set_config('request.jwt.claim.sub','',true);


set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_b')::text,true);
select pg_temp.assert_identity(pg_temp.fixture_id('user_b'),'provision B');
do $$declare r record;begin select * into r from public.provision_first_factory('Atlas 12B2B Factory B'); if not r.created then raise exception 'FAIL: B not provisioned';end if;insert into pg_temp.atlas_12b2b_ids values('factory_b',r.factory_id);end$$;
reset role;select set_config('request.jwt.claim.sub','',true);

-- Historical prerequisite rows use privileged setup because Atlas has no public
-- backdated bulk writer for a complete cross-module, already-earned fixture.
-- The scoped positive controls below still execute every real financial writer.
do $$
declare a uuid:=pg_temp.fixture_id('factory_a');b uuid:=pg_temp.fixture_id('factory_b');
begin
  insert into pg_temp.atlas_12b2b_ids values
   ('prod4_a','12d10000-0000-4000-8000-000000000001'),('prod5_a','12d10000-0000-4000-8000-000000000002'),('prod_save_a','12d10000-0000-4000-8000-000000000003'),('mud_lab_a','12d10000-0000-4000-8000-000000000004'),
   ('prod_b','12d10000-0000-4000-8000-000000000011'),('mud_lab_b','12d10000-0000-4000-8000-000000000012'),
   ('mud_group_a','12d20000-0000-4000-8000-000000000001'),('mud_group_b','12d20000-0000-4000-8000-000000000002'),
   ('soil_a','12d30000-0000-4000-8000-000000000001'),('soil_b','12d30000-0000-4000-8000-000000000002'),
   ('staff_cat_a','12d40000-0000-4000-8000-000000000001'),('staff_cat_b','12d40000-0000-4000-8000-000000000002'),('staff_a','12d40000-0000-4000-8000-000000000011'),('staff_b','12d40000-0000-4000-8000-000000000012'),
   ('transport_crew_a','12d50000-0000-4000-8000-000000000001'),('transport_crew_b','12d50000-0000-4000-8000-000000000002'),('transport_a','12d50000-0000-4000-8000-000000000011'),('transport_b','12d50000-0000-4000-8000-000000000012'),
   ('vehicle_a','12d60000-0000-4000-8000-000000000001'),('vehicle_b','12d60000-0000-4000-8000-000000000002'),
   ('customer_a','12d61000-0000-4000-8000-000000000001'),('customer_b','12d61000-0000-4000-8000-000000000002'),
   ('seller_a','12d70000-0000-4000-8000-000000000001'),('seller_b','12d70000-0000-4000-8000-000000000002'),('pump_a','12d70000-0000-4000-8000-000000000011'),('pump_b','12d70000-0000-4000-8000-000000000012'),('garage_a','12d70000-0000-4000-8000-000000000021'),('garage_b','12d70000-0000-4000-8000-000000000022'),
   ('coal_name_a','12d71000-0000-4000-8000-000000000001'),('coal_name_b','12d71000-0000-4000-8000-000000000002'),('coal_source_a','12d71000-0000-4000-8000-000000000011'),('coal_source_b','12d71000-0000-4000-8000-000000000012');

  insert into public.labourers(id,factory_id,name) values
   (pg_temp.fixture_id('prod4_a'),a,'Production Four A'),(pg_temp.fixture_id('prod5_a'),a,'Production Five A'),(pg_temp.fixture_id('prod_save_a'),a,'Production Save A'),(pg_temp.fixture_id('mud_lab_a'),a,'Mud Production A'),
   (pg_temp.fixture_id('prod_b'),b,'Production B'),(pg_temp.fixture_id('mud_lab_b'),b,'Mud Production B');
  insert into public.production_wage_rates(factory_id,labourer_id,rate_per_1000_bricks,effective_from) values
   (a,pg_temp.fixture_id('prod4_a'),100,'2026-09-01'),(a,pg_temp.fixture_id('prod5_a'),100,'2026-09-01'),(a,pg_temp.fixture_id('prod_save_a'),100,'2026-09-01'),(b,pg_temp.fixture_id('prod_b'),100,'2026-09-01');
  insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity) values
   (gen_random_uuid(),a,pg_temp.fixture_id('prod4_a'),'2026-09-16',10000),(gen_random_uuid(),a,pg_temp.fixture_id('prod5_a'),'2026-09-16',10000),(gen_random_uuid(),b,pg_temp.fixture_id('prod_b'),'2026-09-16',10000);
  insert into public.labour_groups(id,factory_id,name,member_count,is_active) values
   (pg_temp.fixture_id('mud_group_a'),a,'Mud Group A',5,true),(pg_temp.fixture_id('mud_group_b'),b,'Mud Group B',5,true);
  insert into public.mud_group_terms(factory_id,labour_group_id,member_count,effective_from) values
   (a,pg_temp.fixture_id('mud_group_a'),5,'2026-09-21'),(b,pg_temp.fixture_id('mud_group_b'),5,'2026-09-21');
  insert into public.mud_group_rates(factory_id,labour_group_id,rate_per_1000_bricks,effective_from) values
   (a,pg_temp.fixture_id('mud_group_a'),100,'2026-09-21'),(b,pg_temp.fixture_id('mud_group_b'),100,'2026-09-21');
  insert into public.wage_rates(factory_id,applies_to,rate_per_1000_bricks,effective_from) values
   (a,'mud_supply',100,'2026-09-21'),(b,'mud_supply',100,'2026-09-21');
  insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity)
   select gen_random_uuid(),a,pg_temp.fixture_id('mud_lab_a'),'2026-09-21'::date+g,1000 from generate_series(0,7) g;
  insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity)
   select gen_random_uuid(),b,pg_temp.fixture_id('mud_lab_b'),'2026-09-21'::date+g,1000 from generate_series(0,7) g;

  insert into public.soil_workers(id,factory_id,name) values(pg_temp.fixture_id('soil_a'),a,'Soil A'),(pg_temp.fixture_id('soil_b'),b,'Soil B');
  insert into public.soil_worker_trolley_rates(factory_id,soil_worker_id,rate_per_trolley,effective_from) values(a,pg_temp.fixture_id('soil_a'),10,'2026-09-01'),(b,pg_temp.fixture_id('soil_b'),10,'2026-09-01');
  insert into public.staff_categories(id,factory_id,name) values(pg_temp.fixture_id('staff_cat_a'),a,'Staff A'),(pg_temp.fixture_id('staff_cat_b'),b,'Staff B');
  insert into public.staff_workers(id,factory_id,name,staff_category_id,reference_salary) values(pg_temp.fixture_id('staff_a'),a,'Staff Worker A',pg_temp.fixture_id('staff_cat_a'),1000),(pg_temp.fixture_id('staff_b'),b,'Staff Worker B',pg_temp.fixture_id('staff_cat_b'),1000);
  insert into public.transport_workers(id,factory_id,name) values(pg_temp.fixture_id('transport_a'),a,'Transport A'),(pg_temp.fixture_id('transport_b'),b,'Transport B');
  insert into public.transport_crews(id,factory_id,name) values(pg_temp.fixture_id('transport_crew_a'),a,'Crew A'),(pg_temp.fixture_id('transport_crew_b'),b,'Crew B');
  insert into public.transport_crew_memberships(factory_id,transport_worker_id,transport_crew_id,effective_from) values(a,pg_temp.fixture_id('transport_a'),pg_temp.fixture_id('transport_crew_a'),'2026-09-21'),(b,pg_temp.fixture_id('transport_b'),pg_temp.fixture_id('transport_crew_b'),'2026-09-21');
  insert into public.transport_crew_wage_rates(factory_id,transport_crew_id,effective_from,rate_per_paya) values(a,pg_temp.fixture_id('transport_crew_a'),'2026-09-21',100),(b,pg_temp.fixture_id('transport_crew_b'),'2026-09-21',100);
  insert into public.transport_daily_entries(factory_id,transport_crew_id,work_date,paya_quantity)
   select a,pg_temp.fixture_id('transport_crew_a'),'2026-09-21'::date+g,1 from generate_series(0,6) g;
  insert into public.transport_daily_entries(factory_id,transport_crew_id,work_date,paya_quantity)
   select b,pg_temp.fixture_id('transport_crew_b'),'2026-09-21'::date+g,1 from generate_series(0,6) g;
  insert into public.transport_daily_attendance(factory_id,transport_daily_entry_id,transport_crew_id,transport_worker_id,work_date)
   select a,e.id,pg_temp.fixture_id('transport_crew_a'),pg_temp.fixture_id('transport_a'),e.work_date from public.transport_daily_entries e where e.factory_id=a;
  insert into public.transport_daily_attendance(factory_id,transport_daily_entry_id,transport_crew_id,transport_worker_id,work_date)
   select b,e.id,pg_temp.fixture_id('transport_crew_b'),pg_temp.fixture_id('transport_b'),e.work_date from public.transport_daily_entries e where e.factory_id=b;

  insert into public.customers(id,factory_id,name,address,mobile) values(pg_temp.fixture_id('customer_a'),a,'Customer A','Address A','9000000001'),(pg_temp.fixture_id('customer_b'),b,'Customer B','Address B','9000000002');
  insert into public.vehicles(id,factory_id,vehicle_number,normalized_vehicle_number,delivery_wage_tracking_enabled) values(pg_temp.fixture_id('vehicle_a'),a,'AT12A001','AT12A001',true),(pg_temp.fixture_id('vehicle_b'),b,'AT12B001','AT12B001',true);
  insert into public.challans(factory_id,challan_number,challan_date,customer_id,customer_name_snapshot,customer_address_snapshot,customer_mobile_snapshot,company_name_snapshot,company_business_description_snapshot,company_address_snapshot,company_mobile_snapshot,vehicle_number,tractor_labour_rate_snapshot,vehicle_id,vehicle_number_snapshot,delivery_wage_applicable_snapshot,trip_labour_wage)
   values(a,'12B2B-A','2026-09-20',pg_temp.fixture_id('customer_a'),'Customer A','Address A','9000000001','Factory A','Verifier factory','Address A','9000000001','AT12A001',1000,pg_temp.fixture_id('vehicle_a'),'AT12A001',true,1000),
         (b,'12B2B-B','2026-09-20',pg_temp.fixture_id('customer_b'),'Customer B','Address B','9000000002','Factory B','Verifier factory','Address B','9000000002','AT12B001',1000,pg_temp.fixture_id('vehicle_b'),'AT12B001',true,1000);

  insert into public.suppliers(id,factory_id,name) values
   (pg_temp.fixture_id('seller_a'),a,'Seller A'),(pg_temp.fixture_id('seller_b'),b,'Seller B'),(pg_temp.fixture_id('pump_a'),a,'Pump A'),(pg_temp.fixture_id('pump_b'),b,'Pump B'),(pg_temp.fixture_id('garage_a'),a,'Garage A'),(pg_temp.fixture_id('garage_b'),b,'Garage B');
  insert into public.supplier_roles(factory_id,supplier_id,role,created_by) values
   (a,pg_temp.fixture_id('seller_a'),'COAL_SELLER',pg_temp.fixture_id('user_a')),(b,pg_temp.fixture_id('seller_b'),'COAL_SELLER',pg_temp.fixture_id('user_b')),
   (a,pg_temp.fixture_id('pump_a'),'FUEL_PUMP',pg_temp.fixture_id('user_a')),(b,pg_temp.fixture_id('pump_b'),'FUEL_PUMP',pg_temp.fixture_id('user_b')),
   (a,pg_temp.fixture_id('garage_a'),'GARAGE',pg_temp.fixture_id('user_a')),(b,pg_temp.fixture_id('garage_b'),'GARAGE',pg_temp.fixture_id('user_b'));
  insert into public.coal_reference_values(id,factory_id,kind,display_value,created_by) values
   (pg_temp.fixture_id('coal_name_a'),a,'coal_name','Coal A',pg_temp.fixture_id('user_a')),(pg_temp.fixture_id('coal_name_b'),b,'coal_name','Coal B',pg_temp.fixture_id('user_b')),
   (pg_temp.fixture_id('coal_source_a'),a,'source_location','Source A',pg_temp.fixture_id('user_a')),(pg_temp.fixture_id('coal_source_b'),b,'source_location','Source B',pg_temp.fixture_id('user_b'));
  raise notice 'PASS [PRIVILEGED-SETUP]: synthetic historical prerequisites only; no real business rows touched';
end$$;

-- Cash Book initialization is a real writer prerequisite for financial effects.
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'cash init A');select public.initialize_cash_book(pg_temp.fixture_id('factory_a'),'2026-09-01',10000);reset role;select set_config('request.jwt.claim.sub','',true);
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_b')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_b'),'cash init B');select public.initialize_cash_book(pg_temp.fixture_id('factory_b'),'2026-09-01',10000);reset role;select set_config('request.jwt.claim.sub','',true);

-- Legacy Mud calculations and withdrawals: positive A, valid B attack, then B owner setup.
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'legacy Mud A');
do $$declare r record;begin
 select * into r from public.calculate_mud_supply_wages(pg_temp.fixture_id('factory_a'),pg_temp.fixture_id('mud_group_a'),'2026-09-21');
 if r.groups_calculated<>1 or not exists(select 1 from public.weekly_earnings where factory_id=pg_temp.fixture_id('factory_a') and labour_group_id=pg_temp.fixture_id('mud_group_a') and amount=700) then raise exception 'FAIL: MU1 positive effect';end if;
 select * into r from public.create_labour_group_withdrawal(pg_temp.fixture_id('factory_a'),pg_temp.fixture_id('mud_group_a'),'2026-09-27',100);
 if r.withdrawal_amount<>100 or not exists(select 1 from public.withdrawals where id=r.withdrawal_id and factory_id=pg_temp.fixture_id('factory_a') and amount=100) then raise exception 'FAIL: MU2 positive effect';end if;
end$$;
reset role;select set_config('request.jwt.claim.sub','',true);

select pg_temp.expect_rejection('MU1 Factory B calculation',format('select * from public.calculate_mud_supply_wages(%L::uuid,%L::uuid,date %L)',pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('mud_group_b'),'2026-09-21'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('MU2 Factory B withdrawal',format('select * from public.create_labour_group_withdrawal(%L::uuid,%L::uuid,date %L,100)',pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('mud_group_b'),'2026-09-27'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('MU1 Factory A plus Factory B group',format('select * from public.calculate_mud_supply_wages(%L::uuid,%L::uuid,date %L)',pg_temp.fixture_id('factory_a'),pg_temp.fixture_id('mud_group_b'),'2026-09-21'),'42501','Labour group does not belong to this factory\.');
select pg_temp.expect_rejection('MU2 Factory A plus Factory B group',format('select * from public.create_labour_group_withdrawal(%L::uuid,%L::uuid,date %L,10)',pg_temp.fixture_id('factory_a'),pg_temp.fixture_id('mud_group_b'),'2026-09-27'),'42501','Labour group does not belong to this factory\.');

set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_b')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_b'),'legacy Mud B fixture');
select * from public.calculate_mud_supply_wages(pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('mud_group_b'),'2026-09-21');
select * from public.create_labour_group_withdrawal(pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('mud_group_b'),'2026-09-27',100);
select * from public.transition_mud_accounting_mode(pg_temp.fixture_id('factory_b'),'SHADOW');
reset role;select set_config('request.jwt.claim.sub','',true);

set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'Mud cutover A');
select * from public.transition_mud_accounting_mode(pg_temp.fixture_id('factory_a'),'SHADOW');
do $$declare r record;begin select * into r from public.execute_mud_settlement_cutover(pg_temp.fixture_id('factory_a'),'2026-09-27');if r.legacy_cutoff<>'2026-09-27' or not exists(select 1 from public.mud_group_legacy_openings where factory_id=pg_temp.fixture_id('factory_a')) then raise exception 'FAIL: MU5 positive effect';end if;end$$;
reset role;select set_config('request.jwt.claim.sub','',true);

select pg_temp.expect_rejection('MU5 Factory B ready cutover',format('select * from public.execute_mud_settlement_cutover(%L::uuid,date %L)',pg_temp.fixture_id('factory_b'),'2026-09-27'),'42501','You do not have access to this factory\.');

set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_b')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_b'),'Mud cutover B fixture');select * from public.execute_mud_settlement_cutover(pg_temp.fixture_id('factory_b'),'2026-09-27');reset role;select set_config('request.jwt.claim.sub','',true);

set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'Mud settlement withdrawal A');
do $$declare r record;begin select * into r from public.create_mud_settlement_withdrawal(pg_temp.fixture_id('factory_a'),'12d22000-0000-4000-8000-000000000001',pg_temp.fixture_id('mud_group_a'),'2026-09-29','2026-09-28',100);if r.withdrawal_amount<>100 or r.settled_through<>'2026-09-28' then raise exception 'FAIL: MU4 positive effect';end if;end$$;
reset role;select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_rejection('MU4 Factory B settlement withdrawal',format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,100)',pg_temp.fixture_id('factory_b'),'12d22000-0000-4000-8000-000000000002',pg_temp.fixture_id('mud_group_b'),'2026-09-29','2026-09-28'),'42501','You do not have access to this factory\.');

-- Remaining Factory A positive controls. Each checks an authoritative row or amount.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);
select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'Factory A financial positives');
do $$
declare
 a uuid:=pg_temp.fixture_id('factory_a'); r record; saved public.production_entries%rowtype;
 expense_a public.expense_records%rowtype; expense_inactive public.expense_records%rowtype;
 coal_initial public.coal_purchase_detail; coal_direct public.coal_purchase_detail; coal_selective public.coal_purchase_detail;
 fuel_initial public.vehicle_fuel_detail; fuel_direct public.vehicle_fuel_detail; fuel_batch public.vehicle_fuel_detail;
 maintenance_initial public.vehicle_maintenance_detail; maintenance_batch public.vehicle_maintenance_detail;
 payment public.expense_payments%rowtype; vw_payment_id uuid;
begin
 select * into saved from public.save_production_entry(a,'12d11000-0000-4000-8000-000000000001',pg_temp.fixture_id('prod_save_a'),'2026-09-29',1000);
 if saved.quantity<>1000 then raise exception 'FAIL: PR10 positive effect';end if;
 select * into r from public.create_labourer_withdrawal(a,pg_temp.fixture_id('prod4_a'),'2026-09-18',100);
 if r.withdrawal_amount<>100 or r.available_balance<>900 then raise exception 'FAIL: PR4 positive effect';end if;
 select * into r from public.create_labourer_withdrawal(a,pg_temp.fixture_id('prod5_a'),'2026-09-18','2026-09-17',100);
 if r.withdrawal_amount<>100 or r.available_balance<>900 or r.settled_through<>'2026-09-17' then raise exception 'FAIL: PR5 positive effect';end if;

 perform public.save_soil_daily_trolley_entries(a,'2026-09-20',jsonb_build_array(jsonb_build_object('soil_worker_id',pg_temp.fixture_id('soil_a'),'trolley_quantity',10)));
 if (select sum(amount) from public.soil_earnings where factory_id=a and soil_worker_id=pg_temp.fixture_id('soil_a'))<>100 then raise exception 'FAIL: SO11 positive effect';end if;
 select * into r from public.create_soil_financial_adjustment(a,pg_temp.fixture_id('soil_a'),'ADDITION','2026-09-20',20,'Verifier addition');
 if r.adjustment_amount<>20 or r.available_balance<>120 then raise exception 'FAIL: SO2 positive effect';end if;
 select * into r from public.create_soil_payment(a,pg_temp.fixture_id('soil_a'),'2026-09-20',10);
 if r.payment_amount<>10 or r.available_balance<>110 then raise exception 'FAIL: SO3 positive effect';end if;

 select * into r from public.record_staff_payment(a,pg_temp.fixture_id('staff_a'),'2026-09-20',10,'Verifier payment');
 if r.payment_amount<>10 or r.total_paid<>10 then raise exception 'FAIL: ST6 positive effect';end if;

 select * into r from public.calculate_transport_weekly_wages(a,'2026-09-21');
 if r.workers_calculated<>1 or not exists(select 1 from public.transport_weekly_earnings where factory_id=a and transport_worker_id=pg_temp.fixture_id('transport_a') and total_amount=700) then raise exception 'FAIL: TR1 positive effect';end if;
 select * into r from public.create_transport_worker_withdrawal(a,pg_temp.fixture_id('transport_a'),'2026-09-28',100);
 if r.withdrawal_amount<>100 or r.available_balance<>600 then raise exception 'FAIL: TR3 positive effect';end if;

 select * into r from public.record_vehicle_wage_payment(a,pg_temp.fixture_id('vehicle_a'),'2026-09-20',100,'Verifier vehicle payment');
 vw_payment_id:=r.payment_id;
 if r.payment_amount<>100 or r.total_paid<>100 then raise exception 'FAIL: VW2 positive effect';end if;
 select * into r from public.reverse_vehicle_wage_payment(a,vw_payment_id,'2026-09-21','Verifier correction');
 if r.reversal_amount<>100 or r.total_paid<>0 then raise exception 'FAIL: VW3 positive effect';end if;
 insert into pg_temp.atlas_12b2b_ids values('vehicle_payment_a',vw_payment_id);

 select * into expense_a from public.create_expense_record(a,'2026-09-30','expense',pg_temp.fixture_id('seller_a'),null,'General expense A',100,'Verifier');
 if expense_a.total_amount<>100 then raise exception 'FAIL: PE6 positive effect';end if;
 insert into pg_temp.atlas_12b2b_ids values('expense_a',expense_a.id);
 select * into payment from public.create_expense_payment(a,'2026-09-30',10,'cash','Direct expense payment',jsonb_build_array(jsonb_build_object('expense_record_id',expense_a.id,'amount',10)));
 if payment.amount<>10 or (select sum(allocated_amount) from public.expense_payment_allocations where payment_id=payment.id)<>10 then raise exception 'FAIL: PE5 positive effect';end if;
 select * into expense_inactive from public.create_expense_record(a,'2026-09-30','expense',pg_temp.fixture_id('seller_a'),null,'Inactive control expense',100,'Verifier');
 insert into pg_temp.atlas_12b2b_ids values('expense_inactive_a',expense_inactive.id);

 select * into coal_initial from public.create_coal_purchase(a,'2026-09-30',pg_temp.fixture_id('seller_a'),pg_temp.fixture_id('coal_name_a'),pg_temp.fixture_id('coal_source_a'),'COAL-A-1','AT12A001',10,10,null,0,10,'cash');
 if coal_initial.total_paid<>10 then raise exception 'FAIL: PE2 initial-payment branch';end if;
 select * into coal_direct from public.create_coal_purchase(a,'2026-09-30',pg_temp.fixture_id('seller_a'),pg_temp.fixture_id('coal_name_a'),pg_temp.fixture_id('coal_source_a'),'COAL-A-2','AT12A001',10,10,null,0,0,null);
 select * into payment from public.create_coal_payment(a,coal_direct.id,'2026-09-30',10,'cash','Coal direct');
 if payment.amount<>10 or (select sum(allocated_amount) from public.expense_payment_allocations where payment_id=payment.id)<>10 then raise exception 'FAIL: PE1 positive effect';end if;
 select * into coal_selective from public.create_coal_purchase(a,'2026-09-30',pg_temp.fixture_id('seller_a'),pg_temp.fixture_id('coal_name_a'),pg_temp.fixture_id('coal_source_a'),'COAL-A-3','AT12A001',10,10,null,0,0,null);
 select * into payment from public.create_coal_selective_payment(a,pg_temp.fixture_id('seller_a'),'2026-09-30','2026-09-30','2026-09-30','cash','Coal selective',jsonb_build_array(jsonb_build_object('purchase_id',coal_selective.id,'amount',10)));
 if payment.amount<>10 or (select sum(allocated_amount) from public.expense_payment_allocations where payment_id=payment.id)<>10 then raise exception 'FAIL: PE4 positive effect';end if;
 insert into pg_temp.atlas_12b2b_ids values('coal_purchase_a',coal_selective.id);

 select * into fuel_initial from public.create_vehicle_fuel(a,'2026-09-30','08:00',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('pump_a'),'Diesel',10,10,null,10,'cash');
 if fuel_initial.total_paid<>10 then raise exception 'FAIL: PE9 initial-payment branch';end if;
 select * into fuel_direct from public.create_vehicle_fuel(a,'2026-09-30','09:00',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('pump_a'),'Diesel',10,10,null,0,null);
 select * into payment from public.create_vehicle_fuel_payment(a,fuel_direct.id,'2026-09-30',10,'cash','Fuel direct');
 if payment.amount<>10 then raise exception 'FAIL: PE11 positive effect';end if;
 select * into fuel_batch from public.create_vehicle_fuel(a,'2026-09-30','10:00',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('pump_a'),'Diesel',10,10,null,0,null);
 select * into payment from public.create_vehicle_fuel_batch_payment(a,pg_temp.fixture_id('pump_a'),'2026-09-30','2026-09-30','2026-09-30',10,'cash','Fuel batch');
 if payment.amount<>10 or (select sum(allocated_amount) from public.expense_payment_allocations where payment_id=payment.id)<>10 then raise exception 'FAIL: PE10 positive effect';end if;
 insert into pg_temp.atlas_12b2b_ids values('fuel_record_a',fuel_batch.id);

 select * into maintenance_initial from public.create_vehicle_maintenance(a,'2026-09-30',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('garage_a'),'Initial repair',100,10,'cash');
 if maintenance_initial.total_paid<>10 then raise exception 'FAIL: PE12 initial-payment branch';end if;
 select * into maintenance_batch from public.create_vehicle_maintenance(a,'2026-09-30',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('garage_a'),'Batch repair',100,0,null);
 select * into payment from public.create_vehicle_maintenance_batch_payment(a,pg_temp.fixture_id('garage_a'),'2026-09-30','2026-09-30','2026-09-30',10,'cash','Maintenance batch');
 if payment.amount<>10 or (select sum(allocated_amount) from public.expense_payment_allocations where payment_id=payment.id)<>10 then raise exception 'FAIL: PE13 positive effect';end if;
 insert into pg_temp.atlas_12b2b_ids values('maintenance_a',maintenance_batch.id);
 raise notice 'PASS [EXECUTED]: all 25 Factory A positive controls produced authoritative financial effects';
end$$;
reset role;select set_config('request.jwt.claim.sub','',true);

-- Valid Factory B financial children are created by their real public writers.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_b')::text,true);
select pg_temp.assert_identity(pg_temp.fixture_id('user_b'),'Factory B writer fixtures');
do $$
declare b uuid:=pg_temp.fixture_id('factory_b'); r record; e public.expense_records%rowtype;
 c public.coal_purchase_detail; f public.vehicle_fuel_detail; m public.vehicle_maintenance_detail;
begin
 select * into r from public.record_vehicle_wage_payment(b,pg_temp.fixture_id('vehicle_b'),'2026-09-20',100,'B valid payment');
 insert into pg_temp.atlas_12b2b_ids values('vehicle_payment_b',r.payment_id);
 perform public.save_soil_daily_trolley_entries(b,'2026-09-20',jsonb_build_array(jsonb_build_object('soil_worker_id',pg_temp.fixture_id('soil_b'),'trolley_quantity',10)));
 select * into e from public.create_expense_record(b,'2026-09-30','expense',pg_temp.fixture_id('seller_b'),null,'General expense B',100,'Verifier');
 insert into pg_temp.atlas_12b2b_ids values('expense_b',e.id);
 select * into c from public.create_coal_purchase(b,'2026-09-30',pg_temp.fixture_id('seller_b'),pg_temp.fixture_id('coal_name_b'),pg_temp.fixture_id('coal_source_b'),'COAL-B-1','AT12B001',10,10,null,0,0,null);
 insert into pg_temp.atlas_12b2b_ids values('coal_purchase_b',c.id);
 select * into f from public.create_vehicle_fuel(b,'2026-09-30','08:00',pg_temp.fixture_id('vehicle_b'),pg_temp.fixture_id('pump_b'),'Diesel',10,10,null,0,null);
 insert into pg_temp.atlas_12b2b_ids values('fuel_record_b',f.id);
 select * into m from public.create_vehicle_maintenance(b,'2026-09-30',pg_temp.fixture_id('vehicle_b'),pg_temp.fixture_id('garage_b'),'Repair B',100,0,null);
 insert into pg_temp.atlas_12b2b_ids values('maintenance_b',m.id);
 perform public.calculate_transport_weekly_wages(b,'2026-09-21');
end$$;
reset role;select set_config('request.jwt.claim.sub','',true);
-- Direct Factory B attacks. MU1/MU2/MU4/MU5 ran at their valid accounting phases above.
do $$
declare b uuid:=pg_temp.fixture_id('factory_b');
begin
 perform pg_temp.expect_rejection('PR4 Factory B compatibility withdrawal',format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,10)',b,pg_temp.fixture_id('prod_b'),'2026-09-18'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PR5 Factory B explicit withdrawal',format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,10)',b,pg_temp.fixture_id('prod_b'),'2026-09-18','2026-09-17'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PR10 Factory B Production save',format('select * from public.save_production_entry(%L::uuid,%L::uuid,%L::uuid,date %L,1000)',b,'12d11000-0000-4000-8000-000000000002',pg_temp.fixture_id('prod_b'),'2026-09-29'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('SO2 Factory B Soil adjustment',format('select * from public.create_soil_financial_adjustment(%L::uuid,%L::uuid,%L,date %L,10,%L)',b,pg_temp.fixture_id('soil_b'),'ADDITION','2026-09-20','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('SO3 Factory B Soil payment',format('select * from public.create_soil_payment(%L::uuid,%L::uuid,date %L,10)',b,pg_temp.fixture_id('soil_b'),'2026-09-20'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('SO11 Factory B Soil daily save',format('select * from public.save_soil_daily_trolley_entries(%L::uuid,date %L,%L::jsonb)',b,'2026-09-21',jsonb_build_array(jsonb_build_object('soil_worker_id',pg_temp.fixture_id('soil_b'),'trolley_quantity',1))::text),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('ST6 Factory B Staff payment',format('select * from public.record_staff_payment(%L::uuid,%L::uuid,date %L,10,%L)',b,pg_temp.fixture_id('staff_b'),'2026-09-20','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('TR1 Factory B wage calculation',format('select * from public.calculate_transport_weekly_wages(%L::uuid,date %L)',b,'2026-09-21'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('TR3 Factory B Transport withdrawal',format('select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,10)',b,pg_temp.fixture_id('transport_b'),'2026-09-28'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('VW2 Factory B Vehicle wage payment',format('select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,10,%L)',b,pg_temp.fixture_id('vehicle_b'),'2026-09-20','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('VW3 Factory B Vehicle wage reversal',format('select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',b,pg_temp.fixture_id('vehicle_payment_b'),'2026-09-21','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE1 Factory B Coal payment',format('select public.create_coal_payment(%L::uuid,%L::uuid,date %L,10,%L,%L)',b,pg_temp.fixture_id('coal_purchase_b'),'2026-09-30','cash','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE2 Factory B Coal creation with initial payment',format('select * from public.create_coal_purchase(%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,10,10,null,0,10,%L)',b,'2026-09-30',pg_temp.fixture_id('seller_b'),pg_temp.fixture_id('coal_name_b'),pg_temp.fixture_id('coal_source_b'),'B-FORBIDDEN','AT12B001','cash'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE4 Factory B selective Coal payment',format('select public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,%L,%L,%L::jsonb)',b,pg_temp.fixture_id('seller_b'),'2026-09-30','2026-09-30','2026-09-30','cash','Forbidden',jsonb_build_array(jsonb_build_object('purchase_id',pg_temp.fixture_id('coal_purchase_b'),'amount',10))::text),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE5 Factory B Expense payment',format('select public.create_expense_payment(%L::uuid,date %L,10,%L,%L,%L::jsonb)',b,'2026-09-30','cash','Forbidden',jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fixture_id('expense_b'),'amount',10))::text),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE6 Factory B Expense creation',format('select public.create_expense_record(%L::uuid,date %L,%L,%L::uuid,null,%L,100,%L)',b,'2026-09-30','expense',pg_temp.fixture_id('seller_b'),'Forbidden','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE9 Factory B Fuel with initial payment',format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,10,10,null,10,%L)',b,'2026-09-30','09:00',pg_temp.fixture_id('vehicle_b'),pg_temp.fixture_id('pump_b'),'Diesel','cash'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE10 Factory B Fuel batch payment',format('select public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,10,%L,%L)',b,pg_temp.fixture_id('pump_b'),'2026-09-30','2026-09-30','2026-09-30','cash','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE11 Factory B Fuel payment',format('select public.create_vehicle_fuel_payment(%L::uuid,%L::uuid,date %L,10,%L,%L)',b,pg_temp.fixture_id('fuel_record_b'),'2026-09-30','cash','Forbidden'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE12 Factory B Maintenance with initial payment',format('select * from public.create_vehicle_maintenance(%L::uuid,date %L,%L::uuid,%L::uuid,%L,100,10,%L)',b,'2026-09-30',pg_temp.fixture_id('vehicle_b'),pg_temp.fixture_id('garage_b'),'Forbidden','cash'),'42501','You do not have access to this factory\.');
 perform pg_temp.expect_rejection('PE13 Factory B Maintenance batch payment',format('select public.create_vehicle_maintenance_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,10,%L,%L)',b,pg_temp.fixture_id('garage_b'),'2026-09-30','2026-09-30','2026-09-30','cash','Forbidden'),'42501','You do not have access to this factory\.');
 raise notice 'PASS [EXECUTED]: direct Factory B attacks completed for all 25 scoped signatures';
end$$;

-- Valid mixed-tenant child IDs and JSON payloads. Hash checks prove atomicity.
do $$
declare a uuid:=pg_temp.fixture_id('factory_a'); mixed_expense jsonb; mixed_coal jsonb; mixed_soil jsonb;
begin
 perform pg_temp.expect_rejection('PR4 Factory A plus Factory B labourer',format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,10)',a,pg_temp.fixture_id('prod_b'),'2026-09-18'),'42501','Labourer does not belong to this factory\.');
 perform pg_temp.expect_rejection('PR5 Factory A plus Factory B labourer',format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,date %L,10)',a,pg_temp.fixture_id('prod_b'),'2026-09-18','2026-09-17'),'42501','Labourer does not belong to this factory\.');
 perform pg_temp.expect_rejection('PR10 Factory A plus Factory B labourer',format('select * from public.save_production_entry(%L::uuid,%L::uuid,%L::uuid,date %L,1000)',a,'12d11000-0000-4000-8000-000000000099',pg_temp.fixture_id('prod_b'),'2026-09-29'),'42501','Labourer does not belong to this factory\.');
 perform pg_temp.expect_rejection('MU4 Factory A plus Factory B group',format('select * from public.create_mud_settlement_withdrawal(%L::uuid,%L::uuid,%L::uuid,date %L,date %L,10)',a,'12d22000-0000-4000-8000-000000000099',pg_temp.fixture_id('mud_group_b'),'2026-09-29','2026-09-28'),'42501','Mud group does not belong to this factory\.');
 perform pg_temp.expect_rejection('SO2 Factory A plus Factory B worker',format('select * from public.create_soil_financial_adjustment(%L::uuid,%L::uuid,%L,date %L,10,%L)',a,pg_temp.fixture_id('soil_b'),'ADDITION','2026-09-20','Mixed'),'P2602','Soil worker does not belong to this factory\.');
 perform pg_temp.expect_rejection('SO3 Factory A plus Factory B worker',format('select * from public.create_soil_payment(%L::uuid,%L::uuid,date %L,10)',a,pg_temp.fixture_id('soil_b'),'2026-09-20'),'P2602','Soil worker does not belong to this factory\.');
 mixed_soil:=jsonb_build_array(jsonb_build_object('soil_worker_id',pg_temp.fixture_id('soil_a'),'trolley_quantity',1),jsonb_build_object('soil_worker_id',pg_temp.fixture_id('soil_b'),'trolley_quantity',1));
 perform pg_temp.expect_rejection('SO11 mixed A/B Soil JSON',format('select * from public.save_soil_daily_trolley_entries(%L::uuid,date %L,%L::jsonb)',a,'2026-09-21',mixed_soil::text),'P2602','One or more Soil workers do not belong to this factory\.');
 perform pg_temp.expect_rejection('ST6 Factory A plus Factory B Staff worker',format('select * from public.record_staff_payment(%L::uuid,%L::uuid,date %L,10,%L)',a,pg_temp.fixture_id('staff_b'),'2026-09-20','Mixed'),'P2502','Staff worker does not belong to this factory\.');
 perform pg_temp.expect_rejection('TR3 Factory A plus Factory B Transport worker',format('select * from public.create_transport_worker_withdrawal(%L::uuid,%L::uuid,date %L,10)',a,pg_temp.fixture_id('transport_b'),'2026-09-28'),'42501','Transport worker does not belong to this factory\.');
 perform pg_temp.expect_rejection('VW2 Factory A plus Factory B Vehicle',format('select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,10,%L)',a,pg_temp.fixture_id('vehicle_b'),'2026-09-20','Mixed'),'P3102','Vehicle does not belong to this factory\.');
 perform pg_temp.expect_rejection('VW3 Factory A plus Factory B payment',format('select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',a,pg_temp.fixture_id('vehicle_payment_b'),'2026-09-21','Mixed'),'P3120','Vehicle wage payment does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE1 Factory A plus Factory B Coal purchase',format('select public.create_coal_payment(%L::uuid,%L::uuid,date %L,10,%L,%L)',a,pg_temp.fixture_id('coal_purchase_b'),'2026-09-30','cash','Mixed'),'P4206','Coal Purchase does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE2 Factory A plus Factory B seller',format('select * from public.create_coal_purchase(%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,10,10,null,0,10,%L)',a,'2026-09-30',pg_temp.fixture_id('seller_b'),pg_temp.fixture_id('coal_name_a'),pg_temp.fixture_id('coal_source_a'),'MIX-SELLER','AT12A001','cash'),'P4002','Seller does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE2 Factory A plus Factory B Coal reference',format('select * from public.create_coal_purchase(%L::uuid,date %L,%L::uuid,%L::uuid,%L::uuid,%L,%L,10,10,null,0,10,%L)',a,'2026-09-30',pg_temp.fixture_id('seller_a'),pg_temp.fixture_id('coal_name_b'),pg_temp.fixture_id('coal_source_a'),'MIX-REF','AT12A001','cash'),'P4203','Coal Name does not belong to this factory\.');
 mixed_coal:=jsonb_build_array(jsonb_build_object('purchase_id',pg_temp.fixture_id('coal_purchase_a'),'amount',5),jsonb_build_object('purchase_id',pg_temp.fixture_id('coal_purchase_b'),'amount',5));
 perform pg_temp.expect_rejection('PE4 mixed A/B Coal allocation JSON',format('select public.create_coal_selective_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,%L,%L,%L::jsonb)',a,pg_temp.fixture_id('seller_a'),'2026-09-30','2026-09-30','2026-09-30','cash','Mixed',mixed_coal::text),'P4210','A selected Coal Purchase does not belong to this factory\.');
 mixed_expense:=jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fixture_id('expense_a'),'amount',5),jsonb_build_object('expense_record_id',pg_temp.fixture_id('expense_b'),'amount',5));
 perform pg_temp.expect_rejection('PE5 mixed A/B Expense allocation JSON',format('select public.create_expense_payment(%L::uuid,date %L,10,%L,%L,%L::jsonb)',a,'2026-09-30','cash','Mixed',mixed_expense::text),'P4102','Expense/Purchase does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE6 Factory A plus Factory B supplier',format('select public.create_expense_record(%L::uuid,date %L,%L,%L::uuid,null,%L,100,%L)',a,'2026-09-30','expense',pg_temp.fixture_id('seller_b'),'Mixed','Mixed'),'P4002','Supplier does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE9 Factory A plus Factory B Vehicle',format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,10,10,null,10,%L)',a,'2026-09-30','11:00',pg_temp.fixture_id('vehicle_b'),pg_temp.fixture_id('pump_a'),'Diesel','cash'),'P4501','Vehicle does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE9 Factory A plus Factory B Pump',format('select * from public.create_vehicle_fuel(%L::uuid,date %L,time %L,%L::uuid,%L::uuid,%L,10,10,null,10,%L)',a,'2026-09-30','11:00',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('pump_b'),'Diesel','cash'),'P4503','Choose a supplier assigned as a Fuel Pump\.');
 perform pg_temp.expect_rejection('PE10 Factory A plus Factory B Pump',format('select public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,10,%L,%L)',a,pg_temp.fixture_id('pump_b'),'2026-09-30','2026-09-30','2026-09-30','cash','Mixed'),'P4503','Choose a Fuel Pump belonging to this factory\.');
 perform pg_temp.expect_rejection('PE11 Factory A plus Factory B Fuel record',format('select public.create_vehicle_fuel_payment(%L::uuid,%L::uuid,date %L,10,%L,%L)',a,pg_temp.fixture_id('fuel_record_b'),'2026-09-30','cash','Mixed'),'P4504','Fuel record does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE12 Factory A plus Factory B Vehicle',format('select * from public.create_vehicle_maintenance(%L::uuid,date %L,%L::uuid,%L::uuid,%L,100,10,%L)',a,'2026-09-30',pg_temp.fixture_id('vehicle_b'),pg_temp.fixture_id('garage_a'),'Mixed','cash'),'P4301','Vehicle does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE12 Factory A plus Factory B Garage',format('select * from public.create_vehicle_maintenance(%L::uuid,date %L,%L::uuid,%L::uuid,%L,100,10,%L)',a,'2026-09-30',pg_temp.fixture_id('vehicle_a'),pg_temp.fixture_id('garage_b'),'Mixed','cash'),'P4303','Garage does not belong to this factory\.');
 perform pg_temp.expect_rejection('PE13 Factory A plus Factory B Garage',format('select public.create_vehicle_maintenance_batch_payment(%L::uuid,%L::uuid,date %L,date %L,date %L,10,%L,%L)',a,pg_temp.fixture_id('garage_b'),'2026-09-30','2026-09-30','2026-09-30','cash','Mixed'),'P4303','Choose a Garage belonging to this factory\.');
 raise notice 'PASS [EXECUTED]: mixed child-ID and JSON attacks rejected atomically';
end$$;

-- Reverse combinations: Factory B plus valid Factory A children still fail at membership.
select pg_temp.expect_rejection('reverse Production B factory plus A labourer',format('select * from public.create_labourer_withdrawal(%L::uuid,%L::uuid,date %L,10)',pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('prod4_a'),'2026-09-18'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('reverse Soil B factory plus A worker',format('select * from public.create_soil_payment(%L::uuid,%L::uuid,date %L,10)',pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('soil_a'),'2026-09-20'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('reverse Vehicle B factory plus A payment',format('select * from public.reverse_vehicle_wage_payment(%L::uuid,%L::uuid,date %L,%L)',pg_temp.fixture_id('factory_b'),pg_temp.fixture_id('vehicle_payment_a'),'2026-09-21','Reverse'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('reverse Expense B factory plus A record',format('select public.create_expense_payment(%L::uuid,date %L,10,%L,%L,%L::jsonb)',pg_temp.fixture_id('factory_b'),'2026-09-30','cash','Reverse',jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fixture_id('expense_a'),'amount',10))::text),'42501','You do not have access to this factory\.');

-- Representative inactive-member checks with the same valid calls before/after deactivation.
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user_a')::text,true);select pg_temp.assert_identity(pg_temp.fixture_id('user_a'),'inactive pre-controls');
select * from public.record_staff_payment(pg_temp.fixture_id('factory_a'),pg_temp.fixture_id('staff_a'),'2026-09-20',1,'Inactive same call');
select * from public.calculate_transport_weekly_wages(pg_temp.fixture_id('factory_a'),'2026-09-21');
select public.create_expense_payment(pg_temp.fixture_id('factory_a'),'2026-09-30',1,'cash','Inactive same call',jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fixture_id('expense_inactive_a'),'amount',1)));
reset role;select set_config('request.jwt.claim.sub','',true);
update public.factory_users set is_active=false where user_id=pg_temp.fixture_id('user_a') and factory_id=pg_temp.fixture_id('factory_a');
select pg_temp.expect_rejection('inactive workforce payment',format('select * from public.record_staff_payment(%L::uuid,%L::uuid,date %L,1,%L)',pg_temp.fixture_id('factory_a'),pg_temp.fixture_id('staff_a'),'2026-09-20','Inactive same call'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('inactive wage calculation',format('select * from public.calculate_transport_weekly_wages(%L::uuid,date %L)',pg_temp.fixture_id('factory_a'),'2026-09-21'),'42501','You do not have access to this factory\.');
select pg_temp.expect_rejection('inactive expense payment',format('select public.create_expense_payment(%L::uuid,date %L,1,%L,%L,%L::jsonb)',pg_temp.fixture_id('factory_a'),'2026-09-30','cash','Inactive same call',jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fixture_id('expense_inactive_a'),'amount',1))::text),'42501','You do not have access to this factory\.');

reset role;select set_config('request.jwt.claim.sub','',true);
rollback;

-- Persistent rollback proof, including auth.users.
do $$
declare target record;ending bigint;mismatches text[]:=array[]::text[];
begin
 for target in select * from atlas_12b2b_persistent_counts order by schema_name,table_name loop
  execute format('select count(*) from %I.%I',target.schema_name,target.table_name) into ending;
  if ending<>target.row_count then mismatches:=array_append(mismatches,format('%s.%s before=%s after=%s',target.schema_name,target.table_name,target.row_count,ending));end if;
 end loop;
 if cardinality(mismatches)>0 then raise exception 'FAIL: rollback persistent mismatches %',mismatches;end if;
 raise notice 'PASS [ROLLBACK]: all % persistent table/auth counts restored',(select count(*) from atlas_12b2b_persistent_counts);
end$$;

select
 25 as scoped_live_rpcs,
 25 as security_definer_rpcs,
 25 as authenticated_execute,
 0 as anon_execute,
 0 as public_execute,
 25 as executed_and_passed,
 0 as not_proven,
 0 as not_exercised,
 0 as failed,
 16 as real_writer_rpc_fixture_calls,
 0 as authenticated_direct_write_fixture_rows,
 2 as trigger_generated_fixture_rows,
 105 as privileged_setup_fixture_rows,
 25 as direct_factory_b_attacks,
 26 as mixed_tenant_attacks,
 4 as reverse_combination_attacks,
 3 as inactive_membership_checks,
 (select count(*) from atlas_12b2b_persistent_counts) as persistent_count_pairs,
 0 as persistent_count_mismatches,
 'PARTIAL'::text as financial_rpc_isolation_coverage,
 'Remaining financial-integrity test: concurrent/double-submit payment and withdrawal behavior.'::text as future_test_ledger;

drop table atlas_12b2b_persistent_counts;
drop table atlas_12b2b_manifest;
