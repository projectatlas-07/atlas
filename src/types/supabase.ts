export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type WageRateRow = {
  id: string;
  factory_id: string;
  applies_to: "production" | "mud_supply";
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type MudGroupTermRow = {
  id: string;
  factory_id: string;
  labour_group_id: string;
  member_count: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type MudGroupRateRow = {
  id: string;
  factory_id: string;
  labour_group_id: string;
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type MudGroupDailyAllocationRow = {
  labour_group_id: string;
  member_count: number;
  total_active_members: number;
  eligible_factory_production: number;
  allocated_production: number;
  mud_group_rate_id: string;
  rate_per_1000_bricks: number;
  earned_amount: number;
};

type MudAccountingMode = "LEGACY_WEEKLY" | "SHADOW" | "SETTLEMENT";

type MudAccountingStateRow = {
  factory_id: string;
  accounting_mode: MudAccountingMode;
  updated_at: string;
};

type MudAccountingModeTransitionRow = {
  id: string;
  factory_id: string;
  old_mode: MudAccountingMode;
  new_mode: MudAccountingMode;
  changed_at: string;
  actor: string;
};

type MudFactorySettlementRow = {
  id: string;
  factory_id: string;
  previous_cutoff: string | null;
  settled_through: string;
  settlement_type: "legacy_opening" | "checkpoint";
  triggering_labour_group_id: string | null;
  triggering_withdrawal_id: string | null;
  created_at: string;
};

type MudGroupConfigurationRow = {
  labour_group_id: string;
  group_name: string;
  current_member_count: number | null;
  current_rate_per_1000_bricks: number | null;
  is_earning: boolean;
  current_term_id: string | null;
  current_rate_id: string | null;
  accounting_mode: MudAccountingMode;
};

type MudGroupRangeAllocationRow = MudGroupDailyAllocationRow & {
  production_date: string;
};

type MudShadowWeeklyComparisonRow = {
  week_start: string;
  labour_group_id: string;
  legacy_weekly_earning_id: string;
  legacy_earning: number;
  new_engine_earning: number | null;
  difference: number | null;
  status: "PARITY_OK" | "EXPECTED_RATE_CHANGE_DIFFERENCE" | "UNEXPECTED_MISMATCH" | "CONFIGURATION_ERROR";
  detail: string;
};

type MudShadowCertificationRow = {
  certification_status: "READY" | "WAITING_FOR_COMPLETED_WEEK" | "CONFIGURATION_ERROR" | "UNEXPECTED_MISMATCH";
  certification_week: string | null;
  legacy_earning: number | null;
  new_engine_earning: number | null;
  difference: number | null;
  parity_status: MudShadowWeeklyComparisonRow["status"] | null;
  reason: string;
};

type MudCutoverReadinessRow = {
  readiness_status: "READY_FOR_CUTOVER" | "BLOCKED";
  reason: string;
  certification_week: string | null;
  final_legacy_week_start: string | null;
  final_legacy_week_end: string | null;
  proposed_legacy_cutoff: string | null;
  settlement_start_date: string | null;
  labour_group_id: string | null;
  group_name: string | null;
  legacy_locked_earning_total: number | null;
  existing_withdrawals: number | null;
  proposed_opening_amount: number | null;
  resulting_balance: number | null;
};

type MudSettlementAccountRow = {
  settled_earned: number;
  live_earned: number;
  total_earned: number;
  total_withdrawn: number;
  available_balance: number;
  latest_settlement_cutoff: string | null;
};

type MudSettlementWithdrawalRow = {
  withdrawal_id: string;
  settlement_id: string;
  previous_cutoff: string;
  settled_through: string;
  withdrawal_date: string;
  withdrawal_amount: number;
  settled_earned: number;
  total_withdrawn: number;
  settled_available_balance: number;
  daily_snapshots: number;
  group_snapshots: number;
  was_replayed: boolean;
};

type MudSettlementCutoverRow = {
  legacy_opening_settlement_id: string;
  final_legacy_week_start: string;
  legacy_cutoff: string;
  settlement_start_date: string;
  group_openings: number;
  transition_audit_id: string;
  actor: string;
  cutover_at: string;
};

type ProductionWageRateRow = {
  id: string;
  factory_id: string;
  production_crew_id: string | null;
  labourer_id: string | null;
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type ProductionWeeklyEarningDetailRow = {
  id: string;
  factory_id: string;
  weekly_earning_id: string;
  work_date: string;
  quantity_used: number;
  production_wage_rate_id: string;
  rate_per_1000_bricks: number;
  rate_source: "crew_default" | "individual_override";
  production_crew_id: string | null;
  amount: number;
  created_at: string;
};

type ProductionEarningSettlementRow = {
  id: string;
  factory_id: string;
  labourer_id: string;
  previous_settled_through: string | null;
  settled_through: string;
  total_quantity: number;
  total_earned: number;
  settlement_type: "legacy_opening" | "withdrawal";
  withdrawal_id: string | null;
  created_at: string;
};

type ProductionEarningSettlementDetailRow = {
  id: string;
  settlement_id: string;
  factory_id: string;
  labourer_id: string;
  production_entry_id: string;
  work_date: string;
  quantity: number;
  production_wage_rate_id: string;
  rate_per_1000_bricks: number;
  earned_amount: number;
  created_at: string;
};

type ProductionCrewAssignmentRow = {
  id: string;
  factory_id: string;
  labourer_id: string;
  production_crew_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type ProductionCrewRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TransportWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TransportGroupRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TransportCrewMembershipRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  transport_crew_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type TransportCrewAssignmentRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  transport_crew_id: string;
  created_at: string;
};

type TransportDailyEntryRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  work_date: string;
  paya_quantity: number;
  created_at: string;
  updated_at: string;
};

type TransportDailyAttendanceRow = {
  id: string;
  factory_id: string;
  transport_daily_entry_id: string;
  transport_crew_id: string;
  transport_worker_id: string;
  work_date: string;
  created_at: string;
};

type TransportCrewWageRateRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  rate_per_paya: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type TransportWeeklyEarningRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  week_start: string;
  total_amount: number;
  created_at: string;
};

type TransportWeeklyEarningDetailRow = {
  id: string;
  factory_id: string;
  transport_weekly_earning_id: string;
  transport_worker_id: string;
  week_start: string;
  transport_daily_entry_id: string;
  transport_crew_id: string;
  work_date: string;
  transport_crew_wage_rate_id: string;
  rate_per_paya_snapshot: number;
  paya_quantity_snapshot: number;
  attendance_count_snapshot: number;
  daily_crew_pool_snapshot: number;
  worker_daily_share_snapshot: number;
  created_at: string;
};

type TransportWithdrawalRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  withdrawal_date: string;
  amount: number;
  created_at: string;
};

type StaffCategoryRow = {
  id: string;
  factory_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type StaffWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  staff_category_id: string;
  reference_salary: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type StaffPaymentRow = {
  id: string;
  factory_id: string;
  staff_worker_id: string;
  payment_date: string;
  amount: number;
  note: string | null;
  created_at: string;
};

type SoilWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SoilWorkerTrolleyRateRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  rate_per_trolley: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type SoilDailyTrolleyEntryRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  work_date: string;
  trolley_quantity: number;
  soil_worker_trolley_rate_id: string;
  rate_per_trolley_snapshot: number;
  base_amount_snapshot: number;
  created_at: string;
  updated_at: string;
};

type SoilEarningRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  soil_daily_trolley_entry_id: string;
  work_date: string;
  event_type: "BASE" | "CORRECTION";
  event_sequence: number;
  amount: number;
  trolley_quantity_snapshot: number;
  rate_per_trolley_snapshot: number;
  previous_base_amount_snapshot: number;
  source_base_amount_snapshot: number;
  created_at: string;
};

type SoilPaymentRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  payment_date: string;
  amount: number;
  created_at: string;
};

type SoilFinancialAdjustmentRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  adjustment_type: "ADDITION" | "DEDUCTION";
  adjustment_date: string;
  amount: number;
  reason: string;
  created_at: string;
};

type CustomerRow = {
  id: string;
  factory_id: string;
  name: string;
  address: string;
  mobile: string;
  created_at: string;
  updated_at: string;
};

