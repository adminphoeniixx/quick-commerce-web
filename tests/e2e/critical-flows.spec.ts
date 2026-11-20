import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/email/i).fill("e2e-owner@example.test");
  await page.getByLabel(/password/i).fill("E2e-password-123!");
  const login = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: /sign in|login/i }).click();
  expect((await login).ok()).toBeTruthy();
  await expect(page).toHaveURL(/dashboard/);
});

test("login, analytics, organization scope, connections and exports", async ({ page }) => {
  await expect(page.getByText(/quick commerce|dashboard/i).first()).toBeVisible();
  const me = await page.request.get("/api/auth/me"); expect(me.ok()).toBeTruthy();
  const categories = await page.request.get("/api/analytics/categories?from=2026-10-01&to=2026-10-31"); expect(categories.ok()).toBeTruthy();
  const connections = await page.request.get("/api/connections"); expect(connections.ok()).toBeTruthy();
  const exported = await page.request.get("/api/analytics/export?format=csv&from=2026-10-01&to=2026-10-31"); expect(exported.ok()).toBeTruthy();
});

test("advanced sales import preview, mapping, validation and confirmation", async ({ page }) => {
  await page.goto("/dashboard/imports");
  await page.getByLabel("Data type").selectOption("sales");
  await page.getByLabel("Platform").selectOption("blinkit");
  await page.locator('input[type="file"]').setInputFiles({ name:"sales.csv", mimeType:"text/csv", buffer:Buffer.from("SKU Code,Date,GMV,Units Sold\nE2E-A,2026-10-01,100,2\n") });
  await page.getByRole("button", { name:"Preview file" }).click();
  await expect(page.getByText(/Column mapping/)).toBeVisible();
  await page.getByRole("button", { name:"Validate records" }).click();
  await expect(page.getByText(/Review before import/)).toBeVisible();
  await page.getByRole("button", { name:/Confirm/ }).click();
  await expect(page.getByText(/Import started|Progress/)).toBeVisible();
});

test("sales-growth objective is durable and generation requires synced evidence", async ({ page }) => {
  await page.goto("/dashboard/ads/growth");
  await expect(page.getByText("Sales-growth objective")).toBeVisible();
  await page.getByLabel("Target sales growth (%)").fill("25");
  await page.getByRole("button", { name: "Save objective" }).click();
  await expect(page.getByRole("button", { name: "Generate agentic plan" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate agentic plan" }).click();
  // Research is queued; the missing-evidence failure surfaces on the plan via polling.
  await expect(page.getByText(/Sync Blinkit Ads before generating a growth plan/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("failed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate agentic plan" })).toBeEnabled();
});

test("parallel page requests refresh one expired access token without ending session", async ({ page, context }) => {
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.filter((cookie) => cookie.name !== "qcp_access"));
  await page.goto("/dashboard/ads/growth");
  await expect(page).toHaveURL(/dashboard\/ads\/growth/);
  await expect(page.getByText("Sales-growth objective")).toBeVisible();
  const me = await page.request.get("/api/auth/me");
  expect(me.ok()).toBeTruthy();
});
