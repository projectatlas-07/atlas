-- Atlas Security 12B2E: final 23 public RPC signatures; Test Atlas Clean ONLY.
-- npx supabase db query --linked --file supabase/verify_rpc_isolation_remaining_reads.sql
-- Existing verifiers are read as coverage manifests, NEVER executed by this file.
-- Commit below retains ONLY temporary baselines/manifests/counters. All Atlas/auth
-- fixture/test mutations occur in the single subsequent transaction ending ROLLBACK.
-- Session-only sequences retain measured counters across rollback.
create temporary table atlas_12b2e_manifest(id text primary key,fn text,args text,module text,barrier text,unique(fn,args)) on commit preserve rows;
insert into atlas_12b2e_manifest values
('PR2','calculate_production_wages','p_factory_id uuid, p_week_start date','Production','active factory membership is checked BEFORE controlled P2522 disabled response; no business query/write'),
('PE15','get_expense_record_payment_state','p_factory_id uuid, p_expense_record_id uuid','Purchases & Expenses','active membership; expense ID AND factory; allocation join constrained by factory; missing ownership P4102'),
('MU6','get_mud_cutover_readiness','p_factory_id uuid','Mud','active membership; checked cutover-readiness delegate scopes state, groups, weekly earnings and withdrawals; checked certification/allocation readers'),
('MU7','get_mud_group_configuration','p_factory_id uuid, p_as_of_date date','Mud','active membership; groups, state, term and rate lookups constrained by factory_id'),
('MU8','get_mud_group_daily_allocation','p_factory_id uuid, p_production_date date','Mud','active membership; terms/rates/source production/allocation constrained by factory_id; labourer join also matches factory'),
('MU9','get_mud_group_range_allocation','p_factory_id uuid, p_from_date date, p_to_date date','Mud','active membership in public wrapper; checked daily allocation reader with same factory for every day'),
('MU11','get_mud_shadow_certification_status','p_factory_id uuid','Mud','active membership in public wrapper; factory state and candidate week scoped; checked weekly comparisons reader'),
('MU12','get_mud_shadow_weekly_comparisons','p_factory_id uuid, p_from_week_start date, p_to_week_start date','Mud','active membership in public wrapper; factory SHADOW state/weekly earnings scoped; checked range allocation reader'),
('PE16','get_previous_vehicle_refuel','p_factory_id uuid, p_vehicle_id uuid, p_before_date date, p_before_time time without time zone, p_exclude_fuel_record_id uuid','Purchases & Expenses','active membership; vehicle ID AND factory; details delegate factory-scoped; exclusion is only a comparison against owned rows, never a foreign lookup'),
('ST5','get_staff_payment_summary','p_factory_id uuid, p_staff_worker_id uuid','Staff','active membership; worker ID AND factory ownership; payments constrained by factory and worker'),
('PE17','get_supplier_expense_summary','p_factory_id uuid, p_supplier_id uuid','Purchases & Expenses','active membership; supplier ID AND factory; records and allocation aggregation scoped'),
('VW1','get_vehicle_wage_account_summary','p_factory_id uuid, p_vehicle_id uuid','Vehicle Delivery Wages','active membership; vehicle ID AND factory ownership; account delegate scopes challans/payments/reversals by factory and vehicle'),
('PE18','list_coal_payments','p_factory_id uuid, p_seller_id uuid','Purchases & Expenses','active membership; optional seller ID AND factory; payment/allocation/coal/expense joins match factory'),
('PE19','list_coal_purchases','p_factory_id uuid, p_seller_id uuid','Purchases & Expenses','active membership; optional seller ID AND factory; details delegate constrained by factory and seller'),
('PE20','list_coal_selective_payments','p_factory_id uuid, p_seller_id uuid','Purchases & Expenses','active membership; seller role ID AND factory; payment/allocation/coal/expense joins match factory'),
('PE21','list_expense_records','p_factory_id uuid, p_supplier_id uuid','Purchases & Expenses','active membership; optional supplier ID AND factory; records, allocations and subtype exclusions factory-scoped'),
('PE22','list_suppliers_by_role','p_factory_id uuid, p_role text','Purchases & Expenses','active membership; role and supplier join match factory; role filter uses same value for A and B'),
('PE23','list_vehicle_fuel_batch_payments','p_factory_id uuid, p_pump_id uuid','Purchases & Expenses','active membership; optional pump role ID AND factory; payment/allocation/fuel/expense/supplier joins match factory'),
('PE24','list_vehicle_fuel_payments','p_factory_id uuid, p_vehicle_id uuid, p_pump_id uuid','Purchases & Expenses','active membership; optional vehicle and pump role IDs AND factory; financial joins match factory'),
('PE25','list_vehicle_fuel_records','p_factory_id uuid, p_vehicle_id uuid, p_pump_id uuid','Purchases & Expenses','active membership; optional vehicle and pump role IDs AND factory; details delegate factory-scoped'),
('PE26','list_vehicle_maintenance_batch_payments','p_factory_id uuid, p_garage_id uuid','Purchases & Expenses','active membership; optional garage role ID AND factory; payment/allocation/maintenance/expense joins match factory'),
('PE27','list_vehicle_maintenance_payments','p_factory_id uuid, p_vehicle_id uuid, p_garage_id uuid','Purchases & Expenses','active membership; optional vehicle and garage IDs AND factory; financial joins match factory'),
('PE28','list_vehicle_maintenance_records','p_factory_id uuid, p_vehicle_id uuid, p_garage_id uuid','Purchases & Expenses','active membership; optional vehicle and garage IDs AND factory; details delegate factory-scoped');
create temporary table atlas_12b2e_proven(fn text,args text,module text,primary key(fn,args)) on commit preserve rows;
insert into atlas_12b2e_proven values
('provision_first_factory','p_factory_name text','Auth/Factory'),
('resolve_factory_access','','Auth/Factory'),
('update_factory_printable_profile','p_factory_id uuid, p_name text, p_business_description text, p_address text, p_mobile text','Auth/Factory'),
('update_factory_printable_profile','p_factory_id uuid, p_name text, p_business_description text, p_village text, p_post_office text, p_police_station text, p_district text, p_state text, p_mobile text, p_gstin text','Auth/Factory'),
('initialize_cash_book','p_factory_id uuid, p_start_date date, p_opening_balance numeric','Cash Book'),
('create_cash_book_manual_entry','p_factory_id uuid, p_entry_id uuid, p_business_date date, p_direction text, p_amount numeric, p_payment_mode text, p_party_details text, p_note text','Cash Book'),
('void_cash_book_manual_entry','p_factory_id uuid, p_entry_id uuid','Cash Book'),
('get_cash_book_day_summary','p_factory_id uuid, p_business_date date','Cash Book'),
('list_cash_book_day_entries','p_factory_id uuid, p_business_date date','Cash Book'),
('create_brick_type','p_factory_id uuid, p_name text','Sales'),
('rename_brick_type','p_factory_id uuid, p_brick_type_id uuid, p_name text','Sales'),
('set_brick_type_active','p_factory_id uuid, p_brick_type_id uuid, p_is_active boolean','Sales'),
('delete_unused_brick_type','p_factory_id uuid, p_brick_type_id uuid','Sales'),
('create_customer','p_factory_id uuid, p_name text, p_address text, p_mobile text','Sales'),
('update_customer','p_factory_id uuid, p_customer_id uuid, p_name text, p_address text, p_mobile text','Sales'),
('find_or_create_vehicle','p_factory_id uuid, p_vehicle_number text, p_delivery_wage_tracking_enabled boolean','Sales'),
('set_vehicle_delivery_wage_tracking','p_factory_id uuid, p_vehicle_id uuid, p_enabled boolean','Sales'),
('archive_vehicle','p_factory_id uuid, p_vehicle_id uuid','Sales'),
('restore_vehicle','p_factory_id uuid, p_vehicle_id uuid','Sales'),
('create_challan','p_factory_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb','Sales'),
('create_challan_with_received_payment','p_factory_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb, p_payment_date date, p_payment_amount numeric, p_payment_mode text','Sales'),
('update_challan','p_factory_id uuid, p_challan_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb','Sales'),
('void_challan','p_factory_id uuid, p_challan_id uuid','Sales'),
('create_customer_payment','p_factory_id uuid, p_customer_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text, p_allocations jsonb','Sales'),
('create_customer_payment_with_methods','p_factory_id uuid, p_customer_id uuid, p_payment_date date, p_amount numeric, p_payment_methods jsonb, p_note text, p_allocations jsonb','Sales'),
('get_challan_payment_state','p_factory_id uuid, p_challan_id uuid','Sales'),
('get_customer_sales_summary','p_factory_id uuid, p_customer_id uuid','Sales'),
('create_labourer_withdrawal','p_factory_id uuid, p_labourer_id uuid, p_withdrawal_date date, p_amount numeric','Production'),
('create_labourer_withdrawal','p_factory_id uuid, p_labourer_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric','Production'),
('save_production_entry','p_factory_id uuid, p_entry_id uuid, p_labourer_id uuid, p_production_date date, p_quantity integer','Production'),
('calculate_mud_supply_wages','p_factory_id uuid, p_labour_group_id uuid, p_week_start date','Mud'),
('create_labour_group_withdrawal','p_factory_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_amount numeric','Mud'),
('create_mud_settlement_withdrawal','p_factory_id uuid, p_withdrawal_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric','Mud'),
('execute_mud_settlement_cutover','p_factory_id uuid, p_proposed_legacy_cutoff date','Mud'),
('create_soil_financial_adjustment','p_factory_id uuid, p_soil_worker_id uuid, p_adjustment_type text, p_adjustment_date date, p_amount numeric, p_reason text','Soil'),
('create_soil_payment','p_factory_id uuid, p_soil_worker_id uuid, p_payment_date date, p_amount numeric','Soil'),
('save_soil_daily_trolley_entries','p_factory_id uuid, p_work_date date, p_entries jsonb','Soil'),
('record_staff_payment','p_factory_id uuid, p_staff_worker_id uuid, p_payment_date date, p_amount numeric, p_note text','Staff'),
('calculate_transport_weekly_wages','p_factory_id uuid, p_week_start date','Transport'),
('create_transport_worker_withdrawal','p_factory_id uuid, p_transport_worker_id uuid, p_withdrawal_date date, p_amount numeric','Transport'),
('record_vehicle_wage_payment','p_factory_id uuid, p_vehicle_id uuid, p_payment_date date, p_amount numeric, p_note text','Vehicle Delivery Wages'),
('reverse_vehicle_wage_payment','p_factory_id uuid, p_payment_id uuid, p_reversal_date date, p_reason text','Vehicle Delivery Wages'),
('create_coal_payment','p_factory_id uuid, p_purchase_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','Purchases & Expenses'),
('create_coal_purchase','p_factory_id uuid, p_purchase_date date, p_seller_id uuid, p_coal_name_reference_id uuid, p_source_reference_id uuid, p_coal_challan_number text, p_vehicle_number text, p_quantity numeric, p_rate numeric, p_coal_amount numeric, p_separate_freight_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text','Purchases & Expenses'),
('create_coal_selective_payment','p_factory_id uuid, p_seller_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_payment_mode text, p_note text, p_allocations jsonb','Purchases & Expenses'),
('create_expense_payment','p_factory_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text, p_allocations jsonb','Purchases & Expenses'),
('create_expense_record','p_factory_id uuid, p_business_date date, p_kind text, p_supplier_id uuid, p_counterparty_name text, p_description text, p_total_amount numeric, p_note text','Purchases & Expenses'),
('create_vehicle_fuel','p_factory_id uuid, p_fuel_date date, p_fuel_time time without time zone, p_vehicle_id uuid, p_pump_id uuid, p_fuel_type text, p_litres numeric, p_rate_per_litre numeric, p_fuel_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text','Purchases & Expenses'),
('create_vehicle_fuel_batch_payment','p_factory_id uuid, p_pump_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','Purchases & Expenses'),
('create_vehicle_fuel_payment','p_factory_id uuid, p_fuel_record_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','Purchases & Expenses'),
('create_vehicle_maintenance','p_factory_id uuid, p_maintenance_date date, p_vehicle_id uuid, p_garage_id uuid, p_work_description text, p_total_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text','Purchases & Expenses'),
('create_vehicle_maintenance_batch_payment','p_factory_id uuid, p_garage_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','Purchases & Expenses'),
('create_vehicle_maintenance_payment','p_factory_id uuid, p_maintenance_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text','Purchases & Expenses'),
('update_coal_purchase','p_factory_id uuid, p_purchase_id uuid, p_purchase_date date, p_seller_id uuid, p_coal_name_reference_id uuid, p_source_reference_id uuid, p_coal_challan_number text, p_vehicle_number text, p_quantity numeric, p_rate numeric, p_coal_amount numeric, p_separate_freight_amount numeric','Purchases & Expenses'),
('update_expense_record','p_factory_id uuid, p_expense_record_id uuid, p_business_date date, p_kind text, p_supplier_id uuid, p_counterparty_name text, p_description text, p_total_amount numeric, p_note text','Purchases & Expenses'),
('update_vehicle_fuel','p_factory_id uuid, p_fuel_record_id uuid, p_fuel_date date, p_fuel_time time without time zone, p_vehicle_id uuid, p_pump_id uuid, p_fuel_type text, p_litres numeric, p_rate_per_litre numeric, p_fuel_amount numeric','Purchases & Expenses'),
('update_vehicle_maintenance','p_factory_id uuid, p_maintenance_id uuid, p_maintenance_date date, p_vehicle_id uuid, p_garage_id uuid, p_work_description text, p_total_amount numeric','Purchases & Expenses'),
('void_coal_purchase','p_factory_id uuid, p_purchase_id uuid','Purchases & Expenses'),
('void_expense_record','p_factory_id uuid, p_expense_record_id uuid','Purchases & Expenses'),
('void_vehicle_fuel','p_factory_id uuid, p_fuel_record_id uuid','Purchases & Expenses'),
('void_vehicle_maintenance','p_factory_id uuid, p_maintenance_id uuid','Purchases & Expenses'),
('assign_labourer_to_production_crew','p_factory_id uuid, p_labourer_id uuid, p_production_crew_id uuid, p_effective_from date','Production'),
('create_labourer_production_wage_rate_override','p_factory_id uuid, p_labourer_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','Production'),
('create_production_crew_wage_rate','p_factory_id uuid, p_production_crew_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','Production'),
('create_wage_rate','p_factory_id uuid, p_applies_to text, p_rate_per_1000_bricks numeric, p_effective_from date','Production'),
('end_labourer_production_crew_assignment','p_factory_id uuid, p_labourer_id uuid, p_effective_to date','Production'),
('set_production_labourer_origin','p_factory_id uuid, p_labourer_id uuid, p_origin_label text','Production'),
('set_production_labourer_rates','p_factory_id uuid, p_labourer_ids uuid[], p_rate_per_1000_bricks numeric, p_effective_from date','Production'),
('create_mud_group','p_factory_id uuid, p_name text, p_member_count integer, p_earning_start_date date, p_initial_rate numeric, p_rate_effective_date date','Mud'),
('restart_mud_group_earning','p_factory_id uuid, p_labour_group_id uuid, p_member_count integer, p_restart_date date','Mud'),
('set_mud_group_member_count','p_factory_id uuid, p_labour_group_id uuid, p_member_count integer, p_effective_from date','Mud'),
('set_mud_group_rate','p_factory_id uuid, p_labour_group_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','Mud'),
('set_mud_supply_rate','p_factory_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date','Mud'),
('stop_mud_group_earning','p_factory_id uuid, p_labour_group_id uuid, p_stop_date date','Mud'),
('transition_mud_accounting_mode','p_factory_id uuid, p_new_mode mud_accounting_mode','Mud'),
('create_transport_crew_wage_rate','p_factory_id uuid, p_transport_crew_id uuid, p_effective_from date, p_rate_per_paya numeric','Transport'),
('get_mud_group_settlement_account','p_factory_id uuid, p_labour_group_id uuid, p_as_of_date date','Mud'),
('create_coal_reference_value','p_factory_id uuid, p_kind text, p_display_value text','Purchases & Expenses'),
('update_supplier','p_factory_id uuid, p_supplier_id uuid, p_name text, p_address text, p_mobile text','Purchases & Expenses'),
('create_or_assign_supplier_role','p_factory_id uuid, p_role text, p_name text, p_address text, p_mobile text','Purchases & Expenses'),
('create_supplier','p_factory_id uuid, p_name text, p_address text, p_mobile text','Purchases & Expenses'),
('get_production_labourer_account','p_factory_id uuid, p_labourer_id uuid, p_as_of_date date','Production'),
('archive_soil_worker','p_factory_id uuid, p_soil_worker_id uuid','Soil'),
('restore_soil_worker','p_factory_id uuid, p_soil_worker_id uuid','Soil'),
('create_soil_worker_trolley_rate','p_factory_id uuid, p_soil_worker_id uuid, p_rate_per_trolley numeric, p_effective_from date','Soil'),
('create_soil_worker_with_initial_trolley_rate','p_factory_id uuid, p_name text, p_initial_rate_per_trolley numeric, p_initial_effective_from date','Soil'),
('delete_unused_soil_worker','p_factory_id uuid, p_soil_worker_id uuid','Soil'),
('get_soil_financial_summary','p_factory_id uuid, p_soil_worker_id uuid','Soil'),
('get_soil_total_earned','p_factory_id uuid, p_soil_worker_id uuid','Soil'),
('resolve_soil_worker_trolley_rate','p_factory_id uuid, p_soil_worker_id uuid, p_work_date date','Soil'),
('archive_staff_worker','p_factory_id uuid, p_staff_worker_id uuid','Staff'),
('create_staff_worker_with_reference_salary','p_factory_id uuid, p_name text, p_staff_category_id uuid, p_reference_salary numeric','Staff'),
('delete_staff_category','p_factory_id uuid, p_staff_category_id uuid','Staff'),
('delete_staff_worker','p_factory_id uuid, p_staff_worker_id uuid','Staff'),
('restore_staff_worker','p_factory_id uuid, p_staff_worker_id uuid','Staff'),
('update_staff_category','p_factory_id uuid, p_staff_category_id uuid, p_name text','Staff'),
('update_staff_reference_salary','p_factory_id uuid, p_staff_worker_id uuid, p_reference_salary numeric','Staff'),
('get_transport_worker_available_balance','p_factory_id uuid, p_transport_worker_id uuid, p_as_of_date date','Transport'),
('save_transport_daily_entry','p_factory_id uuid, p_transport_crew_id uuid, p_work_date date, p_paya_quantity numeric, p_transport_worker_ids uuid[]','Transport');
create temporary table atlas_12b2e_inventory(fn text,args text,module text) on commit preserve rows;
create temporary table atlas_12b2e_baseline(s text,t text,c bigint,h text,primary key(s,t)) on commit preserve rows;
create temporary sequence atlas_12b2e_writers;
create temporary sequence atlas_12b2e_privileged;
create temporary sequence atlas_12b2e_triggers;
create temporary sequence atlas_12b2e_positive;
create temporary sequence atlas_12b2e_rejected;
create temporary sequence atlas_12b2e_safe_exclusions;
-- FAIL CLOSED before any synthetic work if the inventory, coverage or grants changed.
do $$
declare n integer;r record;c bigint;h text;
begin
 insert into atlas_12b2e_inventory
 select p.proname,pg_get_function_identity_arguments(p.oid),coalesce(done.module,todo.module)
 from pg_proc p join pg_namespace s on s.oid=p.pronamespace
 left join atlas_12b2e_proven done on done.fn=p.proname and done.args=pg_get_function_identity_arguments(p.oid)
 left join atlas_12b2e_manifest todo on todo.fn=p.proname and todo.args=pg_get_function_identity_arguments(p.oid)
 where s.nspname='public' and p.prokind='f'
  and p.prorettype not in('trigger'::regtype,'event_trigger'::regtype)
  and has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
 select count(*) into n from atlas_12b2e_inventory i where not exists(
  select 1 from atlas_12b2e_proven p where p.fn=i.fn and p.args=i.args);
 if n<>23 or (select count(*) from atlas_12b2e_inventory)<>122
 or (select count(*) from atlas_12b2e_proven)<>99
 or exists(select 1 from atlas_12b2e_proven p where not exists(select 1 from atlas_12b2e_inventory i where i.fn=p.fn and i.args=p.args))
 or exists(select 1 from atlas_12b2e_inventory where module is null)
 or (select count(*) from atlas_12b2e_manifest)<>23 then
  raise exception 'STOP inventory drift: remaining %, fresh inventory required',n;
 end if;
 if exists(select 1 from pg_proc p join atlas_12b2e_manifest m on m.fn=p.proname and m.args=pg_get_function_identity_arguments(p.oid)
 where p.pronamespace='public'::regnamespace and(
  not p.prosecdef or not has_function_privilege('authenticated',p.oid,'EXECUTE')
  or has_function_privilege('anon',p.oid,'EXECUTE')
  or not coalesce(p.proconfig@>array['search_path=pg_catalog, public'],false)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
 )) then raise exception 'FAIL grants/security-definer/search_path';end if;
 if exists(
  select * from (values('Auth/Factory',4),('Cash Book',5),('Sales',18),('Production',12),
  ('Mud',18),('Soil',11),('Staff',9),('Transport',5),('Vehicle Delivery Wages',3),('Purchases & Expenses',37)) e(module,n)
  full join (select module,count(*) n from atlas_12b2e_inventory group by module) a using(module)
  where a.n is distinct from e.n
 ) then raise exception 'FAIL module coverage totals';end if;
 for r in select 'public'::text s,c.relname::text t from pg_class c join pg_namespace s on s.oid=c.relnamespace
 where s.nspname='public' and c.relkind in('r','p') union all select 'auth','users' loop
  execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into c,h;
  insert into atlas_12b2e_baseline values(r.s,r.t,c,h);
 end loop;
 if (select count(*) from atlas_12b2e_baseline where s='public')<>63 then raise exception 'FAIL public table count';end if;
 if exists(select 1 from auth.users where id in('12a50000-0000-4000-8000-000000000001','12a50000-0000-4000-8000-000000000002'))
 or exists(select 1 from public.factories where name in('Atlas 12B2E A','Atlas 12B2E B')) then raise exception 'FAIL synthetic fixture collision';end if;
