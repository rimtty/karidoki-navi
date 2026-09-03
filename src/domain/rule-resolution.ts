import { assertLocalDate, compareLocalDates } from "./dates";
import type {
  LocalDate,
  MaturityRule,
  RegionDescriptor,
  RuleCandidate,
  RuleCandidateEnvelope,
  RuleResolution,
  RuleResolutionInput,
} from "./types";

type CandidateWithMetadata = {
  rule: RuleCandidate;
  region?: RegionDescriptor;
  matches?: boolean;
  index: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ruleField(rule: RuleCandidate, camel: string, snake: string): unknown {
  const record = rule as unknown as Record<string, unknown>;
  return record[camel] ?? record[snake];
}

function ruleVarietyId(rule: RuleCandidate): string | undefined {
  const value = ruleField(rule, "varietyId", "variety_id");
  return typeof value === "string" ? value : undefined;
}

function ruleRegionId(rule: RuleCandidate, region?: RegionDescriptor): string | undefined {
  const value = ruleField(rule, "regionId", "region_id");
  if (typeof value === "string") return value;
  return region?.id;
}

function ruleEffectiveFrom(rule: RuleCandidate): LocalDate | null {
  const value = ruleField(rule, "effectiveFrom", "effective_from");
  return typeof value === "string" && isValidDate(value) ? value : null;
}

function ruleEffectiveTo(rule: RuleCandidate): LocalDate | null {
  const value = ruleField(rule, "effectiveTo", "effective_to");
  return value == null ? null : typeof value === "string" && isValidDate(value) ? value : null;
}

function ruleStatus(rule: RuleCandidate): string | undefined {
  const value = ruleField(rule, "status", "status");
  return typeof value === "string" ? value : undefined;
}

function isValidDate(value: string): value is LocalDate {
  try {
    assertLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function isValidRule(rule: RuleCandidate): boolean {
  const start = asNumber(ruleField(rule, "harvestStartTempC", "harvest_start_temp_c"), Number.NaN);
  const target = asNumber(ruleField(rule, "harvestTargetTempC", "harvest_target_temp_c"), Number.NaN);
  const end = asNumber(ruleField(rule, "harvestEndTempC", "harvest_end_temp_c"), Number.NaN);
  const offset = asNumber(
    ruleField(rule, "accumulationStartOffsetDays", "accumulation_start_offset_days"),
    Number.NaN,
  );
  return (
    Number.isFinite(start) &&
    Number.isFinite(target) &&
    Number.isFinite(end) &&
    start <= target &&
    target <= end &&
    Number.isInteger(offset) &&
    offset >= 0 &&
    offset <= 7 &&
    ruleEffectiveFrom(rule) !== null
  );
}

function unwrapCandidate(
  candidate: RuleCandidate | RuleCandidateEnvelope,
  index: number,
): CandidateWithMetadata {
  const record = candidate as unknown as Record<string, unknown>;
  if (isRecord(record.rule)) {
    const rule = record.rule as unknown as RuleCandidate;
    const region = isRecord(record.region)
      ? (record.region as unknown as RegionDescriptor)
      : rule.region;
    return {
      rule,
      region,
      matches: typeof record.matches === "boolean" ? record.matches : rule.matches,
      index,
    };
  }
  const region = isRecord(record.region)
    ? (record.region as unknown as RegionDescriptor)
    : candidate.region;
  return {
    rule: candidate as RuleCandidate,
    region,
    matches: candidate.matches,
    index,
  };
}

function matchesRegion(
  candidate: CandidateWithMetadata,
  input: RuleResolutionInput,
): boolean {
  if (candidate.matches === false) return false;
  if (candidate.matches === true) return true;

  const regionId = ruleRegionId(candidate.rule, candidate.region);
  const regionIds =
    input.regionIds ?? input.matchingRegionIds ?? input.fieldRegionIds ?? null;
  if (regionIds !== null && regionId !== undefined) {
    if (!regionIds.includes(regionId)) return false;
  }

  if (input.matchesRegion && candidate.region) {
    return input.matchesRegion(candidate.region, input.point);
  }
  if (candidate.region?.contains && input.point !== undefined) {
    return candidate.region.contains(input.point);
  }
  return true;
}

function specificity(candidate: CandidateWithMetadata): number {
  const rule = candidate.rule as unknown as Record<string, unknown>;
  const region = candidate.region;
  const explicit =
    rule.regionSpecificity ??
    rule.specificity ??
    region?.specificity ??
    region?.depth ??
    undefined;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;

  const kind = rule.regionKind ?? region?.kind;
  switch (kind) {
    case "COUNTRY":
      return 0;
    case "PREFECTURE":
      return 1;
    case "MUNICIPALITY":
      return 2;
    case "CUSTOM":
      return 3;
    default:
      return Number.NEGATIVE_INFINITY;
  }
}

function regionArea(candidate: CandidateWithMetadata): number | null {
  const rule = candidate.rule as unknown as Record<string, unknown>;
  const value = rule.regionArea ?? rule.area ?? candidate.region?.area;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareCandidates(a: CandidateWithMetadata, b: CandidateWithMetadata): number {
  const aSpecificity = specificity(a);
  const bSpecificity = specificity(b);
  if (aSpecificity !== bSpecificity) return bSpecificity - aSpecificity;

  // If callers supplied two regions at the same hierarchy level, their area
  // is a useful deterministic narrowness tie-breaker.
  const aArea = regionArea(a);
  const bArea = regionArea(b);
  if (aArea !== null && bArea !== null && aArea !== bArea) return aArea - bArea;

  const aPriority = asNumber(ruleField(a.rule, "priority", "priority"));
  const bPriority = asNumber(ruleField(b.rule, "priority", "priority"));
  if (aPriority !== bPriority) return bPriority - aPriority;

  const aEffectiveFrom = ruleEffectiveFrom(a.rule)!;
  const bEffectiveFrom = ruleEffectiveFrom(b.rule)!;
  const effectiveDateOrder = compareLocalDates(bEffectiveFrom, aEffectiveFrom);
  if (effectiveDateOrder !== 0) return effectiveDateOrder;

  const aVersion = asNumber(ruleField(a.rule, "version", "version"));
  const bVersion = asNumber(ruleField(b.rule, "version", "version"));
  if (aVersion !== bVersion) return bVersion - aVersion;

  const aId = String(ruleField(a.rule, "id", "id") ?? "");
  const bId = String(ruleField(b.rule, "id", "id") ?? "");
  const idOrder = aId.localeCompare(bId);
  return idOrder !== 0 ? idOrder : a.index - b.index;
}

function unwrapCustomRule(input: RuleResolutionInput): MaturityRule | null {
  const custom = input.customOverride ?? input.customRule ?? null;
  if (custom === null) return null;
  if (!isValidRule(custom as RuleCandidate)) {
    throw new RangeError("custom variety rule is invalid");
  }
  return custom;
}

function resolveWithMetadata(input: RuleResolutionInput): RuleResolution | null {
  const custom = unwrapCustomRule(input);
  if (custom !== null) return { rule: custom, source: "CUSTOM" };

  const asOfDate = input.asOfDate ?? null;
  if (asOfDate !== null) assertLocalDate(asOfDate, "asOfDate");

  const candidates = input.rules
    .map(unwrapCandidate)
    .filter((candidate) => {
      if (!isValidRule(candidate.rule)) return false;
      if (ruleStatus(candidate.rule) !== undefined && ruleStatus(candidate.rule) !== "ACTIVE") {
        return false;
      }
      if (
        input.varietyId != null &&
        ruleVarietyId(candidate.rule) !== undefined &&
        ruleVarietyId(candidate.rule) !== input.varietyId
      ) {
        return false;
      }
      if (!matchesRegion(candidate, input)) return false;
      if (asOfDate === null) return true;

      const effectiveFrom = ruleEffectiveFrom(candidate.rule)!;
      const effectiveTo = ruleEffectiveTo(candidate.rule);
      return (
        compareLocalDates(effectiveFrom, asOfDate) <= 0 &&
        (effectiveTo === null || compareLocalDates(effectiveTo, asOfDate) >= 0)
      );
    })
    .sort(compareCandidates);

  const selected = candidates[0];
  return selected === undefined
    ? null
    : { rule: selected.rule, source: "REGION", region: selected.region };
}

/** Resolve the applicable immutable rule, or null when no active rule matches. */
export function resolveVarietyRule(input: RuleResolutionInput): MaturityRule | null {
  return resolveWithMetadata(input)?.rule ?? null;
}

/** Same resolution with provenance for detail screens and audit logging. */
export function resolveVarietyRuleWithMetadata(
  input: RuleResolutionInput,
): RuleResolution | null {
  return resolveWithMetadata(input);
}

export const resolveRule = resolveVarietyRule;
export const selectVarietyRule = resolveVarietyRule;
export const findApplicableRule = resolveVarietyRule;
