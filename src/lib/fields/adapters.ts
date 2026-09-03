import {
  CONFIRMED_RICE_VARIETY_NAMES,
  type Coordinate,
  type DataQuality,
  type FieldStatus,
  type FieldSizeClass,
  type FieldViewModel,
  type ParcelCandidateViewModel,
  type ParcelGeometry,
  type RiceVarietyOption,
} from "../../features/fields/view-model";
import type { Database, Json } from "../supabase/database.types";
import {
  DATA_STATUSES,
  isLocalDate,
  MATURITY_STATUSES,
  type DataStatus,
  type MaturityStatus,
} from "../../domain";

export type FieldMapRpcRow =
  Database["public"]["Functions"]["get_field_map"]["Returns"][number];
export type FieldDetailRpcRow =
  Database["public"]["Functions"]["get_field_detail"]["Returns"][number];
export type FieldOverviewRpcRow =
  Database["public"]["Functions"]["get_field_overview"]["Returns"][number];
export type FieldDetailSimpleRpcRow =
  Database["public"]["Functions"]["get_field_detail_simple"]["Returns"][number];
export type RiceVarietyRpcRow =
  Database["public"]["Tables"]["rice_varieties"]["Row"];
export type ParcelCandidateRpcRow =
  Database["public"]["Functions"]["get_parcel_candidates"]["Returns"][number];

export class FieldAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldAdapterError";
  }
}

function asFiniteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  return parsed;
}

function asNonNegativeInteger(value: unknown, label: string): number {
  const parsed = asFiniteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  return parsed;
}

function asDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !isLocalDate(value)) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  return value;
}

function asId(value: unknown, label: string): string;
function asId(value: unknown, label: string, nullable: true): string | null;
function asId(value: unknown, label: string, nullable = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (nullable) return null;
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  return value;
}

function asText(value: unknown, label: string): string;
function asText(value: unknown, label: string, nullable: true): string | null;
function asText(value: unknown, label: string, nullable = false): string | null {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  return value;
}

function asOptionalTemp(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return asFiniteNumber(value, "積算気温");
}

function asSizeClass(value: unknown): FieldSizeClass {
  switch (value) {
    case "SMALL":
      return "small";
    case "MEDIUM":
      return "medium";
    case "LARGE":
      return "large";
    default:
      throw new FieldAdapterError("Supabaseの田んぼの大きさが不正です。");
  }
}

function asMaturityStatus(value: unknown): MaturityStatus | null {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value === "string" &&
    (MATURITY_STATUSES as readonly string[]).includes(value)
  ) {
    return value as MaturityStatus;
  }
  throw new FieldAdapterError("Supabaseの成熟状態が不正です。");
}

function asDataStatus(value: unknown): DataStatus | null {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value === "string" &&
    (DATA_STATUSES as readonly string[]).includes(value)
  ) {
    return value as DataStatus;
  }
  throw new FieldAdapterError("Supabaseのデータ品質状態が不正です。");
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function normalizeRing(value: unknown, label: string): Coordinate[] {
  if (!Array.isArray(value)) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  const ring = value.filter(isCoordinate).map(([lng, lat]) => [lng, lat] as Coordinate);
  if (ring.length < 3 || ring.length !== value.length) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }

  // PostGIS returns a closed linear ring.  FieldMap closes it when creating
  // the source, so remove only the redundant final coordinate.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    ring.pop();
  }
  if (ring.length < 3) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  return ring;
}

function asPolygon(value: Json, label = "圃場形状"): Coordinate[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return normalizeRing(geometry.coordinates[0], label);
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const firstPolygon = geometry.coordinates[0];
    if (Array.isArray(firstPolygon)) {
      return normalizeRing(firstPolygon[0], label);
    }
  }
  throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
}

function asParcelGeometry(value: Json, label = "筆候補形状"): ParcelGeometry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }
  const geometry = value as { type?: unknown; coordinates?: unknown };
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : null;
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
  }

  const normalizedPolygons = polygons.map((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      throw new FieldAdapterError(`Supabaseの${label}が不正です。`);
    }
    return polygon.map((ring) => normalizeRing(ring, label));
  });

  return {
    type: "MultiPolygon",
    coordinates: normalizedPolygons,
  };
}

