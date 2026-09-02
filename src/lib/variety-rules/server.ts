import { FIXTURE_RICE_VARIETIES } from "@/features/fields/fixtures";
import { CONFIRMED_RICE_VARIETY_NAMES } from "@/features/fields/view-model";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type {
  AccountVarietyRule,
  VarietyRuleCard,
  VarietyRuleRegion,
  VarietyRuleSettingsData,
} from "@/features/variety-rules/types";

const PILOT_REGION_CODES = ["34204-kui"] as const;
const SETTINGS_ERROR =
  "品種ルールを読み込めませんでした。通信状態を確認して再試行してください。";
const AUTH_ERROR =
  "ログイン状態を確認できませんでした。ログインし直して再試行してください。";

type RiceVarietyRow = Database["public"]["Tables"]["rice_varieties"]["Row"];
type RegionRow = Database["public"]["Tables"]["rule_regions"]["Row"];
type AccountRuleRow = Database["public"]["Tables"]["account_variety_rules"]["Row"];

function canUseFixtureFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

function asFiniteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Supabaseの${label}が不正です。`);
  return parsed;
}

function asRule(row: AccountRuleRow): AccountVarietyRule {
  return {
    id: row.id,
    accountId: row.account_id,
    varietyId: row.variety_id,
    regionId: row.region_id,
    harvestStartTempC: asFiniteNumber(row.harvest_start_temp_c, "開始温度"),
    harvestTargetTempC: asFiniteNumber(row.harvest_target_temp_c, "中心温度"),
    harvestEndTempC: asFiniteNumber(row.harvest_end_temp_c, "終了温度"),
    accumulationStartOffsetDays: asFiniteNumber(
      row.accumulation_start_offset_days,
      "積算開始日",
    ),
    sourceNote: row.source_note,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asRegion(row: RegionRow): VarietyRuleRegion {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    specificity: asFiniteNumber(row.specificity, "地域優先度"),
  };
}

function fixtureSettings(): VarietyRuleSettingsData {
  const regions: VarietyRuleRegion[] = [
    {
      id: "fixture-region-kui",
      code: "34204-kui",
      name: "三原市久井町",
      kind: "CUSTOM",
      specificity: 50,
    },
  ];
  const cards: VarietyRuleCard[] = FIXTURE_RICE_VARIETIES.map((variety) => ({
    id: variety.id,
    name: variety.name,
    nameKana: variety.nameKana,
    officialConfigured: false,
    customRules: [],
  }));
  return { accountId: null, cards, regions, source: "fixture", error: null };
}

export async function loadVarietyRuleSettings(): Promise<VarietyRuleSettingsData> {
  if (!getSupabasePublicConfig()) return fixtureSettings();

  try {
    const client = await createClient();
    const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) {
      return { ...fixtureSettings(), source: "supabase", error: AUTH_ERROR, cards: [] };
    }

    const memberships = await client
      .from("account_members")
      .select("account_id, created_at")
      .eq("user_id", auth.data.user.id)
      .order("created_at", { ascending: true });
    if (memberships.error) throw memberships.error;
    const accountId = memberships.data?.[0]?.account_id ?? null;
    if (!accountId) {
      return { ...fixtureSettings(), source: "supabase", error: AUTH_ERROR, cards: [] };
    }

    const [varietiesResult, regionsResult, rulesResult] = await Promise.all([
      client
        .from("rice_varieties")
        .select("id, name, name_kana, is_active, created_at, updated_at")
        .eq("is_active", true)
        .in("name", [...CONFIRMED_RICE_VARIETY_NAMES])
        .order("name"),
      client
        .from("rule_regions")
        .select(
          "id, kind, code, name, parent_region_id, specificity, elevation_min_m, elevation_max_m, created_at, updated_at",
        )
        .in("code", [...PILOT_REGION_CODES]),
      client.rpc("list_account_variety_rules", { p_account_id: accountId }),
    ]);
    if (varietiesResult.error) throw varietiesResult.error;
    if (regionsResult.error) throw regionsResult.error;
    if (rulesResult.error) throw rulesResult.error;

    const varietyRows = (varietiesResult.data ?? []) as RiceVarietyRow[];
    const varietyByName = new Map(varietyRows.map((row) => [row.name, row]));
    if (CONFIRMED_RICE_VARIETY_NAMES.some((name) => !varietyByName.has(name))) {
      throw new Error("品種マスターの初期5品種が揃っていません。");
    }
    const rules = ((rulesResult.data ?? []) as AccountRuleRow[]).map(asRule);
    const rulesByVariety = new Map<string, AccountVarietyRule[]>();
    for (const rule of rules) {
      const current = rulesByVariety.get(rule.varietyId) ?? [];
      current.push(rule);
      rulesByVariety.set(rule.varietyId, current);
    }
    const cards: VarietyRuleCard[] = CONFIRMED_RICE_VARIETY_NAMES.map((name) => {
      const row = varietyByName.get(name)!;
      return {
        id: row.id,
        name: name as VarietyRuleCard["name"],
        nameKana: row.name_kana,
        officialConfigured: false,
        customRules: rulesByVariety.get(row.id) ?? [],
      };
    });

    return {
      accountId,
      cards,
      regions: (regionsResult.data ?? []).map((row) => asRegion(row as RegionRow)),
      source: "supabase",
      error: null,
    };
  } catch {
    if (canUseFixtureFallback()) return fixtureSettings();
    return { accountId: null, cards: [], regions: [], source: "supabase", error: SETTINGS_ERROR };
  }
}
