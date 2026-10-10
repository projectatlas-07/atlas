-- Atlas Security 12C2: Test-only ACL hardening, rollback-only runtime proof.
-- COMMIT below retains session-local TEMP baselines only. Every public probe and
-- synthetic Auth/business row is created after BEGIN and discarded by ROLLBACK.
-- No settings changes, existing-row cleanup, or persistent verifier helpers.
-- Pre-migration snapshots were read from Test Atlas Clean before migration 73.
create temporary table atlas_12c2_counts (
  schema_name text, table_name text, row_count bigint, row_hash text not null,
  primary key (schema_name, table_name)
) on commit preserve rows;
create temporary table atlas_12c2_rpc_manifest (
  name text, args text, primary key (name, args)
) on commit preserve rows;
insert into atlas_12c2_rpc_manifest values
  ('archive_soil_worker', 'p_factory_id uuid, p_soil_worker_id uuid'),
  ('archive_staff_worker', 'p_factory_id uuid, p_staff_worker_id uuid'),
  ('archive_vehicle', 'p_factory_id uuid, p_vehicle_id uuid'),
  ('assign_labourer_to_production_crew', 'p_factory_id uuid, p_labourer_id uuid, p_production_crew_id uuid, p_effective_from date'),
  ('calculate_mud_supply_wages', 'p_factory_id uuid, p_labour_group_id uuid, p_week_start date'),
  ('calculate_production_wages', 'p_factory_id uuid, p_week_start date'),
  ('calculate_transport_weekly_wages', 'p_factory_id uuid, p_week_start date'),
  ('create_brick_type', 'p_factory_id uuid, p_name text'),
  ('create_cash_book_manual_entry', 'p_factory_id uuid, p_entry_id uuid, p_business_date date, p_direction text, p_amount numeric, p_payment_mode text, p_party_details text, p_note text'),
  ('create_challan', 'p_factory_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb'),
  ('create_challan_with_received_payment', 'p_factory_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb, p_payment_date date, p_payment_amount numeric, p_payment_mode text'),
  ('create_coal_payment', 'p_factory_id uuid, p_purchase_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text'),
  ('create_coal_purchase', 'p_factory_id uuid, p_purchase_date date, p_seller_id uuid, p_coal_name_reference_id uuid, p_source_reference_id uuid, p_coal_challan_number text, p_vehicle_number text, p_quantity numeric, p_rate numeric, p_coal_amount numeric, p_separate_freight_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text'),
  ('create_coal_reference_value', 'p_factory_id uuid, p_kind text, p_display_value text'),
  ('create_coal_selective_payment', 'p_factory_id uuid, p_seller_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_payment_mode text, p_note text, p_allocations jsonb'),
  ('create_customer', 'p_factory_id uuid, p_name text, p_address text, p_mobile text'),
  ('create_customer_payment', 'p_factory_id uuid, p_customer_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text, p_allocations jsonb'),
  ('create_customer_payment_with_methods', 'p_factory_id uuid, p_customer_id uuid, p_payment_date date, p_amount numeric, p_payment_methods jsonb, p_note text, p_allocations jsonb'),
  ('create_expense_payment', 'p_factory_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text, p_allocations jsonb'),
  ('create_expense_record', 'p_factory_id uuid, p_business_date date, p_kind text, p_supplier_id uuid, p_counterparty_name text, p_description text, p_total_amount numeric, p_note text'),
  ('create_labour_group_withdrawal', 'p_factory_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_amount numeric'),
  ('create_labourer_production_wage_rate_override', 'p_factory_id uuid, p_labourer_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date'),
  ('create_labourer_withdrawal', 'p_factory_id uuid, p_labourer_id uuid, p_withdrawal_date date, p_amount numeric'),
  ('create_labourer_withdrawal', 'p_factory_id uuid, p_labourer_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric'),
  ('create_mud_group', 'p_factory_id uuid, p_name text, p_member_count integer, p_earning_start_date date, p_initial_rate numeric, p_rate_effective_date date'),
  ('create_mud_settlement_withdrawal', 'p_factory_id uuid, p_withdrawal_id uuid, p_labour_group_id uuid, p_withdrawal_date date, p_settlement_cutoff date, p_amount numeric'),
  ('create_or_assign_supplier_role', 'p_factory_id uuid, p_role text, p_name text, p_address text, p_mobile text'),
  ('create_production_crew_wage_rate', 'p_factory_id uuid, p_production_crew_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date'),
  ('create_soil_financial_adjustment', 'p_factory_id uuid, p_soil_worker_id uuid, p_adjustment_type text, p_adjustment_date date, p_amount numeric, p_reason text'),
  ('create_soil_payment', 'p_factory_id uuid, p_soil_worker_id uuid, p_payment_date date, p_amount numeric'),
  ('create_soil_worker_trolley_rate', 'p_factory_id uuid, p_soil_worker_id uuid, p_rate_per_trolley numeric, p_effective_from date'),
  ('create_soil_worker_with_initial_trolley_rate', 'p_factory_id uuid, p_name text, p_initial_rate_per_trolley numeric, p_initial_effective_from date'),
  ('create_staff_worker_with_reference_salary', 'p_factory_id uuid, p_name text, p_staff_category_id uuid, p_reference_salary numeric'),
  ('create_supplier', 'p_factory_id uuid, p_name text, p_address text, p_mobile text'),
  ('create_transport_crew_wage_rate', 'p_factory_id uuid, p_transport_crew_id uuid, p_effective_from date, p_rate_per_paya numeric'),
  ('create_transport_wage_credit', 'p_factory_id uuid, p_credit_id uuid, p_transport_worker_id uuid, p_original_work_date date, p_amount numeric, p_reason text'),
  ('create_transport_worker_withdrawal', 'p_factory_id uuid, p_transport_worker_id uuid, p_withdrawal_date date, p_amount numeric'),
  ('create_vehicle_fuel', 'p_factory_id uuid, p_fuel_date date, p_fuel_time time without time zone, p_vehicle_id uuid, p_pump_id uuid, p_fuel_type text, p_litres numeric, p_rate_per_litre numeric, p_fuel_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text'),
  ('create_vehicle_fuel_batch_payment', 'p_factory_id uuid, p_pump_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text'),
  ('create_vehicle_fuel_payment', 'p_factory_id uuid, p_fuel_record_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text'),
  ('create_vehicle_maintenance', 'p_factory_id uuid, p_maintenance_date date, p_vehicle_id uuid, p_garage_id uuid, p_work_description text, p_total_amount numeric, p_initial_paid_amount numeric, p_initial_payment_mode text'),
  ('create_vehicle_maintenance_batch_payment', 'p_factory_id uuid, p_garage_id uuid, p_from_date date, p_to_date date, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text'),
  ('create_vehicle_maintenance_payment', 'p_factory_id uuid, p_maintenance_id uuid, p_payment_date date, p_amount numeric, p_payment_mode text, p_note text'),
  ('create_wage_rate', 'p_factory_id uuid, p_applies_to text, p_rate_per_1000_bricks numeric, p_effective_from date'),
  ('delete_staff_category', 'p_factory_id uuid, p_staff_category_id uuid'),
  ('delete_staff_worker', 'p_factory_id uuid, p_staff_worker_id uuid'),
  ('delete_unused_brick_type', 'p_factory_id uuid, p_brick_type_id uuid'),
  ('delete_unused_soil_worker', 'p_factory_id uuid, p_soil_worker_id uuid'),
  ('end_labourer_production_crew_assignment', 'p_factory_id uuid, p_labourer_id uuid, p_effective_to date'),
  ('execute_mud_settlement_cutover', 'p_factory_id uuid, p_proposed_legacy_cutoff date'),
  ('find_or_create_vehicle', 'p_factory_id uuid, p_vehicle_number text, p_delivery_wage_tracking_enabled boolean'),
  ('get_cash_book_day_summary', 'p_factory_id uuid, p_business_date date'),
  ('get_challan_payment_state', 'p_factory_id uuid, p_challan_id uuid'),
  ('get_customer_sales_summary', 'p_factory_id uuid, p_customer_id uuid'),
  ('get_expense_record_payment_state', 'p_factory_id uuid, p_expense_record_id uuid'),
  ('get_mud_cutover_readiness', 'p_factory_id uuid'),
  ('get_mud_group_configuration', 'p_factory_id uuid, p_as_of_date date'),
  ('get_mud_group_daily_allocation', 'p_factory_id uuid, p_production_date date'),
  ('get_mud_group_range_allocation', 'p_factory_id uuid, p_from_date date, p_to_date date'),
  ('get_mud_group_settlement_account', 'p_factory_id uuid, p_labour_group_id uuid, p_as_of_date date'),
  ('get_mud_shadow_certification_status', 'p_factory_id uuid'),
  ('get_mud_shadow_weekly_comparisons', 'p_factory_id uuid, p_from_week_start date, p_to_week_start date'),
  ('get_previous_vehicle_refuel', 'p_factory_id uuid, p_vehicle_id uuid, p_before_date date, p_before_time time without time zone, p_exclude_fuel_record_id uuid'),
  ('get_production_labourer_account', 'p_factory_id uuid, p_labourer_id uuid, p_as_of_date date'),
  ('get_soil_financial_summary', 'p_factory_id uuid, p_soil_worker_id uuid'),
  ('get_soil_total_earned', 'p_factory_id uuid, p_soil_worker_id uuid'),
  ('get_staff_payment_summary', 'p_factory_id uuid, p_staff_worker_id uuid'),
  ('get_supplier_expense_summary', 'p_factory_id uuid, p_supplier_id uuid'),
  ('get_transport_worker_available_balance', 'p_factory_id uuid, p_transport_worker_id uuid, p_as_of_date date'),
  ('get_vehicle_wage_account_summary', 'p_factory_id uuid, p_vehicle_id uuid'),
  ('initialize_cash_book', 'p_factory_id uuid, p_start_date date, p_opening_balance numeric'),
  ('list_cash_book_day_entries', 'p_factory_id uuid, p_business_date date'),
  ('list_coal_payments', 'p_factory_id uuid, p_seller_id uuid'),
  ('list_coal_purchases', 'p_factory_id uuid, p_seller_id uuid'),
  ('list_coal_selective_payments', 'p_factory_id uuid, p_seller_id uuid'),
  ('list_expense_records', 'p_factory_id uuid, p_supplier_id uuid'),
  ('list_suppliers_by_role', 'p_factory_id uuid, p_role text'),
  ('list_vehicle_fuel_batch_payments', 'p_factory_id uuid, p_pump_id uuid'),
  ('list_vehicle_fuel_payments', 'p_factory_id uuid, p_vehicle_id uuid, p_pump_id uuid'),
  ('list_vehicle_fuel_records', 'p_factory_id uuid, p_vehicle_id uuid, p_pump_id uuid'),
  ('list_vehicle_maintenance_batch_payments', 'p_factory_id uuid, p_garage_id uuid'),
  ('list_vehicle_maintenance_payments', 'p_factory_id uuid, p_vehicle_id uuid, p_garage_id uuid'),
  ('list_vehicle_maintenance_records', 'p_factory_id uuid, p_vehicle_id uuid, p_garage_id uuid'),
  ('provision_first_factory', 'p_factory_name text'),
  ('record_staff_payment', 'p_factory_id uuid, p_staff_worker_id uuid, p_payment_date date, p_amount numeric, p_note text'),
  ('record_vehicle_wage_payment', 'p_factory_id uuid, p_vehicle_id uuid, p_payment_date date, p_amount numeric, p_note text'),
  ('rename_brick_type', 'p_factory_id uuid, p_brick_type_id uuid, p_name text'),
  ('resolve_factory_access', ''),
  ('resolve_soil_worker_trolley_rate', 'p_factory_id uuid, p_soil_worker_id uuid, p_work_date date'),
  ('restart_mud_group_earning', 'p_factory_id uuid, p_labour_group_id uuid, p_member_count integer, p_restart_date date'),
  ('restore_soil_worker', 'p_factory_id uuid, p_soil_worker_id uuid'),
  ('restore_staff_worker', 'p_factory_id uuid, p_staff_worker_id uuid'),
  ('restore_vehicle', 'p_factory_id uuid, p_vehicle_id uuid'),
  ('reverse_vehicle_wage_payment', 'p_factory_id uuid, p_payment_id uuid, p_reversal_date date, p_reason text'),
  ('save_production_entry', 'p_factory_id uuid, p_entry_id uuid, p_labourer_id uuid, p_production_date date, p_quantity integer'),
  ('save_soil_daily_trolley_entries', 'p_factory_id uuid, p_work_date date, p_entries jsonb'),
  ('save_transport_daily_entry', 'p_factory_id uuid, p_transport_crew_id uuid, p_work_date date, p_paya_quantity numeric, p_transport_worker_ids uuid[]'),
  ('set_brick_type_active', 'p_factory_id uuid, p_brick_type_id uuid, p_is_active boolean'),
  ('set_mud_group_member_count', 'p_factory_id uuid, p_labour_group_id uuid, p_member_count integer, p_effective_from date'),
  ('set_mud_group_rate', 'p_factory_id uuid, p_labour_group_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date'),
  ('set_mud_supply_rate', 'p_factory_id uuid, p_rate_per_1000_bricks numeric, p_effective_from date'),
  ('set_production_labourer_origin', 'p_factory_id uuid, p_labourer_id uuid, p_origin_label text'),
  ('set_production_labourer_rates', 'p_factory_id uuid, p_labourer_ids uuid[], p_rate_per_1000_bricks numeric, p_effective_from date'),
  ('set_vehicle_delivery_wage_tracking', 'p_factory_id uuid, p_vehicle_id uuid, p_enabled boolean'),
  ('stop_mud_group_earning', 'p_factory_id uuid, p_labour_group_id uuid, p_stop_date date'),
  ('transition_mud_accounting_mode', 'p_factory_id uuid, p_new_mode mud_accounting_mode'),
  ('update_challan', 'p_factory_id uuid, p_challan_id uuid, p_challan_number text, p_challan_date date, p_customer_id uuid, p_vehicle_id uuid, p_trip_labour_wage numeric, p_items jsonb, p_flexible_lines jsonb'),
  ('update_coal_purchase', 'p_factory_id uuid, p_purchase_id uuid, p_purchase_date date, p_seller_id uuid, p_coal_name_reference_id uuid, p_source_reference_id uuid, p_coal_challan_number text, p_vehicle_number text, p_quantity numeric, p_rate numeric, p_coal_amount numeric, p_separate_freight_amount numeric'),
  ('update_customer', 'p_factory_id uuid, p_customer_id uuid, p_name text, p_address text, p_mobile text'),
  ('update_expense_record', 'p_factory_id uuid, p_expense_record_id uuid, p_business_date date, p_kind text, p_supplier_id uuid, p_counterparty_name text, p_description text, p_total_amount numeric, p_note text'),
  ('update_factory_printable_profile', 'p_factory_id uuid, p_name text, p_business_description text, p_address text, p_mobile text'),
  ('update_factory_printable_profile', 'p_factory_id uuid, p_name text, p_business_description text, p_village text, p_post_office text, p_police_station text, p_district text, p_state text, p_mobile text, p_gstin text'),
  ('update_staff_category', 'p_factory_id uuid, p_staff_category_id uuid, p_name text'),
  ('update_staff_reference_salary', 'p_factory_id uuid, p_staff_worker_id uuid, p_reference_salary numeric'),
  ('update_supplier', 'p_factory_id uuid, p_supplier_id uuid, p_name text, p_address text, p_mobile text'),
  ('update_vehicle_fuel', 'p_factory_id uuid, p_fuel_record_id uuid, p_fuel_date date, p_fuel_time time without time zone, p_vehicle_id uuid, p_pump_id uuid, p_fuel_type text, p_litres numeric, p_rate_per_litre numeric, p_fuel_amount numeric'),
  ('update_vehicle_maintenance', 'p_factory_id uuid, p_maintenance_id uuid, p_maintenance_date date, p_vehicle_id uuid, p_garage_id uuid, p_work_description text, p_total_amount numeric'),
  ('void_cash_book_manual_entry', 'p_factory_id uuid, p_entry_id uuid'),
  ('void_challan', 'p_factory_id uuid, p_challan_id uuid'),
  ('void_coal_purchase', 'p_factory_id uuid, p_purchase_id uuid'),
  ('void_expense_record', 'p_factory_id uuid, p_expense_record_id uuid'),
  ('void_vehicle_fuel', 'p_factory_id uuid, p_fuel_record_id uuid'),
  ('void_vehicle_maintenance', 'p_factory_id uuid, p_maintenance_id uuid');

