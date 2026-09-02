"use server";

import { revalidatePath } from "next/cache";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  validateVarietyRuleForm,
  type VarietyRuleFormInput,
} from "@/features/variety-rules/validation";
import type {
  AccountVarietyRule,
  DeleteVarietyRuleActionResult,
  VarietyRuleActionResult,
} from "@/features/variety-rules/types";

type AccountRuleRow = Database["public"]["Tables"]["account_variety_rules"]["Row"];

const SAVE_ERROR =
  "品種ルールを保存できませんでした。入力内容を確認して再試行してください。";
const DELETE_ERROR =
  "品種ルールを削除できませんでした。通信状態を確認して再試行してください。";
const AUTH_ERROR =
  "ログイン状態を確認できませんでした。ログインし直して再試行してください。";

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid numeric rule value");
  return parsed;
}

function asRule(row: AccountRuleRow): AccountVarietyRule {
  return {
    id: row.id,
    accountId: row.account_id,
    varietyId: row.variety_id,
    regionId: row.region_id,
    harvestStartTempC: asNumber(row.harvest_start_temp_c),
    harvestTargetTempC: asNumber(row.harvest_target_temp_c),
    harvestEndTempC: asNumber(row.harvest_end_temp_c),
    accumulationStartOffsetDays: asNumber(row.accumulation_start_offset_days),
    sourceNote: row.source_note,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageForRpcError(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "42501") return AUTH_ERROR;
  if (error.code === "23P01") return "同じ品種・地域で適用期間が重なっています。期間を見直してください。";
  if (error.code === "23514" || error.code === "22023") {
    return "入力値が保存条件を満たしていません。温度・日付・根拠メモを確認してください。";
  }
  return fallback;
}

async function currentAccountId(client: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return null;
  const memberships = await client
    .from("account_members")
    .select("account_id, created_at")
    .eq("user_id", auth.data.user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (memberships.error) throw memberships.error;
  return memberships.data?.[0]?.account_id ?? null;
}

export async function saveVarietyRuleAction(input: {
  varietyId: string;
  ruleId?: string | null;
  form: VarietyRuleFormInput;
}): Promise<VarietyRuleActionResult> {
  if (!getSupabasePublicConfig()) {
    return {
      ok: false,
      source: "fixture",
      message: "Supabase未接続の開発表示では、品種ルールを保存できません。",
    };
  }
  if (!input || typeof input !== "object" || typeof input.varietyId !== "string") {
    return { ok: false, source: "supabase", message: SAVE_ERROR };
  }
  if (!input.form || typeof input.form !== "object") {
    return { ok: false, source: "supabase", message: SAVE_ERROR };
  }
  if (input.ruleId !== undefined && input.ruleId !== null && typeof input.ruleId !== "string") {
    return { ok: false, source: "supabase", message: SAVE_ERROR };
  }
  const validation = validateVarietyRuleForm(input.form);
  if (!validation.ok || input.varietyId.trim() === "") {
    return { ok: false, source: "supabase", message: SAVE_ERROR };
  }
  if (input.ruleId !== undefined && input.ruleId !== null && input.ruleId.trim() === "") {
    return { ok: false, source: "supabase", message: SAVE_ERROR };
  }

  try {
    const client = await createClient();
    const accountId = await currentAccountId(client);
    if (!accountId) return { ok: false, source: "supabase", message: AUTH_ERROR };
    const { data, error } = await client.rpc("save_account_variety_rule", {
      p_account_id: accountId,
      p_variety_id: input.varietyId.trim(),
      p_harvest_start_temp_c: validation.value.startTempC,
      p_harvest_target_temp_c: validation.value.targetTempC,
      p_harvest_end_temp_c: validation.value.endTempC,
      p_accumulation_start_offset_days: validation.value.accumulationOffsetDays,
      p_source_note: validation.value.sourceNote,
      p_effective_from: validation.value.effectiveFrom,
      p_rule_id: input.ruleId?.trim() || null,
      p_region_id: validation.value.regionId,
      p_effective_to: validation.value.effectiveTo,
    });
    if (error || !data?.[0]) {
      return {
        ok: false,
        source: "supabase",
        message: messageForRpcError(error ?? {}, SAVE_ERROR),
      };
    }
    revalidatePath("/app/settings/variety-rules");
    revalidatePath("/app/fields/new/1");
    return { ok: true, source: "supabase", rule: asRule(data[0] as AccountRuleRow) };
  } catch {
    return { ok: false, source: "supabase", message: SAVE_ERROR };
  }
}

export async function deleteVarietyRuleAction(input: {
  ruleId: string;
}): Promise<DeleteVarietyRuleActionResult> {
  if (!getSupabasePublicConfig()) {
    return {
      ok: false,
      source: "fixture",
      message: "Supabase未接続の開発表示では、品種ルールを削除できません。",
    };
  }
  if (!input || typeof input.ruleId !== "string" || input.ruleId.trim() === "") {
    return { ok: false, source: "supabase", message: DELETE_ERROR };
  }

  try {
    const client = await createClient();
    const accountId = await currentAccountId(client);
    if (!accountId) return { ok: false, source: "supabase", message: AUTH_ERROR };
    const { data, error } = await client.rpc("delete_account_variety_rule", {
      p_account_id: accountId,
      p_rule_id: input.ruleId.trim(),
    });
    if (error || data !== true) {
      return {
        ok: false,
        source: "supabase",
        message: messageForRpcError(error ?? {}, DELETE_ERROR),
      };
    }
    revalidatePath("/app/settings/variety-rules");
    revalidatePath("/app/fields/new/1");
    return { ok: true, source: "supabase" };
  } catch {
    return { ok: false, source: "supabase", message: DELETE_ERROR };
  }
}
