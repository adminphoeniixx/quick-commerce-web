import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
const redisUrl = process.env.E2E_REDIS_URL;
if (!databaseUrl || !/(test|e2e)/i.test(databaseUrl)) {
  throw new Error("E2E_DATABASE_URL must point to a clearly named separate test/e2e database");
}
if (!redisUrl || !/^redis(s)?:\/\/[^/]+\/(?:[1-9]|1[0-5])$/.test(redisUrl)) {
  throw new Error("E2E_REDIS_URL must use a separate non-zero Redis database (1-15)");
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
    // Web + BullMQ worker, so queued jobs (growth research) actually run in e2e.
    command: "sh -c 'npm run worker & npm run start -- --hostname 127.0.0.1 --port 3100'",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      APP_URL: "http://127.0.0.1:3100",
      COOKIE_SECURE: "false",
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || "e2e-access-secret-not-for-production",
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "e2e-refresh-secret-not-for-production",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
