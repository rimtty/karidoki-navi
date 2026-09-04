"use server";

import { isLocalDate } from "@/domain";
import { FIELD_FIXTURES } from "@/features/fields/fixtures";
import {
  getSupabasePublicConfig,
  SUPABASE_CONFIG_ERROR,
} from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { FieldSizeClass } from "@/features/fields/view-model";

export type RegistrationInput = {
  idempotencyKey: string;
  fieldName: string;
  sizeClass: FieldSizeClass;
  year: number;
  varietyId: string;
  plantingDate: string;
  headingDate: string | null;
};

export type RegistrationActionResult =
  | {
      ok: true;
      source: "supabase" | "fixture";
      fieldId: string;
      cropSeasonId: string;
      sizeClass: FieldSizeClass;
      wasReplayed: boolean;
    }
  | { ok: false; source: "supabase" | "fixture"; message: string };

export type HarvestActionResult =
  | { ok: true; source: "supabase" | "fixture"; harvestDate: string }
  | { ok: false; source: "supabase" | "fixture"; message: string };

const REGISTRATION_ERROR =
  "田んぼを登録できませんでした。入力内容を確認して再試行してください。";

export async function updateHeadingAction(seasonId: string, headingDate: string) {
  if (!isLocalDate(headingDate) || !validText(seasonId, 200)) {
    return { ok: false, message: "出穂日を確認してください。" };
  }
  try {
    const client = await createClient();
    const { error } = await client.rpc("update_season_heading", {
      p_season_id: seasonId, p_heading_date: headingDate,
    });
    if (error) return { ok: false, message: "保存できませんでした。田植え日以降・同じ年の日付を指定してください。収穫済みの記録は変更できません。" };
    return { ok: true, message: "出穂日を保存しました。取得済みの気温で再計算しました。" };
  } catch {
    return { ok: false, message: "通信状態を確認して、もう一度お試しください。" };
  }
}
const REGISTRATION_AUTH_ERROR =
  "ログイン状態を確認できませんでした。ログインし直して再試行してください。";
const HARVEST_ERROR =
  "収穫を登録できませんでした。入力内容を確認して再試行してください。";
const HARVEST_AUTH_ERROR =
  "収穫登録は圃場の所有者のみ実行できます。ログイン状態を確認してください。";

function isDevelopmentFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= max;
}

function fallbackRegistration(input: RegistrationInput): RegistrationActionResult {
  // There is no persistence in fixture mode. Returning a known fixture ID
  // keeps the existing development flow navigable while the DEV notice makes
  // the non-production nature explicit.
  const fieldId = FIELD_FIXTURES[0]?.id ?? "field-fixture";
  return {
    ok: true,
    source: "fixture",
    fieldId,
    cropSeasonId: `fixture-season-${fieldId}`,
    sizeClass: input.sizeClass,
    wasReplayed: false,
  };
}

export async function registerFieldWithSeasonAction(
  input: RegistrationInput,
): Promise<RegistrationActionResult> {
  const config = getSupabasePublicConfig();
  const source: RegistrationActionResult["source"] =
    config || !isDevelopmentFallbackAllowed() ? "supabase" : "fixture";
  if (!input || typeof input !== "object") {
    return { ok: false, source, message: REGISTRATION_ERROR };
  }
  if (
    !validText(input.idempotencyKey, 200) ||
    !validText(input.fieldName, 100) ||
    !(["small", "medium", "large"] as const).includes(input.sizeClass) ||
    !Number.isInteger(input.year) ||
    input.year < 2000 ||
    input.year > 2100 ||
    !validText(input.varietyId, 200) ||
    !isLocalDate(input.plantingDate) ||
    (input.headingDate !== null && (!isLocalDate(input.headingDate) ||
    input.headingDate < input.plantingDate))
  ) {
    return {
      ok: false,
      source,
      message: REGISTRATION_ERROR,
    };
  }

  if (!config) {
    return isDevelopmentFallbackAllowed()
      ? fallbackRegistration(input)
      : { ok: false, source: "supabase", message: SUPABASE_CONFIG_ERROR };
  }

  try {
    const supabase = await createClient();
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) {
      return { ok: false, source: "supabase", message: REGISTRATION_AUTH_ERROR };
    }

    const databaseSize = input.sizeClass.toUpperCase() as "SMALL" | "MEDIUM" | "LARGE";
    const { data, error } = await supabase.rpc("register_simple_field_with_season", {
      p_idempotency_key: input.idempotencyKey.trim(),
      p_field_name: input.fieldName.trim(),
      p_size_class: databaseSize,
      p_year: input.year,
      p_variety_id: input.varietyId,
      p_planting_date: input.plantingDate,
      p_heading_date: input.headingDate,
    });
    if (error || !data?.[0]) {
      if (isDevelopmentFallbackAllowed()) return fallbackRegistration(input);
      return { ok: false, source: "supabase", message: REGISTRATION_ERROR };
    }
    const row = data[0];
    return {
      ok: true,
      source: "supabase",
      fieldId: row.field_id,
      cropSeasonId: row.crop_season_id,
      sizeClass: row.size_class.toLowerCase() as FieldSizeClass,
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
  const config = getSupabasePublicConfig();
  const source: HarvestActionResult["source"] =
    config || !isDevelopmentFallbackAllowed() ? "supabase" : "fixture";
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

  if (!config) {
    return isDevelopmentFallbackAllowed()
      ? { ok: true, source: "fixture", harvestDate: input.harvestDate }
      : { ok: false, source: "supabase", message: SUPABASE_CONFIG_ERROR };
  }

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
