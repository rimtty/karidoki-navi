/**
 * A calendar date without a time zone.  Dates in the domain are deliberately
 * represented as ISO calendar dates rather than JavaScript Date instances.
 */
export type LocalDate = string;

export const MATURITY_STATUSES = [
  "NOT_CONFIGURED",
  "BEFORE_HEADING",
  "GROWING",
  "GROWING_LATE",
  "HARVEST_SOON",
  "HARVEST_READY",
  "OVERDUE",
  "HARVESTED",
] as const;

export type MaturityStatus = (typeof MATURITY_STATUSES)[number];

export const DATA_STATUSES = [
  "PENDING",
  "COMPLETE",
  "INCOMPLETE",
  "STALE",
  "ERROR",
] as const;

export type DataStatus = (typeof DATA_STATUSES)[number];

export const RULE_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;

export type RuleStatus = (typeof RULE_STATUSES)[number];

export const REGION_KINDS = [
  "COUNTRY",
  "PREFECTURE",
  "MUNICIPALITY",
  "CUSTOM",
] as const;

export type RegionKind = (typeof REGION_KINDS)[number];

/** A normalized daily mean-temperature observation. */
export interface DailyTemperature {
  date: LocalDate;
  meanTempC: number | null;
}

/**
 * Shapes accepted at the domain boundary.  snake_case aliases are useful for
 * passing records read directly from Postgres, while `value` is convenient for
 * weather-provider adapters.
 */
export interface TemperatureObservationLike {
  date?: LocalDate;
  observedDate?: LocalDate;
  observed_date?: LocalDate;
  meanTempC?: number | null;
  mean_temp_c?: number | null;
  value?: number | null;
}

export interface MaturityRule {
  id?: string;
  varietyId?: string;
  variety_id?: string;
  regionId?: string;
  region_id?: string;
  harvestStartTempC: number;
  harvestTargetTempC: number;
  harvestEndTempC: number;
  dangerTempC?: number | null;
  accumulationStartOffsetDays: number;
  dailyTemperatureMetric?: "MEAN";
  effectiveFrom: LocalDate;
  effectiveTo?: LocalDate | null;
  priority?: number;
  version?: number;
  status?: RuleStatus;
  sourceTitle?: string;
  sourcePublisher?: string | null;
  sourceUrl?: string | null;
  publishedOn?: LocalDate | null;
  notes?: string | null;
}

export interface RegionDescriptor {
  id: string;
  kind?: RegionKind;
  /** Higher values mean a narrower region. */
  specificity?: number;
  /** Optional area in square metres; a smaller area is narrower. */
  area?: number;
  /** Optional explicit nesting depth; higher values mean narrower. */
  depth?: number;
  /** Optional pure containment predicate supplied by a spatial adapter. */
  contains?: (point: unknown) => boolean;
}

/** A rule with optional spatial matching metadata supplied by an adapter. */
export interface RuleCandidate extends MaturityRule {
  region?: RegionDescriptor;
  regionKind?: RegionKind;
  regionSpecificity?: number;
  regionArea?: number;
  /** Set by a spatial adapter when it has already done the containment test. */
  matches?: boolean;
}

export interface AccumulationResult {
  /** The first calendar date included in the accumulation, if configured. */
  accumulationStartDate: LocalDate | null;
  /** Alias useful to callers that call the same value simply `startDate`. */
  startDate: LocalDate | null;
  /** The last calendar date considered, if a through date was supplied/known. */
  throughDate: LocalDate | null;
  /** Unrounded sum of all valid daily means. */
  accumulatedTempC: number;
  /** Alias for integrations that use the full field name. */
  accumulatedTemperatureC: number;
  validDayCount: number;
  missingDayCount: number;
}

export interface RuleResolutionInput {
  varietyId?: string | null;
  asOfDate?: LocalDate | null;
  /** A user-defined rule takes precedence over all catalog rules. */
  customRule?: MaturityRule | null;
  customOverride?: MaturityRule | null;
  rules: readonly (RuleCandidate | RuleCandidateEnvelope)[];
  /** IDs of regions known to contain the field, from narrowest to broadest or any order. */
  regionIds?: readonly string[];
  matchingRegionIds?: readonly string[];
  fieldRegionIds?: readonly string[];
  /** Optional point/region matcher supplied by the server boundary. */
  point?: unknown;
  matchesRegion?: (region: RegionDescriptor, point: unknown) => boolean;
}

export interface RuleCandidateEnvelope {
  rule: RuleCandidate;
  region?: RegionDescriptor;
  matches?: boolean;
}

export interface RuleResolution {
  rule: MaturityRule;
  source: "CUSTOM" | "REGION";
  region?: RegionDescriptor;
}

export interface MaturityStatusInput {
  headingDate?: LocalDate | null;
  accumulationStartDate?: LocalDate | null;
  accumulationStartOffsetDays?: number;
  throughDate?: LocalDate | null;
  asOfDate?: LocalDate | null;
  accumulatedTempC?: number;
  accumulatedTemperatureC?: number;
  rule?: MaturityRule | null;
  harvestDate?: LocalDate | null;
  harvested?: boolean;
  /** Explicit false/null means no weather location is configured. */
  weatherLocationId?: string | null;
  hasWeatherLocation?: boolean;
  weatherConfigured?: boolean;
}

export interface DataStatusInput {
  pending?: boolean;
  calculationPending?: boolean;
  state?: "PENDING" | "READY" | "COMPLETE" | "ERROR";
  error?: unknown;
  hasError?: boolean;
  missingDayCount?: number;
  validDayCount?: number;
  expectedStartDate?: LocalDate | null;
  expectedEndDate?: LocalDate | null;
  latestObservedDate?: LocalDate | null;
  latestAvailableDate?: LocalDate | null;
  lastUpdatedDate?: LocalDate | null;
  asOfDate?: LocalDate | null;
}

export interface EstimateDaysInput {
  accumulatedTempC?: number;
  accumulatedTemperatureC?: number;
  harvestStartTempC: number;
  recentValues?: readonly TemperatureObservationLike[];
  dailyValues?: readonly TemperatureObservationLike[];
  observations?: readonly TemperatureObservationLike[];
  asOfDate?: LocalDate | null;
}

export interface SeasonSummaryInput {
  headingDate?: LocalDate | null;
  harvestDate?: LocalDate | null;
  weatherLocationId?: string | null;
  rule?: MaturityRule | null;
  dailyValues?: readonly TemperatureObservationLike[];
  observations?: readonly TemperatureObservationLike[];
  throughDate?: LocalDate | null;
  asOfDate?: LocalDate | null;
  pending?: boolean;
  error?: unknown;
}

export interface SeasonSummary {
  accumulation: AccumulationResult;
  maturityStatus: MaturityStatus;
  dataStatus: DataStatus;
  estimatedDaysToStart: number | null;
}
