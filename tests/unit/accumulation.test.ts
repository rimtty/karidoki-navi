import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  calculateAccumulation,
  roundForDisplay,
} from "../../src/domain";

describe("accumulation", () => {
  it("supports an offset of zero and includes heading day", () => {
    const result = calculateAccumulation({
      headingDate: "2026-08-01",
      accumulationStartOffsetDays: 0,
      throughDate: "2026-08-03",
      dailyValues: [
        { date: "2026-08-01", meanTempC: 20.25 },
        { date: "2026-08-02", meanTempC: 21.5 },
        { date: "2026-08-03", meanTempC: 22.75 },
      ],
    });

    expect(result.accumulationStartDate).toBe("2026-08-01");
    expect(result.accumulatedTempC).toBe(64.5);
    expect(result.validDayCount).toBe(3);
    expect(result.missingDayCount).toBe(0);
  });

  it("supports the standard offset of one", () => {
    const result = calculateAccumulation({
      headingDate: "2026-08-01",
      accumulationStartOffsetDays: 1,
      throughDate: "2026-08-03",
      dailyValues: [
        { date: "2026-08-01", meanTempC: 20 },
        { date: "2026-08-02", meanTempC: 21 },
        { date: "2026-08-03", meanTempC: 22 },
      ],
    });

    expect(result.accumulationStartDate).toBe("2026-08-02");
    expect(result.accumulatedTempC).toBe(43);
    expect(result.validDayCount).toBe(2);
    expect(result.missingDayCount).toBe(0);
  });

  it("excludes missing values and counts missing calendar days", () => {
    const result = calculateAccumulation({
      headingDate: "2026-02-27",
      accumulationStartOffsetDays: 0,
      throughDate: "2026-03-02",
      dailyValues: [
        { observed_date: "2026-02-27", mean_temp_c: 10.1 },
        { observed_date: "2026-02-28", mean_temp_c: null },
        // 2026-03-01 is absent altogether.
        { observed_date: "2026-03-02", mean_temp_c: 12.3 },
      ],
    });

    expect(result.accumulatedTempC).toBeCloseTo(22.4);
    expect(result.validDayCount).toBe(2);
    expect(result.missingDayCount).toBe(2);
  });

  it("does not depend on observation order or the host time zone", () => {
    const result = calculateAccumulation({
      headingDate: "2026-03-08",
      accumulationStartOffsetDays: 1,
      throughDate: "2026-03-10",
      dailyValues: [
        { date: "2026-03-10", meanTempC: 3 },
        { date: "2026-03-09", meanTempC: 2 },
      ],
    });

    expect(result.accumulatedTempC).toBe(5);
    expect(addLocalDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addLocalDays("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("rounds only the display value", () => {
    const result = calculateAccumulation({
      headingDate: "2026-08-01",
      accumulationStartOffsetDays: 0,
      throughDate: "2026-08-02",
      dailyValues: [
        { date: "2026-08-01", meanTempC: 10.04 },
        { date: "2026-08-02", meanTempC: 10.05 },
      ],
    });

    expect(result.accumulatedTempC).toBeCloseTo(20.09);
    expect(roundForDisplay(result.accumulatedTempC)).toBe(20.1);
  });
});