export function adaptParcelCandidateRow(
  row: ParcelCandidateRpcRow,
): ParcelCandidateViewModel {
  const id = asId(row.candidate_id, "candidate_id");
  const externalId = asText(row.source_feature_id, "source_feature_id");
  const datasetYear = asNonNegativeInteger(row.source_year, "筆候補年度");
  const municipalityCode = asText(row.municipality_code, "自治体コード");
  const settlementCode = asText(row.settlement_code, "農業集落コード");
  const landType = asNonNegativeInteger(row.land_type, "地目");
  const areaM2 = asFiniteNumber(row.area_m2, "筆候補面積");

  if (datasetYear < 2000 || datasetYear > 2100) {
    throw new FieldAdapterError("Supabaseの筆候補年度が不正です。");
  }
  if (!/^\d{5}$/.test(municipalityCode)) {
    throw new FieldAdapterError("Supabaseの自治体コードが不正です。");
  }
  if (!/^\d{10}$/.test(settlementCode)) {
    throw new FieldAdapterError("Supabaseの農業集落コードが不正です。");
  }
  if (landType !== 100 && landType !== 200) {
    throw new FieldAdapterError("Supabaseの地目が不正です。");
  }
  if (areaM2 <= 0) {
    throw new FieldAdapterError("Supabaseの筆候補面積が不正です。");
  }

  return {
    id,
    externalId,
    datasetYear,
    municipalityCode,
    settlementCode,
    landType,
    areaM2,
    geometry: asParcelGeometry(row.geom_geojson),
    label: `筆候補 ${externalId.slice(0, 8)}`,
  };
}

export function adaptParcelCandidateRows(
  rows: readonly ParcelCandidateRpcRow[],
): ParcelCandidateViewModel[] {
  return rows.map(adaptParcelCandidateRow);
}

function mapStatus(
  maturityStatus: MaturityStatus | null,
  harvestDate: string | null,
  lifecycleStatus?: string | null,
): FieldStatus {
  if (
    harvestDate ||
    maturityStatus === "HARVESTED" ||
    lifecycleStatus === "HARVESTED"
  ) {
    return "harvested";
  }
  switch (maturityStatus) {
    case "HARVEST_READY":
      return "ready";
    case "HARVEST_SOON":
    case "GROWING_LATE":
      return "soon";
    case "OVERDUE":
      return "overdue";
    case "GROWING":
      return "growing";
    case "BEFORE_HEADING":
    case "NOT_CONFIGURED":
    default:
      return "not-configured";
  }
}

function mapQuality(dataStatus: DataStatus | null): DataQuality {
  switch (dataStatus) {
    case "COMPLETE":
      return "complete";
    case "INCOMPLETE":
      return "incomplete";
    case "STALE":
      return "stale";
    case "ERROR":
      return "error";
    case "PENDING":
    default:
      return "pending";
  }
}

function baseField(row: {
  field_id: unknown;
  field_name: unknown;
  geom_geojson: Json;
  area_m2: unknown;
  season_id: unknown;
  season_year: unknown;
  variety_id: unknown;
  variety_name: unknown;
  heading_date: unknown;
  harvest_date: unknown;
  accumulated_temp_c: unknown;
  maturity_status: string | null | undefined;
  lifecycle_status?: string | null | undefined;
  data_status: string | null | undefined;
  accumulated_through: unknown;
  missing_day_count?: unknown;
  estimated_days_to_start?: unknown;
  harvest_accumulated_temp_c?: unknown;
}): FieldViewModel {
  const fieldId = asId(row.field_id, "field_id");
  const name = asText(row.field_name, "field_name");
  const headingDate = asDate(row.heading_date, "出穂日");
  const harvestDate = asDate(row.harvest_date, "収穫日");
  const seasonId = asId(row.season_id, "season_id", true);
  const seasonYear =
    row.season_year === null || row.season_year === undefined
      ? null
      : asNonNegativeInteger(row.season_year, "年度");
  const missingDays =
    row.missing_day_count === undefined || row.missing_day_count === null
      ? 0
      : asNonNegativeInteger(row.missing_day_count, "欠測日数");
  const estimatedDays =
    row.estimated_days_to_start === undefined || row.estimated_days_to_start === null
      ? null
      : asNonNegativeInteger(row.estimated_days_to_start, "参考残り日数");
  const status = mapStatus(
    asMaturityStatus(row.maturity_status),
    harvestDate,
    row.lifecycle_status,
  );
  const areaM2 = asFiniteNumber(row.area_m2, "面積");
  if (areaM2 <= 0) {
    throw new FieldAdapterError("Supabaseの面積が不正です。");
  }

  return {
    id: fieldId,
    name,
    variety: asText(row.variety_name, "品種名", true),
    varietyId: asId(row.variety_id, "variety_id", true),
    year: seasonYear,
    seasonId,
    sizeClass:
      areaM2 < 1000 ? "small" : areaM2 < 3000 ? "medium" : "large",
    areaM2,
    polygon: asPolygon(row.geom_geojson),
    plantingDate: null,
    headingDate,
    accumulationStartDate: null,
    accumulatedTempC: asOptionalTemp(row.accumulated_temp_c),
    harvestDate,
    harvestAccumulatedTempC: asOptionalTemp(row.harvest_accumulated_temp_c),
    remainingTempC: null,
    referenceDays: estimatedDays,
    status,
    dataQuality: mapQuality(asDataStatus(row.data_status)),
    observedThrough: asDate(row.accumulated_through, "反映済み日"),
    weatherStation: null,
    missingDays,
    rule: null,
    dailyAccumulation: [],
  };
}