create function pg_temp.assert_hardening_catalog()
returns void language plpgsql set search_path = pg_catalog, public as $$
declare
  target record;
  actual_privileges text[];
  expected_privileges text[];
  exposed_count integer;
begin
  if current_user <> 'postgres' then
    raise exception 'FAIL: verifier creator must be postgres';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')) <> 64
    or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity) then
    raise exception 'FAIL: reviewed 64/64 public tables must retain RLS';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 87
    or (select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.tablename,x.policyname),'[]')::text)
        from pg_policies x where schemaname='public') <> '14896d5e31fb71f2516ff071500d6b65' then
    raise exception 'FAIL: reviewed 87 policies must match exactly';
  end if;
  if exists (
    select 1 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and n.nspname='public'
      and d.defaclobjtype in ('r','S','f')
      and a.grantee in ('anon'::regrole,'authenticated'::regrole)
  ) then
    raise exception 'FAIL: explicit postgres/public anon/authenticated defaults remain';
  end if;
  if (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.owner,x.schema,x.type,x.grantee,x.privilege),'[]')::text) hash FROM (SELECT pg_get_userbyid(d.defaclrole) owner,coalesce(n.nspname,'GLOBAL') schema,d.defaclobjtype type,coalesce(r.rolname,'PUBLIC') grantee,a.privilege_type privilege,a.is_grantable grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE NOT(d.defaclrole='postgres'::regrole AND n.nspname='public' AND d.defaclobjtype IN ('r','S','f') AND a.grantee IN ('anon'::regrole,'authenticated'::regrole))) x) <> '85815d76c23b5f0f8eddab323397d5d8' then
    raise exception 'FAIL: defaults fingerprint differs outside approved ACL changes';
  end if;
  if (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name,x.grantee,x.privilege),'[]')::text) hash FROM (SELECT c.relname name,pg_get_userbyid(c.relowner) owner,coalesce(r.rolname,'PUBLIC') grantee,a.privilege_type privilege,a.is_grantable grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT(c.relname IN ('factory_users','labourers','production_entries') AND a.grantee='anon'::regrole)) x) <> 'bbc4a2fcb2adb9375387b6af8913b40b' then
    raise exception 'FAIL: tables fingerprint differs outside approved ACL changes';
  end if;
  if (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name,x.args,x.grantee,x.privilege),'[]')::text) hash FROM (SELECT p.proname name,pg_get_function_identity_arguments(p.oid) args,coalesce(r.rolname,'PUBLIC') grantee,a.privilege_type privilege,a.is_grantable grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND NOT(p.proname IN ('audit_mud_accounting_state_transition','initialize_mud_accounting_state','prevent_staff_payment_mutation','prevent_staff_worker_reassignment','protect_mud_accounting_state_transition','reject_mud_settlement_mutation','reject_production_settlement_mutation','set_updated_at') AND p.pronargs=0 AND a.grantee IN (0,'anon'::regrole::oid))) x) <> 'e671fef3266580d354ef7025d4d40336' then
    raise exception 'FAIL: functions fingerprint differs outside approved ACL changes';
  end if;
  -- Original function-definition baseline was captured after migration 73.
  -- Migration 74 intentionally replaced exactly three withdrawal functions.
  -- Migration 75 intentionally replaced these independently reviewed Transport RPCs:
  -- calculate_transport_weekly_wages(uuid,date),
  -- save_transport_daily_entry(uuid,uuid,date,numeric,uuid[]),
  -- create_transport_crew_wage_rate(uuid,uuid,date,numeric).
  -- Migration 76 adds create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text),
  -- get_transport_worker_earning_events(uuid,uuid), prevent_transport_wage_credit_mutation();
  -- and replaces get_transport_worker_available_balance(uuid,uuid,date)
  -- and create_transport_worker_withdrawal(uuid,uuid,date,numeric).
  -- This fingerprint incorporates those authorized definitions.
  if (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name,x.args),'[]')::text) hash FROM (SELECT p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')) x) <> '65e05be07e09ef31557942509a227f44' then
    raise exception 'FAIL: definitions fingerprint differs outside approved ACL changes';
  end if;
  if (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.name),'[]')::text) hash FROM (SELECT c.relname table_name,t.tgname name,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) x) <> 'bcf2bb23de95a916e36f61e19e0da3ad' then
    raise exception 'FAIL: triggers fingerprint differs outside approved ACL changes';
  end if;

  -- Migration 76 ledger: SELECT only for active members; no direct financial writes.
  if not has_table_privilege('authenticated','public.transport_wage_credits','SELECT')
    or exists (select 1 from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) v
      where has_table_privilege('authenticated','public.transport_wage_credits',v))
    or exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) v
      where has_table_privilege('anon','public.transport_wage_credits',v))
    or exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid='public.transport_wage_credits'::regclass and a.grantee=0)
    or exists (select 1 from pg_attribute a where a.attrelid='public.transport_wage_credits'::regclass
      and a.attnum>0 and not a.attisdropped and a.attacl is not null) then
    raise exception 'FAIL: wage credit ledger ACL must be authenticated SELECT only, anon/PUBLIC none';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='transport_wage_credits')<>1
    or not exists (select 1 from pg_policies where schemaname='public' and tablename='transport_wage_credits'
      and policyname='Active members can read their factory Transport wage credits'
      and cmd='SELECT' and roles=array['authenticated']::name[]
      and qual like '%auth.uid()%'
      and qual like '%m.factory_id = transport_wage_credits.factory_id%'
      and qual like '%m.is_active = true%') then
    raise exception 'FAIL: wage credit active-member same-factory SELECT policy';
  end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where c.relnamespace='public'::regnamespace and not t.tgisinternal)<>71
    or not exists (select 1 from pg_trigger where tgrelid='public.transport_wage_credits'::regclass
      and tgname='transport_wage_credits_prevent_mutation' and not tgisinternal
      and tgenabled='O' and tgtype=58
      and tgfoid='public.prevent_transport_wage_credit_mutation()'::regprocedure) then
    raise exception 'FAIL: 71 public triggers and statement-level immutable wage credit trigger required';
  end if;
  for target in select p.* from pg_proc p where p.oid in (
    'public.get_transport_worker_earning_events(uuid,uuid)'::regprocedure,
    'public.prevent_transport_wage_credit_mutation()'::regprocedure) loop
    if target.prosecdef or target.proowner<>'postgres'::regrole
      or not coalesce(target.proconfig @> array['search_path=pg_catalog, public'],false)
      or has_function_privilege('authenticated',target.oid,'EXECUTE')
      or has_function_privilege('anon',target.oid,'EXECUTE')
      or not has_function_privilege('service_role',target.oid,'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(target.proacl,acldefault('f',target.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'FAIL: private wage credit helper/trigger permissions %',target.proname;
    end if;
  end loop;
  if not exists (select 1 from pg_proc p where p.oid=
      'public.create_transport_wage_credit(uuid,uuid,uuid,date,numeric,text)'::regprocedure
      and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig @> array['search_path=pg_catalog, public']
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')) then
    raise exception 'FAIL: wage credit RPC ownership/definer/search_path/grants';
  end if;
  raise notice 'PASS [EXECUTED]: credit ledger RLS/SELECT-only ACL, private helpers, immutable trigger and 71-trigger inventory';

  for target in select unnest(array['factory_users','labourers','production_entries']) name loop
    if exists (
      select 1 from aclexplode(coalesce(
        (select relacl from pg_class where oid=format('public.%I',target.name)::regclass),
        acldefault('r','postgres'::regrole))) a
      where a.grantee in (0,'anon'::regrole::oid)
    ) or exists (
      select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) v
      where has_table_privilege('anon',format('public.%I',target.name),v)
    ) or exists (
      select 1 from pg_attribute a where a.attrelid=format('public.%I',target.name)::regclass
        and a.attnum>0 and not a.attisdropped and a.attacl is not null
    ) then
      raise exception 'FAIL: anon privilege or unexpected column ACL on %',target.name;
    end if;
    select array_agg(a.privilege_type order by a.privilege_type) into actual_privileges
      from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid=format('public.%I',target.name)::regclass and a.grantee='authenticated'::regrole;
    expected_privileges := case target.name when 'production_entries'
      then array['MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE']
      else array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'] end;
    if actual_privileges is distinct from expected_privileges then
      raise exception 'FAIL: authenticated ACL changed on %',target.name;
    end if;
    raise notice 'PASS [EXECUTED]: % authenticated before=% after=%; anon privileges=0',
      target.name,expected_privileges,actual_privileges;
  end loop;

  for target in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.pronargs=0 and p.proname in ('audit_mud_accounting_state_transition','initialize_mud_accounting_state','prevent_staff_payment_mutation','prevent_staff_worker_reassignment','protect_mud_accounting_state_transition','reject_mud_settlement_mutation','reject_production_settlement_mutation','set_updated_at') loop
    if has_function_privilege('anon',target.oid,'EXECUTE')
      or not has_function_privilege('authenticated',target.oid,'EXECUTE')
      or not has_function_privilege('service_role',target.oid,'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(
        (select proacl from pg_proc where oid=target.oid),acldefault('f','postgres'::regrole))) a
        where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'FAIL: trigger ACL %',target.proname;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.pronargs=0 and p.proname in ('audit_mud_accounting_state_transition','initialize_mud_accounting_state','prevent_staff_payment_mutation','prevent_staff_worker_reassignment','protect_mud_accounting_state_transition','reject_mud_settlement_mutation','reject_production_settlement_mutation','set_updated_at')) <> 8 then
    raise exception 'FAIL: expected all eight exact trigger signatures';
  end if;

  if (select count(*) from atlas_12c2_rpc_manifest) <> 123
    or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      join atlas_12c2_rpc_manifest m on m.name=p.proname and m.args=pg_get_function_identity_arguments(p.oid)
      where n.nspname='public' and has_function_privilege('authenticated',p.oid,'EXECUTE')) <> 123
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      join atlas_12c2_rpc_manifest m on m.name=p.proname and m.args=pg_get_function_identity_arguments(p.oid)
      where n.nspname='public' and (has_function_privilege('anon',p.oid,'EXECUTE')
        or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.grantee=0 and a.privilege_type='EXECUTE'))) then
    raise exception 'FAIL: 123 exact authenticated RPC grants must remain secure';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prorettype<>'trigger'::regtype
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
        and d.objid=p.oid and d.deptype='e')) <> 123 then
    raise exception 'FAIL: authenticated Atlas RPC inventory drift';
  end if;
  raise notice 'PASS [EXECUTED]: 64/64 RLS, 87 identical policies, 123/123 RPC grants, exact scope fingerprints';
