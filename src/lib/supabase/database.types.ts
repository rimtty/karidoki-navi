/**
 * The small generated-schema subset used by the web client.
 *
 * Keeping RPC and table shapes here makes changes to the SQL contract visible
 * at the TypeScript boundary.  The adapters still validate values at runtime,
 * because Postgres numeric columns can arrive as strings over PostgREST.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      account_members: {
        Row: {
          account_id: string;
          user_id: string;
          role: "OWNER" | "MEMBER";
          created_at: string;
        };
        Insert: Partial<{
          account_id: string;
          user_id: string;
          role: "OWNER" | "MEMBER";
          created_at: string;
        }>;
        Update: Partial<{
          account_id: string;
          user_id: string;
          role: "OWNER" | "MEMBER";
          created_at: string;
        }>;
        Relationships: [];
      };
      rice_varieties: {
        Row: {
          id: string;
          name: string;
          name_kana: string | null;
          owner_account_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<{
          id: string;
          name: string;
          name_kana: string | null;
          owner_account_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Update: Partial<{
          id: string;
          name: string;
          name_kana: string | null;
          owner_account_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      rule_regions: {
        Row: {
          id: string;
          kind: "COUNTRY" | "PREFECTURE" | "MUNICIPALITY" | "CUSTOM";
          code: string | null;
          name: string;
          parent_region_id: string | null;
          specificity: number;
          elevation_min_m: number | string | null;
          elevation_max_m: number | string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<{
          id: string;
          kind: "COUNTRY" | "PREFECTURE" | "MUNICIPALITY" | "CUSTOM";
          code: string | null;
          name: string;
          parent_region_id: string | null;
          specificity: number;
          elevation_min_m: number | string | null;
          elevation_max_m: number | string | null;
          created_at: string;
          updated_at: string;
        }>;
        Update: Partial<{
          id: string;
          kind: "COUNTRY" | "PREFECTURE" | "MUNICIPALITY" | "CUSTOM";
          code: string | null;
          name: string;
          parent_region_id: string | null;
          specificity: number;
          elevation_min_m: number | string | null;
          elevation_max_m: number | string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      account_variety_rules: {
        Row: {
          id: string;
          account_id: string;
          variety_id: string;
          region_id: string | null;
          harvest_start_temp_c: number | string;
          harvest_target_temp_c: number | string;
          harvest_end_temp_c: number | string;
          accumulation_start_offset_days: number;
          source_note: string;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<{
          id: string;
          account_id: string;
          variety_id: string;
          region_id: string | null;
          harvest_start_temp_c: number | string;
          harvest_target_temp_c: number | string;
          harvest_end_temp_c: number | string;
          accumulation_start_offset_days: number;
          source_note: string;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Update: Partial<{
          id: string;
          account_id: string;
          variety_id: string;
          region_id: string | null;
          harvest_start_temp_c: number | string;
          harvest_target_temp_c: number | string;
          harvest_end_temp_c: number | string;
          accumulation_start_offset_days: number;
          source_note: string;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_field_overview: {
        Args: { p_year: number };
        Returns: Array<{
          field_id: string;
          field_name: string;
          field_size_class: "SMALL" | "MEDIUM" | "LARGE";
          season_id: string | null;
          season_year: number | null;
          variety_id: string | null;
          variety_name: string | null;
          planting_date: string | null;
          heading_date: string | null;
          harvest_date: string | null;
          accumulated_temp_c: number | string | null;
          maturity_status:
            | "NOT_CONFIGURED"
            | "BEFORE_HEADING"
            | "GROWING"
            | "GROWING_LATE"
            | "HARVEST_SOON"
            | "HARVEST_READY"
            | "OVERDUE"
            | "HARVESTED"
            | null;
          data_status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "STALE" | "ERROR" | null;
          accumulated_through: string | null;
          missing_day_count: number | null;
          estimated_days_to_start: number | null;
        }>;
      };
      get_field_detail_simple: {
        Args: { p_field_id: string; p_year?: number | null };
        Returns: Array<{
          field_id: string;
          field_name: string;
          field_size_class: "SMALL" | "MEDIUM" | "LARGE";
          season_id: string | null;
          season_year: number | null;
          variety_id: string | null;
          variety_name: string | null;
          planting_date: string | null;
          heading_date: string | null;
          harvest_date: string | null;
          harvest_accumulated_temp_c: number | string | null;
          lifecycle_status: "ACTIVE" | "HARVESTED" | "ARCHIVED" | null;
          accumulated_temp_c: number | string | null;
          maturity_status:
            | "NOT_CONFIGURED"
            | "BEFORE_HEADING"
            | "GROWING"
            | "GROWING_LATE"
            | "HARVEST_SOON"
            | "HARVEST_READY"
            | "OVERDUE"
            | "HARVESTED"
            | null;
          data_status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "STALE" | "ERROR" | null;
          accumulated_through: string | null;
          valid_day_count: number | null;
          missing_day_count: number | null;
          estimated_days_to_start: number | null;
        }>;
      };
      get_field_map: {
        Args: {
          p_year: number;
          p_min_lng?: number;
          p_min_lat?: number;
          p_max_lng?: number;
          p_max_lat?: number;
        };
        Returns: Array<{
          field_id: string;
          field_name: string;
          geom_geojson: Json;
          area_m2: number | string;
          season_id: string | null;
          season_year: number | null;
          variety_id: string | null;
          variety_name: string | null;
          heading_date: string | null;
          harvest_date: string | null;
          accumulated_temp_c: number | string | null;
          maturity_status:
            | "NOT_CONFIGURED"
            | "BEFORE_HEADING"
            | "GROWING"
            | "GROWING_LATE"
            | "HARVEST_SOON"
            | "HARVEST_READY"
            | "OVERDUE"
            | "HARVESTED"
            | null;
          data_status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "STALE" | "ERROR" | null;
          accumulated_through: string | null;
        }>;
      };
      get_field_detail: {
        Args: {
          p_field_id: string;
          p_year?: number | null;
        };
        Returns: Array<{
          field_id: string;
          field_name: string;
          geom_geojson: Json;
          area_m2: number | string;
          season_id: string | null;
          season_year: number | null;
          variety_id: string | null;
          variety_name: string | null;
          heading_date: string | null;
          harvest_date: string | null;
          harvest_accumulated_temp_c: number | string | null;
          lifecycle_status: "ACTIVE" | "HARVESTED" | "ARCHIVED" | null;
          accumulated_temp_c: number | string | null;
          maturity_status:
            | "NOT_CONFIGURED"
            | "BEFORE_HEADING"
            | "GROWING"
            | "GROWING_LATE"
            | "HARVEST_SOON"
            | "HARVEST_READY"
            | "OVERDUE"
            | "HARVESTED"
            | null;
          data_status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "STALE" | "ERROR" | null;
          accumulated_through: string | null;
          valid_day_count: number | null;
          missing_day_count: number | null;
          estimated_days_to_start: number | null;
        }>;
      };
      register_field_with_season: {
        Args: {
          p_idempotency_key: string;
          p_field_name: string;
          p_geom_geojson: Json;
          p_year: number;
          p_variety_id?: string | null;
          p_heading_date?: string | null;
          p_parcel_source?: string | null;
          p_parcel_external_id?: string | null;
          p_parcel_dataset_version?: string | null;
        };
        Returns: Array<{
          field_id: string;
          crop_season_id: string;
          area_m2: number | string;
          was_replayed: boolean;
        }>;
      };
      create_account_rice_variety: {
        Args: {
          p_account_id: string;
          p_name: string;
        };
        Returns: Array<Database["public"]["Tables"]["rice_varieties"]["Row"]>;
      };
      register_simple_field_with_season: {
        Args: {
          p_idempotency_key: string;
          p_field_name: string;
          p_size_class: "SMALL" | "MEDIUM" | "LARGE";
          p_year: number;
          p_variety_id: string;
          p_planting_date?: string | null;
          p_heading_date?: string | null;
        };
        Returns: Array<{
          field_id: string;
          crop_season_id: string;
          size_class: "SMALL" | "MEDIUM" | "LARGE";
          was_replayed: boolean;
        }>;
      };
      register_harvest: {
        Args: {
          p_crop_season_id: string;
          p_harvest_date: string;
          p_harvest_accumulated_temp_c?: number | string | null;
        };
        Returns: Array<{
          crop_season_id: string;
          harvest_date: string;
          harvest_accumulated_temp_c: number | string | null;
          lifecycle_status: "ACTIVE" | "HARVESTED" | "ARCHIVED";
        }>;
      };
      save_account_variety_rule: {
        Args: {
          p_account_id: string;
          p_variety_id: string;
          p_harvest_start_temp_c: number | string;
          p_harvest_target_temp_c: number | string;
          p_harvest_end_temp_c: number | string;
          p_accumulation_start_offset_days: number;
          p_source_note: string;
          p_effective_from: string;
          p_rule_id?: string | null;
          p_region_id?: string | null;
          p_effective_to?: string | null;
        };
        Returns: Array<Database["public"]["Tables"]["account_variety_rules"]["Row"]>;
      };
      list_account_variety_rules: {
        Args: {
          p_account_id: string;
          p_variety_id?: string | null;
        };
        Returns: Array<Database["public"]["Tables"]["account_variety_rules"]["Row"]>;
      };
      delete_account_variety_rule: {
        Args: {
          p_account_id: string;
          p_rule_id: string;
        };
        Returns: boolean;
      };
      get_parcel_candidates: {
        Args: {
          p_source_year?: number;
          p_min_lng?: number | null;
          p_min_lat?: number | null;
          p_max_lng?: number | null;
          p_max_lat?: number | null;
          p_limit?: number;
          p_municipality_code?: string | null;
        };
        Returns: Array<{
          candidate_id: string;
          source_import_id: string;
          source_year: number;
          source_feature_id: string;
          municipality_code: string;
          settlement_code: string;
          land_type: number;
          area_m2: number | string;
          geom_geojson: Json;
        }>;
      };
      get_parcel_candidates_mvt: {
        Args: {
          p_z: number;
          p_x: number;
          p_y: number;
          p_source_year?: number;
          p_limit?: number;
        };
        Returns: string;
      };
    };
  };
};
