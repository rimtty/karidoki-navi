import { assertLocalDate } from "./dates";
import type {
  DailyTemperature,
  LocalDate,
  TemperatureObservationLike,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read and validate the calendar date from a provider/DB observation. */
export function observationDate(
  observation: TemperatureObservationLike,
): LocalDate | null {
  if (!isRecord(observation)) return null;

  const record = observation as unknown as Record<string, unknown>;
  const value = record.date ?? record.observedDate ?? record.observed_date;
  if (value == null) return null;
  if (typeof value !== "string") return null;
  return assertLocalDate(value, "observation date");
}

/**
 * Read a mean temperature while preserving null as a missing value.  The
 * property order mirrors the canonical camelCase shape, Postgres snake_case,
 * and finally a generic provider value.
 */
export function observationMeanTemperature(
  observation: TemperatureObservationLike,
): number | null {
  if (!isRecord(observation)) return null;

  let value: unknown;
  const record = observation as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "meanTempC")) {
    value = record.meanTempC;
  } else if (Object.prototype.hasOwnProperty.call(record, "mean_temp_c")) {
    value = record.mean_temp_c;
  } else {
    value = record.value;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeObservation(
  observation: TemperatureObservationLike,
): DailyTemperature | null {
  const date = observationDate(observation);
  if (date === null) return null;
  return {
    date,
    meanTempC: observationMeanTemperature(observation),
  };
}

export function normalizeObservations(
  observations: readonly TemperatureObservationLike[],
): DailyTemperature[] {
  return observations
    .map(normalizeObservation)
    .filter((value): value is DailyTemperature => value !== null);
}

export function isValidMeanTemperature(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
