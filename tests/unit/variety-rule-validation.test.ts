import { describe, expect, it } from "vitest";
import {
  emptyVarietyRuleForm,
  validateVarietyRuleForm,
  type VarietyRuleFormInput,
} from "../../src/features/variety-rules/validation";

const validInput: VarietyRuleFormInput = {
  startTempC: "900",
  endTempC: "1100",
  sourceNote: "久井町の営農会議で確認した運用値。",
};

describe("variety rule form validation", () => {
  it("derives the hidden midpoint and starts accumulation on heading day", () => {
    const result = validateVarietyRuleForm(validInput);
    expect(result).toEqual({
      ok: true,
      value: {
        startTempC: 900,
        targetTempC: 1000,
        endTempC: 1100,
        accumulationOffsetDays: 0,
        sourceNote: "久井町の営農会議で確認した運用値。",
      },
    });
  });

  it("derives a half-degree midpoint when the range has an odd width", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      startTempC: "901",
      endTempC: "1100",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetTempC).toBe(1000.5);
  });

  it("requires the harvest end to be greater than the harvest start", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      startTempC: "1100",
      endTempC: "900",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.endTempC).toContain("刈り始めより大きい");
    }
  });

  it("rejects decimal-like mistakes and values outside the broad rice range", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      startTempC: "0.12",
      endTempC: "3001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.startTempC).toContain("100〜3,000の整数");
      expect(result.errors.endTempC).toContain("100〜3,000の整数");
    }
  });

  it("requires a note that records where the estimate came from", () => {
    const result = validateVarietyRuleForm({
      ...validInput,
      sourceNote: "  ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.sourceNote).toContain("出どころ");
    }
  });

  it("starts with only the three farmer-facing fields", () => {
    expect(emptyVarietyRuleForm()).toEqual({
      startTempC: "",
      endTempC: "",
      sourceNote: "",
    });
  });
});