end;
$$;

do $$
declare r record; n bigint; h text;
begin
  for r in select 'public'::text s,c.relname::text t from pg_class c
      join pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname='public' and c.relkind in ('r','p')
      union all select 'auth','users' loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.s,r.t) into n,h;
    insert into atlas_12c2_counts values(r.s,r.t,n,h);
  end loop;
  if (select count(*) from atlas_12c2_counts)<>65 then raise exception 'FAIL: baseline counts';end if;
end;
$$;
commit;
begin;

-- Reusable exposure guard: catalog extension dependencies, not object owners.
-- All 194 existing non-extension public functions trace to tracked Atlas migrations.
-- New/unclassified non-extension functions are included, not silently exempted.
-- btree_gist members are excluded by pg_depend deptype=e. Allowlist is EMPTY:
-- no existing Atlas function has a legitimate unauthenticated execution need.
create temporary table atlas_12c2_function_allowlist (
  name text, args text, reason text not null, primary key(name,args)
) on commit drop;
select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) as explicit_function_exposure_allowlist
  from atlas_12c2_function_allowlist a;
create temporary view atlas_12c2_unexpected_exposure as
select p.proname name,pg_get_function_identity_arguments(p.oid) args,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_effective_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
    and d.objid=p.oid and d.deptype='e')
  and not exists(select 1 from atlas_12c2_function_allowlist a
    where a.name=p.proname and a.args=pg_get_function_identity_arguments(p.oid))
  and (has_function_privilege('anon',p.oid,'EXECUTE')
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'));
select count(*) as unexpected_exposure_count,
  coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) as unexpected_functions
