import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";
test("SCR-13: developer can dry-run the import and read the per-row report; cannot apply", async ({ page }) => {
  await login(page, U.dev);
  await page.goto("/import");
  await page.getByLabel("Use the SYNTHETIC fixture instead of uploads").check();
  await expect(page.locator('select[name="mode"] option')).toHaveCount(1);
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("import-summary")).toContainText("103");
  await expect(page.getByTestId("import-rows")).toContainText("STOCK_LINK_FOLDER");
  await expect(page.getByTestId("import-rows")).toContainText("MTMH_145");
});
