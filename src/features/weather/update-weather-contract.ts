/**
 * Keep this contract module dependency-free so the Supabase Edge Function can
 * load it from the repository without a Node/TypeScript extension resolver.
 * LocalDate is a validated ISO calendar date, matching weather-core.ts.
 */
export type LocalDate = string;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertLocalDate(value: string, name = "date"): LocalDate {
  if (!isLocalDate(value)) {
    throw new RangeError(`${name} must be a valid ISO date (YYYY-MM-DD)`);
  }
  return value;
}

function addLocalDays(value: LocalDate, days: number): LocalDate {
  assertLocalDate(value);
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCDate(date.getUTCDate() + days);
  const formatted = `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return assertLocalDate(formatted);
}

function compareLocalDates(a: LocalDate, b: LocalDate): number {
  assertLocalDate(a, "a");
  assertLocalDate(b, "b");
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The implicit historical window requested for a season-bound location. */
export const DEFAULT_BACKFILL_DAYS = 60;
/** The largest correction window accepted by the operator API. */
export const MAX_CORRECTION_DAYS = 60;
/** Conservative default for the current JMA point-JSON retention window. */
export const DEFAULT_JMA_RETENTION_DAYS = 28;
export const MAX_JMA_RETENTION_DAYS = 60;

export type WeatherDateRange = {
  from: LocalDate;
  to: LocalDate;
};

export type WeatherDateRequest = {
  asOfDate?: LocalDate;
  fromDate?: LocalDate;
  toDate?: LocalDate;
  targetDateOnly?: boolean;
  correctionDays?: number;
};

export type ResolvedWeatherDates = {
  /** The JST run/cutoff date. It is null when an explicit observed range is used. */
  asOfDate: LocalDate | null;
  /** The date used to recalculate summaries and returned as targetDate. */
  targetDate: LocalDate;
  /** An explicit range, or a one-day range when targetDateOnly is true. */
  explicitRange: WeatherDateRange | null;
  mode: "automatic" | "target-only" | "explicit-range";
};

export type WeatherRetentionWindow = {
  days: number;
  earliestDate: LocalDate;
  latestDate: LocalDate;
  basis: "default" | "configured";
};

export type WeatherRangePlan = {
  requestedRange: WeatherDateRange;
  effectiveRange: WeatherDateRange;
  retentionLimited: boolean;
  csvFallbackStatus: "NOT_REQUIRED" | "REQUIRED_FOR_OLDER_DATES";
};

function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareLocalDates(a, b) >= 0 ? a : b;
}

function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareLocalDates(a, b) <= 0 ? a : b;
}

function assertDateOrder(range: WeatherDateRange, label: string): WeatherDateRange {
  if (compareLocalDates(range.from, range.to) > 0) {
    throw new RangeError(`${label}.from must be on or before ${label}.to`);
  }
  return range;
}

function assertDateYear(value: LocalDate, name: string): LocalDate {
  const date = assertLocalDate(value, name);
  if (date < "2000-01-01" || date > "2100-12-31") {
    throw new RangeError(`${name} must be between 2000-01-01 and 2100-12-31`);
  }
  return date;
}

/**
 * Resolve operator date controls without consulting Supabase or the clock.
 *
 * `asOfDate` is deliberately a JST run/cutoff date: without an explicit
 * observed range, the target is the previous JST calendar day. Operators who
 * need exactly one historical day should use `targetDateOnly: true` or an
 * equal `fromDate`/`toDate` pair.
 */
export function resolveWeatherDates(
  input: WeatherDateRequest,
  currentJstDate: LocalDate,
): ResolvedWeatherDates {
  const today = assertDateYear(currentJstDate, "currentJstDate");
  const hasFrom = input.fromDate !== undefined;
  const hasTo = input.toDate !== undefined;
  const hasExplicitRange = hasFrom || hasTo;
  const targetDateOnly = input.targetDateOnly === true;

  if (hasExplicitRange && (!hasFrom || !hasTo)) {
    throw new RangeError("fromDate and toDate must be provided together");
  }
  if (hasExplicitRange && input.asOfDate !== undefined) {
    throw new RangeError("asOfDate cannot be combined with fromDate/toDate");
  }
  if (hasExplicitRange && targetDateOnly) {
    throw new RangeError("targetDateOnly cannot be combined with fromDate/toDate");
  }
  if (hasExplicitRange && input.correctionDays !== undefined) {
    throw new RangeError("correctionDays cannot be combined with fromDate/toDate");
  }
  if (targetDateOnly && input.correctionDays !== undefined) {
    throw new RangeError("correctionDays cannot be combined with targetDateOnly");
  }

  if (hasExplicitRange) {
    const range = assertDateOrder(
      {
        from: assertDateYear(input.fromDate!, "fromDate"),
        to: assertDateYear(input.toDate!, "toDate"),
      },
      "date range",
    );
    if (addLocalDays(range.from, MAX_CORRECTION_DAYS - 1) < range.to) {
      throw new RangeError(`explicit date range must be at most ${MAX_CORRECTION_DAYS} days`);
    }
    return {
      asOfDate: null,
      targetDate: range.to,
      explicitRange: range,
      mode: "explicit-range",
    };
  }

  const asOfDate = assertDateYear(input.asOfDate ?? today, "asOfDate");
  const targetDate = addLocalDays(asOfDate, -1);
  return {
    asOfDate,
    targetDate,
    explicitRange: targetDateOnly ? { from: targetDate, to: targetDate } : null,
    mode: targetDateOnly ? "target-only" : "automatic",
  };
}

/** Parse the configured provider retention without accepting an unsafe value. */
export function parseJmaRetentionDays(raw: string | undefined): {
  days: number;
  basis: "default" | "configured";
} {
  if (raw === undefined || raw.trim() === "") {
    return { days: DEFAULT_JMA_RETENTION_DAYS, basis: "default" };
  }
  const days = Number(raw.trim());
  if (!Number.isInteger(days) || days < 1 || days > MAX_JMA_RETENTION_DAYS) {
    throw new RangeError(
      `JMA_WEATHER_RETENTION_DAYS must be an integer from 1 to ${MAX_JMA_RETENTION_DAYS}`,
    );
  }
  return { days, basis: "configured" };
}

export function makeRetentionWindow(
  latestAvailableDate: LocalDate,
  retention: { days: number; basis: "default" | "configured" },
): WeatherRetentionWindow {
  assertDateYear(latestAvailableDate, "latestAvailableDate");
  if (!Number.isInteger(retention.days) || retention.days < 1 || retention.days > MAX_JMA_RETENTION_DAYS) {
    throw new RangeError(`retention days must be from 1 to ${MAX_JMA_RETENTION_DAYS}`);
  }
  return {
    days: retention.days,
    earliestDate: addLocalDays(latestAvailableDate, -(retention.days - 1)),
    latestDate: latestAvailableDate,
    basis: retention.basis,
  };
}

export function assertRangeWithinRetention(
  range: WeatherDateRange,
  retention: WeatherRetentionWindow,
  label = "requested range",
): WeatherDateRange {
  assertDateOrder(range, label);
  if (compareLocalDates(range.from, retention.earliestDate) < 0) {
    throw new RangeError(
      `${label} starts before the JMA retention window (${retention.earliestDate}); use reviewed CSV`,
    );
  }
  if (compareLocalDates(range.to, retention.latestDate) > 0) {
    throw new RangeError(
      `${label} ends after the latest available JMA date (${retention.latestDate})`,
    );
  }
  return range;
}

/** Validate all explicit operator ranges before any DB or JMA request starts. */
export function validateWeatherDateRequest(
  resolved: ResolvedWeatherDates,
  input: WeatherDateRequest,
  retention: WeatherRetentionWindow,
): void {
  if (compareLocalDates(resolved.targetDate, retention.earliestDate) < 0) {
    throw new RangeError(
      `target date is outside the JMA retention window (${retention.earliestDate}..${retention.latestDate}); use reviewed CSV`,
    );
  }
  if (compareLocalDates(resolved.targetDate, retention.latestDate) > 0) {
    throw new RangeError(
      `target date must be on or before the latest available JMA date (${retention.latestDate})`,
    );
  }
  if (resolved.explicitRange) {
    assertRangeWithinRetention(resolved.explicitRange, retention);
  }
  if (input.correctionDays !== undefined) {
    if (
      !Number.isInteger(input.correctionDays) ||
      input.correctionDays < 1 ||
      input.correctionDays > MAX_CORRECTION_DAYS
    ) {
      throw new RangeError(`correctionDays must be an integer from 1 to ${MAX_CORRECTION_DAYS}`);
    }
    if (input.correctionDays > retention.days) {
      throw new RangeError(
        `correctionDays exceeds the JMA retention window (${retention.days} days); use reviewed CSV`,
      );
    }
    assertRangeWithinRetention(
      {
        from: addLocalDays(resolved.targetDate, -(input.correctionDays - 1)),
        to: resolved.targetDate,
      },
      retention,
      "correction range",
    );
  }
}

function oneDayRange(targetDate: LocalDate): WeatherDateRange {
  return { from: targetDate, to: targetDate };
}

/**
 * Plan the actual provider range. Only an implicit season backfill may be
 * shortened to the retention window; explicit ranges and correction requests
 * are rejected before this function is called when they are out of bounds.
 */
export function planWeatherRange(input: {
  targetDate: LocalDate;
  seasonCount: number;
  seasonFallbackFrom?: LocalDate | null;
  explicitRange?: WeatherDateRange | null;
  correctionDays?: number;
  retention: WeatherRetentionWindow;
}): WeatherRangePlan {
  const targetDate = assertDateYear(input.targetDate, "targetDate");
  if (!Number.isInteger(input.seasonCount) || input.seasonCount < 0) {
    throw new RangeError("seasonCount must be a non-negative integer");
  }

  if (input.explicitRange) {
    assertRangeWithinRetention(input.explicitRange, input.retention);
    return {
      requestedRange: input.explicitRange,
      effectiveRange: input.explicitRange,
      retentionLimited: false,
      csvFallbackStatus: "NOT_REQUIRED",
    };
  }

  if (input.correctionDays !== undefined) {
    const requestedRange = {
      from: addLocalDays(targetDate, -(input.correctionDays - 1)),
      to: targetDate,
    };
    assertRangeWithinRetention(requestedRange, input.retention, "correction range");
    return {
      requestedRange,
      effectiveRange: requestedRange,
      retentionLimited: false,
      csvFallbackStatus: "NOT_REQUIRED",
    };
  }

  const requestedRange =
    input.seasonCount === 0
      ? oneDayRange(targetDate)
      : {
          from: minDate(
            targetDate,
            maxDate(
              addLocalDays(targetDate, -DEFAULT_BACKFILL_DAYS + 1),
              input.seasonFallbackFrom ?? addLocalDays(targetDate, -DEFAULT_BACKFILL_DAYS + 1),
            ),
          ),
          to: targetDate,
        };
  const effectiveFrom = maxDate(requestedRange.from, input.retention.earliestDate);
  const effectiveTo = minDate(requestedRange.to, input.retention.latestDate);
  if (compareLocalDates(effectiveFrom, effectiveTo) > 0) {
    throw new RangeError(
      `no dates are available in the JMA retention window (${input.retention.earliestDate}..${input.retention.latestDate})`,
    );
  }
  const retentionLimited = compareLocalDates(effectiveFrom, requestedRange.from) > 0;
  return {
    requestedRange,
    effectiveRange: { from: effectiveFrom, to: effectiveTo },
    retentionLimited,
    csvFallbackStatus: retentionLimited ? "REQUIRED_FOR_OLDER_DATES" : "NOT_REQUIRED",
  };
}