from atlas_12c2_unexpected_exposure x;
do $$begin
  if exists(select 1 from atlas_12c2_unexpected_exposure) then
    raise exception 'FAIL: unexpected non-extension Atlas function anon/PUBLIC EXECUTE';
  end if;
  raise notice 'PASS [EXECUTED]: EMPTY exposure allowlist; unexpected function exposure count=0';
end;$$;
select pg_temp.assert_hardening_catalog();

create function pg_temp.expect_error(label text,statement text,expected_state text,expected_message text)
returns void language plpgsql as $$
declare got_state text;got_message text;blocked boolean:=false;
begin
  begin
    execute statement;
  exception when others then
    got_state:=sqlstate;got_message:=sqlerrm;blocked:=true;
  end;
  if not blocked or got_state is distinct from expected_state
    or (expected_message is not null and got_message is distinct from expected_message) then
    raise exception 'FAIL: % did not reach required protection (expected %, got %)',
      label,expected_state,got_state;
  end if;
  raise notice 'PASS [EXECUTED]: % rejected with expected %',label,got_state;
end;
$$;

-- Public probes must exercise public schema defaults, not TEMP object defaults.
do $$begin
  if to_regclass('public.atlas_12c2_probe_table') is not null
    or to_regclass('public.atlas_12c2_probe_sequence') is not null
    or to_regprocedure('public.atlas_12c2_probe_function()') is not null then
    raise exception 'FAIL: reserved probe name collision; never replace existing objects';
  end if;
  if current_user<>'postgres' then raise exception 'FAIL: probe creator role';end if;
