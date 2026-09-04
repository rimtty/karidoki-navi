import { expect, it } from "vitest";
import { weatherReflectionLabel } from "../../src/features/fields/weather-reflection";

it("does not suggest accumulation before heading or when no data has arrived", () => {
  expect(weatherReflectionLabel({ status: "before-heading", observedThrough: "2026-09-04" }))
    .toBe("出穂後に計算を始めます");
  expect(weatherReflectionLabel({ status: "growing", observedThrough: null }))
    .toBe("まだ気温が反映されていません");
  expect(weatherReflectionLabel({ status: "growing", observedThrough: "2026-09-04" }))
    .toBe("2026年9月4日まで");
});
