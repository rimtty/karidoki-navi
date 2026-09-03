import { describe, expect, it } from "vitest";
import {
  resolveVarietyRule,
  resolveVarietyRuleWithMetadata,
  type MaturityRule,
  type RuleCandidate,
} from "../../src/domain";

const baseRule: MaturityRule = {
  varietyId: "koshihikari",
  harvestStartTempC: 900,
  harvestTargetTempC: 1_000,
  harvestEndTempC: 1_100,
  accumulationStartOffsetDays: 1,
  effectiveFrom: "2026-01-01",
  status: "ACTIVE",
};

function candidate(
  id: string,
  regionId: string,
  regionKind: RuleCandidate["regionKind"],
  overrides: Partial<RuleCandidate> = {},
): RuleCandidate {
  return {
    ...baseRule,
    id,
    regionId,
    regionKind,
    ...overrides,
  };
}

describe("variety rule resolution", () => {
  it("uses a custom override before catalog rules", () => {
    const custom: MaturityRule = {
      ...baseRule,
      id: "custom",
      harvestStartTempC: 850,
    };
    expect(
      resolveVarietyRule({
        varietyId: "koshihikari",
        asOfDate: "2026-08-01",
        customOverride: custom,
        rules: [candidate("country", "jp", "COUNTRY")],
      }),
    ).toBe(custom);
  });

  it("chooses the narrowest matching region before priority", () => {
    const country = candidate("country", "jp", "COUNTRY", { priority: 99 });
    const prefecture = candidate("prefecture", "hiroshima", "PREFECTURE", {
      priority: 1,
    });
    const municipality = candidate("municipality", "mihara", "MUNICIPALITY", {
      priority: 0,
    });
    expect(
      resolveVarietyRule({
        varietyId: "koshihikari",
        asOfDate: "2026-08-01",
        regionIds: ["jp", "hiroshima", "mihara"],
        rules: [country, prefecture, municipality],
      }),
    ).toBe(municipality);
  });

  it("orders same-region candidates by priority, effective date, then version", () => {
    const highPriority = candidate("high-priority", "hiroshima", "PREFECTURE", {
      priority: 10,
      effectiveFrom: "2026-01-01",
      version: 1,
    });
    const newer = candidate("newer", "hiroshima", "PREFECTURE", {
      priority: 10,
      effectiveFrom: "2026-06-01",
      version: 1,
    });
    const newestVersion = candidate("newest-version", "hiroshima", "PREFECTURE", {
      priority: 10,
      effectiveFrom: "2026-06-01",
      version: 2,
    });
    expect(
      resolveVarietyRule({
        varietyId: "koshihikari",
        asOfDate: "2026-08-01",
        regionIds: ["hiroshima"],
        rules: [highPriority, newer, newestVersion],
      }),
    ).toBe(newestVersion);
  });

  it("filters inactive and out-of-period rules", () => {
    const draft = candidate("draft", "jp", "COUNTRY", { status: "DRAFT" });
    const future = candidate("future", "jp", "COUNTRY", {
      effectiveFrom: "2027-01-01",
    });
    expect(
      resolveVarietyRule({
        varietyId: "koshihikari",
        asOfDate: "2026-08-01",
        regionIds: ["jp"],
        rules: [draft, future],
      }),
    ).toBeNull();
  });

  it("returns provenance for the selected catalog rule", () => {
    const rule = candidate("pref", "hiroshima", "PREFECTURE");
    expect(
      resolveVarietyRuleWithMetadata({
        varietyId: "koshihikari",
        asOfDate: "2026-08-01",
        regionIds: ["hiroshima"],
        rules: [rule],
      }),
    ).toMatchObject({ rule, source: "REGION" });
  });
});
