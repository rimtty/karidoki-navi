import type { ConfirmedRiceVarietyName } from "@/features/fields/view-model";

export type VarietyRuleDataSource = "supabase" | "fixture";

export type VarietyRuleRegion = {
  id: string;
  code: string | null;
  name: string;
  kind: "COUNTRY" | "PREFECTURE" | "MUNICIPALITY" | "CUSTOM";
  specificity: number;
};

export type AccountVarietyRule = {
  id: string;
  accountId: string;
  varietyId: string;
  regionId: string | null;
  harvestStartTempC: number;
  harvestTargetTempC: number;
  harvestEndTempC: number;
  accumulationStartOffsetDays: number;
  sourceNote: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VarietyRuleCard = {
  id: string;
  name: ConfirmedRiceVarietyName;
  nameKana?: string | null;
  officialConfigured: false;
  customRules: AccountVarietyRule[];
};

export type VarietyRuleSettingsData = {
  accountId: string | null;
  cards: VarietyRuleCard[];
  regions: VarietyRuleRegion[];
  source: VarietyRuleDataSource;
  error: string | null;
};

export type VarietyRuleActionResult =
  | { ok: true; source: VarietyRuleDataSource; rule: AccountVarietyRule }
  | { ok: false; source: VarietyRuleDataSource; message: string };

export type DeleteVarietyRuleActionResult =
  | { ok: true; source: VarietyRuleDataSource }
  | { ok: false; source: VarietyRuleDataSource; message: string };
