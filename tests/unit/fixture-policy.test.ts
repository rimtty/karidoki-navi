import { expect, it } from "vitest";
import { mayShowFieldFixtures } from "../../src/lib/fields/fixture-policy";

it("never masks a configured database failure with sample fields", () => {
  for (const environment of ["production", "development", "test", undefined]) {
    expect(mayShowFieldFixtures(environment, true)).toBe(false);
  }
  expect(mayShowFieldFixtures("production", false)).toBe(false);
  expect(mayShowFieldFixtures("development", false)).toBe(true);
});
