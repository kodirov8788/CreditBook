import { expect, test } from "@playwright/test";

test("login page renders the Uzbek entry flow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Xush kelibsiz." })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirish havolasini yuborish" })).toBeVisible();
});

test("home route responds successfully", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
});

test("production health reports Supabase readiness", async ({ request }, testInfo) => {
  test.skip(!process.env.E2E_BASE_URL, "Production smoke test runs when E2E_BASE_URL is provided.");
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  expect(await response.json()).toMatchObject({ ok: true, checks: { supabase: "ok", customers_table: "ok" } });
  testInfo.annotations.push({ type: "scope", description: "Unauthenticated production health only; no customer data is created." });
});
