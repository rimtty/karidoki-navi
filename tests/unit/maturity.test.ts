import { describe, expect, it } from "vitest";
import { determineMaturityStatus, type MaturityRule } from "../../src/domain";

const rule: MaturityRule = {
  harvestStartTempC: 1_000,
  harvestTargetTempC: 1_050,
  harvestEndTempC: 1_100,
  accumulationStartOffsetDays: 1,
  effectiveFrom: "2026-01-01",
};

function status(accumulatedTempC: number) {
  return determineMaturityStatus({
    headingDate: "2026-08-01",
    asOfDate: "2026-09-01",
    accumulatedTempC,
    rule,
    weatherLocationId: "amedas-1",
  });
}

describe("maturity status", () => {
  it("uses the exact 70% and 90% boundaries", () => {
    expect(status(699.99)).toBe("GROWING");
    expect(status(700)).toBe("GROWING_LATE");
    expect(status(899.99)).toBe("GROWING_LATE");
    expect(status(900)).toBe("HARVEST_SOON");
    expect(status(999.99)).toBe("HARVEST_SOON");
    expect(status(1_000)).toBe("HARVEST_READY");
    expect(status(1_100)).toBe("HARVEST_READY");
    expect(status(1_100.01)).toBe("OVERDUE");
  });

  it("prioritizes harvested over every other state", () => {
    expect(
      determineMaturityStatus({
        harvestDate: "2026-09-02",
        accumulatedTempC: 0,
        rule: null,
        headingDate: null,
        weatherLocationId: null,
      }),
    ).toBe("HARVESTED");
  });

  it("returns not configured when a required setting is absent", () => {
    expect(
      determineMaturityStatus({
        headingDate: "2026-08-01",
        accumulatedTempC: 500,
        rule,
        weatherLocationId: null,
      }),
    ).toBe("NOT_CONFIGURED");
    expect(
      determineMaturityStatus({
        headingDate: "2026-08-01",
        accumulatedTempC: 500,
        rule: null,
        weatherLocationId: "amedas-1",
      }),
    ).toBe("NOT_CONFIGURED");
  });

  it("returns before heading until the offset start date", () => {
    expect(
      determineMaturityStatus({
        headingDate: "2026-08-01",
        asOfDate: "2026-08-01",
        accumulatedTempC: 0,
        rule,
        weatherLocationId: "amedas-1",
      }),
    ).toBe("BEFORE_HEADING");
    expect(
      determineMaturityStatus({
        headingDate: "2026-08-01",
        asOfDate: "2026-08-02",
        accumulatedTempC: 0,
        rule,
        weatherLocationId: "amedas-1",
      }),
    ).toBe("GROWING");
  });
});
