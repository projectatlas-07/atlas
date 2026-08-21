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
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type StaffWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  staff_category_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type StaffMonthlySalaryRateRow = {
  id: string;
  factory_id: string;
  staff_category_id: string | null;
  staff_worker_id: string | null;
  monthly_salary: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type StaffSalaryEligibilityPeriodRow = {
  id: string;
  factory_id: string;
  staff_worker_id: string;
  effective_from_month: string;
  effective_to_month: string | null;
  first_month_custom_salary: number | null;
  created_at: string;
  updated_at: string;
};

type StaffMonthlyEarningRow = {
  id: string;
  factory_id: string;
  staff_worker_id: string;
  salary_month: string;
  credited_amount: number;
  salary_configuration_id: string;
  resolved_monthly_salary_snapshot: number;
  salary_source_snapshot: "CATEGORY_DEFAULT" | "STAFF_OVERRIDE";
  credit_source: "NORMAL_SALARY" | "FIRST_MONTH_CUSTOM";
  staff_category_id_snapshot: string;
  created_at: string;
};

type StaffWithdrawalRow = {
  id: string;
  factory_id: string;
  staff_worker_id: string;
  withdrawal_date: string;
  amount: number;
  created_at: string;
};

type StaffSalaryDeductionRow = {
  id: string;
  factory_id: string;
  staff_worker_id: string;
  deduction_date: string;
  amount: number;
  reason: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      factories: {
        Row: { id: string; name: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; created_at?: string; updated_at?: string };
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
        Insert: { id?: string; factory_id: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [{ foreignKeyName: "staff_categories_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      staff_workers: {
        Row: StaffWorkerRow;
        Insert: { id?: string; factory_id: string; name: string; staff_category_id: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; name?: string; staff_category_id?: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "staff_workers_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_workers_category_factory_fkey"; columns: ["staff_category_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_categories"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_monthly_salary_rates: {
        Row: StaffMonthlySalaryRateRow;
        Insert: { id?: string; factory_id: string; staff_category_id?: string | null; staff_worker_id?: string | null; monthly_salary: number; effective_from: string; effective_to?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; staff_category_id?: string | null; staff_worker_id?: string | null; monthly_salary?: number; effective_from?: string; effective_to?: string | null; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "staff_monthly_salary_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_monthly_salary_rates_category_factory_fkey"; columns: ["staff_category_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_categories"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "staff_monthly_salary_rates_worker_factory_fkey"; columns: ["staff_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_salary_eligibility_periods: {
        Row: StaffSalaryEligibilityPeriodRow;
        Insert: { id?: string; factory_id: string; staff_worker_id: string; effective_from_month: string; effective_to_month?: string | null; first_month_custom_salary?: number | null; created_at?: string; updated_at?: string };
        Update: { id?: string; factory_id?: string; staff_worker_id?: string; effective_from_month?: string; effective_to_month?: string | null; first_month_custom_salary?: number | null; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: "staff_salary_eligibility_periods_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_salary_eligibility_periods_worker_factory_fkey"; columns: ["staff_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_monthly_earnings: {
        Row: StaffMonthlyEarningRow;
        Insert: { id?: string; factory_id: string; staff_worker_id: string; salary_month: string; credited_amount: number; salary_configuration_id: string; resolved_monthly_salary_snapshot: number; salary_source_snapshot: "CATEGORY_DEFAULT" | "STAFF_OVERRIDE"; credit_source: "NORMAL_SALARY" | "FIRST_MONTH_CUSTOM"; staff_category_id_snapshot: string; created_at?: string };
        Update: { id?: string; factory_id?: string; staff_worker_id?: string; salary_month?: string; credited_amount?: number; salary_configuration_id?: string; resolved_monthly_salary_snapshot?: number; salary_source_snapshot?: "CATEGORY_DEFAULT" | "STAFF_OVERRIDE"; credit_source?: "NORMAL_SALARY" | "FIRST_MONTH_CUSTOM"; staff_category_id_snapshot?: string; created_at?: string };
        Relationships: [
          { foreignKeyName: "staff_monthly_earnings_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_monthly_earnings_worker_factory_fkey"; columns: ["staff_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_workers"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "staff_monthly_earnings_configuration_factory_fkey"; columns: ["salary_configuration_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_monthly_salary_rates"; referencedColumns: ["id", "factory_id"] },
          { foreignKeyName: "staff_monthly_earnings_category_factory_fkey"; columns: ["staff_category_id_snapshot", "factory_id"]; isOneToOne: false; referencedRelation: "staff_categories"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_withdrawals: {
        Row: StaffWithdrawalRow;
        Insert: { id?: string; factory_id: string; staff_worker_id: string; withdrawal_date: string; amount: number; created_at?: string };
        Update: { id?: string; factory_id?: string; staff_worker_id?: string; withdrawal_date?: string; amount?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: "staff_withdrawals_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_withdrawals_worker_factory_fkey"; columns: ["staff_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_workers"; referencedColumns: ["id", "factory_id"] }
        ];
      };
      staff_salary_deductions: {
        Row: StaffSalaryDeductionRow;
        Insert: { id?: string; factory_id: string; staff_worker_id: string; deduction_date: string; amount: number; reason?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; staff_worker_id?: string; deduction_date?: string; amount?: number; reason?: string | null; created_at?: string };
        Relationships: [
          { foreignKeyName: "staff_salary_deductions_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] },
          { foreignKeyName: "staff_salary_deductions_worker_factory_fkey"; columns: ["staff_worker_id", "factory_id"]; isOneToOne: false; referencedRelation: "staff_workers"; referencedColumns: ["id", "factory_id"] }
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
      create_staff_category_monthly_salary: {
        Args: { p_factory_id: string; p_staff_category_id: string; p_monthly_salary: number; p_effective_from: string };
        Returns: StaffMonthlySalaryRateRow;
      };
      create_staff_worker: {
        Args: { p_factory_id: string; p_name: string; p_staff_category_id: string; p_salary_start_month: string; p_first_month_custom_salary: number | null };
        Returns: StaffWorkerRow;
      };
      deactivate_staff_worker: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_deactivation_month: string };
        Returns: StaffWorkerRow;
      };
      delete_staff_worker: {
        Args: { p_factory_id: string; p_staff_worker_id: string };
        Returns: string;
      };
      reactivate_staff_worker: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_salary_restart_month: string };
        Returns: StaffWorkerRow;
      };
      ensure_staff_monthly_earnings: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_through_month: string };
        Returns: { earnings_created: number; first_created_month: string | null; last_created_month: string | null }[];
      };
      get_staff_financial_summary: {
        Args: { p_factory_id: string; p_staff_worker_id: string };
        Returns: { total_earnings: number; total_deductions: number; total_withdrawn: number; available_balance: number }[];
      };
      create_staff_withdrawal: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_withdrawal_date: string; p_amount: number };
        Returns: {
          withdrawal_id: string;
          withdrawal_factory_id: string;
          withdrawal_staff_worker_id: string;
          withdrawal_date: string;
          withdrawal_amount: number;
          created_at: string;
          total_earnings: number;
          total_deductions: number;
          total_withdrawn: number;
          available_balance: number;
        }[];
      };
      create_staff_salary_deduction: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_deduction_date: string; p_amount: number; p_reason: string | null };
        Returns: {
          deduction_id: string;
          deduction_factory_id: string;
          deduction_staff_worker_id: string;
          deduction_date: string;
          deduction_amount: number;
          deduction_reason: string | null;
          created_at: string;
          total_earnings: number;
          total_deductions: number;
          total_withdrawn: number;
          available_balance: number;
        }[];
      };
      create_staff_monthly_salary_override: {
        Args: { p_factory_id: string; p_staff_worker_id: string; p_monthly_salary: number; p_effective_from: string };
        Returns: StaffMonthlySalaryRateRow;
      };
      resolve_staff_monthly_salary: {
        Args: { p_factory_id: string; p_staff_id: string; p_effective_date: string };
        Returns: { salary_configuration_id: string; monthly_salary: number; source: "STAFF_OVERRIDE" | "CATEGORY_DEFAULT"; staff_category_id: string }[];
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
