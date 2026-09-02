import { describe, expect, it } from "vitest";
import { determineDataStatus } from "../../src/domain";

describe("data status", () => {
  it("classifies pending, complete, and incomplete data", () => {
    expect(determineDataStatus({ pending: true })).toBe("PENDING");
    expect(determineDataStatus({ missingDayCount: 0 })).toBe("COMPLETE");
    expect(determineDataStatus({ missingDayCount: 2 })).toBe("INCOMPLETE");
  });

  it("derives missing days from an expected date range", () => {
    expect(
      determineDataStatus({
        expectedStartDate: "2026-08-01",
        expectedEndDate: "2026-08-05",
        validDayCount: 5,
      }),
    ).toBe("COMPLETE");
    expect(
      determineDataStatus({
        expectedStartDate: "2026-08-01",
        expectedEndDate: "2026-08-05",
        validDayCount: 4,
      }),
    ).toBe("INCOMPLETE");
  });

  it("marks a feed stale only when it is two calendar days behind", () => {
    expect(
      determineDataStatus({
        latestObservedDate: "2026-09-01",
        asOfDate: "2026-09-02",
      }),
    ).toBe("COMPLETE");
    expect(
      determineDataStatus({
        latestObservedDate: "2026-09-01",
        asOfDate: "2026-09-03",
      }),
    ).toBe("STALE");
  });

  it("gives errors and pending work precedence", () => {
    expect(
      determineDataStatus({
        error: new Error("provider failed"),
        pending: true,
      }),
    ).toBe("ERROR");
    expect(
      determineDataStatus({
        pending: true,
        missingDayCount: 4,
      }),
    ).toBe("PENDING");
  });
});