end$$;
create temporary table atlas_12b2e_cases(id text,label text primary key,category text,q text,code text,message text,user_key text) on commit preserve rows;
insert into atlas_12b2e_cases values
('PR2','PR2 direct B','DIRECT','select * from public.calculate_production_wages(pg_temp.fid(''fb''),date ''2026-09-21'')','42501','You do not have access to this factory.','ua'),
('MU6','MU6 direct B','DIRECT','select * from public.get_mud_cutover_readiness(pg_temp.fid(''fb''))','42501','You do not have access to this factory.','ua'),
('MU7','MU7 direct B','DIRECT','select * from public.get_mud_group_configuration(pg_temp.fid(''fb''),date ''2026-09-21'')','42501','You do not have access to this factory.','ua'),
('MU8','MU8 direct B','DIRECT','select * from public.get_mud_group_daily_allocation(pg_temp.fid(''fb''),date ''2026-09-21'')','42501','You do not have access to this factory.','ua'),
('MU9','MU9 direct B','DIRECT','select * from public.get_mud_group_range_allocation(pg_temp.fid(''fb''),date ''2026-09-21'',date ''2026-09-27'')','42501','You do not have access to this factory.','ua'),
('MU11','MU11 direct B','DIRECT','select * from public.get_mud_shadow_certification_status(pg_temp.fid(''fb''))','42501','You do not have access to this factory.','ua'),
('MU12','MU12 direct B','DIRECT','select * from public.get_mud_shadow_weekly_comparisons(pg_temp.fid(''fb''),date ''2026-09-21'',date ''2026-09-21'')','42501','You do not have access to this factory.','ua'),
('ST5','ST5 direct B','DIRECT','select * from public.get_staff_payment_summary(pg_temp.fid(''fb''),pg_temp.fid(''staff_b''))','42501','You do not have access to this factory.','ua'),
('VW1','VW1 direct B','DIRECT','select * from public.get_vehicle_wage_account_summary(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''))','42501','You do not have access to this factory.','ua'),
('PE15','PE15 direct B','DIRECT','select * from public.get_expense_record_payment_state(pg_temp.fid(''fb''),pg_temp.fid(''expense_b1''))','42501','You do not have access to this factory.','ua'),
('PE16','PE16 direct B','DIRECT','select * from public.get_previous_vehicle_refuel(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),date ''2026-09-30'',time ''12:00'',pg_temp.fid(''fuel_b3''))','42501','You do not have access to this factory.','ua'),
('PE17','PE17 direct B','DIRECT','select * from public.get_supplier_expense_summary(pg_temp.fid(''fb''),pg_temp.fid(''generic_b''))','42501','You do not have access to this factory.','ua'),
('PE18','PE18 direct B','DIRECT','select * from public.list_coal_payments(pg_temp.fid(''fb''),pg_temp.fid(''seller_b''))','42501','You do not have access to this factory.','ua'),
('PE19','PE19 direct B','DIRECT','select * from public.list_coal_purchases(pg_temp.fid(''fb''),pg_temp.fid(''seller_b''))','42501','You do not have access to this factory.','ua'),
('PE20','PE20 direct B','DIRECT','select * from public.list_coal_selective_payments(pg_temp.fid(''fb''),pg_temp.fid(''seller_b''))','42501','You do not have access to this factory.','ua'),
('PE21','PE21 direct B','DIRECT','select * from public.list_expense_records(pg_temp.fid(''fb''),pg_temp.fid(''generic_b''))','42501','You do not have access to this factory.','ua'),
('PE22','PE22 direct B','DIRECT','select * from public.list_suppliers_by_role(pg_temp.fid(''fb''),''COAL_SELLER'')','42501','You do not have access to this factory.','ua'),
('PE23','PE23 direct B','DIRECT','select * from public.list_vehicle_fuel_batch_payments(pg_temp.fid(''fb''),pg_temp.fid(''pump_b''))','42501','You do not have access to this factory.','ua'),
('PE24','PE24 direct B','DIRECT','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_b''))','42501','You do not have access to this factory.','ua'),
('PE25','PE25 direct B','DIRECT','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_b''))','42501','You do not have access to this factory.','ua'),
('PE26','PE26 direct B','DIRECT','select * from public.list_vehicle_maintenance_batch_payments(pg_temp.fid(''fb''),pg_temp.fid(''garage_b''))','42501','You do not have access to this factory.','ua'),
('PE27','PE27 direct B','DIRECT','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_b''))','42501','You do not have access to this factory.','ua'),
('PE28','PE28 direct B','DIRECT','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_b''))','42501','You do not have access to this factory.','ua'),
('ST5','ST5 A factory B staff','MIXED','select * from public.get_staff_payment_summary(pg_temp.fid(''fa''),pg_temp.fid(''staff_b''))','P2502','Staff worker does not belong to this factory.','ua'),
('ST5','ST5 B caller A staff','REVERSE','select * from public.get_staff_payment_summary(pg_temp.fid(''fb''),pg_temp.fid(''staff_a''))','P2502','Staff worker does not belong to this factory.','ub'),
('VW1','VW1 A factory B vehicle','MIXED','select * from public.get_vehicle_wage_account_summary(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_b''))','P3102','Vehicle does not belong to this factory.','ua'),
('VW1','VW1 B caller A vehicle','REVERSE','select * from public.get_vehicle_wage_account_summary(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_a''))','P3102','Vehicle does not belong to this factory.','ub'),
('PE15','PE15 A factory B expense1','MIXED','select * from public.get_expense_record_payment_state(pg_temp.fid(''fa''),pg_temp.fid(''expense_b1''))','P4102','Expense/Purchase does not belong to this factory.','ua'),
('PE15','PE15 B caller A expense1','REVERSE','select * from public.get_expense_record_payment_state(pg_temp.fid(''fb''),pg_temp.fid(''expense_a1''))','P4102','Expense/Purchase does not belong to this factory.','ub'),
('PE16','PE16 A factory B vehicle','MIXED','select * from public.get_previous_vehicle_refuel(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_b''),date ''2026-09-30'',time ''12:00'',pg_temp.fid(''fuel_a2''))','P4501','Vehicle does not belong to this factory.','ua'),
('PE16','PE16 B caller A vehicle','REVERSE','select * from public.get_previous_vehicle_refuel(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_a''),date ''2026-09-30'',time ''12:00'',pg_temp.fid(''fuel_b3''))','P4501','Vehicle does not belong to this factory.','ub'),
('PE17','PE17 A factory B generic','MIXED','select * from public.get_supplier_expense_summary(pg_temp.fid(''fa''),pg_temp.fid(''generic_b''))','P4002','Supplier does not belong to this factory.','ua'),
('PE17','PE17 B caller A generic','REVERSE','select * from public.get_supplier_expense_summary(pg_temp.fid(''fb''),pg_temp.fid(''generic_a''))','P4002','Supplier does not belong to this factory.','ub'),
('PE18','PE18 A factory B seller','MIXED','select * from public.list_coal_payments(pg_temp.fid(''fa''),pg_temp.fid(''seller_b''))','P4002','Seller does not belong to this factory.','ua'),
('PE18','PE18 B caller A seller','REVERSE','select * from public.list_coal_payments(pg_temp.fid(''fb''),pg_temp.fid(''seller_a''))','P4002','Seller does not belong to this factory.','ub'),
('PE19','PE19 A factory B seller','MIXED','select * from public.list_coal_purchases(pg_temp.fid(''fa''),pg_temp.fid(''seller_b''))','P4002','Seller does not belong to this factory.','ua'),
('PE19','PE19 B caller A seller','REVERSE','select * from public.list_coal_purchases(pg_temp.fid(''fb''),pg_temp.fid(''seller_a''))','P4002','Seller does not belong to this factory.','ub'),
('PE20','PE20 A factory B seller','MIXED','select * from public.list_coal_selective_payments(pg_temp.fid(''fa''),pg_temp.fid(''seller_b''))','P4002','Seller does not belong to this factory.','ua'),
('PE20','PE20 B caller A seller','REVERSE','select * from public.list_coal_selective_payments(pg_temp.fid(''fb''),pg_temp.fid(''seller_a''))','P4002','Seller does not belong to this factory.','ub'),
('PE21','PE21 A factory B generic','MIXED','select * from public.list_expense_records(pg_temp.fid(''fa''),pg_temp.fid(''generic_b''))','P4002','Supplier does not belong to this factory.','ua'),
('PE21','PE21 B caller A generic','REVERSE','select * from public.list_expense_records(pg_temp.fid(''fb''),pg_temp.fid(''generic_a''))','P4002','Supplier does not belong to this factory.','ub'),
('PE23','PE23 A factory B pump','MIXED','select * from public.list_vehicle_fuel_batch_payments(pg_temp.fid(''fa''),pg_temp.fid(''pump_b''))','P4503','Choose a Fuel Pump belonging to this factory.','ua'),
('PE23','PE23 B caller A pump','REVERSE','select * from public.list_vehicle_fuel_batch_payments(pg_temp.fid(''fb''),pg_temp.fid(''pump_a''))','P4503','Choose a Fuel Pump belonging to this factory.','ub'),
('PE24','PE24 A factory B vehicle','MIXED','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_a''))','P4501','Vehicle does not belong to this factory.','ua'),
('PE24','PE24 B caller A vehicle','REVERSE','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_b''))','P4501','Vehicle does not belong to this factory.','ub'),
('PE24','PE24 A factory B pump','MIXED','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_b''))','P4503','Fuel Pump does not belong to this factory.','ua'),
('PE24','PE24 B caller A pump','REVERSE','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_a''))','P4503','Fuel Pump does not belong to this factory.','ub'),
('PE25','PE25 A factory B vehicle','MIXED','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_a''))','P4501','Vehicle does not belong to this factory.','ua'),
('PE25','PE25 B caller A vehicle','REVERSE','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_b''))','P4501','Vehicle does not belong to this factory.','ub'),
('PE25','PE25 A factory B pump','MIXED','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_b''))','P4503','Fuel Pump does not belong to this factory.','ua'),
('PE25','PE25 B caller A pump','REVERSE','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_a''))','P4503','Fuel Pump does not belong to this factory.','ub'),
('PE26','PE26 A factory B garage','MIXED','select * from public.list_vehicle_maintenance_batch_payments(pg_temp.fid(''fa''),pg_temp.fid(''garage_b''))','P4303','Choose a Garage belonging to this factory.','ua'),
('PE26','PE26 B caller A garage','REVERSE','select * from public.list_vehicle_maintenance_batch_payments(pg_temp.fid(''fb''),pg_temp.fid(''garage_a''))','P4303','Choose a Garage belonging to this factory.','ub'),
('PE27','PE27 A factory B vehicle','MIXED','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_a''))','P4301','Vehicle does not belong to this factory.','ua'),
('PE27','PE27 B caller A vehicle','REVERSE','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''garage_b''))','P4301','Vehicle does not belong to this factory.','ub'),
('PE27','PE27 A factory B garage','MIXED','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''garage_b''))','P4303','Garage does not belong to this factory.','ua'),
('PE27','PE27 B caller A garage','REVERSE','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_a''))','P4303','Garage does not belong to this factory.','ub'),
('PE28','PE28 A factory B vehicle','MIXED','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_a''))','P4301','Vehicle does not belong to this factory.','ua'),
('PE28','PE28 B caller A vehicle','REVERSE','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''garage_b''))','P4301','Vehicle does not belong to this factory.','ub'),
('PE28','PE28 A factory B garage','MIXED','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''garage_b''))','P4303','Garage does not belong to this factory.','ua'),
('PE28','PE28 B caller A garage','REVERSE','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_a''))','P4303','Garage does not belong to this factory.','ub'),
('PE18','PE18 direct B unfiltered','UNFILTERED','select * from public.list_coal_payments(pg_temp.fid(''fb''),null)','42501','You do not have access to this factory.','ua'),
('PE19','PE19 direct B unfiltered','UNFILTERED','select * from public.list_coal_purchases(pg_temp.fid(''fb''),null)','42501','You do not have access to this factory.','ua'),
('PE20','PE20 direct B unfiltered','UNFILTERED','select * from public.list_coal_selective_payments(pg_temp.fid(''fb''),null)','42501','You do not have access to this factory.','ua'),
('PE21','PE21 direct B unfiltered','UNFILTERED','select * from public.list_expense_records(pg_temp.fid(''fb''),null)','42501','You do not have access to this factory.','ua'),
('PE23','PE23 direct B unfiltered','UNFILTERED','select * from public.list_vehicle_fuel_batch_payments(pg_temp.fid(''fb''),null)','42501','You do not have access to this factory.','ua'),
('PE24','PE24 direct B unfiltered','UNFILTERED','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fb''),null,null)','42501','You do not have access to this factory.','ua'),
('PE25','PE25 direct B unfiltered','UNFILTERED','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fb''),null,null)','42501','You do not have access to this factory.','ua'),
('PE26','PE26 direct B unfiltered','UNFILTERED','select * from public.list_vehicle_maintenance_batch_payments(pg_temp.fid(''fb''),null)','42501','You do not have access to this factory.','ua'),
('PE27','PE27 direct B unfiltered','UNFILTERED','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fb''),null,null)','42501','You do not have access to this factory.','ua'),
('PE28','PE28 direct B unfiltered','UNFILTERED','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fb''),null,null)','42501','You do not have access to this factory.','ua'),
('MU9','MU9 inactive same call','INACTIVE','select * from public.get_mud_group_range_allocation(pg_temp.fid(''fa''),date ''2026-09-21'',date ''2026-09-27'')','42501','You do not have access to this factory.','ua'),
('ST5','ST5 inactive same call','INACTIVE','select * from public.get_staff_payment_summary(pg_temp.fid(''fa''),pg_temp.fid(''staff_a''))','42501','You do not have access to this factory.','ua'),
('VW1','VW1 inactive same call','INACTIVE','select * from public.get_vehicle_wage_account_summary(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''))','42501','You do not have access to this factory.','ua'),
('PE25','PE25 inactive same call','INACTIVE','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_a''))','42501','You do not have access to this factory.','ua');

