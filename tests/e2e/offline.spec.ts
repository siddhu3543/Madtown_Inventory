import { test, expect } from "@playwright/test";
import { login, U, sql, fillCheckout } from "./helpers";

test("NFR-013/014: lookup works offline from cache; an offline check-out is queued, shown as NOT confirmed, then synced", async ({ page, context }) => {
  await login(page, U.team);
  await page.goto("/scan");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // SW now controls the page and caches the index
  await page.goto("/items/MTMH_193/checkout"); // visit while online so the page is cached
  await page.goto("/scan");
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload().catch(() => {});
  await expect(page.getByTestId("offline-banner")).toContainText("You are offline");
  await page.getByTestId("manual-id").fill("teleprompter");
  await expect(page.getByTestId("manual-matches")).toContainText("MTMH_203");
  await page.goto("/items/MTMH_193/checkout").catch(() => {});
  await fillCheckout(page, { borrower: "Test Team Member (me)" });
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByTestId("queued")).toContainText("NOT confirmed");
  await expect(page.getByTestId("offline-banner")).toContainText("1 action(s) queued");
  expect((await sql("select status from items where id='MTMH_193'"))[0].status).toBe("Available");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await sql("select status from items where id='MTMH_193'"))[0].status, { timeout: 15000 }).toBe("Checked out");
  const l = await sql("select created_via from loans l join loan_lines ll on ll.loan_id = l.id where ll.item_id = 'MTMH_193' and ll.active");
  expect(l[0].created_via).toBe("Offline");
});

test("NFR-014: a double check-out created offline is rejected by the server and flagged to a Manager", async ({ page, context }) => {
  await login(page, U.team2);
  await page.goto("/items/MTMH_193/checkout"); // MTMH_193 is now out (previous test)
  await context.setOffline(true);
  await fillCheckout(page, { borrower: "Second Team Member (me)" });
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByTestId("queued")).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await sql("select error_code from sync_conflicts order by created_at desc limit 1"))[0]?.error_code, { timeout: 15000 }).toBe("ALREADY_OUT");
  const n = await sql("select intended_recipients from notifications_log where event_code = 'SYNC-CONFLICT'");
  expect(n[0].intended_recipients).toContain("anand@madtown.in");
});

test("A4: a failed evidence upload stays visible as incomplete and retries", async ({ page }) => {
  await login(page, U.team);
  await page.route("**/api/photos/*/upload", (r) => r.abort());
  await page.goto("/items/MTMH_194");
  await page.locator('[data-testid="photo-input-Latest"]').setInputFiles("tests/e2e/photo.jpg");
  await expect(page.getByTestId("photo-state").first()).toHaveText("retrying");
  const id = (await sql<{ id: string; upload_state: string }>("select id, upload_state from photos where item_id='MTMH_194' order by created_at desc limit 1"))[0];
  expect(["pending", "failed"]).toContain(id.upload_state);
  await page.unroute("**/api/photos/*/upload");
  await page.reload(); // resumePendingUploads() on load
  await expect.poll(async () => (await sql<{ upload_state: string }>("select upload_state from photos where id=$1", [id.id]))[0].upload_state, { timeout: 15000 }).toBe("uploaded");
});
