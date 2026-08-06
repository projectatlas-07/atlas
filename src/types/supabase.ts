export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
