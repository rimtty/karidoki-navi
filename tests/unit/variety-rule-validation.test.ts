import { describe, expect, it } from "vitest";
import {
  emptyVarietyRuleForm,
  validateVarietyRuleForm,
  type VarietyRuleFormInput,
} from "../../src/features/variety-rules/validation";

const validInput: VarietyRuleFormInput = {
  startTempC: "900",
  targetTempC: "1000",
  endTempC: "1100",
  accumulationOffsetDays: "1",
  sourceNote: "久井町の営農会議で確認した運用値。",
  regionId: "kui",
  effectiveFrom: "2026-01-01",
  effectiveTo: "",
};

describe("variety rule form validation", () => {
  it("normalizes a valid form for the save RPC", () => {
    const result = validateVarietyRuleForm(validInput);
    expect(result).toEqual({
      ok: true,
      value: {
        startTempC: 900,
        targetTempC: 1000,
        endTempC: 1100,
        accumulationOffsetDays: 1,
        sourceNote: "久井町の営農会議で確認した運用値。",
        regionId: "kui",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
    });
  });

  it("requires start <= target <= end", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      startTempC: "1100",
      targetTempC: "1000",
      endTempC: "900",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.targetTempC).toContain("開始温度以上");
      expect(result.errors.endTempC).toContain("中心温度以上");
    }
  });

  it("rejects non-positive or over-limit temperatures and offsets", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      startTempC: "0",
      targetTempC: "10001",
      endTempC: "10002",
      accumulationOffsetDays: "8.5",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.startTempC).toContain("0より大きく");
      expect(result.errors.targetTempC).toContain("10,000");
      expect(result.errors.endTempC).toContain("10,000");
      expect(result.errors.accumulationOffsetDays).toContain("0〜7日の整数");
    }
  });

  it("requires a source note and a valid effective period", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      sourceNote: "  ",
      effectiveFrom: "2026-02-30",
      effectiveTo: "2026-01-01",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.sourceNote).toContain("根拠メモ");
      expect(result.errors.effectiveFrom).toContain("正しい日付");
      // An invalid start date does not create a misleading range error.
      expect(result.errors.effectiveTo).toBeUndefined();
    }
  });

  it("starts with an empty, unconfigured rule form", () => {
    expect(emptyVarietyRuleForm("2026-09-03")).toEqual({
      startTempC: "",
      targetTempC: "",
      endTempC: "",
      accumulationOffsetDays: "1",
      sourceNote: "",
      regionId: "",
      effectiveFrom: "2026-09-03",
      effectiveTo: "",
    });
  });
});
