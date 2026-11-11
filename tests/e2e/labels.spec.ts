import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";
test("AC-QR-01: printing labels for MTMH_101 to MTMH_110 produces 10 QR codes with ID and name", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/labels?ids=101-110");
  const labels = page.getByTestId("label");
  await expect(labels).toHaveCount(10);
  await expect(labels.first().locator("svg")).toBeVisible();
  await expect(page.getByTestId("label-id").first()).toHaveText("MTMH_101");
  await expect(labels.first()).toContainText("Sony FX3");
  const box = await labels.first().boundingBox();
  expect(Math.round(box!.width)).toBeGreaterThanOrEqual(93);
  expect(Math.round(box!.width)).toBeLessThanOrEqual(96); // 25 mm at 96 dpi = 94.5 px
  await page.emulateMedia({ media: "print" });
  await page.pdf?.({ path: "test-results/labels-101-110.pdf", format: "A4" }).catch(() => {});
});
test("Team members cannot print labels (section 9)", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/labels?ids=101-110");
  await expect(page.getByTestId("label")).toHaveCount(0);
});