end;$$;
create table public.atlas_12c2_probe_table(id integer);
create sequence public.atlas_12c2_probe_sequence;
create function public.atlas_12c2_probe_function() returns integer language sql as $$select 17$$;
do $$declare role_name text;v text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach v in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege(role_name,'public.atlas_12c2_probe_table',v) then
        raise exception 'FAIL: future table implicit privilege %/%',role_name,v;
      end if;
    end loop;
    foreach v in array array['SELECT','UPDATE','USAGE'] loop
      if has_sequence_privilege(role_name,'public.atlas_12c2_probe_sequence',v) then
        raise exception 'FAIL: future sequence implicit privilege %/%',role_name,v;
      end if;
    end loop;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid='public.atlas_12c2_probe_function()'::regprocedure
      and a.grantee in ('anon'::regrole,'authenticated'::regrole))
    or not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid='public.atlas_12c2_probe_function()'::regprocedure and a.grantee=0
      and a.privilege_type='EXECUTE')
    or not has_function_privilege('anon','public.atlas_12c2_probe_function()','EXECUTE') then
    raise exception 'FAIL: expected built-in PUBLIC EXECUTE, without explicit anon/authenticated defaults';
  end if;
  if not has_table_privilege('service_role','public.atlas_12c2_probe_table','SELECT')
    or not has_sequence_privilege('service_role','public.atlas_12c2_probe_sequence','USAGE')
    or not has_function_privilege('service_role','public.atlas_12c2_probe_function()','EXECUTE') then
    raise exception 'FAIL: service-role future defaults lost';
  end if;
  raise notice 'PASS [EXECUTED]: future table/sequence roles denied; built-in PUBLIC function EXECUTE remains';
  raise notice 'Future function default hardening is PARTIAL.';
