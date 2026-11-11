import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";
test("AC-AUD-01: editing MTMH_112's name is recorded with user, time, before and after; Owner-only global log", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/items/MTMH_112/edit");
  await page.getByLabel("Item name *").fill("Synthetic Light 112 renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("item-audit")).toContainText("Synthetic Light 112 renamed"); // item-level history for Managers (D-03)
  await page.goto("/audit-log");
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(page.locator("body")).toContainText("cannot open this page"); // global log is Owner only
  await page.context().clearCookies();
  await login(page, U.owner);
  await page.goto("/audit-log?record=MTMH_112");
  const row = page.getByTestId("audit-table").locator("tr", { hasText: "renamed" }).first();
  await expect(row).toContainText("Anand <anand@madtown.in>");
  await expect(row).toContainText('"name":"Synthetic Light 112"');
  await expect(row).toContainText("IST");
  const csv = await (await page.request.get("/api/export/audit-log.csv?record=MTMH_112")).text();
  expect(csv).toContain("Synthetic Light 112 renamed");
});
