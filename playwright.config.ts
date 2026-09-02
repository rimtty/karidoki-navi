import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["dot"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/login`,
    timeout: 120_000,
    // Reusing a server started without the local Supabase environment can
    // silently switch the app to fixture mode, so opt in explicitly.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    stdout: "pipe",
    stderr: "pipe",
    // The service-role key is needed only by global setup and must never enter
    // the Next.js process. The public key is safe to expose to the browser.
    env: {
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  },
});
