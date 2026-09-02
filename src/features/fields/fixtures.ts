/**
 * UI-only development fixtures.
 *
 * The pilot geography is intentionally explicit so the prototype is useful
 * without pretending that production parcels, weather, or variety rules are
 * already connected. Any temperature threshold below is a demo value only.
 */

import {
  CONFIRMED_RICE_VARIETY_NAMES,
  type Coordinate,
  type DataQuality,
  type FieldRuleViewModel,
  type FieldStatus,
  type FieldViewModel,
  type RiceVarietyOption,
} from "./view-model";

export {
  CONFIRMED_RICE_VARIETY_NAMES,
  type Coordinate,
  type DataQuality,
  type FieldRuleViewModel,
  type FieldStatus,
  type FieldViewModel,
  type RiceVarietyOption,
} from "./view-model";

/** Compatibility alias for development-only fixture callers. */
export type DevelopmentRule = FieldRuleViewModel;
export type FieldFixture = FieldViewModel;

export const PILOT_REGION = {
  name: "広島県三原市久井町",
  // Approximate center for the development map. Production location search is
  // intentionally not wired yet.
  center: [133.077, 34.524] as Coordinate,
  zoom: 13,
};

/** The threshold values are not official and must not be used for farming. */
export const DEVELOPMENT_RULE: DevelopmentRule = {
  startTempC: 900,
  targetTempC: 1_000,
  endTempC: 1_100,
  accumulationOffsetDays: 1,
  label: "開発用仮ルール（公式値ではありません）",
  source: "公式の品種・地域ルール未接続",
};

export const RICE_VARIETIES = CONFIRMED_RICE_VARIETY_NAMES;

/** Stable IDs keep the unconfigured registration flow deterministic. */
export const FIXTURE_RICE_VARIETIES: RiceVarietyOption[] = RICE_VARIETIES.map(
  (name, index) => ({ id: `fixture-variety-${index + 1}`, name }),
);

export type RiceVariety = (typeof RICE_VARIETIES)[number];

export const FIELD_STATUS_META: Record<
  FieldStatus,
  { label: string; shortLabel: string; tone: string; glyph: string }
> = {
  ready: { label: "刈取適期", shortLabel: "適期", tone: "ready", glyph: "●" },
  soon: { label: "刈取接近", shortLabel: "接近", tone: "soon", glyph: "◐" },
  growing: { label: "登熟中", shortLabel: "登熟中", tone: "growing", glyph: "○" },
  overdue: { label: "適期超過", shortLabel: "超過", tone: "overdue", glyph: "!" },
  "not-configured": {
    label: "未設定",
    shortLabel: "未設定",
    tone: "notConfigured",
    glyph: "?",
  },
  harvested: { label: "収穫済", shortLabel: "収穫済", tone: "harvested", glyph: "✓" },
};

export const DATA_QUALITY_META: Record<
  DataQuality,
  { label: string; tone: string; message: string }
> = {
  pending: {
    label: "計算中",
    tone: "pending",
    message: "初回の積算を準備しています。",
  },
  complete: {
    label: "正常",
    tone: "complete",
    message: "対象期間のデータが揃っています。",
  },
  incomplete: {
    label: "欠測あり",
    tone: "incomplete",
    message: "欠測日があるため、積算値は参考表示です。",
  },
  stale: {
    label: "更新遅れ",
    tone: "stale",
    message: "気象データの更新が遅れています。",
  },
  error: {
    label: "取得失敗",
    tone: "error",
    message: "気象データを取得できませんでした。",
  },
};