type VehicleRow = {
  id: string;
  factory_id: string;
  vehicle_number: string;
  normalized_vehicle_number: string;
  delivery_wage_tracking_enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type VehicleWagePaymentRow = {
  id: string;
  factory_id: string;
  vehicle_id: string;
  payment_date: string;
  amount: number;
  note: string | null;
  created_at: string;
  created_by: string;
};

type VehicleWagePaymentReversalRow = {
  id: string;
  factory_id: string;
  payment_id: string;
  reversal_date: string;
  reason: string;
  created_at: string;
  created_by: string;
};

type ChallanRow = {
  id: string;
  factory_id: string;
  challan_number: string | null;
  challan_date: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_address_snapshot: string;
  customer_mobile_snapshot: string;
  company_name_snapshot: string;
  company_business_description_snapshot: string;
  company_address_snapshot: string;
  company_mobile_snapshot: string;
  company_village_snapshot: string | null;
  company_post_office_snapshot: string | null;
  company_police_station_snapshot: string | null;
  company_district_snapshot: string | null;
  company_state_snapshot: string | null;
  company_gstin_snapshot: string | null;
  vehicle_id: string | null;
  vehicle_number_snapshot: string | null;
  delivery_wage_applicable_snapshot: boolean;
  trip_labour_wage: number | null;
  vehicle_number: string | null;
  tractor_labour_rate_snapshot: number | null;
  challan_total: number;
  status: "active" | "void";
  is_locked: boolean;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type ChallanItemRow = {
  id: string;
  factory_id: string;
  challan_id: string;
  brick_type_id: string;
  brick_particulars_snapshot: string;
  quantity: number;
  pricing_mode: "RATE" | "AMOUNT";
  rate_per_1000_bricks: number;
  pricing_unit: "PER_1000_BRICKS";
  line_amount: number;
  line_position: number;
  created_at: string;
};

type ChallanFlexibleLineRow = {
  id: string;
  factory_id: string;
  challan_id: string;
  line_type: "NOTE" | "EXTRA_CHARGE";
  line_category: "OTHER_REVENUE" | "NON_FINANCIAL";
  order_index: number;
  particulars: string;
  quantity: number | null;
  rate: number | null;
  amount: number;
  created_at: string;
};

type CustomerPaymentRow = {
  id: string;
  factory_id: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_address_snapshot: string;
  customer_mobile_snapshot: string;
  company_name_snapshot: string;
  company_business_description_snapshot: string;
  company_address_snapshot: string;
  company_mobile_snapshot: string;
  payment_date: string;
  amount: number;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified" | "multiple";
  note: string | null;
  created_at: string;
};

type CustomerPaymentMethodRow = {
  factory_id: string;
  payment_id: string;
  mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
  split_amount: number | null;
  created_at: string;
};

type CashBookInitializationRow = {
  factory_id: string;
  start_date: string;
  opening_balance: number;
  created_at: string;
  created_by: string;
};

type CashBookManualEntryRow = {
  id: string;
  factory_id: string;
  business_date: string;
  direction: "in" | "out";
  amount: number;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  party_details: string;
  note: string | null;
  status: "active" | "void";
  created_at: string;
  created_by: string;
  voided_at: string | null;
  voided_by: string | null;
};

type SupplierRow = {
  id: string;
  factory_id: string;
  name: string;
  address: string | null;
  mobile: string | null;
  created_at: string;
  updated_at: string;
};

type ExpenseRecordRow = {
  id: string;
  factory_id: string;
  business_date: string;
  kind: "purchase" | "expense";
  supplier_id: string | null;
  counterparty_name_snapshot: string;
  counterparty_address_snapshot: string | null;
  counterparty_mobile_snapshot: string | null;
  description: string;
  total_amount: number;
  note: string | null;
  status: "active" | "void";
  is_locked: boolean;
  voided_at: string | null;
  voided_by: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
};

type ExpensePaymentRow = {
  id: string;
  factory_id: string;
  payment_date: string;
  amount: number;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null;
  created_at: string;
  created_by: string;
};

type ExpensePaymentAllocationRow = {
  id: string;
  factory_id: string;
  payment_id: string;
  expense_record_id: string;
  allocated_amount: number;
  created_at: string;
};

type CoalReferenceValueRow = {
  id: string;
  factory_id: string;
  kind: "coal_name" | "source_location";
  display_value: string;
  created_at: string;
  created_by: string;
};

type CoalPurchaseRow = {
  id: string;
  factory_id: string;
  coal_name_reference_id: string;
  source_reference_id: string;
  coal_name_snapshot: string;
  source_location_snapshot: string;
  coal_challan_number: string | null;
  vehicle_number_snapshot: string;
  quantity: number;
  rate: number;
  coal_amount: number;
  separate_freight_amount: number;
  created_at: string;
  created_by: string;
};

type CoalPurchaseDetailRow = {
  id: string;
  factory_id: string;
  purchase_date: string;
  seller_id: string;
  seller_name_snapshot: string;
  seller_address_snapshot: string | null;
  seller_mobile_snapshot: string | null;
  coal_name_reference_id: string;
  coal_name_snapshot: string;
  source_reference_id: string;
  source_location_snapshot: string;
  coal_challan_number: string | null;
  vehicle_number_snapshot: string;
  quantity: number;
  rate: number;
  coal_amount: number;
  separate_freight_amount: number;
  final_total: number;
  status: "active" | "void";
  is_locked: boolean;
  total_paid: number;
  outstanding_amount: number;
  payment_state: "unpaid" | "partially_paid" | "paid";
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type VehicleMaintenanceRow = {
  id: string;
  factory_id: string;
  vehicle_id: string;
  vehicle_number_snapshot: string;
  work_description: string;
  created_at: string;
  created_by: string;
};

type VehicleMaintenanceDetailRow = {
  id: string;
  factory_id: string;
  maintenance_date: string;
  vehicle_id: string;
  vehicle_number_snapshot: string;
  garage_id: string;
  garage_name_snapshot: string;
  garage_address_snapshot: string | null;
  garage_mobile_snapshot: string | null;
  work_description: string;
  total_amount: number;
  status: "active" | "void";
  is_locked: boolean;
  total_paid: number;
  outstanding_amount: number;
  payment_state: "unpaid" | "partially_paid" | "paid";
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type VehicleFuelRow = {
  id: string;
  factory_id: string;
  vehicle_id: string;
  vehicle_number_snapshot: string;
  fuel_time: string;
  fuel_type: "DIESEL" | "PETROL";
  litres: number;
  rate_per_litre: number;
  created_at: string;
  created_by: string;
};

type VehicleFuelDetailRow = {
  id: string;
  factory_id: string;
  fuel_date: string;
  fuel_time: string;
  vehicle_id: string;
  vehicle_number_snapshot: string;
  pump_id: string;
  pump_name_snapshot: string;
  pump_address_snapshot: string | null;
  pump_mobile_snapshot: string | null;
  fuel_type: "DIESEL" | "PETROL";
  litres: number;
  rate_per_litre: number;
  fuel_amount: number;
  status: "active" | "void";
  is_locked: boolean;
  total_paid: number;
  outstanding_amount: number;
  payment_state: "unpaid" | "partially_paid" | "paid";
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type SupplierRoleRow = {
  id: string;
  factory_id: string;
  supplier_id: string;
  role: "COAL_SELLER" | "GARAGE" | "FUEL_PUMP";
  created_at: string;
  created_by: string;
};

type CustomerPaymentAllocationRow = {
  id: string;
  factory_id: string;
  payment_id: string;
  challan_id: string;
  allocated_amount: number;
  created_at: string;
};

type BrickTypeRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  ever_used: boolean;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      factories: {
        Row: { id: string; name: string; business_description: string; village: string; post_office: string; police_station: string; district: string; state: string; address: string; mobile: string; gstin: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; business_description?: string; village?: string; post_office?: string; police_station?: string; district?: string; state?: string; address?: string; mobile?: string; gstin?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; business_description?: string; village?: string; post_office?: string; police_station?: string; district?: string; state?: string; address?: string; mobile?: string; gstin?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      factory_users: {
        Row: { id: string; user_id: string; factory_id: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; user_id: string; factory_id: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; user_id?: string; factory_id?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "factory_users_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      brick_types: {
        Row: BrickTypeRow;
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; ever_used?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Omit<BrickTypeRow, "id">> & { id?: string };
        Relationships: [{ foreignKeyName: "brick_types_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      customers: {
        Row: CustomerRow;
        Insert: { id?: string; factory_id: string; name: string; address?: string; mobile?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; address?: string; mobile?: string; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "customers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      vehicles: {
        Row: VehicleRow;
        Insert: {
          id?: string;
          factory_id: string;
          vehicle_number: string;
          normalized_vehicle_number: string;
          delivery_wage_tracking_enabled?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<VehicleRow, "id">> & { id?: string };
        Relationships: [{ foreignKeyName: "vehicles_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      vehicle_wage_payments: {
        Row: VehicleWagePaymentRow;
        Insert: {
          id?: string;
          factory_id: string;
          vehicle_id: string;
          payment_date: string;
          amount: number;
          note?: string | null;
          created_at?: string;
          created_by: string;
        };
        Update: Partial<VehicleWagePaymentRow>;
        Relationships: [
          { foreignKeyName: "vehicle_wage_payments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "vehicle_wage_payments_vehicle_factory_fkey"; columns: ["vehicle_id", "factory_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      vehicle_wage_payment_reversals: {
        Row: VehicleWagePaymentReversalRow;
        Insert: {
          id?: string;
          factory_id: string;
          payment_id: string;
          reversal_date: string;
          reason: string;
          created_at?: string;
          created_by: string;
        };
        Update: Partial<VehicleWagePaymentReversalRow>;
        Relationships: [
          { foreignKeyName: "vehicle_wage_payment_reversals_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "vehicle_wage_payment_reversals_payment_factory_fkey"; columns: ["payment_id", "factory_id"]; isOneToOne: true; referencedRelation: "vehicle_wage_payments"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      challans: {
        Row: ChallanRow;
        Insert: {
          id?: string;
          factory_id: string;
          challan_number?: string | null;
          challan_date: string;
          customer_id: string;
          customer_name_snapshot: string;
          customer_address_snapshot: string;
          customer_mobile_snapshot: string;
          company_name_snapshot: string;
          company_business_description_snapshot: string;
          company_address_snapshot: string;
          company_mobile_snapshot: string;
          company_village_snapshot?: string | null;
          company_post_office_snapshot?: string | null;
          company_police_station_snapshot?: string | null;
          company_district_snapshot?: string | null;
          company_state_snapshot?: string | null;
          company_gstin_snapshot?: string | null;
          vehicle_id?: string | null;
          vehicle_number_snapshot?: string | null;
          delivery_wage_applicable_snapshot?: boolean;
          trip_labour_wage?: number | null;
          vehicle_number?: string | null;
          tractor_labour_rate_snapshot?: number | null;
          challan_total?: number;
          status?: "active" | "void";
          is_locked?: boolean;
          voided_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ChallanRow, "id">> & { id?: string };
        Relationships: [
          { foreignKeyName: "challans_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "challans_customer_factory_fkey"; columns: ["customer_id", "factory_id"]; isOneToOne: false; referencedRelation: "customers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "challans_vehicle_factory_fkey"; columns: ["vehicle_id", "factory_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      challan_items: {
        Row: ChallanItemRow;
        Insert: {
          id?: string;
          factory_id: string;
          challan_id: string;
          brick_type_id: string;
          brick_particulars_snapshot: string;
          quantity: number;
          pricing_mode?: "RATE" | "AMOUNT";
          rate_per_1000_bricks: number;
          pricing_unit?: "PER_1000_BRICKS";
          line_amount: number;
          line_position: number;
          created_at?: string;
        };
        Update: Partial<ChallanItemRow>;
        Relationships: [
          { foreignKeyName: "challan_items_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "challan_items_challan_factory_fkey"; columns: ["challan_id", "factory_id"]; isOneToOne: false; referencedRelation: "challans"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "challan_items_brick_type_factory_fkey"; columns: ["brick_type_id", "factory_id"]; isOneToOne: false; referencedRelation: "brick_types"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      challan_flexible_lines: {
        Row: ChallanFlexibleLineRow;
        Insert: {
          id?: string;
          factory_id: string;
          challan_id: string;
          line_type: "NOTE" | "EXTRA_CHARGE";
          line_category: "OTHER_REVENUE" | "NON_FINANCIAL";
          order_index: number;
          particulars: string;
          quantity?: number | null;
          rate?: number | null;
          amount: number;
          created_at?: string;
        };
        Update: Partial<Omit<ChallanFlexibleLineRow, "id" | "factory_id" | "challan_id" | "created_at">>;
        Relationships: [
          { foreignKeyName: "challan_flexible_lines_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "challan_flexible_lines_challan_factory_fkey"; columns: ["challan_id", "factory_id"]; isOneToOne: false; referencedRelation: "challans"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      customer_payments: {
        Row: CustomerPaymentRow;
        Insert: {
          id?: string;
          factory_id: string;
          customer_id: string;
          customer_name_snapshot?: string;
          customer_address_snapshot?: string;
          customer_mobile_snapshot?: string;
          company_name_snapshot?: string;
          company_business_description_snapshot?: string;
          company_address_snapshot?: string;
          company_mobile_snapshot?: string;
          payment_date: string;
          amount: number;
          payment_mode?: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified" | "multiple";
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<CustomerPaymentRow, "id">> & { id?: string };
        Relationships: [
          { foreignKeyName: "customer_payments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "customer_payments_customer_factory_fkey"; columns: ["customer_id", "factory_id"]; isOneToOne: false; referencedRelation: "customers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      customer_payment_methods: {
        Row: CustomerPaymentMethodRow;
        Insert: {
          factory_id: string;
          payment_id: string;
          mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
          split_amount?: number | null;
          created_at?: string;
        };
        Update: Partial<CustomerPaymentMethodRow>;
        Relationships: [
          { foreignKeyName: "customer_payment_methods_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "customer_payment_methods_payment_factory_fkey"; columns: ["payment_id", "factory_id"]; isOneToOne: false; referencedRelation: "customer_payments"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      customer_payment_allocations: {
        Row: CustomerPaymentAllocationRow;
        Insert: {
          id?: string;
          factory_id: string;
          payment_id: string;
          challan_id: string;
          allocated_amount: number;
          created_at?: string;
        };
        Update: Partial<Omit<CustomerPaymentAllocationRow, "id">> & { id?: string };
        Relationships: [
          { foreignKeyName: "customer_payment_allocations_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "customer_payment_allocations_payment_factory_fkey"; columns: ["payment_id", "factory_id"]; isOneToOne: false; referencedRelation: "customer_payments"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "customer_payment_allocations_challan_factory_fkey"; columns: ["challan_id", "factory_id"]; isOneToOne: false; referencedRelation: "challans"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      cash_book_initializations: {
        Row: CashBookInitializationRow;
        Insert: {
          factory_id: string;
          start_date: string;
          opening_balance: number;
          created_at?: string;
          created_by: string;
        };
        Update: Partial<CashBookInitializationRow>;
        Relationships: [{ foreignKeyName: "cash_book_initializations_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: true; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      cash_book_manual_entries: {
        Row: CashBookManualEntryRow;
        Insert: {
          id: string;
          factory_id: string;
          business_date: string;
          direction: "in" | "out";
          amount: number;
          payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          party_details: string;
          note?: string | null;
          status?: "active" | "void";
          created_at?: string;
          created_by: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: Partial<CashBookManualEntryRow>;
        Relationships: [{ foreignKeyName: "cash_book_manual_entries_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      suppliers: {
        Row: SupplierRow;
        Insert: {
          id?: string; factory_id: string; name: string; address?: string | null;
          mobile?: string | null; created_at?: string; updated_at?: string;
        };
        Update: Partial<SupplierRow>;
        Relationships: [{ foreignKeyName: "suppliers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      expense_records: {
        Row: ExpenseRecordRow;
        Insert: {
          id?: string; factory_id: string; business_date: string;
          kind: "purchase" | "expense"; supplier_id?: string | null;
          counterparty_name_snapshot: string;
          counterparty_address_snapshot?: string | null;
          counterparty_mobile_snapshot?: string | null;
          description: string; total_amount: number; note?: string | null;
          status?: "active" | "void"; is_locked?: boolean;
          voided_at?: string | null; voided_by?: string | null;
          created_at?: string; updated_at?: string; created_by: string;
        };
        Update: Partial<ExpenseRecordRow>;
        Relationships: [
          { foreignKeyName: "expense_records_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "expense_records_supplier_factory_fkey"; columns: ["supplier_id", "factory_id"]; isOneToOne: false; referencedRelation: "suppliers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      expense_payments: {
        Row: ExpensePaymentRow;
        Insert: {
          id?: string; factory_id: string; payment_date: string; amount: number;
          payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note?: string | null; created_at?: string; created_by: string;
        };
        Update: Partial<ExpensePaymentRow>;
        Relationships: [{ foreignKeyName: "expense_payments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      expense_payment_allocations: {
        Row: ExpensePaymentAllocationRow;
        Insert: {
          id?: string; factory_id: string; payment_id: string;
          expense_record_id: string; allocated_amount: number; created_at?: string;
        };
        Update: Partial<ExpensePaymentAllocationRow>;
        Relationships: [
          { foreignKeyName: "expense_payment_allocations_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "expense_payment_allocations_payment_factory_fkey"; columns: ["payment_id", "factory_id"]; isOneToOne: false; referencedRelation: "expense_payments"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "expense_payment_allocations_record_factory_fkey"; columns: ["expense_record_id", "factory_id"]; isOneToOne: false; referencedRelation: "expense_records"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      coal_reference_values: {
        Row: CoalReferenceValueRow;
        Insert: {
          id?: string; factory_id: string; kind: "coal_name" | "source_location";
          display_value: string; created_at?: string; created_by: string;
        };
        Update: Partial<CoalReferenceValueRow>;
        Relationships: [{ foreignKeyName: "coal_reference_values_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      coal_purchases: {
        Row: CoalPurchaseRow;
        Insert: {
          id: string; factory_id: string; coal_name_reference_id: string;
          source_reference_id: string; coal_name_snapshot: string;
          source_location_snapshot: string; coal_challan_number?: string | null;
          vehicle_number_snapshot: string; quantity: number; rate: number;
          coal_amount: number; separate_freight_amount?: number;
          created_at?: string; created_by: string;
        };
        Update: Partial<CoalPurchaseRow>;
        Relationships: [
          { foreignKeyName: "coal_purchases_expense_record_factory_fkey"; columns: ["id", "factory_id"]; isOneToOne: true; referencedRelation: "expense_records"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "coal_purchases_name_reference_factory_fkey"; columns: ["coal_name_reference_id", "factory_id"]; isOneToOne: false; referencedRelation: "coal_reference_values"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "coal_purchases_source_reference_factory_fkey"; columns: ["source_reference_id", "factory_id"]; isOneToOne: false; referencedRelation: "coal_reference_values"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      vehicle_maintenance_records: {
        Row: VehicleMaintenanceRow;
        Insert: {
          id: string; factory_id: string; vehicle_id: string;
          vehicle_number_snapshot: string; work_description: string;
          created_at?: string; created_by: string;
        };
        Update: Partial<VehicleMaintenanceRow>;
        Relationships: [
          { foreignKeyName: "vehicle_maintenance_records_expense_factory_fkey"; columns: ["id", "factory_id"]; isOneToOne: true; referencedRelation: "expense_records"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "vehicle_maintenance_records_vehicle_factory_fkey"; columns: ["vehicle_id", "factory_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      vehicle_fuel_records: {
        Row: VehicleFuelRow;
        Insert: {
          id: string; factory_id: string; vehicle_id: string;
          vehicle_number_snapshot: string; fuel_time: string;
          fuel_type: "DIESEL" | "PETROL"; litres: number;
          rate_per_litre: number; created_at?: string; created_by: string;
        };
        Update: Partial<VehicleFuelRow>;
        Relationships: [
          { foreignKeyName: "vehicle_fuel_records_expense_factory_fkey"; columns: ["id", "factory_id"]; isOneToOne: true; referencedRelation: "expense_records"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "vehicle_fuel_records_vehicle_factory_fkey"; columns: ["vehicle_id", "factory_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      supplier_roles: {
        Row: SupplierRoleRow;
        Insert: {
          id?: string; factory_id: string; supplier_id: string;
          role: "COAL_SELLER" | "GARAGE" | "FUEL_PUMP"; created_at?: string; created_by: string;
        };
        Update: Partial<SupplierRoleRow>;
        Relationships: [
          { foreignKeyName: "supplier_roles_supplier_factory_fkey"; columns: ["supplier_id", "factory_id"]; isOneToOne: false; referencedRelation: "suppliers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      labourers: {
        Row: { id: string; factory_id: string; name: string; production_origin_label: string | null; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; factory_id: string; name: string; production_origin_label?: string | null; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; production_origin_label?: string | null; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "labourers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }
        ];
      };
      production_crews: {
        Row: ProductionCrewRow;
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "production_crews_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      production_crew_assignments: {
        Row: ProductionCrewAssignmentRow;
        Insert: { id?: string; factory_id: string; labourer_id: string; production_crew_id: string; effective_from: string; effective_to?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; labourer_id?: string; production_crew_id?: string; effective_from?: string; effective_to?: string | null; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "production_crew_assignments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "production_crew_assignments_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_crew_assignments_crew_factory_fkey"; columns: ["production_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "production_crews"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_workers: {
        Row: TransportWorkerRow;
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "transport_workers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      transport_crews: {
        Row: TransportGroupRow;
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "transport_crews_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      transport_crew_memberships: {
        Row: TransportCrewMembershipRow;
        Insert: { id?: string; factory_id: string; transport_worker_id: string; transport_crew_id: string; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_worker_id?: string; transport_crew_id?: string; effective_from?: string; effective_to?: string | null; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_crew_memberships_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_crew_memberships_worker_factory_fkey"; columns: ["transport_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_workers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "transport_crew_memberships_crew_factory_fkey"; columns: ["transport_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_crews"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_crew_assignments: {
        Row: TransportCrewAssignmentRow;
        Insert: { id?: string; factory_id: string; transport_worker_id: string; transport_crew_id: string; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_worker_id?: string; transport_crew_id?: string; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_crew_assignments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_crew_assignments_worker_factory_fkey"; columns: ["transport_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_workers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "transport_crew_assignments_crew_factory_fkey"; columns: ["transport_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_crews"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_daily_entries: {
        Row: TransportDailyEntryRow;
        Insert: { id?: string; factory_id: string; transport_crew_id: string; work_date: string; paya_quantity: number; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; transport_crew_id?: string; work_date?: string; paya_quantity?: number; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "transport_daily_entries_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_daily_entries_crew_factory_fkey"; columns: ["transport_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_crews"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_daily_attendance: {
        Row: TransportDailyAttendanceRow;
        Insert: { id?: string; factory_id: string; transport_daily_entry_id: string; transport_crew_id: string; transport_worker_id: string; work_date: string; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_daily_entry_id?: string; transport_crew_id?: string; transport_worker_id?: string; work_date?: string; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_daily_attendance_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_daily_attendance_parent_fkey"; columns: ["transport_daily_entry_id", "factory_id", "transport_crew_id", "work_date"]; isOneToOne: false; referencedRelation: "transport_daily_entries"; referencedColumns: ["id", "factory_id", "transport_crew_id", "work_date"] },
          { foreignKeyName: "transport_daily_attendance_worker_factory_fkey"; columns: ["transport_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_crew_wage_rates: {
        Row: TransportCrewWageRateRow;
        Insert: { id?: string; factory_id: string; transport_crew_id: string; rate_per_paya: number; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_crew_id?: string; rate_per_paya?: number; effective_from?: string; effective_to?: string | null; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_crew_wage_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_crew_wage_rates_crew_factory_fkey"; columns: ["transport_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_crews"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_weekly_earnings: {
        Row: TransportWeeklyEarningRow;
        Insert: { id?: string; factory_id: string; transport_worker_id: string; week_start: string; total_amount: number; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_worker_id?: string; week_start?: string; total_amount?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_weekly_earnings_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_weekly_earnings_worker_factory_fkey"; columns: ["transport_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_weekly_earning_details: {
        Row: TransportWeeklyEarningDetailRow;
        Insert: { id?: string; factory_id: string; transport_weekly_earning_id: string; transport_worker_id: string; week_start: string; transport_daily_entry_id: string; transport_crew_id: string; work_date: string; transport_crew_wage_rate_id: string; rate_per_paya_snapshot: number; paya_quantity_snapshot: number; attendance_count_snapshot: number; daily_crew_pool_snapshot: number; worker_daily_share_snapshot: number; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_weekly_earning_id?: string; transport_worker_id?: string; week_start?: string; transport_daily_entry_id?: string; transport_crew_id?: string; work_date?: string; transport_crew_wage_rate_id?: string; rate_per_paya_snapshot?: number; paya_quantity_snapshot?: number; attendance_count_snapshot?: number; daily_crew_pool_snapshot?: number; worker_daily_share_snapshot?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_weekly_earning_details_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_weekly_earning_details_parent_identity_fkey"; columns: ["transport_weekly_earning_id", "factory_id", "transport_worker_id", "week_start"]; isOneToOne: false; referencedRelation: "transport_weekly_earnings"; referencedColumns: ["id", "factory_id", "transport_worker_id", "week_start"] },
          { foreignKeyName: "transport_weekly_earning_details_daily_entry_fkey"; columns: ["transport_daily_entry_id", "factory_id", "transport_crew_id", "work_date"]; isOneToOne: false; referencedRelation: "transport_daily_entries"; referencedColumns: ["id", "factory_id", "transport_crew_id", "work_date"] },
          { foreignKeyName: "transport_weekly_earning_details_rate_factory_fkey"; columns: ["transport_crew_wage_rate_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_crew_wage_rates"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_wage_credits: {
        Row: { id: string; factory_id: string; transport_worker_id: string; original_work_date: string; posting_date: string; amount: number; reason: string; actor_id: string; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [
          { foreignKeyName: "transport_wage_credits_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_wage_credits_worker_factory_fkey"; columns: ["transport_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      transport_withdrawals: {
        Row: TransportWithdrawalRow;
        Insert: { id?: string; factory_id: string; transport_worker_id: string; withdrawal_date: string; amount: number; created_at?: string };
        Update: { id?: string; factory_id?: string; transport_worker_id?: string; withdrawal_date?: string; amount?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: "transport_withdrawals_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "transport_withdrawals_worker_factory_fkey"; columns: ["transport_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "transport_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_categories: {
        Row: StaffCategoryRow;
        Insert: { id?: string; factory_id: string; name: string; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "staff_categories_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      staff_workers: {
        Row: StaffWorkerRow;
        Insert: { id?: string; factory_id: string; name: string; staff_category_id: string; reference_salary: number; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; staff_category_id?: string; reference_salary?: number; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "staff_workers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_workers_category_factory_fkey"; columns: ["staff_category_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_categories"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_payments: {
        Row: StaffPaymentRow;
        Insert: { id?: string; factory_id: string; staff_worker_id: string; payment_date: string; amount: number; note?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; staff_worker_id?: string; payment_date?: string; amount?: number; note?: string | null; created_at?: string };
        Relationships: [
          { foreignKeyName: "staff_payments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_payments_worker_factory_fkey"; columns: ["staff_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      soil_workers: {
        Row: SoilWorkerRow;
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "soil_workers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      soil_worker_trolley_rates: {
        Row: SoilWorkerTrolleyRateRow;
        Insert: { id?: string; factory_id: string; soil_worker_id: string; rate_per_trolley: number; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; soil_worker_id?: string; rate_per_trolley?: number; effective_from?: string; effective_to?: string | null; created_at?: string };
        Relationships: [
          { foreignKeyName: "soil_worker_trolley_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "soil_worker_trolley_rates_worker_factory_fkey"; columns: ["soil_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "soil_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      soil_daily_trolley_entries: {
        Row: SoilDailyTrolleyEntryRow;
        Insert: { id?: string; factory_id: string; soil_worker_id: string; work_date: string; trolley_quantity: number; soil_worker_trolley_rate_id: string; rate_per_trolley_snapshot: number; base_amount_snapshot: number; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; soil_worker_id?: string; work_date?: string; trolley_quantity?: number; soil_worker_trolley_rate_id?: string; rate_per_trolley_snapshot?: number; base_amount_snapshot?: number; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "soil_daily_trolley_entries_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "soil_daily_trolley_entries_worker_factory_fkey"; columns: ["soil_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "soil_workers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "soil_daily_trolley_entries_rate_identity_fkey"; columns: ["soil_worker_trolley_rate_id", "factory_id", "soil_worker_id"]; isOneToOne: false; referencedRelation: "soil_worker_trolley_rates"; referencedColumns: ["id", "factory_id", "soil_worker_id"] }
        ];
      };
      soil_earnings: {
        Row: SoilEarningRow;
        Insert: { id?: string; factory_id: string; soil_worker_id: string; soil_daily_trolley_entry_id: string; work_date: string; event_type: "BASE" | "CORRECTION"; event_sequence: number; amount: number; trolley_quantity_snapshot: number; rate_per_trolley_snapshot: number; previous_base_amount_snapshot: number; source_base_amount_snapshot: number; created_at?: string };
        Update: { id?: string; factory_id?: string; soil_worker_id?: string; soil_daily_trolley_entry_id?: string; work_date?: string; event_type?: "BASE" | "CORRECTION"; event_sequence?: number; amount?: number; trolley_quantity_snapshot?: number; rate_per_trolley_snapshot?: number; previous_base_amount_snapshot?: number; source_base_amount_snapshot?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: "soil_earnings_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "soil_earnings_worker_factory_fkey"; columns: ["soil_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "soil_workers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "soil_earnings_source_identity_fkey"; columns: ["soil_daily_trolley_entry_id", "factory_id", "soil_worker_id", "work_date"]; isOneToOne: false; referencedRelation: "soil_daily_trolley_entries"; referencedColumns: ["id", "factory_id", "soil_worker_id", "work_date"] }
        ];
      };
      soil_payments: {
        Row: SoilPaymentRow;
        Insert: { id?: string; factory_id: string; soil_worker_id: string; payment_date: string; amount: number; created_at?: string };
        Update: { id?: string; factory_id?: string; soil_worker_id?: string; payment_date?: string; amount?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: "soil_payments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "soil_payments_worker_factory_fkey"; columns: ["soil_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "soil_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      soil_financial_adjustments: {
        Row: SoilFinancialAdjustmentRow;
        Insert: { id?: string; factory_id: string; soil_worker_id: string; adjustment_type: "ADDITION" | "DEDUCTION"; adjustment_date: string; amount: number; reason: string; created_at?: string };
        Update: { id?: string; factory_id?: string; soil_worker_id?: string; adjustment_type?: "ADDITION" | "DEDUCTION"; adjustment_date?: string; amount?: number; reason?: string; created_at?: string };
        Relationships: [
          { foreignKeyName: "soil_financial_adjustments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "soil_financial_adjustments_worker_factory_fkey"; columns: ["soil_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "soil_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      production_wage_rates: {
        Row: ProductionWageRateRow;
        Insert: { id?: string; factory_id: string; production_crew_id?: string | null; labourer_id?: string | null; rate_per_1000_bricks: number; effective_from: string; effective_to?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; production_crew_id?: string | null; labourer_id?: string | null; rate_per_1000_bricks?: number; effective_from?: string; effective_to?: string | null; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "production_wage_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "production_wage_rates_crew_factory_fkey"; columns: ["production_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "production_crews"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_wage_rates_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      labour_groups: {
        Row: { id: string; factory_id: string; name: string; member_names: string | null; member_count: number | null; is_active: boolean; created_at: string };
        Insert: { id?: string; factory_id: string; name: string; member_names?: string | null; member_count?: number | null; is_active?: boolean; created_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; member_names?: string | null; member_count?: number | null; is_active?: boolean; created_at?: string };
        Relationships: [{ foreignKeyName: "labour_groups_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      mud_group_terms: {
        Row: MudGroupTermRow;
        Insert: { id?: string; factory_id: string; labour_group_id: string; member_count: number; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: Partial<MudGroupTermRow>;
        Relationships: [
          { foreignKeyName: "mud_group_terms_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "mud_group_terms_group_factory_fkey"; columns: ["labour_group_id", "factory_id"]; isOneToOne: false; referencedRelation: "labour_groups"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      mud_group_rates: {
        Row: MudGroupRateRow;
        Insert: { id?: string; factory_id: string; labour_group_id: string; rate_per_1000_bricks: number; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: Partial<MudGroupRateRow>;
        Relationships: [
          { foreignKeyName: "mud_group_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "mud_group_rates_group_factory_fkey"; columns: ["labour_group_id", "factory_id"]; isOneToOne: false; referencedRelation: "labour_groups"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      mud_accounting_states: {
        Row: MudAccountingStateRow;
        Insert: { factory_id: string; accounting_mode?: MudAccountingMode; updated_at?: string };
        Update: { factory_id?: string; accounting_mode?: MudAccountingMode; updated_at?: string };
        Relationships: [
          { foreignKeyName: "mud_accounting_states_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: true; referencedRelation: "factories"; referencedColumns: ["id"] }
        ];
      };
      mud_accounting_mode_transitions: {
        Row: MudAccountingModeTransitionRow;
        Insert: { id?: string; factory_id: string; old_mode: MudAccountingMode; new_mode: MudAccountingMode; changed_at?: string; actor: string };
        Update: Partial<MudAccountingModeTransitionRow>;
        Relationships: [
          { foreignKeyName: "mud_accounting_mode_transitions_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }
        ];
      };
      mud_factory_settlements: {
        Row: MudFactorySettlementRow;
        Insert: {
          id?: string;
          factory_id: string;
          previous_cutoff?: string | null;
          settled_through: string;
          settlement_type: "legacy_opening" | "checkpoint";
          triggering_labour_group_id?: string | null;
          triggering_withdrawal_id?: string | null;
          created_at?: string;
        };
        Update: Partial<MudFactorySettlementRow>;
        Relationships: [
          { foreignKeyName: "mud_factory_settlements_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "mud_factory_settlements_trigger_group_factory_fkey"; columns: ["triggering_labour_group_id", "factory_id"]; isOneToOne: false; referencedRelation: "labour_groups"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "mud_factory_settlements_triggering_withdrawal_id_fkey"; columns: ["triggering_withdrawal_id"]; isOneToOne: false; referencedRelation: "withdrawals"; referencedColumns: ["id"] }
        ];
      };
      production_entries: {
        Row: { id: string; factory_id: string; labourer_id: string; production_date: string; quantity: number; created_at: string; updated_at: string };
        Insert: { id: string; factory_id: string; labourer_id: string; production_date: string; quantity: number; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; labourer_id?: string; production_date?: string; quantity?: number; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "production_entries_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "production_entries_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      production_earning_settlements: {
        Row: ProductionEarningSettlementRow;
        Insert: {
          id?: string;
          factory_id: string;
          labourer_id: string;
          previous_settled_through?: string | null;
          settled_through: string;
          total_quantity: number;
          total_earned: number;
          settlement_type: "legacy_opening" | "withdrawal";
          withdrawal_id?: string | null;
          created_at?: string;
        };
        Update: Partial<ProductionEarningSettlementRow>;
        Relationships: [
          { foreignKeyName: "production_earning_settlements_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "production_earning_settlements_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_earning_settlements_withdrawal_fkey"; columns: ["withdrawal_id"]; isOneToOne: true; referencedRelation: "withdrawals"; referencedColumns: ["id"] }
        ];
      };
      production_earning_settlement_details: {
        Row: ProductionEarningSettlementDetailRow;
        Insert: {
          id?: string;
          settlement_id: string;
          factory_id: string;
          labourer_id: string;
          production_entry_id: string;
          work_date: string;
          quantity: number;
          production_wage_rate_id: string;
          rate_per_1000_bricks: number;
          earned_amount: number;
          created_at?: string;
        };
        Update: Partial<ProductionEarningSettlementDetailRow>;
        Relationships: [
          { foreignKeyName: "production_earning_settlement_details_settlement_fkey"; columns: ["settlement_id", "factory_id", "labourer_id"]; isOneToOne: false; referencedRelation: "production_earning_settlements"; referencedColumns: ["id", "factory_id", "labourer_id"] },
          { foreignKeyName: "production_earning_settlement_details_rate_fkey"; columns: ["production_wage_rate_id", "factory_id"]; isOneToOne: false; referencedRelation: "production_wage_rates"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_earning_settlement_details_production_entry_id_fkey"; columns: ["production_entry_id"]; isOneToOne: false; referencedRelation: "production_entries"; referencedColumns: ["id"] }
        ];
      };
      production_weekly_earning_details: {
        Row: ProductionWeeklyEarningDetailRow;
        Insert: {
          id?: string;
          factory_id: string;
          weekly_earning_id: string;
          work_date: string;
          quantity_used: number;
          production_wage_rate_id: string;
          rate_per_1000_bricks: number;
          rate_source: "crew_default" | "individual_override";
          production_crew_id?: string | null;
          amount: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          factory_id?: string;
          weekly_earning_id?: string;
          work_date?: string;
          quantity_used?: number;
          production_wage_rate_id?: string;
          rate_per_1000_bricks?: number;
          rate_source?: "crew_default" | "individual_override";
          production_crew_id?: string | null;
          amount?: number;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "production_weekly_earning_details_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "production_weekly_earning_details_parent_factory_fkey"; columns: ["weekly_earning_id", "factory_id"]; isOneToOne: false; referencedRelation: "weekly_earnings"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_weekly_earning_details_rate_factory_fkey"; columns: ["production_wage_rate_id", "factory_id"]; isOneToOne: false; referencedRelation: "production_wage_rates"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_weekly_earning_details_crew_factory_fkey"; columns: ["production_crew_id", "factory_id"]; isOneToOne: false; referencedRelation: "production_crews"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      wage_rates: {
        Row: WageRateRow;
        Insert: { id?: string; factory_id: string; applies_to: "production" | "mud_supply"; rate_per_1000_bricks: number; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; applies_to?: "production" | "mud_supply"; rate_per_1000_bricks?: number; effective_from?: string; effective_to?: string | null; created_at?: string };
        Relationships: [{ foreignKeyName: "wage_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      weekly_earnings: {
        Row: { id: string; factory_id: string; labourer_id: string | null; labour_group_id: string | null; week_start: string; quantity_used: number; wage_rate_id: string | null; rate_used: number | null; amount: number; calculated_at: string };
        Insert: { id?: string; factory_id: string; labourer_id?: string | null; labour_group_id?: string | null; week_start: string; quantity_used: number; wage_rate_id?: string | null; rate_used?: number | null; amount: number; calculated_at?: string };
        Update: { id?: string; factory_id?: string; labourer_id?: string | null; labour_group_id?: string | null; week_start?: string; quantity_used?: number; wage_rate_id?: string | null; rate_used?: number | null; amount?: number; calculated_at?: string };
        Relationships: [
          { foreignKeyName: "weekly_earnings_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "weekly_earnings_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "weekly_earnings_wage_rate_factory_fkey"; columns: ["wage_rate_id", "factory_id"]; isOneToOne: false; referencedRelation: "wage_rates"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      withdrawals: {
        Row: { id: string; factory_id: string; labourer_id: string | null; labour_group_id: string | null; withdrawal_date: string; amount: number; note: string | null; created_at: string };
        Insert: { id?: string; factory_id: string; labourer_id?: string | null; labour_group_id?: string | null; withdrawal_date: string; amount: number; note?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; labourer_id?: string | null; labour_group_id?: string | null; withdrawal_date?: string; amount?: number; note?: string | null; created_at?: string };
        Relationships: [
          { foreignKeyName: "withdrawals_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "withdrawals_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      resolve_factory_access: {
        Args: Record<PropertyKey, never>;
        Returns: { status: "active" | "inactive" | "none"; factory_id: string | null }[];
      };
      provision_first_factory: {
        Args: { p_factory_name: string };
        Returns: { factory_id: string; created: boolean }[];
      };
      update_factory_printable_profile: {
        Args: {
          p_factory_id: string;
          p_name: string;
          p_business_description: string;
          p_village: string;
          p_post_office: string;
          p_police_station: string;
          p_district: string;
          p_state: string;
          p_mobile: string;
          p_gstin: string | null;
        };
        Returns: Database["public"]["Tables"]["factories"]["Row"];
      };
      create_brick_type: {
        Args: { p_factory_id: string; p_name: string };
        Returns: BrickTypeRow;
      };
      rename_brick_type: {
        Args: { p_factory_id: string; p_brick_type_id: string; p_name: string };
        Returns: BrickTypeRow;
      };
      set_brick_type_active: {
        Args: { p_factory_id: string; p_brick_type_id: string; p_is_active: boolean };
        Returns: BrickTypeRow;
      };
      delete_unused_brick_type: {
        Args: { p_factory_id: string; p_brick_type_id: string };
        Returns: string;
      };
      create_customer: {
        Args: { p_factory_id: string; p_name: string; p_address: string; p_mobile: string };
        Returns: CustomerRow;
      };
      update_customer: {
        Args: { p_factory_id: string; p_customer_id: string; p_name: string; p_address: string; p_mobile: string };
        Returns: CustomerRow;
      };
      find_or_create_vehicle: {
        Args: { p_factory_id: string; p_vehicle_number: string; p_delivery_wage_tracking_enabled?: boolean };
        Returns: VehicleRow;
      };
      set_vehicle_delivery_wage_tracking: {
        Args: { p_factory_id: string; p_vehicle_id: string; p_enabled: boolean };
        Returns: VehicleRow;
      };
      archive_vehicle: {
        Args: { p_factory_id: string; p_vehicle_id: string };
        Returns: VehicleRow;
      };
      restore_vehicle: {
        Args: { p_factory_id: string; p_vehicle_id: string };
        Returns: VehicleRow;
      };
      get_vehicle_wage_account_summary: {
        Args: { p_factory_id: string; p_vehicle_id: string };
        Returns: {
          total_earned: number;
          total_paid: number;
          available_balance: number;
        }[];
      };
      record_vehicle_wage_payment: {
        Args: {
          p_factory_id: string;
          p_vehicle_id: string;
          p_payment_date: string;
          p_amount: number;
          p_note?: string | null;
        };
        Returns: {
          payment_id: string;
          payment_factory_id: string;
          payment_vehicle_id: string;
          payment_date: string;
          payment_amount: number;
          payment_note: string | null;
          created_at: string;
          created_by: string;
          total_earned: number;
          total_paid: number;
          available_balance: number;
        }[];
      };
      reverse_vehicle_wage_payment: {
        Args: {
          p_factory_id: string;
          p_payment_id: string;
          p_reversal_date: string;
          p_reason: string;
        };
        Returns: {
          reversal_id: string;
          reversal_factory_id: string;
          reversed_payment_id: string;
          reversal_vehicle_id: string;
          reversal_date: string;
          reversal_amount: number;
          reversal_reason: string;
          created_at: string;
          created_by: string;
          total_earned: number;
          total_paid: number;
          available_balance: number;
        }[];
      };
      create_challan: {
        Args: { p_factory_id: string; p_challan_number: string | null; p_challan_date: string; p_customer_id: string; p_vehicle_id: string | null; p_trip_labour_wage: number | null; p_items: Json; p_flexible_lines?: Json | null };
        Returns: ChallanRow;
      };
      create_challan_with_received_payment: {
        Args: {
          p_factory_id: string;
          p_challan_number: string | null;
          p_challan_date: string;
          p_customer_id: string;
          p_vehicle_id: string | null;
          p_trip_labour_wage: number | null;
          p_items: Json;
          p_flexible_lines: Json;
          p_payment_date: string;
          p_payment_amount: number;
          p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
        };
        Returns: ChallanRow;
      };
      update_challan: {
        Args: { p_factory_id: string; p_challan_id: string; p_challan_number: string | null; p_challan_date: string; p_customer_id: string; p_vehicle_id: string | null; p_trip_labour_wage: number | null; p_items: Json; p_flexible_lines?: Json | null };
        Returns: ChallanRow;
      };
      void_challan: {
        Args: { p_factory_id: string; p_challan_id: string };
        Returns: ChallanRow;
      };
      create_customer_payment: {
        Args: {
          p_factory_id: string;
          p_customer_id: string;
          p_payment_date: string;
          p_amount: number;
          p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null;
          p_allocations: Json;
        };
        Returns: CustomerPaymentRow;
      };
      create_customer_payment_with_methods: {
        Args: {
          p_factory_id: string;
          p_customer_id: string;
          p_payment_date: string;
          p_amount: number;
          p_payment_methods: Json;
          p_note: string | null;
          p_allocations: Json;
        };
        Returns: CustomerPaymentRow;
      };
      get_challan_payment_state: {
        Args: { p_factory_id: string; p_challan_id: string };
        Returns: {
          challan_id: string;
          challan_status: "active" | "void";
          sale_total: number;
          total_paid: number;
          outstanding_amount: number;
          payment_state: "unpaid" | "partially_paid" | "paid";
        }[];
      };
      get_customer_sales_summary: {
        Args: { p_factory_id: string; p_customer_id: string };
        Returns: {
          customer_id: string;
          total_active_sales: number;
          total_payments_allocated: number;
          total_outstanding: number;
        }[];
      };
      initialize_cash_book: {
        Args: { p_factory_id: string; p_start_date: string; p_opening_balance: number };
        Returns: CashBookInitializationRow;
      };
      create_cash_book_manual_entry: {
        Args: {
          p_factory_id: string;
          p_entry_id: string;
          p_business_date: string;
          p_direction: "in" | "out";
          p_amount: number;
          p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_party_details: string;
          p_note: string | null;
        };
        Returns: CashBookManualEntryRow;
      };
      void_cash_book_manual_entry: {
        Args: { p_factory_id: string; p_entry_id: string };
        Returns: CashBookManualEntryRow;
      };
      get_cash_book_day_summary: {
        Args: { p_factory_id: string; p_business_date: string };
        Returns: {
          business_date: string;
          opening_balance: number;
          total_money_in: number;
          total_money_out: number;
          closing_balance: number;
        }[];
      };
      list_cash_book_day_entries: {
        Args: { p_factory_id: string; p_business_date: string };
        Returns: {
          source_type: "customer_payment" | "manual_cash_entry" | "expense_payment" | "vehicle_wage_payment" | "vehicle_wage_payment_reversal";
          source_id: string;
          business_date: string;
          direction: "in" | "out";
          amount: number;
          payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified" | "multiple";
          counterparty: string;
          description: string;
          note: string | null;
          source_status: "active" | "void";
          created_at: string;
        }[];
      };
      create_supplier: {
        Args: { p_factory_id: string; p_name: string; p_address: string | null; p_mobile: string | null };
        Returns: SupplierRow;
      };
      update_supplier: {
        Args: { p_factory_id: string; p_supplier_id: string; p_name: string; p_address: string | null; p_mobile: string | null };
        Returns: SupplierRow;
      };
      create_expense_record: {
        Args: {
          p_factory_id: string; p_business_date: string; p_kind: "purchase" | "expense";
          p_supplier_id: string | null; p_counterparty_name: string | null;
          p_description: string; p_total_amount: number; p_note: string | null;
        };
        Returns: ExpenseRecordRow;
      };
      update_expense_record: {
        Args: {
          p_factory_id: string; p_expense_record_id: string; p_business_date: string;
          p_kind: "purchase" | "expense"; p_supplier_id: string | null;
          p_counterparty_name: string | null; p_description: string;
          p_total_amount: number; p_note: string | null;
        };
        Returns: ExpenseRecordRow;
      };
      void_expense_record: {
        Args: { p_factory_id: string; p_expense_record_id: string };
        Returns: ExpenseRecordRow;
      };
      create_expense_payment: {
        Args: {
          p_factory_id: string; p_payment_date: string; p_amount: number;
          p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null; p_allocations: Json;
        };
        Returns: ExpensePaymentRow;
      };
      list_expense_records: {
        Args: { p_factory_id: string; p_supplier_id: string | null };
        Returns: {
          expense_record_id: string; factory_id: string; business_date: string;
          kind: "purchase" | "expense"; supplier_id: string | null;
          counterparty_name_snapshot: string; counterparty_address_snapshot: string | null;
          counterparty_mobile_snapshot: string | null; description: string;
          total_amount: number; note: string | null; status: "active" | "void";
          is_locked: boolean; total_paid: number; outstanding_amount: number;
          payment_state: "unpaid" | "partially_paid" | "paid";
          voided_at: string | null; created_at: string; updated_at: string;
        }[];
      };
      get_expense_record_payment_state: {
        Args: { p_factory_id: string; p_expense_record_id: string };
        Returns: {
          expense_record_id: string; status: "active" | "void";
          kind: "purchase" | "expense"; total_amount: number; total_paid: number;
          outstanding_amount: number; payment_state: "unpaid" | "partially_paid" | "paid";
          is_locked: boolean;
        }[];
      };
      get_supplier_expense_summary: {
        Args: { p_factory_id: string; p_supplier_id: string };
        Returns: {
          supplier_id: string; active_record_count: number; total_cost: number;
          total_paid: number; total_outstanding: number;
        }[];
      };
      create_coal_reference_value: {
        Args: { p_factory_id: string; p_kind: "coal_name" | "source_location"; p_display_value: string };
        Returns: CoalReferenceValueRow;
      };
      list_coal_purchases: {
        Args: { p_factory_id: string; p_seller_id: string | null };
        Returns: CoalPurchaseDetailRow[];
      };
      create_coal_purchase: {
        Args: {
          p_factory_id: string; p_purchase_date: string; p_seller_id: string;
          p_coal_name_reference_id: string; p_source_reference_id: string;
          p_coal_challan_number: string | null; p_vehicle_number: string;
          p_quantity: number | null; p_rate: number | null; p_coal_amount: number | null;
          p_separate_freight_amount: number; p_initial_paid_amount: number;
          p_initial_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | null;
        };
        Returns: CoalPurchaseDetailRow[];
      };
      update_coal_purchase: {
        Args: {
          p_factory_id: string; p_purchase_id: string; p_purchase_date: string;
          p_seller_id: string; p_coal_name_reference_id: string;
          p_source_reference_id: string; p_coal_challan_number: string | null;
          p_vehicle_number: string; p_quantity: number | null; p_rate: number | null;
          p_coal_amount: number | null; p_separate_freight_amount: number;
        };
        Returns: CoalPurchaseDetailRow[];
      };
      void_coal_purchase: {
        Args: { p_factory_id: string; p_purchase_id: string };
        Returns: CoalPurchaseDetailRow[];
      };
      create_coal_payment: {
        Args: {
          p_factory_id: string; p_purchase_id: string; p_payment_date: string;
          p_amount: number; p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null;
        };
        Returns: ExpensePaymentRow;
      };
      list_coal_payments: {
        Args: { p_factory_id: string; p_seller_id: string | null };
        Returns: {
          payment_id: string; factory_id: string; purchase_id: string;
          seller_id: string; seller_name_snapshot: string; payment_date: string;
          amount: number; payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note: string | null; created_at: string;
        }[];
      };
      create_coal_selective_payment: {
        Args: {
          p_factory_id: string; p_seller_id: string; p_from_date: string;
          p_to_date: string; p_payment_date: string; p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null; p_allocations: Json;
        };
        Returns: ExpensePaymentRow;
      };
      list_coal_selective_payments: {
        Args: { p_factory_id: string; p_seller_id: string | null };
        Returns: {
          payment_id: string; factory_id: string; seller_id: string;
          seller_name_snapshot: string; allocation_count: number; allocations: Json;
          payment_date: string; amount: number;
          payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note: string | null; created_at: string;
        }[];
      };
      list_vehicle_maintenance_records: {
        Args: { p_factory_id: string; p_vehicle_id: string | null; p_garage_id: string | null };
        Returns: VehicleMaintenanceDetailRow[];
      };
      create_vehicle_maintenance: {
        Args: {
          p_factory_id: string; p_maintenance_date: string; p_vehicle_id: string;
          p_garage_id: string; p_work_description: string; p_total_amount: number;
          p_initial_paid_amount: number;
          p_initial_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | null;
        };
        Returns: VehicleMaintenanceDetailRow[];
      };
      update_vehicle_maintenance: {
        Args: {
          p_factory_id: string; p_maintenance_id: string; p_maintenance_date: string;
          p_vehicle_id: string; p_garage_id: string; p_work_description: string;
          p_total_amount: number;
        };
        Returns: VehicleMaintenanceDetailRow[];
      };
      void_vehicle_maintenance: {
        Args: { p_factory_id: string; p_maintenance_id: string };
        Returns: VehicleMaintenanceDetailRow[];
      };
      create_vehicle_maintenance_payment: {
        Args: {
          p_factory_id: string; p_maintenance_id: string; p_payment_date: string;
          p_amount: number; p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null;
        };
        Returns: ExpensePaymentRow;
      };
      create_vehicle_maintenance_batch_payment: {
        Args: {
          p_factory_id: string; p_garage_id: string;
          p_from_date: string; p_to_date: string; p_payment_date: string;
          p_amount: number; p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null;
        };
        Returns: ExpensePaymentRow;
      };
      list_vehicle_maintenance_payments: {
        Args: { p_factory_id: string; p_vehicle_id: string | null; p_garage_id: string | null };
        Returns: {
          payment_id: string; factory_id: string; maintenance_id: string;
          vehicle_id: string; vehicle_number_snapshot: string;
          garage_id: string; garage_name_snapshot: string; payment_date: string;
          amount: number; payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note: string | null; created_at: string;
        }[];
      };
      list_vehicle_maintenance_batch_payments: {
        Args: { p_factory_id: string; p_garage_id: string | null };
        Returns: {
          payment_id: string; factory_id: string;
          garage_id: string; garage_name_snapshot: string;
          vehicle_ids: string[]; allocation_count: number; allocations: Json;
          payment_date: string; amount: number;
          payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note: string | null; created_at: string;
        }[];
      };
      list_vehicle_fuel_records: {
        Args: { p_factory_id: string; p_vehicle_id: string | null; p_pump_id: string | null };
        Returns: VehicleFuelDetailRow[];
      };
      get_previous_vehicle_refuel: {
        Args: {
          p_factory_id: string; p_vehicle_id: string; p_before_date: string;
          p_before_time: string; p_exclude_fuel_record_id: string | null;
        };
        Returns: VehicleFuelDetailRow[];
      };
      create_vehicle_fuel: {
        Args: {
          p_factory_id: string; p_fuel_date: string; p_fuel_time: string;
          p_vehicle_id: string; p_pump_id: string; p_fuel_type: "DIESEL" | "PETROL";
          p_litres: number | null; p_rate_per_litre: number | null;
          p_fuel_amount: number | null; p_initial_paid_amount: number;
          p_initial_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | null;
        };
        Returns: VehicleFuelDetailRow[];
      };
      update_vehicle_fuel: {
        Args: {
          p_factory_id: string; p_fuel_record_id: string; p_fuel_date: string;
          p_fuel_time: string; p_vehicle_id: string; p_pump_id: string;
          p_fuel_type: "DIESEL" | "PETROL"; p_litres: number | null;
          p_rate_per_litre: number | null; p_fuel_amount: number | null;
        };
        Returns: VehicleFuelDetailRow[];
      };
      void_vehicle_fuel: {
        Args: { p_factory_id: string; p_fuel_record_id: string };
        Returns: VehicleFuelDetailRow[];
      };
      create_vehicle_fuel_payment: {
        Args: {
          p_factory_id: string; p_fuel_record_id: string; p_payment_date: string;
          p_amount: number; p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null;
        };
        Returns: ExpensePaymentRow;
      };
      list_vehicle_fuel_payments: {
        Args: { p_factory_id: string; p_vehicle_id: string | null; p_pump_id: string | null };
        Returns: {
          payment_id: string; factory_id: string; fuel_record_id: string;
          vehicle_id: string; vehicle_number_snapshot: string;
          pump_id: string; pump_name_snapshot: string; payment_date: string;
          amount: number; payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note: string | null; created_at: string;
        }[];
      };
      create_vehicle_fuel_batch_payment: {
        Args: {
          p_factory_id: string; p_pump_id: string;
          p_from_date: string; p_to_date: string; p_payment_date: string;
          p_amount: number; p_payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          p_note: string | null;
        };
        Returns: ExpensePaymentRow;
      };
      list_vehicle_fuel_batch_payments: {
        Args: { p_factory_id: string; p_pump_id: string | null };
        Returns: {
          payment_id: string; factory_id: string; pump_id: string; pump_name: string;
          vehicle_ids: string[]; allocation_count: number; allocations: Json;
          payment_date: string;
          amount: number; payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
          note: string | null; created_at: string;
        }[];
      };
      list_suppliers_by_role: {
        Args: { p_factory_id: string; p_role: "COAL_SELLER" | "GARAGE" | "FUEL_PUMP" };
        Returns: SupplierRow[];
      };
      create_or_assign_supplier_role: {
        Args: {
          p_factory_id: string; p_role: "COAL_SELLER" | "GARAGE" | "FUEL_PUMP";
          p_name: string; p_address: string | null; p_mobile: string | null;
        };
        Returns: SupplierRow;
      };
      assign_labourer_to_production_crew: {
        Args: { p_factory_id: string; p_labourer_id: string; p_production_crew_id: string; p_effective_from: string };
        Returns: ProductionCrewAssignmentRow;
      };
      end_labourer_production_crew_assignment: {
        Args: { p_factory_id: string; p_labourer_id: string; p_effective_to: string };
        Returns: ProductionCrewAssignmentRow;
      };
      create_wage_rate: {
        Args: { p_factory_id: string; p_applies_to: "production" | "mud_supply"; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: WageRateRow;
      };
      get_mud_group_daily_allocation: {
        Args: { p_factory_id: string; p_production_date: string };
        Returns: MudGroupDailyAllocationRow[];
      };
      get_mud_group_range_allocation: {
        Args: { p_factory_id: string; p_from_date: string; p_to_date: string };
        Returns: MudGroupRangeAllocationRow[];
      };
      get_mud_shadow_weekly_comparisons: {
        Args: { p_factory_id: string; p_from_week_start: string; p_to_week_start: string };
        Returns: MudShadowWeeklyComparisonRow[];
      };
      get_mud_shadow_certification_status: {
        Args: { p_factory_id: string };
        Returns: MudShadowCertificationRow[];
      };
      get_mud_cutover_readiness: {
        Args: { p_factory_id: string };
        Returns: MudCutoverReadinessRow[];
      };
      get_mud_group_configuration: {
        Args: { p_factory_id: string; p_as_of_date: string };
        Returns: MudGroupConfigurationRow[];
      };
      get_mud_group_settlement_account: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_as_of_date: string };
        Returns: MudSettlementAccountRow[];
      };
      create_mud_settlement_withdrawal: {
        Args: {
          p_factory_id: string; p_withdrawal_id: string; p_labour_group_id: string;
          p_withdrawal_date: string; p_settlement_cutoff: string; p_amount: number;
        };
        Returns: MudSettlementWithdrawalRow[];
      };
      execute_mud_settlement_cutover: {
        Args: { p_factory_id: string; p_proposed_legacy_cutoff: string };
        Returns: MudSettlementCutoverRow[];
      };
      transition_mud_accounting_mode: {
        Args: { p_factory_id: string; p_new_mode: MudAccountingMode };
        Returns: MudAccountingStateRow[];
      };
      create_mud_group: {
        Args: { p_factory_id: string; p_name: string; p_member_count: number; p_earning_start_date: string; p_initial_rate: number; p_rate_effective_date: string };
        Returns: string;
      };
      set_mud_group_member_count: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_member_count: number; p_effective_from: string };
        Returns: string;
      };
      set_mud_group_rate: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: string;
      };
      stop_mud_group_earning: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_stop_date: string };
        Returns: string;
      };
      restart_mud_group_earning: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_member_count: number; p_restart_date: string };
        Returns: string;
      };
      set_mud_supply_rate: {
        Args: { p_factory_id: string; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: WageRateRow;
      };
      create_production_crew_wage_rate: {
        Args: { p_factory_id: string; p_production_crew_id: string; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: ProductionWageRateRow;
      };
      create_labourer_production_wage_rate_override: {
        Args: { p_factory_id: string; p_labourer_id: string; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: ProductionWageRateRow;
      };
      set_production_labourer_rates: {
        Args: { p_factory_id: string; p_labourer_ids: string[]; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: ProductionWageRateRow[];
      };
      set_production_labourer_origin: {
        Args: { p_factory_id: string; p_labourer_id: string; p_origin_label: string | null };
        Returns: Database["public"]["Tables"]["labourers"]["Row"];
      };
      create_transport_crew_wage_rate: {
        Args: { p_factory_id: string; p_transport_crew_id: string; p_effective_from: string; p_rate_per_paya: number };
        Returns: TransportCrewWageRateRow;
      };
      create_staff_worker_with_reference_salary: {
        Args: { p_factory_id: string; p_name: string; p_staff_category_id: string; p_reference_salary: number };
        Returns: StaffWorkerRow;
      };
      create_soil_worker_with_initial_trolley_rate: {
        Args: { p_factory_id: string; p_name: string; p_initial_rate_per_trolley: number; p_initial_effective_from: string };
        Returns: SoilWorkerRow;
      };
      create_soil_worker_trolley_rate: {
        Args: { p_factory_id: string; p_soil_worker_id: string; p_rate_per_trolley: number; p_effective_from: string };
        Returns: SoilWorkerTrolleyRateRow;
      };
      resolve_soil_worker_trolley_rate: {
        Args: { p_factory_id: string; p_soil_worker_id: string; p_work_date: string };
        Returns: SoilWorkerTrolleyRateRow;
      };
      archive_soil_worker: {
        Args: { p_factory_id: string; p_soil_worker_id: string };
        Returns: SoilWorkerRow;
      };
      restore_soil_worker: {
        Args: { p_factory_id: string; p_soil_worker_id: string };
        Returns: SoilWorkerRow;
      };
      delete_unused_soil_worker: {
        Args: { p_factory_id: string; p_soil_worker_id: string };
        Returns: string;
      };
      save_soil_daily_trolley_entries: {
        Args: { p_factory_id: string; p_work_date: string; p_entries: Json };
        Returns: SoilDailyTrolleyEntryRow[];
      };
      get_soil_total_earned: {
        Args: { p_factory_id: string; p_soil_worker_id: string };
        Returns: { total_earned: number }[];
      };
      get_soil_financial_summary: {
        Args: { p_factory_id: string; p_soil_worker_id: string };
        Returns: { total_earned: number; total_additions: number; total_deductions: number; total_paid: number; available_balance: number }[];
      };
      create_soil_payment: {
        Args: { p_factory_id: string; p_soil_worker_id: string; p_payment_date: string; p_amount: number };
        Returns: {
          payment_id: string;
          payment_factory_id: string;
          payment_soil_worker_id: string;
          payment_date: string;
          payment_amount: number;
          created_at: string;
          total_earned: number;
          total_paid: number;
          available_balance: number;
        }[];
      };
      create_soil_financial_adjustment: {
        Args: { p_factory_id: string; p_soil_worker_id: string; p_adjustment_type: "ADDITION" | "DEDUCTION"; p_adjustment_date: string; p_amount: number; p_reason: string };
        Returns: {
          adjustment_id: string;
          adjustment_factory_id: string;
          adjustment_soil_worker_id: string;
          adjustment_type: "ADDITION" | "DEDUCTION";
          adjustment_date: string;
          adjustment_amount: number;
          adjustment_reason: string;
          created_at: string;
          total_earned: number;
          total_additions: number;
          total_deductions: number;
          total_paid: number;
          available_balance: number;
        }[];
      };
      update_staff_category: {
        Args: { p_factory_id: string; p_staff_category_id: string; p_name: string };
        Returns: StaffCategoryRow;
      };
      delete_staff_category: {
        Args: { p_factory_id: string; p_staff_category_id: string };
        Returns: string;
      };
      update_staff_reference_salary: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_reference_salary: number };
        Returns: StaffWorkerRow;
      };
      archive_staff_worker: {
        Args: { p_factory_id: string; p_staff_worker_id: string };
        Returns: StaffWorkerRow;
      };
      restore_staff_worker: {
        Args: { p_factory_id: string; p_staff_worker_id: string };
        Returns: StaffWorkerRow;
      };
      delete_staff_worker: {
        Args: { p_factory_id: string; p_staff_worker_id: string };
        Returns: string;
      };
      record_staff_payment: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_payment_date: string; p_amount: number; p_note?: string | null };
        Returns: {
          payment_id: string;
          payment_factory_id: string;
          payment_staff_worker_id: string;
          payment_date: string;
          payment_amount: number;
          payment_note: string | null;
          created_at: string;
          total_paid: number;
        }[];
      };
      get_staff_payment_summary: {
        Args: { p_factory_id: string; p_staff_worker_id: string };
        Returns: { total_paid: number }[];
      };
      calculate_production_wages: {
        Args: { p_factory_id: string; p_week_start: string };
        Returns: { labourers_calculated: number; rows_skipped: number }[];
      };
      calculate_transport_weekly_wages: {
        Args: { p_factory_id: string; p_week_start: string };
        Returns: { workers_calculated: number; detail_rows_created: number; rows_skipped: number }[];
      };
      save_transport_daily_entry: {
        Args: { p_factory_id: string; p_transport_crew_id: string; p_work_date: string; p_paya_quantity: number; p_transport_worker_ids: string[] };
        Returns: { daily_entry_id: string; attendance_count: number; saved_paya_quantity: number }[];
      };
      create_transport_wage_credit: {
        Args: { p_factory_id: string; p_credit_id: string; p_transport_worker_id: string; p_original_work_date: string; p_amount: string; p_reason: string };
        Returns: { credit_id: string; factory_id: string; transport_worker_id: string; original_work_date: string; posting_date: string; amount: number; reason: string; actor_id: string; created_at: string; was_replayed: boolean }[];
      };
      get_transport_worker_available_balance: {
        Args: { p_factory_id: string; p_transport_worker_id: string; p_as_of_date: string };
        Returns: { total_earned: number; total_withdrawn: number; available_balance: number }[];
      };
      create_transport_worker_withdrawal: {
        Args: { p_factory_id: string; p_transport_worker_id: string; p_withdrawal_date: string; p_amount: number };
        Returns: {
          withdrawal_id: string;
          withdrawal_factory_id: string;
          withdrawal_transport_worker_id: string;
          withdrawal_date: string;
          withdrawal_amount: number;
          created_at: string;
          available_balance: number;
        }[];
      };
      calculate_mud_supply_wages: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_week_start: string };
        Returns: { weekly_earning_id: string; groups_calculated: number; rows_skipped: number }[];
      };
      create_labourer_withdrawal: {
        Args: { p_factory_id: string; p_labourer_id: string; p_withdrawal_date: string; p_settlement_cutoff: string; p_amount: number };
        Returns: {
          withdrawal_id: string;
          withdrawal_factory_id: string;
          withdrawal_labourer_id: string;
          withdrawal_date: string;
          withdrawal_amount: number;
          created_at: string;
          available_balance: number;
          settlement_id: string;
          settled_through: string;
        }[];
      };
      get_production_labourer_account: {
        Args: { p_factory_id: string; p_labourer_id: string; p_as_of_date: string };
        Returns: {
          settled_earned: number;
          live_earned: number;
          total_earned: number;
          total_withdrawn: number;
          available_balance: number;
          latest_settlement_cutoff: string | null;
        }[];
      };
      save_production_entry: {
        Args: {
          p_factory_id: string;
          p_entry_id: string;
          p_labourer_id: string;
          p_production_date: string;
          p_quantity: number;
        };
        Returns: Database["public"]["Tables"]["production_entries"]["Row"][];
      };
      create_labour_group_withdrawal: {
        Args: { p_factory_id: string; p_labour_group_id: string; p_withdrawal_date: string; p_amount: number };
        Returns: {
          withdrawal_id: string;
          withdrawal_factory_id: string;
          withdrawal_labour_group_id: string;
          withdrawal_date: string;
          withdrawal_amount: number;
          created_at: string;
          available_balance: number;
        }[];
      };
    };
    Enums: {
      mud_accounting_mode: MudAccountingMode;
    };
    CompositeTypes: {
      coal_purchase_detail: CoalPurchaseDetailRow;
    };
  };
};