-- Session-only manifests and baselines, no persistent fixture writes yet.
commit;
begin;
create temporary table atlas_12b2e_ids(k text primary key,id uuid not null) on commit drop;
create temporary table atlas_12b2e_pass(id text primary key,status text default 'EXECUTED + PASSED') on commit drop;
create temporary table atlas_12b2e_rejections(
  id text, label text primary key, code text, class text
) on commit drop;
grant select,insert on atlas_12b2e_ids to authenticated;
create function pg_temp.fid(k text) returns uuid language sql stable as
$$select id from pg_temp.atlas_12b2e_ids x where x.k=fid.k$$;
create function pg_temp.check_it(ok boolean,label text) returns void language plpgsql as
$$begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end$$;
create function pg_temp.clear_identity() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform pg_temp.check_it(current_user<>'authenticated' and auth.uid() is null,'privileged context cleared');
end$$;
create function pg_temp.identity(u uuid) returns void language plpgsql as $$
begin
  perform pg_temp.check_it(current_user='authenticated' and auth.uid()=u,'authenticated role and intended JWT');
end$$;
-- SECURITY INVOKER: entry-point calls execute as authenticated, not as the CLI administrator.
create function pg_temp.run(u uuid,q text,writer boolean default false) returns jsonb
language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.clear_identity();
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  perform pg_temp.identity(u);
  execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from ('||q||') t' into j;
  perform pg_temp.identity(u);
  perform pg_temp.clear_identity();
  if writer then perform nextval('pg_temp.atlas_12b2e_writers'); end if;
  return j;
end$$;
create function pg_temp.seed(q text) returns void language plpgsql as $$
declare n integer;i integer;
begin
  perform pg_temp.clear_identity();
  execute q;
  get diagnostics n=row_count;
  for i in 1..n loop perform nextval('pg_temp.atlas_12b2e_privileged'); end loop;
end$$;
create function pg_temp.pass(test_id text) returns void language plpgsql as $$
begin
  insert into pg_temp.atlas_12b2e_pass values(test_id,'EXECUTED + PASSED');
  perform nextval('pg_temp.atlas_12b2e_positive');
end$$;
-- Canonical full-row snapshots: factory profile plus ALL factory_id-bearing public tables.
-- Used only under the cleared privileged verifier context.
create function pg_temp.fhash(f uuid) returns text language plpgsql stable as $$
declare r record;j jsonb; x jsonb;
begin
  select to_jsonb(q) into j from public.factories q where id=f;
  for r in
    select c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p')
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid
                 and a.attname='factory_id' and not a.attisdropped)
    order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'') from public.%I q where factory_id=$1',r.t)
      into x using f;
    j:=j||jsonb_build_object(r.t,x);
  end loop;
  return md5(j::text);