end;$$;

set local role anon;
do $$begin
  if current_user<>'anon' or public.atlas_12c2_probe_function()<>17 then
    raise exception 'FAIL: before per-function REVOKE, anon must execute via PUBLIC';
  end if;
end;$$;
reset role;
-- Required Atlas convention: revoke unwanted roles on this exact function.
revoke execute on function public.atlas_12c2_probe_function() from public,anon,authenticated;
do $$begin
  if has_function_privilege('anon','public.atlas_12c2_probe_function()','EXECUTE')
    or has_function_privilege('authenticated','public.atlas_12c2_probe_function()','EXECUTE')
    or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid='public.atlas_12c2_probe_function()'::regprocedure and a.grantee=0) then
    raise exception 'FAIL: per-function revoke did not remove PUBLIC/anon/authenticated';
  end if;
end;$$;
set local role anon;
select pg_temp.expect_error('probe anon EXECUTE after revoke',
  'select public.atlas_12c2_probe_function()','42501',null);
reset role;
grant execute on function public.atlas_12c2_probe_function() to authenticated;
set local role authenticated;
do $$begin
  if current_user<>'authenticated' or public.atlas_12c2_probe_function()<>17 then
    raise exception 'FAIL: explicit authenticated grant must enable real execution';
  end if;
  raise notice 'PASS [EXECUTED]: exact-function revoke blocks anon; explicit authenticated grant succeeds';
end;$$;
reset role;

create temporary table atlas_12c2_ids(key text primary key,id uuid not null) on commit drop;
grant select,insert on atlas_12c2_ids to authenticated;
create function pg_temp.fixture_id(k text) returns uuid language sql stable as $$
  select id from pg_temp.atlas_12c2_ids where key=k;
$$;
create function pg_temp.assert_user() returns void language plpgsql as $$
begin
  if current_user<>'authenticated' or auth.uid() is distinct from pg_temp.fixture_id('user') then
    raise exception 'FAIL: synthetic authenticated role/JWT mismatch';
  end if;
