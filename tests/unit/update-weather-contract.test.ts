import { describe, expect, it } from "vitest";
import {
  DEFAULT_JMA_RETENTION_DAYS,
  makeRetentionWindow,
  parseJmaRetentionDays,
  planWeatherRange,
  resolveWeatherDates,
  validateWeatherDateRequest,
} from "../../src/features/weather/update-weather-contract";

describe("update-weather date contract", () => {
  const currentJstDate = "2026-09-03" as const;
  const retention = makeRetentionWindow("2026-09-02", {
    days: DEFAULT_JMA_RETENTION_DAYS,
    basis: "default",
  });

  it("treats asOfDate as the JST run date and targetDateOnly fetches only its previous day", () => {
    const resolved = resolveWeatherDates(
      { asOfDate: currentJstDate, targetDateOnly: true },
      currentJstDate,
    );

    expect(resolved.asOfDate).toBe("2026-09-03");
    expect(resolved.targetDate).toBe("2026-09-02");
    expect(resolved.explicitRange).toEqual({ from: "2026-09-02", to: "2026-09-02" });
    expect(resolved.mode).toBe("target-only");
  });

  it("keeps an explicit one-day from/to smoke range exactly one day", () => {
    const resolved = resolveWeatherDates(
      { fromDate: "2026-09-02", toDate: "2026-09-02" },
      currentJstDate,
    );

    expect(resolved.asOfDate).toBeNull();
    expect(resolved.targetDate).toBe("2026-09-02");
    expect(resolved.explicitRange).toEqual({ from: "2026-09-02", to: "2026-09-02" });
    validateWeatherDateRequest(resolved, {}, retention);
  });

  it("does not backfill a location without a season", () => {
    const plan = planWeatherRange({
      targetDate: "2026-09-02",
      seasonCount: 0,
      retention,
    });

    expect(plan.requestedRange).toEqual({ from: "2026-09-02", to: "2026-09-02" });
    expect(plan.effectiveRange).toEqual(plan.requestedRange);
    expect(plan.retentionLimited).toBe(false);
    expect(plan.csvFallbackStatus).toBe("NOT_REQUIRED");
  });

  it("limits an implicit season backfill to JMA retention and exposes CSV fallback", () => {
    const plan = planWeatherRange({
      targetDate: "2026-09-02",
      seasonCount: 1,
      seasonFallbackFrom: "2026-07-01",
      retention,
    });

    expect(plan.requestedRange).toEqual({ from: "2026-07-05", to: "2026-09-02" });
    expect(plan.effectiveRange).toEqual({ from: "2026-08-06", to: "2026-09-02" });
    expect(plan.retentionLimited).toBe(true);
    expect(plan.csvFallbackStatus).toBe("REQUIRED_FOR_OLDER_DATES");
  });

  it("rejects correction windows beyond retention instead of clamping them", () => {
    const resolved = resolveWeatherDates({ asOfDate: currentJstDate }, currentJstDate);

    expect(() => validateWeatherDateRequest(resolved, { correctionDays: 29 }, retention)).toThrow(
      /exceeds the JMA retention window/,
    );
  });

  it("rejects an explicit range outside retention before a provider request", () => {
    const resolved = resolveWeatherDates(
      { fromDate: "2026-07-01", toDate: "2026-07-01" },
      currentJstDate,
    );

    expect(() => validateWeatherDateRequest(resolved, {}, retention)).toThrow(
      /outside the JMA retention window/,
    );
  });

  it("accepts an explicit retention setting only within the safe range", () => {
    expect(parseJmaRetentionDays(undefined)).toEqual({
      days: DEFAULT_JMA_RETENTION_DAYS,
      basis: "default",
    });
    expect(parseJmaRetentionDays("21")).toEqual({ days: 21, basis: "configured" });
    expect(() => parseJmaRetentionDays("61")).toThrow(/JMA_WEATHER_RETENTION_DAYS/);
  });
});
