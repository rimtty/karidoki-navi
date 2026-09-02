import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns tests/e2e; Vitest must keep its unit runner isolated so
    // test() from the two frameworks is never evaluated in the same process.
    include: ["tests/unit/**/*.test.ts"],
  },
});