end;$$;
insert into atlas_12c2_ids values('user','12c20000-0000-4000-8000-000000000001');
-- PK/email collisions abort, never delete/replace existing users.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(pg_temp.fixture_id('user'),'authenticated','authenticated','atlas-12c2@example.invalid',
  now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.fixture_id('user')::text,true);
select pg_temp.assert_user();
select pg_temp.expect_error('private earning helper ACL',
  $$select * from public.get_transport_worker_earning_events(null::uuid,null::uuid)$$,
  '42501','permission denied for function get_transport_worker_earning_events');
select pg_temp.expect_error('private immutable trigger ACL',
  $$select public.prevent_transport_wage_credit_mutation()$$,
  '42501','permission denied for function prevent_transport_wage_credit_mutation');
do $$declare r record;
begin
  select * into r from public.provision_first_factory('Atlas 12C2 Synthetic');
  if not r.created or r.factory_id is null then raise exception 'FAIL: new factory result';end if;
  insert into pg_temp.atlas_12c2_ids values('factory',r.factory_id);
  if not exists(select 1 from public.factories where id=r.factory_id)
    or not exists(select 1 from public.factory_users where factory_id=r.factory_id
      and user_id=auth.uid() and is_active)
    or not exists(select 1 from public.mud_accounting_states where factory_id=r.factory_id
      and accounting_mode='LEGACY_WEEKLY')
    or exists(select 1 from public.mud_accounting_mode_transitions where factory_id=r.factory_id) then
    raise exception 'FAIL: provision/member/LEGACY_WEEKLY initialization trigger';
  end if;
  raise notice 'PASS [EXECUTED]: real authenticated provisioning creates factory, membership and LEGACY_WEEKLY';
  -- Reuse the legitimate 12B2C Mud fixture pattern before the real transition RPC.
  perform public.create_mud_group(r.factory_id,'12C2 Mud',5,'2026-09-01',100,'2026-09-01');
  perform public.set_mud_supply_rate(r.factory_id,100,'2026-09-07');
  perform public.transition_mud_accounting_mode(r.factory_id,'SHADOW');
  if not exists(select 1 from public.mud_accounting_states where factory_id=r.factory_id and accounting_mode='SHADOW')
    or (select count(*) from public.mud_accounting_mode_transitions where factory_id=r.factory_id)<>1
    or not exists(select 1 from public.mud_accounting_mode_transitions where factory_id=r.factory_id
      and old_mode='LEGACY_WEEKLY' and new_mode='SHADOW' and actor=auth.uid()) then
    raise exception 'FAIL: real Mud transition/audit trigger path';
  end if;
  raise notice 'PASS [EXECUTED]: authenticated transition RPC LEGACY_WEEKLY -> SHADOW; exact old/new/actor audit';
end;$$;
reset role;

-- Synthetic parents only; mutation-negative proofs use postgres because these
-- immutable records and staff identity columns are deliberately RPC-only.
-- No privileged raw UPDATE substitutes for the real Mud transition above.
do $$declare f uuid:=pg_temp.fixture_id('factory');c uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();
  w uuid;payment record;l uuid:=gen_random_uuid();p uuid:=gen_random_uuid();m uuid:=gen_random_uuid();
begin
  insert into public.staff_categories(id,factory_id,name) values(c,f,'12C2 Staff'),(c2,f,'12C2 Other Staff');
  insert into pg_temp.atlas_12c2_ids values('category',c),('other_category',c2);
  insert into public.labourers(id,factory_id,name,updated_at)
    values(l,f,'12C2 Labourer','2000-01-01');
  insert into pg_temp.atlas_12c2_ids values('labourer',l);
  insert into public.production_earning_settlements(
    id,factory_id,labourer_id,settled_through,total_quantity,total_earned,settlement_type)
    values(p,f,l,'2026-09-01',0,0,'legacy_opening');
  insert into public.mud_factory_settlements(id,factory_id,settled_through,settlement_type)
    values(m,f,'2026-09-01','legacy_opening');
  insert into pg_temp.atlas_12c2_ids values('production_settlement',p),('mud_settlement',m);
end;$$;
set local role authenticated;
select pg_temp.assert_user();
do $$declare f uuid:=pg_temp.fixture_id('factory');w uuid;r record;worker public.staff_workers%rowtype;
begin
  worker:=public.create_staff_worker_with_reference_salary(f,'12C2 Worker',pg_temp.fixture_id('category'),1000);
  w:=worker.id;
  insert into pg_temp.atlas_12c2_ids values('worker',w);
  select * into r from public.record_staff_payment(f,w,'2026-09-20',10,'12C2 synthetic');
  insert into pg_temp.atlas_12c2_ids values('payment',r.payment_id);
  perform public.update_staff_reference_salary(f,w,1100);
  update public.labourers set name='12C2 Labourer Updated' where id=pg_temp.fixture_id('labourer') and factory_id=f;
  if not exists(select 1 from public.labourers where id=pg_temp.fixture_id('labourer')
      and name='12C2 Labourer Updated' and updated_at=now())
    or not exists(select 1 from public.staff_workers where id=w and reference_salary=1100) then
    raise exception 'FAIL: legitimate worker/updated_at paths';
  end if;
  raise notice 'PASS [EXECUTED]: authenticated Staff writer/reference update and normal updated_at trigger';
end;$$;
reset role;

select pg_temp.expect_error('Staff payment mutation trigger',
  format('update public.staff_payments set amount=11 where id=%L::uuid',pg_temp.fixture_id('payment')),
  'P2550','Staff payments are immutable.');
select pg_temp.expect_error('Staff payment delete trigger',
  format('delete from public.staff_payments where id=%L::uuid',pg_temp.fixture_id('payment')),
  'P2550','Staff payments are immutable.');
