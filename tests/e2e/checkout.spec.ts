import { test, expect } from "@playwright/test";
import { login, U, PHOTO, sql } from "./helpers";

test.describe.serial("check-out / check-in on a phone (AC-CHK-01, 02, 04; FR-QR-003; NFR-002)", () => {
  test("scan -> item page -> check out needs a photo -> with photo it saves", async ({ page }) => {
    await login(page, U.team);
    await page.goto("/i/MTMH_103"); // what the printed QR opens
    await expect(page).toHaveURL(/\/items\/MTMH_103\?scanned=1/);
    await expect(page.getByTestId("primary-action")).toHaveText("Check out");
    await page.getByTestId("primary-action").click();
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByTestId("form-error")).toContainText("needs at least one check-out photo");
    await page.getByTestId("photo-input-Check-out").setInputFiles(PHOTO);
    await expect(page.getByTestId("photo-state").first()).toHaveText(/uploading|saved/);
    await page.getByTestId("checkout-submit").click(); // save does not wait for the upload (NFR-002)
    await expect(page.getByTestId("checked-out")).toBeVisible();
    await page.goto("/items/MTMH_103");
    await expect(page.getByTestId("item-status")).toContainText("Checked out");
    await expect.poll(async () => (await sql("select count(*)::int n from photos where item_id='MTMH_103' and kind='Check-out' and upload_state='uploaded'"))[0].n).toBe(1);
  });

  test("a second check-out of MTMH_103 is blocked", async ({ page }) => {
    await login(page, U.manager);
    await page.goto("/items/MTMH_103/checkout");
    await page.getByTestId("photo-input-Check-out").setInputFiles(PHOTO);
    await page.waitForTimeout(500);
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByTestId("form-error")).toContainText("already checked out");
  });

  test("check-in in Bad condition prompts and creates a repair linked to the loan", async ({ page }) => {
    await login(page, U.team);
    await page.goto("/items/MTMH_103");
    await expect(page.getByTestId("primary-action")).toHaveText("Check in");
    await page.getByTestId("primary-action").click();
    await page.getByTestId("condition-in").selectOption("Bad condition");
    await page.getByTestId("photo-input-Check-in").setInputFiles(PHOTO);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(page.getByTestId("checked-in")).toBeVisible();
    await expect(page.getByText("Condition is worse than at check-out")).toBeVisible();
    await page.getByTestId("one-tap").getByRole("button", { name: "Record damage incident" }).click();
    await expect(page.getByTestId("form-ok")).toContainText("linked to this loan");
    // a Manager opens the repair in one tap from the same prompt
    await page.context().clearCookies();
    await login(page, U.manager);
    const loan = (
      await sql<{ id: string }>("select l.id from loans l join loan_lines ll on ll.loan_id = l.id where ll.item_id='MTMH_103' and not l.legacy order by l.created_at desc limit 1")
    )[0].id;
    await page.goto(`/loans/${loan}?worse=1`);
    await page.getByTestId("one-tap").getByRole("button", { name: "Open repair" }).click();
    await expect(page.getByTestId("form-ok")).toContainText("Repair opened");
    const m = await sql("select linked_loan_id from maintenance_events where item_id='MTMH_103' and type='Repair'");
    expect(m[0].linked_loan_id).toBe(loan);
    await page.goto("/items/MTMH_103");
    await expect(page.getByTestId("item-status")).toContainText("In repair");
  });

  test("AC-CHK-03 through the UI: 5 of MTMH_141 then 2 more blocked", async ({ page }) => {
    await login(page, U.team);
    await page.goto("/items/MTMH_141/checkout");
    await page.getByTestId("quantity").fill("5");
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByTestId("checked-out")).toBeVisible();
    await page.goto("/items/MTMH_141/checkout");
    await page.getByTestId("quantity").fill("2");
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByTestId("form-error")).toContainText("only 1 of 2");
  });

  test("AC-CHK-05: transfer Anand -> Chiru keeps one chain of custody", async ({ page }) => {
    await login(page, U.manager);
    await page.goto("/items/MTMH_164/checkout");
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByTestId("checked-out")).toBeVisible();
    await page.getByTestId("transfer-to").selectOption({ label: "Chiru" });
    await page
      .locator("form", { has: page.getByTestId("transfer-to") })
      .getByLabel("Reason")
      .fill("Hand-over at the shoot");
    await page.getByRole("button", { name: "Transfer" }).click();
    await expect(page.getByTestId("chain")).toContainText("Anand");
    await expect(page.getByTestId("chain")).toContainText("Chiru");
    await page.goto("/items/MTMH_164");
    await expect(page.getByTestId("item-loans")).toContainText("Chiru");
    await expect(page.getByTestId("item-loans")).toContainText("transferred");
  });
});
