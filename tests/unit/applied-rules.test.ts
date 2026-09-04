import { expect, it } from "vitest";
import { attachAppliedRules } from "../../src/lib/fields/applied-rules";
import { FIELD_FIXTURES } from "../../src/features/fields/fixtures";

it("uses only the matching saved season rule and calculates remaining temperature", () => {
  const field = { ...FIELD_FIXTURES[0], seasonId: "season", headingDate: "2026-08-01", accumulatedTempC: 720, rule: null };
  const rule = { crop_season_id: "season", harvest_start_temp_c: 1000, harvest_target_temp_c: 1050,
    harvest_end_temp_c: 1100, accumulation_start_offset_days: 1, source_title: "作業ノート" };
  const [result] = attachAppliedRules([field], [rule]);
  expect(result.rule?.startTempC).toBe(1000);
  expect(result.rule?.source).toBe("作業ノート");
  expect(result.remainingTempC).toBe(280);
  expect(result.accumulationStartDate).toBe("2026-08-02");
  expect(attachAppliedRules([field], [{ ...rule, crop_season_id: "other" }])[0].rule).toBeNull();
  expect(attachAppliedRules([{ ...field, accumulatedTempC: null }], [rule])[0].remainingTempC).toBeNull();
  expect(attachAppliedRules([{ ...field, accumulatedTempC: 1200 }], [rule])[0].remainingTempC).toBe(0);
  expect(field.rule).toBeNull();
});
