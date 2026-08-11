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
      wage_rates: {
        Row: WageRateRow;
        Insert: { id?: string; factory_id: string; applies_to: "production" | "mud_supply"; rate_per_1000_bricks: number; effective_from: string; effective_to?: string | null; created_at?: string };
        Update: { id?: string; factory_id?: string; applies_to?: "production" | "mud_supply"; rate_per_1000_bricks?: number; effective_from?: string; effective_to?: string | null; created_at?: string };
        Relationships: [{ foreignKeyName: "wage_rates_factory_id_fkey"; columns: ["factory_id"]; isOneToOne: false; referencedRelation: "factories"; referencedColumns: ["id"] }];
      };
      weekly_earnings: {
        Row: { id: string; factory_id: string; labourer_id: string | null; labour_group_id: string | null; week_start: string; quantity_used: number; wage_rate_id: string; rate_used: number; amount: number; calculated_at: string };
        Insert: { id?: string; factory_id: string; labourer_id?: string | null; labour_group_id?: string | null; week_start: string; quantity_used: number; wage_rate_id: string; rate_used: number; amount: number; calculated_at?: string };
        Update: { id?: string; factory_id?: string; labourer_id?: string | null; labour_group_id?: string | null; week_start?: string; quantity_used?: number; wage_rate_id?: string; rate_used?: number; amount?: number; calculated_at?: string };
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
      create_wage_rate: {
        Args: { p_factory_id: string; p_applies_to: "production" | "mud_supply"; p_rate_per_1000_bricks: number; p_effective_from: string };
        Returns: WageRateRow;
      };
      calculate_production_wages: {
        Args: { p_factory_id: string; p_week_start: string };
        Returns: { labourers_calculated: number; rows_skipped: number }[];
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