end$$;
create function pg_temp.reject(test_id text,label text,q text,expected_code text,expected_message text,u uuid default null)
returns void language plpgsql as $$
declare a uuid:=pg_temp.fid('fa');b uuid:=pg_temp.fid('fb');
ha text;hb text;gs text;gm text;returned boolean:=false;
begin
  perform pg_temp.clear_identity();
  perform pg_temp.check_it(exists(select 1 from pg_temp.atlas_12b2e_pass where id=test_id),
                           label||' has prior valid A positive');
  ha:=pg_temp.fhash(a);hb:=pg_temp.fhash(b);
  begin
    perform pg_temp.run(coalesce(u,pg_temp.fid('ua')),q,false);
    returned:=true;
  exception when others then gs:=sqlstate;gm:=sqlerrm;
  end;
  perform pg_temp.clear_identity();
  if returned or gs is distinct from expected_code or gm is distinct from expected_message then
    -- Intentionally do not print arbitrary provider/database error details.
    raise exception 'FAIL %: success or incidental rejection (SQLSTATE %)',label,gs;
  end if;
  perform pg_temp.check_it(ha=pg_temp.fhash(a) and hb=pg_temp.fhash(b),label||' zero A/B full-row mutation');
  insert into pg_temp.atlas_12b2e_rejections values(test_id,label,gs,expected_message);
  perform nextval('pg_temp.atlas_12b2e_rejected');
end$$;


