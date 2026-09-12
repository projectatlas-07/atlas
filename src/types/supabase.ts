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

type TransportCrewRow = {
  id: string;
  factory_id: string;
  name: string;
  work_direction: "FIELD_TO_KILN" | "KILN_TO_FIELD";
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
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
  note: string | null;
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

type CustomerPaymentAllocationRow = {
  id: string;
  factory_id: string;
  payment_id: string;
  challan_id: string;
  allocated_amount: number;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      factories: {
        Row: { id: string; name: string; business_description: string; village: string; post_office: string; police_station: string; district: string; state: string; address: string; mobile: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; business_description?: string; village?: string; post_office?: string; police_station?: string; district?: string; state?: string; address?: string; mobile?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; business_description?: string; village?: string; post_office?: string; police_station?: string; district?: string; state?: string; address?: string; mobile?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      factory_users: {
        Row: { id: string; user_id: string; factory_id: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; user_id: string; factory_id: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; user_id?: string; factory_id?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "factory_users_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      brick_types: {
        Row: { id: string; factory_id: string; name: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
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
          payment_mode?: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<CustomerPaymentRow, "id">> & { id?: string };
        Relationships: [
          { foreignKeyName: "customer_payments_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "customer_payments_customer_factory_fkey"; columns: ["customer_id", "factory_id"]; isOneToOne: false; referencedRelation: "customers"; referencedColumns: ["id", "factory_id"] }
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
      labourers: {
        Row: { id: string; factory_id: string; name: string; assigned_brick_type_id: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; factory_id: string; name: string; assigned_brick_type_id: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; assigned_brick_type_id?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "labourers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "labourers_assigned_brick_type_factory_fkey"; columns: ["assigned_brick_type_id", "factory_id"]; isOneToOne: false; referencedRelation: "brick_types"; referencedColumns: ["id", "factory_id"] }
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
        Row: TransportCrewRow;
        Insert: { id?: string; factory_id: string; name: string; work_direction: "FIELD_TO_KILN" | "KILN_TO_FIELD"; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; work_direction?: "FIELD_TO_KILN" | "KILN_TO_FIELD"; is_active?: boolean; created_at?: string; updated_at?: string };
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
      production_entries: {
        Row: { id: string; factory_id: string; labourer_id: string; brick_type_id: string; production_date: string; quantity: number; created_at: string; updated_at: string };
        Insert: { id: string; factory_id: string; labourer_id: string; brick_type_id: string; production_date: string; quantity: number; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; labourer_id?: string; brick_type_id?: string; production_date?: string; quantity?: number; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "production_entries_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "production_entries_labourer_factory_fkey"; columns: ["labourer_id", "factory_id"]; isOneToOne: false; referencedRelation: "labourers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "production_entries_brick_type_factory_fkey"; columns: ["brick_type_id", "factory_id"]; isOneToOne: false; referencedRelation: "brick_types"; referencedColumns: ["id", "factory_id"] }
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
        };
        Returns: Database["public"]["Tables"]["factories"]["Row"];
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
          payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
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
      create_production_crew_wage_rate: {
        Args: { p_factory_id: string; p_production_crew_id: string; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: ProductionWageRateRow;
      };
      create_labourer_production_wage_rate_override: {
        Args: { p_factory_id: string; p_labourer_id: string; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: ProductionWageRateRow;
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
        Args: { p_factory_id: string; p_labourer_id: string; p_withdrawal_date: string; p_amount: number };
        Returns: {
          withdrawal_id: string;
          withdrawal_factory_id: string;
          withdrawal_labourer_id: string;
          withdrawal_date: string;
          withdrawal_amount: number;
          created_at: string;
          available_balance: number;
        }[];
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
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
