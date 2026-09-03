import { describe, expect, it } from "vitest";
import { estimateDaysToStart } from "../../src/domain";

function sevenDays(values: Array<number | null>) {
  return values.map((meanTempC, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    meanTempC,
  }));
}

describe("reference days to harvest start", () => {
  it("requires at least five valid values in the last seven days", () => {
    expect(
      estimateDaysToStart({
        accumulatedTempC: 800,
        harvestStartTempC: 1_000,
        recentValues: sevenDays([10, 10, 10, 10, null, null, null]),
        asOfDate: "2026-09-07",
      }),
    ).toBeNull();
    expect(
      estimateDaysToStart({
        accumulatedTempC: 800,
        harvestStartTempC: 1_000,
        recentValues: sevenDays([10, 10, 10, 10, 10, null, null]),
        asOfDate: "2026-09-07",
      }),
    ).toBe(20);
  });

  it("does not estimate with a non-positive recent average", () => {
    expect(
      estimateDaysToStart({
        accumulatedTempC: 800,
        harvestStartTempC: 1_000,
        recentValues: sevenDays([0, 0, 0, 0, 0, 0, null]),
        asOfDate: "2026-09-07",
      }),
    ).toBeNull();
    expect(
      estimateDaysToStart({
        accumulatedTempC: 1_020,
        harvestStartTempC: 1_000,
        recentValues: sevenDays([10, 10, 10, 10, 10, null, null]),
        asOfDate: "2026-09-07",
      }),
    ).toBe(0);
  });

  it("filters values to the calendar seven-day window", () => {
    expect(
      estimateDaysToStart({
        accumulatedTempC: 900,
        harvestStartTempC: 1_000,
        recentValues: [
          { date: "2026-08-31", meanTempC: 100 },
          { date: "2026-09-01", meanTempC: 10 },
          { date: "2026-09-02", meanTempC: 10 },
          { date: "2026-09-03", meanTempC: 10 },
          { date: "2026-09-04", meanTempC: 10 },
          { date: "2026-09-05", meanTempC: 10 },
          { date: "2026-09-06", meanTempC: 10 },
          { date: "2026-09-07", meanTempC: 10 },
        ],
        asOfDate: "2026-09-07",
      }),
    ).toBe(10);
  });
});