function baseSimpleField(row: {
  field_id: unknown;
  field_name: unknown;
  field_size_class: unknown;
  season_id: unknown;
  season_year: unknown;
  variety_id: unknown;
  variety_name: unknown;
  planting_date: unknown;
  heading_date: unknown;
  harvest_date: unknown;
  accumulated_temp_c: unknown;
  maturity_status: string | null | undefined;
  lifecycle_status?: string | null | undefined;
  data_status: string | null | undefined;
  accumulated_through: unknown;
  missing_day_count?: unknown;
  estimated_days_to_start?: unknown;
  harvest_accumulated_temp_c?: unknown;
}): FieldViewModel {
  const headingDate = asDate(row.heading_date, "出穂日");
  const harvestDate = asDate(row.harvest_date, "収穫日");
  const seasonYear =
    row.season_year === null || row.season_year === undefined
      ? null
      : asNonNegativeInteger(row.season_year, "年度");
  const missingDays =
    row.missing_day_count === undefined || row.missing_day_count === null
      ? 0
      : asNonNegativeInteger(row.missing_day_count, "欠測日数");
  const estimatedDays =
    row.estimated_days_to_start === undefined || row.estimated_days_to_start === null
      ? null
      : asNonNegativeInteger(row.estimated_days_to_start, "参考残り日数");

  return {
    id: asId(row.field_id, "field_id"),
    name: asText(row.field_name, "field_name"),
    variety: asText(row.variety_name, "品種名", true),
    varietyId: asId(row.variety_id, "variety_id", true),
    year: seasonYear,
    seasonId: asId(row.season_id, "season_id", true),
    sizeClass: asSizeClass(row.field_size_class),
    areaM2: null,
    polygon: [],
    plantingDate: asDate(row.planting_date, "田植え日"),
    headingDate,
    accumulationStartDate: headingDate,
    accumulatedTempC: asOptionalTemp(row.accumulated_temp_c),
    harvestDate,
    harvestAccumulatedTempC: asOptionalTemp(row.harvest_accumulated_temp_c),
    remainingTempC: null,
    referenceDays: estimatedDays,
    status: mapStatus(
      asMaturityStatus(row.maturity_status),
      harvestDate,
      row.lifecycle_status,
    ),
    dataQuality: mapQuality(asDataStatus(row.data_status)),
    observedThrough: asDate(row.accumulated_through, "反映済み日"),
    weatherStation: null,
    missingDays,
    rule: null,
    dailyAccumulation: [],
  };
}

export function adaptFieldOverviewRows(
  rows: readonly FieldOverviewRpcRow[],
): FieldViewModel[] {
  return rows.map(baseSimpleField);
}

export function adaptFieldDetailSimpleRows(
  rows: readonly FieldDetailSimpleRpcRow[],
): FieldViewModel[] {
  return rows.map(baseSimpleField);
}

export function adaptFieldMapRow(row: FieldMapRpcRow): FieldViewModel {
  return baseField(row);
}

export function adaptFieldMapRows(rows: readonly FieldMapRpcRow[]): FieldViewModel[] {
  return rows.map(adaptFieldMapRow);
}

export function adaptFieldDetailRow(row: FieldDetailRpcRow): FieldViewModel {
  return baseField(row);
}

export function adaptFieldDetailRows(rows: readonly FieldDetailRpcRow[]): FieldViewModel[] {
  return rows.map(adaptFieldDetailRow);
}

export function adaptRiceVarietyRows(
  rows: readonly RiceVarietyRpcRow[],
): RiceVarietyOption[] {
  const order = new Map<string, number>(
    CONFIRMED_RICE_VARIETY_NAMES.map((name, index) => [name, index]),
  );
  return rows
    .map((row): RiceVarietyOption | null => {
      const id = asId(row.id, "品種ID");
      const name = asText(row.name, "品種名");
      if (typeof row.is_active !== "boolean") {
        throw new FieldAdapterError("Supabaseの品種有効状態が不正です。");
      }
      const nameKana = asText(row.name_kana, "品種読み", true);
      if (!row.is_active) return null;
      return {
        id,
        name,
        nameKana,
        isCustom: row.owner_account_id !== null,
      };
    })
    .filter((row): row is RiceVarietyOption => row !== null)
    .sort((left, right) => {
      const leftOrder = order.get(left.name);
      const rightOrder = order.get(right.name);
      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return left.name.localeCompare(right.name, "ja");
    });
}
