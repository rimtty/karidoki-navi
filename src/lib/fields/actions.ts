"use server";

import { isLocalDate } from "@/domain";
import { FIELD_FIXTURES } from "@/features/fields/fixtures";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { Coordinate } from "@/features/fields/view-model";

export type RegistrationInput = {
  idempotencyKey: string;
  fieldName: string;
  polygon: Coordinate[];
  year: number;
  varietyId: string;
  headingDate: string | null;
  parcelSource: "MAFF_PARCEL" | "MANUAL";
  parcelExternalId: string | null;
  parcelDatasetVersion: string | null;
};

export type RegistrationActionResult =
  | {
      ok: true;
      source: "supabase" | "fixture";
      fieldId: string;
      cropSeasonId: string;
      areaM2: number;
      wasReplayed: boolean;
    }
  | { ok: false; source: "supabase" | "fixture"; message: string };

export type HarvestActionResult =
  | { ok: true; source: "supabase" | "fixture"; harvestDate: string }
  | { ok: false; source: "supabase" | "fixture"; message: string };

const REGISTRATION_ERROR =
  "圃場を登録できませんでした。入力内容を確認して再試行してください。";
const REGISTRATION_AUTH_ERROR =
  "ログイン状態を確認できませんでした。ログインし直して再試行してください。";
const HARVEST_ERROR =
  "収穫を登録できませんでした。入力内容を確認して再試行してください。";
const HARVEST_AUTH_ERROR =
  "収穫登録は圃場の所有者のみ実行できます。ログイン状態を確認してください。";

function isDevelopmentFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function validCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function normalizePolygon(polygon: unknown): Coordinate[] | null {
  if (!Array.isArray(polygon)) return null;
  const points = polygon.filter(validCoordinate);
  if (points.length !== polygon.length || points.length < 3) return null;
  const normalized = points.map(([lng, lat]) => [lng, lat] as Coordinate);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) normalized.pop();
  return normalized.length >= 3 ? normalized : null;
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= max;
}

function fallbackRegistration(input: RegistrationInput): RegistrationActionResult {
  // There is no persistence in fixture mode. Returning a known fixture ID
  // keeps the existing development flow navigable while the DEV notice makes
  // the non-production nature explicit.
  const fieldId =
    input.parcelExternalId && input.parcelExternalId.startsWith("field-")
      ? input.parcelExternalId
      : FIELD_FIXTURES[0]?.id ?? "field-fixture";
  return {
    ok: true,
    source: "fixture",
    fieldId,
    cropSeasonId: `fixture-season-${fieldId}`,
    areaM2: 0,
    wasReplayed: false,
  };
}

export async function registerFieldWithSeasonAction(
  input: RegistrationInput,
): Promise<RegistrationActionResult> {
  const source = getSupabasePublicConfig() ? "supabase" : "fixture";
  if (!input || typeof input !== "object") {
    return { ok: false, source, message: REGISTRATION_ERROR };
  }
  const polygon = normalizePolygon(input.polygon);
  if (
    !validText(input.idempotencyKey, 200) ||
    !validText(input.fieldName, 100) ||
    !polygon ||
    !Number.isInteger(input.year) ||
    input.year < 2000 ||
    input.year > 2100 ||
    !validText(input.varietyId, 200) ||
    (input.headingDate !== null && !isLocalDate(input.headingDate)) ||
    (input.parcelSource !== "MAFF_PARCEL" && input.parcelSource !== "MANUAL")
  ) {
    return {
      ok: false,
      source,
      message: REGISTRATION_ERROR,
    };
  }

  const config = getSupabasePublicConfig();
  if (!config) return fallbackRegistration(input);

  try {
    const supabase = await createClient();
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) {
      return { ok: false, source: "supabase", message: REGISTRATION_AUTH_ERROR };
    }

    const ring = [...polygon, polygon[0]];
    const { data, error } = await supabase.rpc("register_field_with_season", {
      p_idempotency_key: input.idempotencyKey.trim(),
      p_field_name: input.fieldName.trim(),
      p_geom_geojson: {
        type: "Polygon",
        coordinates: [ring],
      },
      p_year: input.year,
      p_variety_id: input.varietyId,
      p_heading_date: input.headingDate,
      p_parcel_source: input.parcelSource,
      p_parcel_external_id: input.parcelExternalId,
      p_parcel_dataset_version: input.parcelDatasetVersion,
    });
    if (error || !data?.[0]) {
      if (isDevelopmentFallbackAllowed()) return fallbackRegistration(input);
      return { ok: false, source: "supabase", message: REGISTRATION_ERROR };
    }
    const row = data[0];
    const areaM2 = Number(row.area_m2);
    if (!Number.isFinite(areaM2) || areaM2 <= 0) {
      if (isDevelopmentFallbackAllowed()) return fallbackRegistration(input);
      return { ok: false, source: "supabase", message: REGISTRATION_ERROR };
    }
    return {
      ok: true,
      source: "supabase",
      fieldId: row.field_id,
      cropSeasonId: row.crop_season_id,
      areaM2,
      wasReplayed: row.was_replayed,
    };
  } catch {
    if (isDevelopmentFallbackAllowed()) return fallbackRegistration(input);
    return { ok: false, source: "supabase", message: REGISTRATION_ERROR };
  }
}

export async function registerHarvestAction(input: {
  cropSeasonId: string;
  harvestDate: string;
  accumulatedTempC: number | null;
}): Promise<HarvestActionResult> {
  const source = getSupabasePublicConfig() ? "supabase" : "fixture";
  if (
    !input ||
    typeof input !== "object" ||
    !validText(input.cropSeasonId, 200) ||
    !isLocalDate(input.harvestDate) ||
    (input.accumulatedTempC !== null &&
      (typeof input.accumulatedTempC !== "number" ||
        !Number.isFinite(input.accumulatedTempC) ||
        input.accumulatedTempC < 0))
  ) {
    return {
      ok: false,
      source,
      message: HARVEST_ERROR,
    };
  }

  const config = getSupabasePublicConfig();
  if (!config) return { ok: true, source: "fixture", harvestDate: input.harvestDate };

  try {
    const supabase = await createClient();
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) {
      return { ok: false, source: "supabase", message: REGISTRATION_AUTH_ERROR };
    }
    const { data, error } = await supabase.rpc("register_harvest", {
      p_crop_season_id: input.cropSeasonId,
      p_harvest_date: input.harvestDate,
      p_harvest_accumulated_temp_c: input.accumulatedTempC,
    });
    if (error || !data?.[0]) {
      if (error?.code === "42501") {
        return { ok: false, source: "supabase", message: HARVEST_AUTH_ERROR };
      }
      if (isDevelopmentFallbackAllowed()) {
        return { ok: true, source: "fixture", harvestDate: input.harvestDate };
      }
      return { ok: false, source: "supabase", message: HARVEST_ERROR };
    }
    return { ok: true, source: "supabase", harvestDate: input.harvestDate };
  } catch {
    if (isDevelopmentFallbackAllowed()) {
      return { ok: true, source: "fixture", harvestDate: input.harvestDate };
    }
    return { ok: false, source: "supabase", message: HARVEST_ERROR };
  }
}
