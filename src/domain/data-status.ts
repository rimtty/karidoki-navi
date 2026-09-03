import {
  assertLocalDate,
  countInclusiveLocalDays,
  differenceInLocalDays,
} from "./dates";
import type { DataStatus, DataStatusInput } from "./types";

function hasError(input: DataStatusInput): boolean {
  if (input.hasError === true || input.state === "ERROR") return true;
  if (input.error === undefined || input.error === null) return false;
  if (input.error === false || input.error === "") return false;
  return true;
}

function isPending(input: DataStatusInput): boolean {
  return (
    input.pending === true ||
    input.calculationPending === true ||
    input.state === "PENDING"
  );
}

function isStale(input: DataStatusInput): boolean {
  const latest =
    input.latestObservedDate ??
    input.latestAvailableDate ??
    input.lastUpdatedDate ??
    null;
  const asOf = input.asOfDate ?? null;
  if (latest === null || asOf === null) return false;
  assertLocalDate(latest, "latestObservedDate");
  assertLocalDate(asOf, "asOfDate");
  // "前々日以前" means that on the third day the feed has still not reached
  // the preceding day: a gap of two or more calendar days.
  return differenceInLocalDays(latest, asOf) >= 2;
}

function missingDays(input: DataStatusInput): number {
  if (input.missingDayCount !== undefined) {
    if (!Number.isInteger(input.missingDayCount) || input.missingDayCount < 0) {
      throw new RangeError("missingDayCount must be a non-negative integer");
    }
    return input.missingDayCount;
  }

  if (input.expectedStartDate == null || input.expectedEndDate == null) {
    return 0;
  }
  assertLocalDate(input.expectedStartDate, "expectedStartDate");
  assertLocalDate(input.expectedEndDate, "expectedEndDate");
  const expected = countInclusiveLocalDays(
    input.expectedStartDate,
    input.expectedEndDate,
  );
  if (expected === 0) return 0;
  const valid = input.validDayCount ?? 0;
  if (!Number.isInteger(valid) || valid < 0) {
    throw new RangeError("validDayCount must be a non-negative integer");
  }
  return Math.max(0, expected - valid);
}

/**
 * Derive the quality of a weather calculation.  Errors and pending work take
 * precedence, followed by freshness and then missing days.  This lets a stale
 * feed remain visibly stale even when its old range also contains a hole.
 */
export function determineDataStatus(input: DataStatusInput): DataStatus {
  if (hasError(input)) return "ERROR";
  if (isPending(input)) return "PENDING";
  if (isStale(input)) return "STALE";
  if (missingDays(input) > 0) return "INCOMPLETE";
  return "COMPLETE";
}

export const getDataStatus = determineDataStatus;
export const deriveDataStatus = determineDataStatus;
export const classifyDataStatus = determineDataStatus;