select pg_temp.expect_error('Staff worker reassignment trigger',
  format('update public.staff_workers set staff_category_id=%L::uuid where id=%L::uuid',
    pg_temp.fixture_id('other_category'),pg_temp.fixture_id('worker')),
  'P2501','A Staff worker''s identity, factory, and category cannot be changed.');
select pg_temp.expect_error('Production settlement mutation trigger',
  format('update public.production_earning_settlements set total_earned=1 where id=%L::uuid',
    pg_temp.fixture_id('production_settlement')),
  'P2501','Production earning settlement snapshots are immutable.');
select pg_temp.expect_error('Production settlement delete trigger',
  format('delete from public.production_earning_settlements where id=%L::uuid',pg_temp.fixture_id('production_settlement')),
  'P2501','Production earning settlement snapshots are immutable.');
select pg_temp.expect_error('Mud settlement mutation trigger',
  format('update public.mud_factory_settlements set settled_through=date %L where id=%L::uuid',
    '2026-09-02',pg_temp.fixture_id('mud_settlement')),
  'P2901','Mud settlement snapshots are immutable.');
select pg_temp.expect_error('Mud settlement delete trigger',
  format('delete from public.mud_factory_settlements where id=%L::uuid',pg_temp.fixture_id('mud_settlement')),
  'P2901','Mud settlement snapshots are immutable.');
-- Exercise invalid transition via the same real authenticated RPC, never raw UPDATE.
set local role authenticated;
select pg_temp.assert_user();
select pg_temp.expect_error('Mud transition protection',
  format('select * from public.transition_mud_accounting_mode(%L::uuid,%L)',
    pg_temp.fixture_id('factory'),'LEGACY_WEEKLY'),'P2802',null);
do $$begin
  if (select amount from public.staff_payments where id=pg_temp.fixture_id('payment'))<>10
    or (select staff_category_id from public.staff_workers where id=pg_temp.fixture_id('worker'))
      is distinct from pg_temp.fixture_id('category')
    or (select total_earned from public.production_earning_settlements where id=pg_temp.fixture_id('production_settlement'))<>0
    or (select settled_through from public.mud_factory_settlements where id=pg_temp.fixture_id('mud_settlement'))<>'2026-09-01'
    or (select count(*) from public.mud_accounting_mode_transitions where factory_id=pg_temp.fixture_id('factory'))<>1 then
    raise exception 'FAIL: rejected mutations changed synthetic state';
  end if;
  raise notice 'PASS [EXECUTED]: all eight trigger functions exercised; rejected mutations unchanged';
end;$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Re-run reusable guard after the exact-function probe convention.
do $$begin
  if exists(select 1 from atlas_12c2_unexpected_exposure) then raise exception 'FAIL: probe exposure';end if;
end;$$;
rollback;

-- E7A: validate the preserved baseline before any cleanup comparison.
do $baseline_guard$
begin
  if pg_catalog.to_regclass('pg_temp.atlas_12c2_counts') is null then
    raise exception 'FAIL: preserved cleanup baseline is missing';
  end if;
  if exists (select 1 from pg_temp.atlas_12c2_counts
    where schema_name is null or table_name is null or row_count is null or row_hash is null) then
    raise exception 'FAIL: cleanup baseline has NULL identity, count or fingerprint';
  end if;
  if exists (select 1 from pg_temp.atlas_12c2_counts
    group by schema_name,table_name having count(*) > 1) then
    raise exception 'FAIL: cleanup baseline has duplicate identities';
  end if;
  if (select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r','p')) <> 64 then
    raise exception 'FAIL: cleanup catalog must contain exactly 64 public tables';
  end if;
  if (select count(*) from pg_temp.atlas_12c2_counts) <> 65
    or (select count(distinct table_name) from pg_temp.atlas_12c2_counts
      where schema_name = 'public') <> 64
    or (select count(*) from pg_temp.atlas_12c2_counts
      where schema_name = 'auth' and table_name = 'users') <> 1 then
    raise exception 'FAIL: cleanup baseline requires 64 public identities plus one auth.users identity';
  end if;
  if exists (
    with expected as (
      select ns.nspname::text as schema_name,c.relname::text as table_name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r','p')
      union all select 'auth','users'
    ), actual as (
      select schema_name as schema_name,table_name as table_name
      from pg_temp.atlas_12c2_counts
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'FAIL: cleanup baseline identities differ from the catalog plus auth.users';
  end if;
end;
$baseline_guard$;

do $$declare r record;n bigint;h text;
begin
  for r in select * from atlas_12c2_counts loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),''[]'')::text) from %I.%I q',r.schema_name,r.table_name) into n,h;
    if n<>r.row_count or h is distinct from r.row_hash then raise exception 'FAIL: post-ROLLBACK count/hash mismatch %.%',r.schema_name,r.table_name;end if;
  end loop;
  if to_regclass('public.atlas_12c2_probe_table') is not null
    or to_regclass('public.atlas_12c2_probe_sequence') is not null
    or to_regprocedure('public.atlas_12c2_probe_function()') is not null
    or exists(select 1 from auth.users where id='12c20000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: persistent verifier fixture remains';
  end if;
  raise notice 'PASS [EXECUTED]: rollback removes probes/fixtures; 65 persistent table counts/full-row hashes unchanged';
end;$$;
select pg_temp.assert_hardening_catalog();
select 64 as rls_tables,87 as unchanged_policies,123 as authenticated_rpc_grants,
  8 as trigger_paths_exercised,0 as unexpected_function_exposures,
  '[]'::jsonb as explicit_function_exposure_allowlist,
  0 as persistent_count_mismatches,'PARTIAL; built-in PUBLIC EXECUTE remains' as future_function_defaults;
drop function pg_temp.assert_hardening_catalog();
drop table atlas_12c2_counts;
drop table atlas_12c2_rpc_manifest;
