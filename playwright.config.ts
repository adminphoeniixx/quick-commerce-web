import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl || !/(test|e2e)/i.test(databaseUrl)) {
  throw new Error("E2E_DATABASE_URL must point to a clearly named separate test/e2e database");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: process.env.E2E_REDIS_URL || "redis://127.0.0.1:6379", APP_URL: "http://127.0.0.1:3100", COOKIE_SECURE: "false" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
