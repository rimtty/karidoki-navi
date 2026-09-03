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
  | "before-heading"
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

export type FieldSizeClass = "small" | "medium" | "large";

export type ParcelMultiPolygon = {
  type: "MultiPolygon";
  coordinates: Coordinate[][][];
};

export type ParcelGeometry = ParcelMultiPolygon;

/** Owner-independent public parcel data consumed by the registration map. */
export interface ParcelCandidateViewModel {
  id: string;
  externalId: string;
  datasetYear: number;
  municipalityCode: string;
  settlementCode: string;
  landType: number;
  areaM2: number;
  geometry: ParcelGeometry;
  label: string;
}

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
  sizeClass: FieldSizeClass;
  areaM2: number | null;
  polygon: Coordinate[];
  plantingDate: string | null;
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
  name: string;
  nameKana?: string | null;
  isCustom: boolean;
}