export const FIELD_FIXTURES: FieldFixture[] = [
  {
    id: "field-kui-east",
    name: "久井東圃場",
    variety: "コシヒカリ",
    areaM2: 1_180,
    polygon: [
      [133.0717, 34.5266],
      [133.0752, 34.5274],
      [133.0761, 34.5252],
      [133.073, 34.5244],
    ],
    headingDate: "2026-08-04",
    accumulationStartDate: "2026-08-05",
    accumulatedTempC: 936.4,
    remainingTempC: 0,
    referenceDays: 0,
    status: "ready",
    dataQuality: "complete",
    observedThrough: "2026-09-02",
    weatherStation: "久井（開発用地点）",
    missingDays: 0,
    dataNote: "地図と数値は開発用フィクスチャです。",
    rule: DEVELOPMENT_RULE,
    dailyAccumulation: [32, 61, 91, 122, 150, 181, 209, 241, 274, 302, 334, 365],
  },
  {
    id: "field-kui-naka",
    name: "久井中央圃場",
    variety: "あきさかり",
    areaM2: 860,
    polygon: [
      [133.0758, 34.5248],
      [133.0792, 34.5256],
      [133.0803, 34.5231],
      [133.077, 34.5223],
    ],
    headingDate: "2026-08-08",
    accumulationStartDate: "2026-08-09",
    accumulatedTempC: 824.8,
    remainingTempC: 75.2,
    referenceDays: 4,
    status: "soon",
    dataQuality: "incomplete",
    observedThrough: "2026-09-01",
    weatherStation: "久井（開発用地点）",
    missingDays: 2,
    dataNote: "欠測2日。表示値は開発用フィクスチャです。",
    rule: DEVELOPMENT_RULE,
    dailyAccumulation: [29, 55, 83, 111, 139, 170, 198, 226, 253, 282, 311, 338],
  },
  {
    id: "field-kui-south",
    name: "久井南圃場",
    variety: "あきろまん",
    areaM2: 1_420,
    polygon: [
      [133.0751, 34.5212],
      [133.0796, 34.5219],
      [133.0809, 34.5195],
      [133.0765, 34.5187],
    ],
    headingDate: "2026-08-14",
    accumulationStartDate: "2026-08-15",
    accumulatedTempC: 548.1,
    remainingTempC: 351.9,
    referenceDays: 18,
    status: "growing",
    dataQuality: "complete",
    observedThrough: "2026-09-02",
    weatherStation: "久井（開発用地点）",
    missingDays: 0,
    dataNote: "地図と数値は開発用フィクスチャです。",
    rule: DEVELOPMENT_RULE,
    dailyAccumulation: [18, 38, 61, 85, 111, 138, 167, 196, 226, 256, 286, 319],
  },
  {
    id: "field-kui-west",
    name: "久井西圃場",
    variety: null,
    areaM2: 710,
    polygon: [
      [133.0682, 34.5226],
      [133.0712, 34.5232],
      [133.072, 34.5214],
      [133.0691, 34.5208],
    ],
    headingDate: null,
    accumulationStartDate: null,
    accumulatedTempC: null,
    remainingTempC: null,
    referenceDays: null,
    status: "not-configured",
    dataQuality: "pending",
    observedThrough: null,
    weatherStation: null,
    missingDays: 0,
    dataNote: "出穂日と品種を登録すると計算を開始します。",
    rule: null,
    dailyAccumulation: [],
  },
  {
    id: "field-kui-hayama",
    name: "葉山圃場",
    variety: "ヒノヒカリ",
    areaM2: 980,
    polygon: [
      [133.0818, 34.5268],
      [133.0854, 34.5276],
      [133.0865, 34.5252],
      [133.083, 34.5243],
    ],
    headingDate: "2026-07-31",
    accumulationStartDate: "2026-08-01",
    accumulatedTempC: 1_142.7,
    remainingTempC: -42.7,
    referenceDays: null,
    status: "overdue",
    dataQuality: "stale",
    observedThrough: "2026-08-30",
    weatherStation: "久井（開発用地点）",
    missingDays: 0,
    dataNote: "3日以上更新されていないため警告しています。",
    rule: DEVELOPMENT_RULE,
    dailyAccumulation: [36, 73, 111, 151, 193, 237, 282, 328, 375, 423, 472, 522],
  },
];

export function getFieldFixture(fieldId: string): FieldFixture | undefined {
  return FIELD_FIXTURES.find((field) => field.id === fieldId);
}

export function formatDate(date: string | null): string {
  if (!date) return "未設定";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export function formatTemp(value: number | null, suffix = "℃"): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}${suffix}`;
}

export function statusLabel(status: FieldStatus): string {
  return FIELD_STATUS_META[status].label;
}
