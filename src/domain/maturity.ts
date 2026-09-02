import { addLocalDays, assertLocalDate, compareLocalDates } from "./dates";
import type { LocalDate, MaturityRule, MaturityStatus, MaturityStatusInput } from "./types";

function ruleValue(rule: MaturityRule, key: keyof MaturityRule): unknown {
  return rule[key];
}

function assertUsableRule(rule: MaturityRule): void {
  const start = ruleValue(rule, "harvestStartTempC");
  const target = ruleValue(rule, "harvestTargetTempC");
  const end = ruleValue(rule, "harvestEndTempC");
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof target !== "number" ||
    !Number.isFinite(target) ||
    typeof end !== "number" ||
    !Number.isFinite(end) ||
    start > target ||
    target > end
  ) {
    throw new RangeError("maturity rule temperature thresholds are invalid");
  }
}

function hasWeatherLocation(input: MaturityStatusInput): boolean {
  if (input.hasWeatherLocation !== undefined) return input.hasWeatherLocation;
  if (input.weatherConfigured !== undefined) return input.weatherConfigured;
  // A null (or undefined explicitly supplied) station means unconfigured. If
  // the field is omitted entirely, the lower-level status function is being
  // used without weather-binding context and can still classify the values.
  if (Object.prototype.hasOwnProperty.call(input, "weatherLocationId")) {
    return input.weatherLocationId != null && input.weatherLocationId !== "";
  }
  return true;
}

function inputAccumulatedTemp(input: MaturityStatusInput): number {
  const value = input.accumulatedTempC ?? input.accumulatedTemperatureC ?? 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError("accumulated temperature must be finite");
  }
  return value;
}

function inputStartDate(input: MaturityStatusInput, rule: MaturityRule): LocalDate {
  if (input.accumulationStartDate != null) {
    return assertLocalDate(input.accumulationStartDate, "accumulationStartDate");
  }
  const offset = input.accumulationStartOffsetDays ?? rule.accumulationStartOffsetDays;
  if (!Number.isInteger(offset) || offset < 0 || offset > 7) {
    throw new RangeError("accumulation start offset must be an integer from 0 to 7 days");
  }
  return addLocalDays(assertLocalDate(input.headingDate!, "headingDate"), offset);
}

/**
 * Classify a crop season from its immutable rule snapshot and current values.
 * `harvestDate` is deliberately checked first, and an explicit null station is
 * treated as not configured.  All comparisons are against LocalDate strings,
 * so no host time zone can move a boundary across midnight.
 */
export function determineMaturityStatus(input: MaturityStatusInput): MaturityStatus {
  if (input.harvested || input.harvestDate != null) return "HARVESTED";

  const headingDate = input.headingDate ?? null;
  const rule = input.rule ?? null;
  if (headingDate === null || rule === null || !hasWeatherLocation(input)) {
    return "NOT_CONFIGURED";
  }
  assertLocalDate(headingDate, "headingDate");
  assertUsableRule(rule);

  const startDate = inputStartDate(input, rule);
  const currentDate = input.asOfDate ?? input.throughDate ?? null;
  if (currentDate !== null) {
    assertLocalDate(currentDate, "asOfDate");
    if (compareLocalDates(currentDate, startDate) < 0) {
      return "BEFORE_HEADING";
    }
  }

  const accumulated = inputAccumulatedTemp(input);
  const harvestStart = rule.harvestStartTempC;
  const harvestEnd = rule.harvestEndTempC;

  // A zero start threshold is unusual but valid in the DB constraints.  It
  // means every non-negative accumulation is already at least the start;
  // avoid division by zero while keeping the inclusive ready/end boundaries.
  if (harvestStart <= 0) {
    return accumulated <= harvestEnd ? "HARVEST_READY" : "OVERDUE";
  }

  const ratio = accumulated / harvestStart;
  if (ratio < 0.7) return "GROWING";
  if (ratio < 0.9) return "GROWING_LATE";
  if (accumulated < harvestStart) return "HARVEST_SOON";
  if (accumulated <= harvestEnd) return "HARVEST_READY";
  return "OVERDUE";
}

export const getMaturityStatus = determineMaturityStatus;
export const calculateMaturityStatus = determineMaturityStatus;
export const resolveMaturityStatus = determineMaturityStatus;
