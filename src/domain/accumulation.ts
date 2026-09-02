import { addLocalDays, assertLocalDate, compareLocalDates, listLocalDates, maxLocalDate } from "./dates";
import { normalizeObservations } from "./observations";
import type {
  AccumulationResult,
  LocalDate,
  TemperatureObservationLike,
} from "./types";

export interface AccumulationInput {
  headingDate?: LocalDate | null;
  heading_date?: LocalDate | null;
  accumulationStartOffsetDays?: number;
  accumulation_start_offset_days?: number;
  offsetDays?: number;
  dailyValues?: readonly TemperatureObservationLike[];
  dailyTemperatures?: readonly TemperatureObservationLike[];
  observations?: readonly TemperatureObservationLike[];
  values?: readonly TemperatureObservationLike[];
  throughDate?: LocalDate | null;
  through_date?: LocalDate | null;
  accumulatedThroughDate?: LocalDate | null;
}

function assertOffset(offsetDays: number): number {
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 7) {
    throw new RangeError("accumulation start offset must be an integer from 0 to 7 days");
  }
  return offsetDays;
}

function emptyResult(
  startDate: LocalDate | null,
  throughDate: LocalDate | null,
): AccumulationResult {
  return {
    accumulationStartDate: startDate,
    startDate,
    throughDate,
    accumulatedTempC: 0,
    accumulatedTemperatureC: 0,
    validDayCount: 0,
    missingDayCount: 0,
  };
}

function inputObservations(input: AccumulationInput): readonly TemperatureObservationLike[] {
  return (
    input.dailyValues ??
    input.dailyTemperatures ??
    input.observations ??
    input.values ??
    []
  );
}

function inputThroughDate(input: AccumulationInput): LocalDate | null | undefined {
  if (input.throughDate !== undefined) return input.throughDate;
  if (input.through_date !== undefined) return input.through_date;
  return input.accumulatedThroughDate;
}

function calculateFromInput(input: AccumulationInput): AccumulationResult {
  const headingDate = input.headingDate ?? input.heading_date ?? null;
  const offsetDays = assertOffset(
    input.accumulationStartOffsetDays ??
      input.accumulation_start_offset_days ??
      input.offsetDays ??
      1,
  );
  const observations = inputObservations(input);

  if (headingDate === null) {
    return emptyResult(null, null);
  }
  assertLocalDate(headingDate, "headingDate");
  const startDate = addLocalDays(headingDate, offsetDays);

  const normalized = normalizeObservations(observations);
  const explicitThroughDate = inputThroughDate(input);
  const throughDate =
    explicitThroughDate === undefined
      ? maxLocalDate(normalized.map((observation) => observation.date))
      : explicitThroughDate;
  if (throughDate !== null) assertLocalDate(throughDate, "throughDate");

  if (throughDate === null || compareLocalDates(throughDate, startDate) < 0) {
    return emptyResult(startDate, throughDate);
  }

  // There is one expected slot per calendar date.  A map makes the result
  // independent of provider ordering and keeps duplicate-date handling
  // deterministic (the last record wins, matching an UPSERT stream).
  const byDate = new Map<LocalDate, number | null>();
  for (const observation of normalized) {
    if (compareLocalDates(observation.date, startDate) < 0) continue;
    if (compareLocalDates(observation.date, throughDate) > 0) continue;
    byDate.set(observation.date, observation.meanTempC);
  }

  let accumulatedTempC = 0;
  let validDayCount = 0;
  let missingDayCount = 0;
  for (const date of listLocalDates(startDate, throughDate)) {
    const value = byDate.get(date);
    if (typeof value === "number" && Number.isFinite(value)) {
      accumulatedTempC += value;
      validDayCount += 1;
    } else {
      missingDayCount += 1;
    }
  }

  return {
    accumulationStartDate: startDate,
    startDate,
    throughDate,
    accumulatedTempC,
    accumulatedTemperatureC: accumulatedTempC,
    validDayCount,
    missingDayCount,
  };
}

/**
 * Sum valid daily mean temperatures from heading date + offset through the
 * requested date.  Missing values are never treated as 0; their calendar days
 * are counted separately in `missingDayCount`.
 */
export function calculateAccumulation(input: AccumulationInput): AccumulationResult;
export function calculateAccumulation(
  headingDate: LocalDate | null | undefined,
  observations: readonly TemperatureObservationLike[],
  offsetDays?: number,
  throughDate?: LocalDate | null,
): AccumulationResult;
export function calculateAccumulation(
  inputOrHeadingDate: AccumulationInput | LocalDate | null | undefined,
  observations?: readonly TemperatureObservationLike[],
  offsetDays = 1,
  throughDate?: LocalDate | null,
): AccumulationResult {
  if (typeof inputOrHeadingDate === "object" && inputOrHeadingDate !== null) {
    return calculateFromInput(inputOrHeadingDate);
  }
  return calculateFromInput({
    headingDate: inputOrHeadingDate,
    observations,
    offsetDays,
    throughDate,
  });
}

/**
 * Friendly alias for callers that naturally put observations first.  Both
 * positional orders remain available through `calculateAccumulation` above.
 */
export function accumulateTemperatures(
  observations: readonly TemperatureObservationLike[],
  headingDate: LocalDate | null | undefined,
  offsetDays?: number,
  throughDate?: LocalDate | null,
): AccumulationResult;
export function accumulateTemperatures(
  headingDate: LocalDate | null | undefined,
  observations: readonly TemperatureObservationLike[],
  offsetDays?: number,
  throughDate?: LocalDate | null,
): AccumulationResult;
export function accumulateTemperatures(
  first: readonly TemperatureObservationLike[] | LocalDate | null | undefined,
  second: readonly TemperatureObservationLike[] | LocalDate | null | undefined,
  offsetDays = 1,
  throughDate?: LocalDate | null,
): AccumulationResult {
  if (Array.isArray(first)) {
    return calculateAccumulation(second as LocalDate | null | undefined, first, offsetDays, throughDate);
  }
  return calculateAccumulation(
    first as LocalDate | null | undefined,
    second as readonly TemperatureObservationLike[],
    offsetDays,
    throughDate,
  );
}

export const calculateAccumulatedTemperature = calculateAccumulation;

/** Return a normalized, unrounded sum for integrations that only need the scalar. */
export function accumulatedTemperatureC(input: AccumulationInput): number {
  return calculateFromInput(input).accumulatedTempC;
}
