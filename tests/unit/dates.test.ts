import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  compareLocalDates,
  differenceInLocalDays,
  isLocalDate,
  parseLocalDate,
} from "../../src/domain";

describe("LocalDate", () => {
  it("validates real calendar dates", () => {
    expect(isLocalDate("2024-02-29")).toBe(true);
    expect(isLocalDate("2025-02-29")).toBe(false);
    expect(isLocalDate("2026-2-01")).toBe(false);
  });

  it("uses UTC only as an implementation detail", () => {
    expect(parseLocalDate("2026-01-01").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(differenceInLocalDays("2026-09-01", "2026-09-03")).toBe(2);
    expect(compareLocalDates("2026-09-01", "2026-09-03")).toBe(-1);
  });
});