create temporary table atlas_12b2e_fixture_json(k text primary key,j jsonb) on commit drop;
create temporary table atlas_12b2e_expected(id text,s text,q text,j jsonb,primary key(id,s)) on commit drop;
create function pg_temp.canonical(j jsonb) returns jsonb language sql immutable as
$$select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from jsonb_array_elements(j)$$;
create function pg_temp.query_json(q text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
 perform pg_temp.clear_identity();
 execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from ('||q||') t' into j;
 return pg_temp.canonical(j);
end$$;
create function pg_temp.remember(k text,j jsonb) returns void language plpgsql as $$
begin
 perform pg_temp.check_it(jsonb_array_length(j)=1,k||' one writer-created fixture');
 insert into pg_temp.atlas_12b2e_fixture_json values(k,j->0);
 insert into pg_temp.atlas_12b2e_ids values(k,(j->0->>'id')::uuid);
end$$;
create function pg_temp.expect_read(test_id text,u uuid,q text,expected jsonb) returns void language plpgsql as $$
declare j jsonb;ha text;hb text;
begin
 perform pg_temp.check_it(jsonb_array_length(expected)>0,test_id||' qualifying non-empty expected data');
 ha:=pg_temp.fhash(pg_temp.fid('fa'));hb:=pg_temp.fhash(pg_temp.fid('fb'));
 j:=pg_temp.canonical(pg_temp.run(u,q));
 perform pg_temp.check_it(j=pg_temp.canonical(expected),test_id||' exact full-row expected result, no foreign fields/rows');
 perform pg_temp.check_it(ha=pg_temp.fhash(pg_temp.fid('fa')) and hb=pg_temp.fhash(pg_temp.fid('fb')),test_id||' zero read mutation');
end$$;
select pg_temp.clear_identity();
select pg_temp.seed($q$insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('12a50000-0000-4000-8000-000000000001','authenticated','authenticated','atlas-12b2e-a@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('12a50000-0000-4000-8000-000000000002','authenticated','authenticated','atlas-12b2e-b@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}',now(),now())$q$);
insert into atlas_12b2e_ids values('ua','12a50000-0000-4000-8000-000000000001'),('ub','12a50000-0000-4000-8000-000000000002');
do $$
declare s text;j jsonb;f uuid;
begin
 foreach s in array array['a','b'] loop
  j:=pg_temp.run(pg_temp.fid('u'||s),'select * from public.provision_first_factory(''Atlas 12B2E '||upper(s)||''')',true);
  f:=(j->0->>'factory_id')::uuid;insert into pg_temp.atlas_12b2e_ids values('f'||s,f);
  perform pg_temp.check_it(exists(select 1 from public.factory_users where factory_id=f and user_id=pg_temp.fid('u'||s) and is_active)
   and exists(select 1 from public.mud_accounting_states where factory_id=f),'real provisioning and Mud trigger');
  perform nextval('pg_temp.atlas_12b2e_triggers');
  perform pg_temp.run(pg_temp.fid('u'||s),format('select * from public.initialize_cash_book(%L::uuid,date ''2026-09-01'',100000)',f),true);
 end loop;
end$$;

-- Already-proven master/history prerequisites; scoped reads are NEVER substituted.
insert into atlas_12b2e_ids(k,id) select k,gen_random_uuid() from unnest(array[
'lab_a','lab_b','cat_a','cat_b','staff_a','staff_b','vehicle_a','vehicle_b','customer_a','customer_b',
'generic_a','generic_b','seller_a','seller_b','pump_a','pump_b','garage_a','garage_b',
'coal_name_a','coal_name_b','source_a','source_b']) k;
select pg_temp.seed($q$insert into public.labourers(id,factory_id,name) values
(pg_temp.fid('lab_a'),pg_temp.fid('fa'),'Production E A'),(pg_temp.fid('lab_b'),pg_temp.fid('fb'),'Production E B')$q$);
select pg_temp.seed($q$insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity)
select gen_random_uuid(),pg_temp.fid('fa'),pg_temp.fid('lab_a'),date '2026-09-21'+g,1000 from generate_series(0,7) g$q$);
select pg_temp.seed($q$insert into public.production_entries(id,factory_id,labourer_id,production_date,quantity)
select gen_random_uuid(),pg_temp.fid('fb'),pg_temp.fid('lab_b'),date '2026-09-21'+g,2000 from generate_series(0,7) g$q$);
select pg_temp.seed($q$insert into public.staff_categories(id,factory_id,name) values
(pg_temp.fid('cat_a'),pg_temp.fid('fa'),'Staff Category E A'),(pg_temp.fid('cat_b'),pg_temp.fid('fb'),'Staff Category E B')$q$);
select pg_temp.seed($q$insert into public.staff_workers(id,factory_id,name,staff_category_id,reference_salary) values
(pg_temp.fid('staff_a'),pg_temp.fid('fa'),'Staff E A',pg_temp.fid('cat_a'),1200),
(pg_temp.fid('staff_b'),pg_temp.fid('fb'),'Staff E B',pg_temp.fid('cat_b'),2300)$q$);
select pg_temp.seed($q$insert into public.vehicles(id,factory_id,vehicle_number,normalized_vehicle_number,delivery_wage_tracking_enabled) values
(pg_temp.fid('vehicle_a'),pg_temp.fid('fa'),'AT12E001','AT12E001',true),
(pg_temp.fid('vehicle_b'),pg_temp.fid('fb'),'AT12E002','AT12E002',true)$q$);
select pg_temp.seed($q$insert into public.customers(id,factory_id,name,address,mobile) values
(pg_temp.fid('customer_a'),pg_temp.fid('fa'),'Synthetic E A','Address A','0000000001'),
(pg_temp.fid('customer_b'),pg_temp.fid('fb'),'Synthetic E B','Address B','0000000002')$q$);
select pg_temp.seed($q$insert into public.challans(factory_id,challan_number,challan_date,customer_id,
customer_name_snapshot,customer_address_snapshot,customer_mobile_snapshot,company_name_snapshot,
company_business_description_snapshot,company_address_snapshot,company_mobile_snapshot,
vehicle_number,tractor_labour_rate_snapshot,vehicle_id,vehicle_number_snapshot,delivery_wage_applicable_snapshot,trip_labour_wage)
values
(pg_temp.fid('fa'),'12B2E-A','2026-09-20',pg_temp.fid('customer_a'),'Synthetic E A','Address A','0000000001','Factory A','Verifier','Address A','0000000001','AT12E001',1000,pg_temp.fid('vehicle_a'),'AT12E001',true,1000),
(pg_temp.fid('fb'),'12B2E-B','2026-09-22',pg_temp.fid('customer_b'),'Synthetic E B','Address B','0000000002','Factory B','Verifier','Address B','0000000002','AT12E002',3000,pg_temp.fid('vehicle_b'),'AT12E002',true,3000)$q$);
select pg_temp.seed($q$insert into public.suppliers(id,factory_id,name,address) values
(pg_temp.fid('generic_a'),pg_temp.fid('fa'),'General E A','General Address A'),
(pg_temp.fid('generic_b'),pg_temp.fid('fb'),'General E B','General Address B'),
(pg_temp.fid('seller_a'),pg_temp.fid('fa'),'Seller E A','Seller Address A'),
(pg_temp.fid('seller_b'),pg_temp.fid('fb'),'Seller E B','Seller Address B'),
(pg_temp.fid('pump_a'),pg_temp.fid('fa'),'Pump E A','Pump Address A'),
(pg_temp.fid('pump_b'),pg_temp.fid('fb'),'Pump E B','Pump Address B'),
(pg_temp.fid('garage_a'),pg_temp.fid('fa'),'Garage E A','Garage Address A'),
(pg_temp.fid('garage_b'),pg_temp.fid('fb'),'Garage E B','Garage Address B')$q$);
select pg_temp.seed($q$insert into public.supplier_roles(factory_id,supplier_id,role,created_by) values
(pg_temp.fid('fa'),pg_temp.fid('seller_a'),'COAL_SELLER',pg_temp.fid('ua')),
(pg_temp.fid('fb'),pg_temp.fid('seller_b'),'COAL_SELLER',pg_temp.fid('ub')),
(pg_temp.fid('fa'),pg_temp.fid('pump_a'),'FUEL_PUMP',pg_temp.fid('ua')),
(pg_temp.fid('fb'),pg_temp.fid('pump_b'),'FUEL_PUMP',pg_temp.fid('ub')),
(pg_temp.fid('fa'),pg_temp.fid('garage_a'),'GARAGE',pg_temp.fid('ua')),
(pg_temp.fid('fb'),pg_temp.fid('garage_b'),'GARAGE',pg_temp.fid('ub'))$q$);
select pg_temp.seed($q$insert into public.coal_reference_values(id,factory_id,kind,display_value,created_by) values
(pg_temp.fid('coal_name_a'),pg_temp.fid('fa'),'coal_name','Coal E A',pg_temp.fid('ua')),
(pg_temp.fid('coal_name_b'),pg_temp.fid('fb'),'coal_name','Coal E B',pg_temp.fid('ub')),
(pg_temp.fid('source_a'),pg_temp.fid('fa'),'source_location','Source E A',pg_temp.fid('ua')),
(pg_temp.fid('source_b'),pg_temp.fid('fb'),'source_location','Source E B',pg_temp.fid('ub'))$q$);

-- Real writers populate non-zero financial histories. A has 2 typed records,
-- B has 3, with different quantities/rates/names/payment totals in the SAME window.
create temporary table atlas_12b2e_money(
 s text,kind text,i integer,record_id uuid,total numeric,paid numeric,
 primary key(s,kind,i)
) on commit drop;
do $$
declare tenant text;f uuid;u uuid;j jsonb;g uuid;i integer;n integer;qty numeric;rate numeric;cost numeric;paid numeric;batch numeric;alloc jsonb;
begin
 foreach tenant in array array['a','b'] loop
  f:=pg_temp.fid('f'||tenant);u:=pg_temp.fid('u'||tenant);n:=case tenant when 'a' then 2 else 3 end;
  rate:=case tenant when 'a' then 100 else 200 end;
  j:=pg_temp.run(u,format('select public.create_mud_group(%L::uuid,%L,%s,date ''2026-09-21'',%s,date ''2026-09-21'')',f,'Mud E '||upper(tenant),case tenant when 'a' then 5 else 9 end,rate),true);
  g:=(j->0->>'create_mud_group')::uuid;insert into atlas_12b2e_ids values('mud_'||tenant,g);
  perform pg_temp.run(u,format('select * from public.set_mud_supply_rate(%L::uuid,%s,date ''2026-09-21'')',f,rate),true);
  perform pg_temp.run(u,format('select * from public.calculate_mud_supply_wages(%L::uuid,%L::uuid,date ''2026-09-21'')',f,g),true);
  perform pg_temp.check_it(exists(select 1 from public.weekly_earnings where factory_id=f and labour_group_id=g
   and week_start='2026-09-21' and amount=case tenant when 'a' then 700 else 2800 end),'distinct meaningful locked Mud week');
  perform pg_temp.run(u,format('select * from public.create_labour_group_withdrawal(%L::uuid,%L::uuid,date ''2026-09-27'',%s)',f,g,case tenant when 'a' then 100 else 300 end),true);
  perform pg_temp.run(u,format('select * from public.transition_mud_accounting_mode(%L::uuid,''SHADOW'')',f),true);
  for i in 1..n loop
   paid:=case tenant when 'a' then i*100 else (i+3)*100 end;
   perform pg_temp.run(u,format('select * from public.record_staff_payment(%L::uuid,%L::uuid,%L::date,%s,%L)',f,pg_temp.fid('staff_'||tenant),date '2026-09-20'+i,paid,'Staff E '||tenant||i),true);
  end loop;
  perform pg_temp.run(u,format('select * from public.record_vehicle_wage_payment(%L::uuid,%L::uuid,date ''2026-09-25'',%s,%L)',f,pg_temp.fid('vehicle_'||tenant),case tenant when 'a' then 150 else 550 end,'Vehicle E '||tenant),true);
  -- Generic expense count also differs: A=1; B=2.
  for i in 1..case tenant when 'a' then 1 else 2 end loop
   cost:=case when tenant='a' then 500 when i=1 then 1500 else 700 end;
   paid:=case when tenant='a' then 125 when i=1 then 325 else 175 end;
   j:=pg_temp.run(u,format('select * from public.create_expense_record(%L::uuid,%L::date,''expense'',%L::uuid,null,%L,%s,null)',f,date '2026-09-20'+i,pg_temp.fid('generic_'||tenant),'Generic E '||tenant||i,cost),true);
   perform pg_temp.remember('expense_'||tenant||i,j);
   insert into atlas_12b2e_money values(tenant,'expense',i,pg_temp.fid('expense_'||tenant||i),cost,paid);
   alloc:=jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fid('expense_'||tenant||i),'amount',paid));
   perform pg_temp.run(u,format('select * from public.create_expense_payment(%L::uuid,date ''2026-09-25'',%s,''cash'',%L,%L::jsonb)',f,paid,'Generic payment E '||tenant||i,alloc::text),true);
  end loop;
  for i in 1..n loop
   qty:=case tenant when 'a' then i*10 else (i+2)*10 end;
   rate:=case tenant when 'a' then 10 else 20 end;cost:=qty*rate;
   paid:=cost/10;
   j:=pg_temp.run(u,format('select * from public.create_coal_purchase(%L::uuid,%L::date,%L::uuid,%L::uuid,%L::uuid,%L,%L,%s,%s,null,0,%s,''cash'')',
    f,date '2026-09-20'+i-1,pg_temp.fid('seller_'||tenant),pg_temp.fid('coal_name_'||tenant),pg_temp.fid('source_'||tenant),
    'E-'||upper(tenant)||'-'||i,case tenant when 'a' then 'AT12E001' else 'AT12E002' end,qty,rate,paid),true);
   perform pg_temp.remember('coal_'||tenant||i,j);
   j:=pg_temp.run(u,format('select * from public.create_vehicle_fuel(%L::uuid,%L::date,%L::time,%L::uuid,%L::uuid,''Diesel'',%s,%s,null,%s,''cash'')',
    f,date '2026-09-20'+i-1,(case tenant when 'a' then '08:0' else '09:0' end)||i,pg_temp.fid('vehicle_'||tenant),pg_temp.fid('pump_'||tenant),qty,rate,paid),true);
   perform pg_temp.remember('fuel_'||tenant||i,j);
   j:=pg_temp.run(u,format('select * from public.create_vehicle_maintenance(%L::uuid,%L::date,%L::uuid,%L::uuid,%L,%s,%s,''cash'')',
    f,date '2026-09-20'+i-1,pg_temp.fid('vehicle_'||tenant),pg_temp.fid('garage_'||tenant),'Repair E '||tenant||i,cost,paid),true);
   perform pg_temp.remember('maint_'||tenant||i,j);
   insert into atlas_12b2e_money values
    (tenant,'coal',i,pg_temp.fid('coal_'||tenant||i),cost,paid),
    (tenant,'fuel',i,pg_temp.fid('fuel_'||tenant||i),cost,paid),
    (tenant,'maint',i,pg_temp.fid('maint_'||tenant||i),cost,paid);
  end loop;
  batch:=case tenant when 'a' then 200 else 1000 end;
  alloc:=jsonb_build_array(
   jsonb_build_object('purchase_id',pg_temp.fid('coal_'||tenant||1),'amount',case tenant when 'a' then 90 else 540 end),
   jsonb_build_object('purchase_id',pg_temp.fid('coal_'||tenant||2),'amount',case tenant when 'a' then 110 else 460 end));
  perform pg_temp.run(u,format('select * from public.create_coal_selective_payment(%L::uuid,%L::uuid,date ''2026-09-20'',date ''2026-09-30'',date ''2026-09-26'',''cash'',%L,%L::jsonb)',f,pg_temp.fid('seller_'||tenant),'Selective E '||tenant,alloc::text),true);
  perform pg_temp.run(u,format('select * from public.create_vehicle_fuel_batch_payment(%L::uuid,%L::uuid,date ''2026-09-20'',date ''2026-09-30'',date ''2026-09-26'',%s,''cash'',%L)',f,pg_temp.fid('pump_'||tenant),batch,'Fuel batch E '||tenant),true);
  perform pg_temp.run(u,format('select * from public.create_vehicle_maintenance_batch_payment(%L::uuid,%L::uuid,date ''2026-09-20'',date ''2026-09-30'',date ''2026-09-26'',%s,''cash'',%L)',f,pg_temp.fid('garage_'||tenant),batch,'Maintenance batch E '||tenant),true);
  update atlas_12b2e_money set paid=total where atlas_12b2e_money.s=tenant and kind in('coal','fuel','maint') and atlas_12b2e_money.i=1;
  update atlas_12b2e_money set paid=atlas_12b2e_money.paid+case tenant when 'a' then 110 else 460 end
   where atlas_12b2e_money.s=tenant and kind in('coal','fuel','maint') and atlas_12b2e_money.i=2;
 end loop;
end$$;
-- Independently check input-model amounts and payment allocation evidence before ANY read positive.
-- Oracles below use full expected rows from synthetic, factory-constrained base tables;
-- no scoped RPC or private detail function is used as an expected-result oracle.
do $$
declare r record;n integer;
begin
 for r in select * from atlas_12b2e_money loop
  perform pg_temp.check_it(
   exists(select 1 from public.expense_records e where e.id=r.record_id and e.factory_id=pg_temp.fid('f'||r.s)
     and e.status='active' and e.total_amount=r.total and e.is_locked)
   and (select coalesce(sum(a.allocated_amount),0) from public.expense_payment_allocations a
     where a.factory_id=pg_temp.fid('f'||r.s) and a.expense_record_id=r.record_id)=r.paid,
    'known source-model total/paid '||r.s||' '||r.kind||r.i);
 end loop;
 perform pg_temp.check_it((select sum(amount)=300 from public.staff_payments where factory_id=pg_temp.fid('fa'))
  and (select sum(amount)=1500 from public.staff_payments where factory_id=pg_temp.fid('fb')),'distinct qualifying Staff payments');
 perform pg_temp.check_it((select sum(trip_labour_wage)=1000 from public.challans where factory_id=pg_temp.fid('fa'))
  and (select sum(trip_labour_wage)=3000 from public.challans where factory_id=pg_temp.fid('fb'))
  and (select sum(amount)=150 from public.vehicle_wage_payments where factory_id=pg_temp.fid('fa'))
  and (select sum(amount)=550 from public.vehicle_wage_payments where factory_id=pg_temp.fid('fb')),'distinct qualifying Vehicle wage state');
end$$;

-- Store the actual public calls, with no invented date/filter parameters.
create temporary table atlas_12b2e_calls(id text,s text,q text,primary key(id,s)) on commit drop;
insert into atlas_12b2e_calls values
('PR2','a','select * from public.calculate_production_wages(pg_temp.fid(''fa''),date ''2026-09-21'')'),
('MU6','a','select * from public.get_mud_cutover_readiness(pg_temp.fid(''fa''))'),
('MU7','a','select * from public.get_mud_group_configuration(pg_temp.fid(''fa''),date ''2026-09-21'')'),
('MU8','a','select * from public.get_mud_group_daily_allocation(pg_temp.fid(''fa''),date ''2026-09-21'')'),
('MU9','a','select * from public.get_mud_group_range_allocation(pg_temp.fid(''fa''),date ''2026-09-21'',date ''2026-09-27'')'),
('MU11','a','select * from public.get_mud_shadow_certification_status(pg_temp.fid(''fa''))'),
('MU12','a','select * from public.get_mud_shadow_weekly_comparisons(pg_temp.fid(''fa''),date ''2026-09-21'',date ''2026-09-21'')'),
('ST5','a','select * from public.get_staff_payment_summary(pg_temp.fid(''fa''),pg_temp.fid(''staff_a''))'),
('VW1','a','select * from public.get_vehicle_wage_account_summary(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''))'),
('PE15','a','select * from public.get_expense_record_payment_state(pg_temp.fid(''fa''),pg_temp.fid(''expense_a1''))'),
('PE16','a','select * from public.get_previous_vehicle_refuel(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),date ''2026-09-30'',time ''12:00'',pg_temp.fid(''fuel_a2''))'),
('PE17','a','select * from public.get_supplier_expense_summary(pg_temp.fid(''fa''),pg_temp.fid(''generic_a''))'),
('PE18','a','select * from public.list_coal_payments(pg_temp.fid(''fa''),pg_temp.fid(''seller_a''))'),
('PE19','a','select * from public.list_coal_purchases(pg_temp.fid(''fa''),pg_temp.fid(''seller_a''))'),
('PE20','a','select * from public.list_coal_selective_payments(pg_temp.fid(''fa''),pg_temp.fid(''seller_a''))'),
('PE21','a','select * from public.list_expense_records(pg_temp.fid(''fa''),pg_temp.fid(''generic_a''))'),
('PE22','a','select * from public.list_suppliers_by_role(pg_temp.fid(''fa''),''COAL_SELLER'')'),
('PE23','a','select * from public.list_vehicle_fuel_batch_payments(pg_temp.fid(''fa''),pg_temp.fid(''pump_a''))'),
('PE24','a','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_a''))'),
('PE25','a','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''pump_a''))'),
('PE26','a','select * from public.list_vehicle_maintenance_batch_payments(pg_temp.fid(''fa''),pg_temp.fid(''garage_a''))'),
('PE27','a','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''garage_a''))'),
('PE28','a','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fa''),pg_temp.fid(''vehicle_a''),pg_temp.fid(''garage_a''))'),
('PR2','b','select * from public.calculate_production_wages(pg_temp.fid(''fb''),date ''2026-09-21'')'),
('MU6','b','select * from public.get_mud_cutover_readiness(pg_temp.fid(''fb''))'),
('MU7','b','select * from public.get_mud_group_configuration(pg_temp.fid(''fb''),date ''2026-09-21'')'),
('MU8','b','select * from public.get_mud_group_daily_allocation(pg_temp.fid(''fb''),date ''2026-09-21'')'),
('MU9','b','select * from public.get_mud_group_range_allocation(pg_temp.fid(''fb''),date ''2026-09-21'',date ''2026-09-27'')'),
('MU11','b','select * from public.get_mud_shadow_certification_status(pg_temp.fid(''fb''))'),
('MU12','b','select * from public.get_mud_shadow_weekly_comparisons(pg_temp.fid(''fb''),date ''2026-09-21'',date ''2026-09-21'')'),
('ST5','b','select * from public.get_staff_payment_summary(pg_temp.fid(''fb''),pg_temp.fid(''staff_b''))'),
('VW1','b','select * from public.get_vehicle_wage_account_summary(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''))'),
('PE15','b','select * from public.get_expense_record_payment_state(pg_temp.fid(''fb''),pg_temp.fid(''expense_b1''))'),
('PE16','b','select * from public.get_previous_vehicle_refuel(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),date ''2026-09-30'',time ''12:00'',pg_temp.fid(''fuel_b3''))'),
('PE17','b','select * from public.get_supplier_expense_summary(pg_temp.fid(''fb''),pg_temp.fid(''generic_b''))'),
('PE18','b','select * from public.list_coal_payments(pg_temp.fid(''fb''),pg_temp.fid(''seller_b''))'),
('PE19','b','select * from public.list_coal_purchases(pg_temp.fid(''fb''),pg_temp.fid(''seller_b''))'),
('PE20','b','select * from public.list_coal_selective_payments(pg_temp.fid(''fb''),pg_temp.fid(''seller_b''))'),
('PE21','b','select * from public.list_expense_records(pg_temp.fid(''fb''),pg_temp.fid(''generic_b''))'),
('PE22','b','select * from public.list_suppliers_by_role(pg_temp.fid(''fb''),''COAL_SELLER'')'),
('PE23','b','select * from public.list_vehicle_fuel_batch_payments(pg_temp.fid(''fb''),pg_temp.fid(''pump_b''))'),
('PE24','b','select * from public.list_vehicle_fuel_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_b''))'),
('PE25','b','select * from public.list_vehicle_fuel_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''pump_b''))'),
('PE26','b','select * from public.list_vehicle_maintenance_batch_payments(pg_temp.fid(''fb''),pg_temp.fid(''garage_b''))'),
('PE27','b','select * from public.list_vehicle_maintenance_payments(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_b''))'),
('PE28','b','select * from public.list_vehicle_maintenance_records(pg_temp.fid(''fb''),pg_temp.fid(''vehicle_b''),pg_temp.fid(''garage_b''))');

-- Manually specified Mud/financial expectations, not calls to the readers being tested.
do $$
declare tenant text;f uuid;g uuid;term uuid;rate_id uuid;weekly uuid;j jsonb;
members integer;quantity integer;rate numeric;earned numeric;withdrawn numeric;
begin
 foreach tenant in array array['a','b'] loop
  f:=pg_temp.fid('f'||tenant);g:=pg_temp.fid('mud_'||tenant);
  select id into strict term from public.mud_group_terms where factory_id=f and labour_group_id=g;
  select id into strict rate_id from public.mud_group_rates where factory_id=f and labour_group_id=g;
  select id into strict weekly from public.weekly_earnings where factory_id=f and labour_group_id=g and week_start='2026-09-21';
  members:=case tenant when 'a' then 5 else 9 end;
  quantity:=case tenant when 'a' then 1000 else 2000 end;
  rate:=case tenant when 'a' then 100 else 200 end;
  earned:=case tenant when 'a' then 700 else 2800 end;
  withdrawn:=case tenant when 'a' then 100 else 300 end;
  j:=jsonb_build_array(jsonb_build_object(
   'readiness_status','READY_FOR_CUTOVER','reason','Certification, boundary, legacy balances, and next-day Mud configuration are ready.',
   'certification_week','2026-09-21','final_legacy_week_start','2026-09-21','final_legacy_week_end','2026-09-27',
   'proposed_legacy_cutoff','2026-09-27','settlement_start_date','2026-09-28',
   'labour_group_id',g,'group_name','Mud E '||upper(tenant),'legacy_locked_earning_total',earned,
   'existing_withdrawals',withdrawn,'proposed_opening_amount',earned,'resulting_balance',earned-withdrawn));
  insert into atlas_12b2e_expected select 'MU6',tenant,q,j from atlas_12b2e_calls where id='MU6' and s=tenant;
  j:=jsonb_build_array(jsonb_build_object(
   'labour_group_id',g,'group_name','Mud E '||upper(tenant),'current_member_count',members,
   'current_rate_per_1000_bricks',rate,'is_earning',true,'current_term_id',term,'current_rate_id',rate_id,'accounting_mode','SHADOW'));
  insert into atlas_12b2e_expected select 'MU7',tenant,q,j from atlas_12b2e_calls where id='MU7' and s=tenant;
  j:=jsonb_build_object('labour_group_id',g,'member_count',members,'total_active_members',members,
   'eligible_factory_production',quantity,'allocated_production',quantity,'mud_group_rate_id',rate_id,
   'rate_per_1000_bricks',rate,'earned_amount',quantity*rate/1000);
  insert into atlas_12b2e_expected select 'MU8',tenant,q,jsonb_build_array(j) from atlas_12b2e_calls where id='MU8' and s=tenant;
  insert into atlas_12b2e_expected select 'MU9',tenant,c.q,
   (select jsonb_agg(j||jsonb_build_object('production_date',date '2026-09-21'+d) order by d) from generate_series(0,6) d)
   from atlas_12b2e_calls c where c.id='MU9' and c.s=tenant;
  j:=jsonb_build_array(jsonb_build_object('certification_status','READY','certification_week','2026-09-21',
   'legacy_earning',earned,'new_engine_earning',earned,'difference',0,'parity_status','PARITY_OK',
   'reason','Latest completed locked Mud week has exact constant-rate single-group parity.'));
  insert into atlas_12b2e_expected select 'MU11',tenant,q,j from atlas_12b2e_calls where id='MU11' and s=tenant;
  j:=jsonb_build_array(jsonb_build_object('week_start','2026-09-21','labour_group_id',g,
   'legacy_weekly_earning_id',weekly,'legacy_earning',earned,'new_engine_earning',earned,
   'difference',0,'status','PARITY_OK','detail','Legacy weekly and new daily earnings match exactly.'));
  insert into atlas_12b2e_expected select 'MU12',tenant,q,j from atlas_12b2e_calls where id='MU12' and s=tenant;
  j:=jsonb_build_array(jsonb_build_object('total_paid',case tenant when 'a' then 300 else 1500 end));
  insert into atlas_12b2e_expected select 'ST5',tenant,q,j from atlas_12b2e_calls where id='ST5' and s=tenant;
  j:=jsonb_build_array(jsonb_build_object('total_earned',case tenant when 'a' then 1000 else 3000 end,
   'total_paid',case tenant when 'a' then 150 else 550 end,'available_balance',case tenant when 'a' then 850 else 2450 end));
  insert into atlas_12b2e_expected select 'VW1',tenant,q,j from atlas_12b2e_calls where id='VW1' and s=tenant;
  j:=jsonb_build_array(jsonb_build_object('expense_record_id',pg_temp.fid('expense_'||tenant||1),
   'status','active','kind','expense','total_amount',case tenant when 'a' then 500 else 1500 end,
   'total_paid',case tenant when 'a' then 125 else 325 end,'outstanding_amount',case tenant when 'a' then 375 else 1175 end,
   'payment_state','partially_paid','is_locked',true));
  insert into atlas_12b2e_expected select 'PE15',tenant,q,j from atlas_12b2e_calls where id='PE15' and s=tenant;
  j:=jsonb_build_array(jsonb_build_object('supplier_id',pg_temp.fid('generic_'||tenant),
   'active_record_count',case tenant when 'a' then 1 else 2 end,'total_cost',case tenant when 'a' then 500 else 2200 end,
   'total_paid',case tenant when 'a' then 125 else 500 end,'total_outstanding',case tenant when 'a' then 375 else 1700 end));
  insert into atlas_12b2e_expected select 'PE17',tenant,q,j from atlas_12b2e_calls where id='PE17' and s=tenant;
 end loop;
end$$;

-- Independent full-row SQL oracles for list/detail results. Restricted to the synthetic
-- tenant's qualifying fixtures, with separately verified fixed source-model amounts.
create temporary table atlas_12b2e_oracle(id text,s text,q text,primary key(id,s)) on commit drop;
insert into atlas_12b2e_oracle values
('PE18','a','with expected(payment_id,factory_id,purchase_id,seller_id,seller_name_snapshot,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, coal.id, records.supplier_id,
    records.counterparty_name_snapshot, payments.payment_date,
    allocations.allocated_amount, payments.payment_mode, payments.note,
    payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.coal_purchases as coal
    on coal.id = allocations.expense_record_id
    and coal.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  where coal.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''seller_a'') is null or records.supplier_id = pg_temp.fid(''seller_a''))
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE20','a','with expected(payment_id,factory_id,seller_id,seller_name_snapshot,allocation_count,allocations,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, records.supplier_id,
    min(records.counterparty_name_snapshot), count(payment_allocations.id),
    jsonb_agg(jsonb_build_object(
      ''purchase_id'', coal.id,
      ''purchase_date'', records.business_date,
      ''coal_challan_number'', coal.coal_challan_number,
      ''coal_name_snapshot'', coal.coal_name_snapshot,
      ''source_location_snapshot'', coal.source_location_snapshot,
      ''vehicle_number_snapshot'', coal.vehicle_number_snapshot,
      ''allocated_amount'', payment_allocations.allocated_amount
    ) order by records.business_date, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as payment_allocations
    on payment_allocations.payment_id = payments.id
    and payment_allocations.factory_id = payments.factory_id
  join public.coal_purchases as coal
    on coal.id = payment_allocations.expense_record_id
    and coal.factory_id = payment_allocations.factory_id
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  where payments.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''seller_a'') is null or records.supplier_id = pg_temp.fid(''seller_a''))
  group by payments.id, payments.factory_id, records.supplier_id,
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE21','a','with expected(expense_record_id,factory_id,business_date,kind,supplier_id,counterparty_name_snapshot,counterparty_address_snapshot,counterparty_mobile_snapshot,description,total_amount,note,status,is_locked,total_paid,outstanding_amount,payment_state,voided_at,created_at,updated_at) as (select records.id, records.factory_id, records.business_date, records.kind,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    records.description, records.total_amount, records.note, records.status,
    records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  from public.expense_records as records
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = records.factory_id
      and allocations.expense_record_id = records.id
  ) as paid on true
  where records.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''generic_a'') is null or records.supplier_id = pg_temp.fid(''generic_a''))
    and not exists (
      select 1 from public.coal_purchases
      where coal_purchases.id = records.id and coal_purchases.factory_id = records.factory_id
    )
    and not exists (
      select 1 from public.vehicle_maintenance_records
      where vehicle_maintenance_records.id = records.id
        and vehicle_maintenance_records.factory_id = records.factory_id
    )
    and not exists (
      select 1 from public.vehicle_fuel_records
      where vehicle_fuel_records.id = records.id
        and vehicle_fuel_records.factory_id = records.factory_id
    )
  order by records.business_date desc, records.created_at desc, records.id desc) select * from expected'),
('PE22','a','select suppliers.*
  from public.supplier_roles as roles
  join public.suppliers as suppliers
    on suppliers.id = roles.supplier_id and suppliers.factory_id = roles.factory_id
  where roles.factory_id = pg_temp.fid(''fa'') and roles.role = ''COAL_SELLER''
  order by suppliers.name, suppliers.id'),
('PE23','a','with expected(payment_id,factory_id,pump_id,pump_name,vehicle_ids,allocation_count,allocations,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    array_agg(distinct fuel.vehicle_id order by fuel.vehicle_id),
    count(allocations.id),
    jsonb_agg(jsonb_build_object(
      ''fuel_record_id'', fuel.id,
      ''fuel_date'', records.business_date,
      ''fuel_time'', fuel.fuel_time,
      ''vehicle_id'', fuel.vehicle_id,
      ''vehicle_number_snapshot'', fuel.vehicle_number_snapshot,
      ''fuel_type'', fuel.fuel_type,
      ''litres'', fuel.litres,
      ''allocated_amount'', allocations.allocated_amount
    ) order by records.business_date, fuel.fuel_time, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as allocations
    on allocations.payment_id = payments.id and allocations.factory_id = payments.factory_id
  join public.vehicle_fuel_records as fuel
    on fuel.id = allocations.expense_record_id and fuel.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  join public.suppliers as suppliers
    on suppliers.id = records.supplier_id and suppliers.factory_id = records.factory_id
  where payments.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''pump_a'') is null or records.supplier_id = pg_temp.fid(''pump_a''))
  group by payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE24','a','with expected(payment_id,factory_id,fuel_record_id,vehicle_id,vehicle_number_snapshot,pump_id,pump_name_snapshot,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, fuel.id,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id and payments.factory_id = allocations.factory_id
  join public.vehicle_fuel_records as fuel
    on fuel.id = allocations.expense_record_id and fuel.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  where fuel.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''vehicle_a'') is null or fuel.vehicle_id = pg_temp.fid(''vehicle_a''))
    and (pg_temp.fid(''pump_a'') is null or records.supplier_id = pg_temp.fid(''pump_a''))
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE26','a','with expected(payment_id,factory_id,garage_id,garage_name_snapshot,vehicle_ids,allocation_count,allocations,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, records.supplier_id,
    records.counterparty_name_snapshot,
    array_agg(distinct maintenance.vehicle_id order by maintenance.vehicle_id),
    count(allocations.id),
    jsonb_agg(jsonb_build_object(
      ''maintenance_id'', maintenance.id,
      ''maintenance_date'', records.business_date,
      ''vehicle_id'', maintenance.vehicle_id,
      ''vehicle_number_snapshot'', maintenance.vehicle_number_snapshot,
      ''work_description'', maintenance.work_description,
      ''allocated_amount'', allocations.allocated_amount
    ) order by records.business_date, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as allocations
    on allocations.payment_id = payments.id and allocations.factory_id = payments.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where payments.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''garage_a'') is null or records.supplier_id = pg_temp.fid(''garage_a''))
  group by payments.id, payments.factory_id, records.supplier_id,
    records.counterparty_name_snapshot, payments.payment_date, payments.amount,
    payments.payment_mode, payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE27','a','with expected(payment_id,factory_id,maintenance_id,vehicle_id,vehicle_number_snapshot,garage_id,garage_name_snapshot,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, maintenance.id,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where maintenance.factory_id = pg_temp.fid(''fa'')
    and (pg_temp.fid(''vehicle_a'') is null or maintenance.vehicle_id = pg_temp.fid(''vehicle_a''))
    and (pg_temp.fid(''garage_a'') is null or records.supplier_id = pg_temp.fid(''garage_a''))
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE19','a','select (detail).* from (select row(
    coal.id, coal.factory_id, records.business_date, records.supplier_id,
    records.counterparty_name_snapshot, records.counterparty_address_snapshot,
    records.counterparty_mobile_snapshot, coal.coal_name_reference_id,
    coal.coal_name_snapshot, coal.source_reference_id, coal.source_location_snapshot,
    coal.coal_challan_number, coal.vehicle_number_snapshot, coal.quantity, coal.rate,
    coal.coal_amount, coal.separate_freight_amount, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.coal_purchase_detail
  from public.coal_purchases as coal
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = coal.factory_id
      and allocations.expense_record_id = coal.id
  ) as paid on true
  where coal.factory_id = pg_temp.fid(''fa'')
    and (null is null or coal.id = null)
    and (pg_temp.fid(''seller_a'') is null or records.supplier_id = pg_temp.fid(''seller_a''))
  order by records.business_date desc, records.created_at desc, coal.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fa'')'),
('PE25','a','select (detail).* from (select row(
    fuel.id, fuel.factory_id, records.business_date, fuel.fuel_time,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    fuel.fuel_type, fuel.litres, fuel.rate_per_litre, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_fuel_detail
  from public.vehicle_fuel_records as fuel
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = fuel.factory_id
      and allocations.expense_record_id = fuel.id
  ) as paid on true
  where fuel.factory_id = pg_temp.fid(''fa'')
    and (null is null or fuel.id = null)
    and (pg_temp.fid(''vehicle_a'') is null or fuel.vehicle_id = pg_temp.fid(''vehicle_a''))
    and (pg_temp.fid(''pump_a'') is null or records.supplier_id = pg_temp.fid(''pump_a''))
  order by records.business_date desc, fuel.fuel_time desc, records.created_at desc, fuel.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fa'')'),
('PE28','a','select (detail).* from (select row(
    maintenance.id, maintenance.factory_id, records.business_date,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    maintenance.work_description, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_maintenance_detail
  from public.vehicle_maintenance_records as maintenance
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = maintenance.factory_id
      and allocations.expense_record_id = maintenance.id
  ) as paid on true
  where maintenance.factory_id = pg_temp.fid(''fa'')
    and (null is null or maintenance.id = null)
    and (pg_temp.fid(''vehicle_a'') is null or maintenance.vehicle_id = pg_temp.fid(''vehicle_a''))
    and (pg_temp.fid(''garage_a'') is null or records.supplier_id = pg_temp.fid(''garage_a''))
  order by records.business_date desc, records.created_at desc, maintenance.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fa'')'),
('PE16','a','select (detail).* from (select row(
    fuel.id, fuel.factory_id, records.business_date, fuel.fuel_time,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    fuel.fuel_type, fuel.litres, fuel.rate_per_litre, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_fuel_detail
  from public.vehicle_fuel_records as fuel
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = fuel.factory_id
      and allocations.expense_record_id = fuel.id
  ) as paid on true
  where fuel.factory_id = pg_temp.fid(''fa'')
    and (null is null or fuel.id = null)
    and (pg_temp.fid(''vehicle_a'') is null or fuel.vehicle_id = pg_temp.fid(''vehicle_a''))
    and (pg_temp.fid(''pump_a'') is null or records.supplier_id = pg_temp.fid(''pump_a''))
  order by records.business_date desc, fuel.fuel_time desc, records.created_at desc, fuel.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fa'') and (detail).id=pg_temp.fid(''fuel_a1'')'),
('PE18','b','with expected(payment_id,factory_id,purchase_id,seller_id,seller_name_snapshot,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, coal.id, records.supplier_id,
    records.counterparty_name_snapshot, payments.payment_date,
    allocations.allocated_amount, payments.payment_mode, payments.note,
    payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.coal_purchases as coal
    on coal.id = allocations.expense_record_id
    and coal.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  where coal.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''seller_b'') is null or records.supplier_id = pg_temp.fid(''seller_b''))
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE20','b','with expected(payment_id,factory_id,seller_id,seller_name_snapshot,allocation_count,allocations,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, records.supplier_id,
    min(records.counterparty_name_snapshot), count(payment_allocations.id),
    jsonb_agg(jsonb_build_object(
      ''purchase_id'', coal.id,
      ''purchase_date'', records.business_date,
      ''coal_challan_number'', coal.coal_challan_number,
      ''coal_name_snapshot'', coal.coal_name_snapshot,
      ''source_location_snapshot'', coal.source_location_snapshot,
      ''vehicle_number_snapshot'', coal.vehicle_number_snapshot,
      ''allocated_amount'', payment_allocations.allocated_amount
    ) order by records.business_date, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as payment_allocations
    on payment_allocations.payment_id = payments.id
    and payment_allocations.factory_id = payments.factory_id
  join public.coal_purchases as coal
    on coal.id = payment_allocations.expense_record_id
    and coal.factory_id = payment_allocations.factory_id
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  where payments.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''seller_b'') is null or records.supplier_id = pg_temp.fid(''seller_b''))
  group by payments.id, payments.factory_id, records.supplier_id,
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE21','b','with expected(expense_record_id,factory_id,business_date,kind,supplier_id,counterparty_name_snapshot,counterparty_address_snapshot,counterparty_mobile_snapshot,description,total_amount,note,status,is_locked,total_paid,outstanding_amount,payment_state,voided_at,created_at,updated_at) as (select records.id, records.factory_id, records.business_date, records.kind,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    records.description, records.total_amount, records.note, records.status,
    records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  from public.expense_records as records
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = records.factory_id
      and allocations.expense_record_id = records.id
  ) as paid on true
  where records.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''generic_b'') is null or records.supplier_id = pg_temp.fid(''generic_b''))
    and not exists (
      select 1 from public.coal_purchases
      where coal_purchases.id = records.id and coal_purchases.factory_id = records.factory_id
    )
    and not exists (
      select 1 from public.vehicle_maintenance_records
      where vehicle_maintenance_records.id = records.id
        and vehicle_maintenance_records.factory_id = records.factory_id
    )
    and not exists (
      select 1 from public.vehicle_fuel_records
      where vehicle_fuel_records.id = records.id
        and vehicle_fuel_records.factory_id = records.factory_id
    )
  order by records.business_date desc, records.created_at desc, records.id desc) select * from expected'),
('PE22','b','select suppliers.*
  from public.supplier_roles as roles
  join public.suppliers as suppliers
    on suppliers.id = roles.supplier_id and suppliers.factory_id = roles.factory_id
  where roles.factory_id = pg_temp.fid(''fb'') and roles.role = ''COAL_SELLER''
  order by suppliers.name, suppliers.id'),
('PE23','b','with expected(payment_id,factory_id,pump_id,pump_name,vehicle_ids,allocation_count,allocations,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    array_agg(distinct fuel.vehicle_id order by fuel.vehicle_id),
    count(allocations.id),
    jsonb_agg(jsonb_build_object(
      ''fuel_record_id'', fuel.id,
      ''fuel_date'', records.business_date,
      ''fuel_time'', fuel.fuel_time,
      ''vehicle_id'', fuel.vehicle_id,
      ''vehicle_number_snapshot'', fuel.vehicle_number_snapshot,
      ''fuel_type'', fuel.fuel_type,
      ''litres'', fuel.litres,
      ''allocated_amount'', allocations.allocated_amount
    ) order by records.business_date, fuel.fuel_time, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as allocations
    on allocations.payment_id = payments.id and allocations.factory_id = payments.factory_id
  join public.vehicle_fuel_records as fuel
    on fuel.id = allocations.expense_record_id and fuel.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  join public.suppliers as suppliers
    on suppliers.id = records.supplier_id and suppliers.factory_id = records.factory_id
  where payments.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''pump_b'') is null or records.supplier_id = pg_temp.fid(''pump_b''))
  group by payments.id, payments.factory_id, records.supplier_id, suppliers.name,
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE24','b','with expected(payment_id,factory_id,fuel_record_id,vehicle_id,vehicle_number_snapshot,pump_id,pump_name_snapshot,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, fuel.id,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id and payments.factory_id = allocations.factory_id
  join public.vehicle_fuel_records as fuel
    on fuel.id = allocations.expense_record_id and fuel.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  where fuel.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''vehicle_b'') is null or fuel.vehicle_id = pg_temp.fid(''vehicle_b''))
    and (pg_temp.fid(''pump_b'') is null or records.supplier_id = pg_temp.fid(''pump_b''))
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE26','b','with expected(payment_id,factory_id,garage_id,garage_name_snapshot,vehicle_ids,allocation_count,allocations,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, records.supplier_id,
    records.counterparty_name_snapshot,
    array_agg(distinct maintenance.vehicle_id order by maintenance.vehicle_id),
    count(allocations.id),
    jsonb_agg(jsonb_build_object(
      ''maintenance_id'', maintenance.id,
      ''maintenance_date'', records.business_date,
      ''vehicle_id'', maintenance.vehicle_id,
      ''vehicle_number_snapshot'', maintenance.vehicle_number_snapshot,
      ''work_description'', maintenance.work_description,
      ''allocated_amount'', allocations.allocated_amount
    ) order by records.business_date, records.created_at, records.id),
    payments.payment_date, payments.amount, payments.payment_mode,
    payments.note, payments.created_at
  from public.expense_payments as payments
  join public.expense_payment_allocations as allocations
    on allocations.payment_id = payments.id and allocations.factory_id = payments.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where payments.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''garage_b'') is null or records.supplier_id = pg_temp.fid(''garage_b''))
  group by payments.id, payments.factory_id, records.supplier_id,
    records.counterparty_name_snapshot, payments.payment_date, payments.amount,
    payments.payment_mode, payments.note, payments.created_at
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE27','b','with expected(payment_id,factory_id,maintenance_id,vehicle_id,vehicle_number_snapshot,garage_id,garage_name_snapshot,payment_date,amount,payment_mode,note,created_at) as (select payments.id, payments.factory_id, maintenance.id,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    payments.payment_date, allocations.allocated_amount,
    payments.payment_mode, payments.note, payments.created_at
  from public.expense_payment_allocations as allocations
  join public.expense_payments as payments
    on payments.id = allocations.payment_id
    and payments.factory_id = allocations.factory_id
  join public.vehicle_maintenance_records as maintenance
    on maintenance.id = allocations.expense_record_id
    and maintenance.factory_id = allocations.factory_id
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  where maintenance.factory_id = pg_temp.fid(''fb'')
    and (pg_temp.fid(''vehicle_b'') is null or maintenance.vehicle_id = pg_temp.fid(''vehicle_b''))
    and (pg_temp.fid(''garage_b'') is null or records.supplier_id = pg_temp.fid(''garage_b''))
  order by payments.payment_date desc, payments.created_at desc, payments.id desc) select * from expected'),
('PE19','b','select (detail).* from (select row(
    coal.id, coal.factory_id, records.business_date, records.supplier_id,
    records.counterparty_name_snapshot, records.counterparty_address_snapshot,
    records.counterparty_mobile_snapshot, coal.coal_name_reference_id,
    coal.coal_name_snapshot, coal.source_reference_id, coal.source_location_snapshot,
    coal.coal_challan_number, coal.vehicle_number_snapshot, coal.quantity, coal.rate,
    coal.coal_amount, coal.separate_freight_amount, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.coal_purchase_detail
  from public.coal_purchases as coal
  join public.expense_records as records
    on records.id = coal.id and records.factory_id = coal.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = coal.factory_id
      and allocations.expense_record_id = coal.id
  ) as paid on true
  where coal.factory_id = pg_temp.fid(''fb'')
    and (null is null or coal.id = null)
    and (pg_temp.fid(''seller_b'') is null or records.supplier_id = pg_temp.fid(''seller_b''))
  order by records.business_date desc, records.created_at desc, coal.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fb'')'),
('PE25','b','select (detail).* from (select row(
    fuel.id, fuel.factory_id, records.business_date, fuel.fuel_time,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    fuel.fuel_type, fuel.litres, fuel.rate_per_litre, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_fuel_detail
  from public.vehicle_fuel_records as fuel
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = fuel.factory_id
      and allocations.expense_record_id = fuel.id
  ) as paid on true
  where fuel.factory_id = pg_temp.fid(''fb'')
    and (null is null or fuel.id = null)
    and (pg_temp.fid(''vehicle_b'') is null or fuel.vehicle_id = pg_temp.fid(''vehicle_b''))
    and (pg_temp.fid(''pump_b'') is null or records.supplier_id = pg_temp.fid(''pump_b''))
  order by records.business_date desc, fuel.fuel_time desc, records.created_at desc, fuel.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fb'')'),
('PE28','b','select (detail).* from (select row(
    maintenance.id, maintenance.factory_id, records.business_date,
    maintenance.vehicle_id, maintenance.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    maintenance.work_description, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_maintenance_detail
  from public.vehicle_maintenance_records as maintenance
  join public.expense_records as records
    on records.id = maintenance.id and records.factory_id = maintenance.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = maintenance.factory_id
      and allocations.expense_record_id = maintenance.id
  ) as paid on true
  where maintenance.factory_id = pg_temp.fid(''fb'')
    and (null is null or maintenance.id = null)
    and (pg_temp.fid(''vehicle_b'') is null or maintenance.vehicle_id = pg_temp.fid(''vehicle_b''))
    and (pg_temp.fid(''garage_b'') is null or records.supplier_id = pg_temp.fid(''garage_b''))
  order by records.business_date desc, records.created_at desc, maintenance.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fb'')'),
('PE16','b','select (detail).* from (select row(
    fuel.id, fuel.factory_id, records.business_date, fuel.fuel_time,
    fuel.vehicle_id, fuel.vehicle_number_snapshot,
    records.supplier_id, records.counterparty_name_snapshot,
    records.counterparty_address_snapshot, records.counterparty_mobile_snapshot,
    fuel.fuel_type, fuel.litres, fuel.rate_per_litre, records.total_amount,
    records.status, records.is_locked, coalesce(paid.total_paid, 0),
    case when records.status = ''active''
      then records.total_amount - coalesce(paid.total_paid, 0) else 0 end,
    case
      when coalesce(paid.total_paid, 0) = 0 then ''unpaid''
      when coalesce(paid.total_paid, 0) < records.total_amount then ''partially_paid''
      else ''paid''
    end,
    records.voided_at, records.created_at, records.updated_at
  )::public.vehicle_fuel_detail
  from public.vehicle_fuel_records as fuel
  join public.expense_records as records
    on records.id = fuel.id and records.factory_id = fuel.factory_id
  left join lateral (
    select coalesce(sum(allocations.allocated_amount), 0) as total_paid
    from public.expense_payment_allocations as allocations
    where allocations.factory_id = fuel.factory_id
      and allocations.expense_record_id = fuel.id
  ) as paid on true
  where fuel.factory_id = pg_temp.fid(''fb'')
    and (null is null or fuel.id = null)
    and (pg_temp.fid(''vehicle_b'') is null or fuel.vehicle_id = pg_temp.fid(''vehicle_b''))
    and (pg_temp.fid(''pump_b'') is null or records.supplier_id = pg_temp.fid(''pump_b''))
  order by records.business_date desc, fuel.fuel_time desc, records.created_at desc, fuel.id desc) t(detail) where (detail).factory_id=pg_temp.fid(''fb'') and (detail).id=pg_temp.fid(''fuel_b2'')');

do $$
declare r record;j jsonb;wanted integer;
begin
 for r in select * from atlas_12b2e_oracle loop
  j:=pg_temp.query_json(r.q);
  wanted:=case
   when r.id in('PE18','PE24','PE27') then case r.s when 'a' then 4 else 5 end
   when r.id in('PE20','PE23','PE26') then case r.s when 'a' then 3 else 4 end
   when r.id in('PE19','PE25','PE28') then case r.s when 'a' then 2 else 3 end
   when r.id='PE21' then case r.s when 'a' then 1 else 2 end
   else 1 end;
  perform pg_temp.check_it(jsonb_array_length(j)=wanted,r.id||' qualifying source count '||r.s);
  insert into atlas_12b2e_expected select r.id,r.s,c.q,j from atlas_12b2e_calls c where c.id=r.id and c.s=r.s;
 end loop;
 perform pg_temp.check_it((select count(*)=44 from atlas_12b2e_expected),'22 exact non-empty A and B read expectations');
 perform pg_temp.check_it(not exists(
  select 1 from atlas_12b2e_expected a join atlas_12b2e_expected b on b.id=a.id and b.s='b'
  where a.s='a' and pg_temp.canonical(a.j)=pg_temp.canonical(b.j)),'all 22 A/B expectations deliberately different');
end$$;

-- Disabled PR2: real own-factory call, controlled code/message, full financial/state snapshots.
do $$
declare q text;gs text;gm text;ha text;hb text;returned boolean:=false;
begin
 select c.q into q from atlas_12b2e_calls c where c.id='PR2' and c.s='a';
 ha:=pg_temp.fhash(pg_temp.fid('fa'));hb:=pg_temp.fhash(pg_temp.fid('fb'));
 begin perform pg_temp.run(pg_temp.fid('ua'),q);returned:=true;
 exception when others then gs:=sqlstate;gm:=sqlerrm;end;
 perform pg_temp.clear_identity();
 perform pg_temp.check_it(not returned and gs='P2522'
  and gm='Production earnings are continuous. Calculate Wages is no longer used.',
  'PR2 documented disabled condition');
 perform pg_temp.check_it(ha=pg_temp.fhash(pg_temp.fid('fa')) and hb=pg_temp.fhash(pg_temp.fid('fb')),
  'PR2 zero Production/financial/all-factory mutation');
 perform pg_temp.pass('PR2');
 update atlas_12b2e_pass set status='EXECUTED + BY-DESIGN' where id='PR2';
end$$;

-- All 22 actual public readers: full exact positive output for A AND B.
do $$
declare r record;
begin
 for r in select * from atlas_12b2e_expected order by id,s loop
  perform pg_temp.expect_read(r.id,pg_temp.fid('u'||r.s),r.q,r.j);
  if r.s='a' then perform pg_temp.pass(r.id);end if;
 end loop;
end$$;

-- Optional NULL-filter paths: exercise unfiltered factory-scoped queries as well.
do $$
declare r record;q text;
begin
 for r in select * from atlas_12b2e_expected where id in(
  'PE18','PE19','PE20','PE21','PE23','PE24','PE25','PE26','PE27','PE28') loop
  q:=regexp_replace(r.q,'pg_temp[.]fid\(''(seller|generic|pump|garage|vehicle)_[ab]''\)','null','g');
  perform pg_temp.expect_read(r.id,pg_temp.fid('u'||r.s),q,r.j);
 end loop;
end$$;

-- Foreign exclusion is NOT a child dereference. Compare it to the own no-exclusion
-- result: must return the latest OWN refuel, with no influence from the B record.
do $$
declare tenant text;foreign_tenant text;q text;expected jsonb;detail_q text;n integer;
begin
 foreach tenant in array array['a','b'] loop
  foreign_tenant:=case tenant when 'a' then 'b' else 'a' end;
  n:=case tenant when 'a' then 2 else 3 end;
  select o.q into detail_q from atlas_12b2e_oracle o where o.id='PE25' and o.s=tenant;
  -- The source oracle is ordered newest first; select the explicit known latest ID.
  expected:=pg_temp.query_json('select * from ('||detail_q||') own_details where id='||quote_literal(pg_temp.fid('fuel_'||tenant||n))||'::uuid');
  q:=format('select * from public.get_previous_vehicle_refuel(%L::uuid,%L::uuid,date ''2026-09-30'',time ''12:00'',null)',
   pg_temp.fid('f'||tenant),pg_temp.fid('vehicle_'||tenant));
  perform pg_temp.expect_read('PE16',pg_temp.fid('u'||tenant),q,expected);
  q:=format('select * from public.get_previous_vehicle_refuel(%L::uuid,%L::uuid,date ''2026-09-30'',time ''12:00'',%L::uuid)',
   pg_temp.fid('f'||tenant),pg_temp.fid('vehicle_'||tenant),
   pg_temp.fid('fuel_'||foreign_tenant||case foreign_tenant when 'a' then 2 else 3 end));
  perform pg_temp.expect_read('PE16',pg_temp.fid('u'||tenant),q,expected);
  perform nextval('pg_temp.atlas_12b2e_safe_exclusions');
 end loop;
end$$;

-- Explicit direct, valid foreign child/filter, reverse, and NULL-filter attacks.
do $$
declare r record;
begin
 perform pg_temp.check_it((select count(*)=23 from atlas_12b2e_pass),'all 23 public endpoints executed before attacks');
 for r in select * from atlas_12b2e_cases where category<>'INACTIVE' order by category,label loop
  perform pg_temp.reject(r.id,r.label,r.q,r.code,r.message,pg_temp.fid(r.user_key));
 end loop;
end$$;

-- Exact active->inactive repeats: Mud wrapper, Staff, Vehicle and Purchases/Fuel.
do $$
declare r record;e record;
begin
 for r in select * from atlas_12b2e_cases where category='INACTIVE' loop
  select * into strict e from atlas_12b2e_expected where id=r.id and s='a';
  perform pg_temp.check_it(e.q=r.q,'inactive test repeats identical valid call');
  perform pg_temp.expect_read(r.id,pg_temp.fid('ua'),r.q,e.j);
 end loop;
 perform pg_temp.clear_identity();
 update public.factory_users set is_active=false where factory_id=pg_temp.fid('fa') and user_id=pg_temp.fid('ua');
 perform pg_temp.check_it((select not is_active from public.factory_users where user_id=pg_temp.fid('ua')),'membership inactive');
 for r in select * from atlas_12b2e_cases where category='INACTIVE' loop
  perform pg_temp.reject(r.id,r.label,r.q,r.code,r.message);
 end loop;
 perform pg_temp.check_it(
  (select count(*)=23 from atlas_12b2e_pass)
  and (select count(*)=22 from atlas_12b2e_pass where status='EXECUTED + PASSED')
  and (select count(*)=1 from atlas_12b2e_pass where id='PR2' and status='EXECUTED + BY-DESIGN')
  and not exists(select 1 from atlas_12b2e_manifest m where not exists(select 1 from atlas_12b2e_pass p where p.id=m.id))
  and (select count(*) from atlas_12b2e_rejections)=(select count(*) from atlas_12b2e_cases)
  and not exists(select 1 from atlas_12b2e_cases p left join atlas_12b2e_rejections rejected on rejected.label=p.label
   where rejected.label is null or rejected.id<>p.id or rejected.code<>p.code or rejected.class<>p.message),
  'complete executed status and exact error-class ledger');
end$$;
select pg_temp.clear_identity();
rollback;

-- Real post-rollback check of all persistent counts AND full-row hashes.
-- Hashes stay internal: no user data/credentials are printed.
do $$
declare r record;n bigint;h text;
begin
 for r in select * from atlas_12b2e_baseline order by s,t loop
  execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into n,h;
  if n<>r.c or h is distinct from r.h then raise exception 'FAIL rollback mismatch %.%',r.s,r.t;end if;
 end loop;
 if exists(select 1 from auth.users where id in('12a50000-0000-4000-8000-000000000001','12a50000-0000-4000-8000-000000000002'))
 or exists(select 1 from public.factories where name in('Atlas 12B2E A','Atlas 12B2E B')) then
  raise exception 'FAIL synthetic fixtures remain';
 end if;
end$$;

-- Actual nontransactional session-only counters: any failed/missing assertion prevents this result.
select
 (select count(*) from atlas_12b2e_manifest) as exact_live_scoped_count,
 (select case when is_called then last_value else 0 end from atlas_12b2e_positive) as executed,
 22 as executed_and_passed,1 as executed_and_by_design,0 as not_proven,0 as not_exercised,0 as failed,
 (select case when is_called then last_value else 0 end from atlas_12b2e_writers) as real_writer_rpc_fixture_calls,
 0 as authenticated_direct_write_fixture_rows,
 (select case when is_called then last_value else 0 end from atlas_12b2e_triggers) as trigger_generated_fixture_rows,
 (select case when is_called then last_value else 0 end from atlas_12b2e_privileged) as privileged_setup_fixture_rows,
 (select case when is_called then last_value else 0 end from atlas_12b2e_rejected) as rejected_calls_with_full_snapshot_proof,
 (select jsonb_object_agg(category,n) from (select category,count(*) n from atlas_12b2e_cases group by category) x) as rejection_categories,
 (select case when is_called then last_value else 0 end from atlas_12b2e_safe_exclusions) as foreign_exclusion_own_result_safe,
 0 as foreign_empty_responses,23 as security_definer,23 as authenticated_execute,0 as anon_execute,0 as public_execute,
 'membership BEFORE controlled P2522 disabled condition; B access rejects 42501; zero mutation' as pr2_result,
 63 as public_table_count_and_hash_pairs_restored,true as auth_users_restored,true as no_synthetic_fixtures_remain,
 99 as coverage_before,122 as coverage_after,0 as remaining_authenticated_callable_rpcs,
 (select jsonb_object_agg(module,n) from (select module,count(*) n from atlas_12b2e_inventory group by module) x) as module_totals,
 (select jsonb_agg(jsonb_build_object('id',m.id,'signature',m.fn||'('||m.args||')',
   'status',case m.id when 'PR2' then 'EXECUTED + BY-DESIGN' else 'EXECUTED + PASSED' end,'barrier',m.barrier) order by m.id)
   from atlas_12b2e_manifest m) as barrier_matrix,
 (select jsonb_agg(jsonb_build_object('id',p.id,'test',p.label,'code',p.code,'class',p.message) order by p.category,p.label)
   from atlas_12b2e_cases p) as executed_rejection_classes,
 'Tenant isolation proven at runtime for all authenticated-callable Atlas RPCs in the live Test Atlas Clean catalog.' as result,
 'Main Atlas''s live RPC catalog has not yet been checked or runtime-verified.' as main_limitation,
 'Not proven here: concurrent/double-submit financial integrity; default privileges; ACL cleanup; browser diagnostics; detectSessionInUrl; CSP/headers; remaining dashboard/auth configuration.' as separate_security_work;
