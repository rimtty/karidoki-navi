/**
 * The field shape consumed by the UI.
 *
 * This is deliberately separate from both the Supabase row shape and the
 * development fixtures.  Server adapters are the only place where database
 * values are converted into this view model.
 */

export type FieldStatus =
  | "ready"
  | "soon"
  | "growing"
  | "overdue"
  | "not-configured"
  | "harvested";

export type DataQuality =
  | "pending"
  | "complete"
  | "incomplete"
  | "stale"
  | "error";

export type Coordinate = [number, number];

export interface FieldRuleViewModel {
  startTempC: number;
  targetTempC: number;
  endTempC: number;
  accumulationOffsetDays: number;
  label: string;
  source: string;
}

export interface FieldViewModel {
  id: string;
  name: string;
  variety: string | null;
  varietyId?: string | null;
  year?: number | null;
  seasonId?: string | null;
  areaM2: number;
  polygon: Coordinate[];
  headingDate: string | null;
  accumulationStartDate: string | null;
  accumulatedTempC: number | null;
  harvestDate?: string | null;
  harvestAccumulatedTempC?: number | null;
  remainingTempC: number | null;
  referenceDays: number | null;
  status: FieldStatus;
  dataQuality: DataQuality;
  observedThrough: string | null;
  weatherStation: string | null;
  missingDays: number;
  dataNote?: string;
  rule: FieldRuleViewModel | null;
  dailyAccumulation: number[];
}

/** The five pilot varieties confirmed for the registration flow. */
export const CONFIRMED_RICE_VARIETY_NAMES = [
  "コシヒカリ",
  "あきさかり",
  "あきろまん",
  "ヒノヒカリ",
  "恋の予感",
] as const;

export type ConfirmedRiceVarietyName =
  (typeof CONFIRMED_RICE_VARIETY_NAMES)[number];

export interface RiceVarietyOption {
  id: string;
  name: ConfirmedRiceVarietyName;
  nameKana?: string | null;
}
