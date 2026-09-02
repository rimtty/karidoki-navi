import { addLocalDays, assertLocalDate, maxLocalDate } from "./dates";
import { normalizeObservations } from "./observations";
import type { EstimateDaysInput, LocalDate, TemperatureObservationLike } from "./types";

function estimateFromInput(input: EstimateDaysInput): number | null {
  const current = input.accumulatedTempC ?? input.accumulatedTemperatureC ?? 0;
  if (typeof current !== "number" || !Number.isFinite(current)) {
    throw new RangeError("accumulated temperature must be finite");
  }
  if (
    typeof input.harvestStartTempC !== "number" ||
    !Number.isFinite(input.harvestStartTempC)
  ) {
    throw new RangeError("harvest start temperature must be finite");
  }

  const source = input.recentValues ?? input.dailyValues ?? input.observations ?? [];
  const normalized = normalizeObservations(source);
  const asOfDate =
    input.asOfDate ?? maxLocalDate(normalized.map((observation) => observation.date));
  if (asOfDate === null) return null;
  assertLocalDate(asOfDate, "asOfDate");
  const windowStart = addLocalDays(asOfDate, -6);

  // A weather day is one sample.  De-duplicate dates so a malformed provider
  // response cannot make an estimate eligible merely by repeating one day.
  const recentByDate = new Map<LocalDate, number | null>();
  for (const observation of normalized) {
    if (observation.date < windowStart || observation.date > asOfDate) continue;
    recentByDate.set(observation.date, observation.meanTempC);
  }

  const validValues = [...recentByDate.values()].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (validValues.length < 5) return null;

  const average = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
  if (!(average > 0)) return null;

  const remaining = input.harvestStartTempC - current;
  return Math.max(0, Math.ceil(remaining / average));
}

/**
 * Estimate calendar days until the rule's start temperature using only the
 * recent measured trend.  Fewer than five valid samples in the seven-day
 * window, or a non-positive mean, intentionally yields null.
 */
export function estimateDaysToStart(input: EstimateDaysInput): number | null;
export function estimateDaysToStart(
  accumulatedTempC: number,
  harvestStartTempC: number,
  recentValues: readonly TemperatureObservationLike[],
  asOfDate?: LocalDate | null,
): number | null;
export function estimateDaysToStart(
  inputOrAccumulated: EstimateDaysInput | number,
  harvestStartTempC?: number,
  recentValues: readonly TemperatureObservationLike[] = [],
  asOfDate?: LocalDate | null,
): number | null {
  if (typeof inputOrAccumulated === "object") return estimateFromInput(inputOrAccumulated);
  return estimateFromInput({
    accumulatedTempC: inputOrAccumulated,
    harvestStartTempC: harvestStartTempC as number,
    recentValues,
    asOfDate,
  });
}

export const estimateDaysToHarvestStart = estimateDaysToStart;
export const estimateRemainingDays = estimateDaysToStart;
