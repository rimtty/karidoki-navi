import type { LocalDate } from "./types";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Validate an ISO calendar date without interpreting it in the host's local
 * time zone.
 */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Date.UTC treats years 0..99 as 1900..1999.  Construct at epoch and set
  // the full year explicitly to preserve every four-digit ISO year.
  const utc = new Date(0);
  utc.setUTCHours(0, 0, 0, 0);
  utc.setUTCFullYear(year, month - 1, day);

  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function assertLocalDate(value: string, name = "date"): LocalDate {
  if (!isLocalDate(value)) {
    throw new RangeError(`${name} must be a valid ISO date (YYYY-MM-DD)`);
  }
  return value;
}

/** Parse a LocalDate as UTC midnight, never local midnight. */
export function parseLocalDate(value: LocalDate): Date {
  assertLocalDate(value);
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(0);
  utc.setUTCHours(0, 0, 0, 0);
  utc.setUTCFullYear(year, month - 1, day);
  return utc;
}

/** Format a Date instant using UTC fields as a LocalDate. */
export function formatLocalDate(value: Date): LocalDate {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError("value must be a valid Date");
  }

  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return assertLocalDate(`${year}-${month}-${day}`);
}

export function addLocalDays(value: LocalDate, days: number): LocalDate {
  assertLocalDate(value);
  if (!Number.isInteger(days)) {
    throw new RangeError("days must be an integer");
  }

  const utc = parseLocalDate(value);
  utc.setUTCDate(utc.getUTCDate() + days);
  return formatLocalDate(utc);
}

/** Compare two LocalDates in chronological order. */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  assertLocalDate(a, "a");
  assertLocalDate(b, "b");
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isLocalDateBefore(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDates(a, b) < 0;
}

export function isLocalDateOnOrBefore(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDates(a, b) <= 0;
}

export function isLocalDateAfter(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDates(a, b) > 0;
}

export function isLocalDateOnOrAfter(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDates(a, b) >= 0;
}

/** Number of calendar days from `from` to `to` (can be negative). */
export function differenceInLocalDays(
  from: LocalDate,
  to: LocalDate,
): number {
  const start = parseLocalDate(from).getTime();
  const end = parseLocalDate(to).getTime();
  return Math.round((end - start) / MILLISECONDS_PER_DAY);
}

/** Number of calendar days in an inclusive date range. */
export function countInclusiveLocalDays(
  from: LocalDate,
  to: LocalDate,
): number {
  const difference = differenceInLocalDays(from, to);
  return difference < 0 ? 0 : difference + 1;
}

export function listLocalDates(
  from: LocalDate,
  to: LocalDate,
): LocalDate[] {
  if (compareLocalDates(from, to) > 0) return [];

  const result: LocalDate[] = [];
  let cursor = from;
  while (compareLocalDates(cursor, to) <= 0) {
    result.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return result;
}

export function maxLocalDate(values: readonly (LocalDate | null | undefined)[]):
  LocalDate | null {
  let maximum: LocalDate | null = null;
  for (const value of values) {
    if (value == null) continue;
    assertLocalDate(value);
    if (maximum === null || value > maximum) maximum = value;
  }
  return maximum;
}

export function minLocalDate(values: readonly (LocalDate | null | undefined)[]):
  LocalDate | null {
  let minimum: LocalDate | null = null;
  for (const value of values) {
    if (value == null) continue;
    assertLocalDate(value);
    if (minimum === null || value < minimum) minimum = value;
  }
  return minimum;
}
