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
      rice_varieties: {
        Row: {
          id: string;
          name: string;
          name_kana: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<{
          id: string;
          name: string;
          name_kana: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Update: Partial<{
          id: string;
          name: string;
          name_kana: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
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
