import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";
/**
 * The upload was read (103 items planned from the file). Earlier e2e specs check out, repair and edit imported
 * items, so here Replace must refuse with nothing deleted; on an untouched catalog the preview succeeds.
 */
async function expectUploadRead(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("import-summary")).toContainText("103");
  const h = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  if (/failed/.test(h)) await expect(page.getByText(/Replace stopped — nothing was deleted\. .*loans made in the app/)).toBeVisible();
  else expect(h).toContain("succeeded");
}
test("SCR-13: developer can dry-run the import and read the per-row report; cannot apply", async ({ page }) => {
  await login(page, U.dev);
  await page.goto("/import");
  await page.getByLabel("Use the SYNTHETIC test fixture instead of an upload").check();
  await expect(page.locator('select[name="mode"] option')).toHaveCount(1);
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("import-summary")).toContainText("103");
  await expect(page.getByTestId("import-rows")).toContainText("STOCK_LINK_FOLDER");
  await expect(page.getByTestId("import-rows")).toContainText("MTMH_145");
});
test("SCR-13: Owner previews an Excel workbook upload (three tabs in one .xlsx)", async ({ page }) => {
  await login(page, U.owner);
  await page.goto("/import");
  await page.getByTestId("import-workbook").setInputFiles("fixtures/sheet/fixture-workbook.xlsx");
  await page.locator('input[name="replace"]').check();
  await page.getByRole("button", { name: "Run" }).click();
  await expectUploadRead(page);
});
test("SCR-13: Owner previews three separate CSV uploads (one per tab)", async ({ page }) => {
  await login(page, U.owner);
  await page.goto("/import");
  await page.getByText("Or upload one file per tab").click();
  await page.locator('input[name="sheet1"]').setInputFiles("fixtures/sheet/Sheet1.csv");
  await page.locator('input[name="tobuy"]').setInputFiles("fixtures/sheet/To buy.csv");
  await page.locator('input[name="unsorted"]').setInputFiles("fixtures/sheet/Not yet sorted.csv");
  await page.locator('input[name="replace"]').check();
  await page.getByRole("button", { name: "Run" }).click();
  await expectUploadRead(page);
});
test("SCR-13: a workbook missing a tab is refused with a clear message", async ({ page }) => {
  await login(page, U.owner);
  await page.goto("/import");
  await page.locator('input[name="sheet1"]').setInputFiles("fixtures/sheet/Sheet1.csv");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByTestId("form-error")).toContainText("Could not find the To buy, Not yet sorted tabs");
});
