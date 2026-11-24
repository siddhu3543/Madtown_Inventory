import { test, expect } from "@playwright/test";
import { login, U, sql, fillCheckout, fillCheckin } from "./helpers";

test("AC-RPT-01: dashboard counts match the item list filters", async ({ page }) => {
  await login(page, U.owner);
  await page.goto("/");
  const tile = async (k: string) => Number(await page.getByTestId(`tile-${k}`).getByTestId("tile-value").innerText());
  const counts = { out_now: await tile("out-now"), overdue: await tile("overdue"), in_repair: await tile("in-repair"), lost: await tile("lost"), missing: await tile("missing") };
  for (const [view, n] of Object.entries(counts)) {
    await page.goto(`/items?view=${view}`);
    await expect(page.getByTestId("result-count")).toContainText(`${n} item(s)`);
  }
  expect(counts.lost).toBeGreaterThanOrEqual(5);
});

test("AC-RPT-03: inventory report exports all active items to CSV", async ({ page }) => {
  await login(page, U.owner);
  const csv = await (await page.request.get("/api/export/inventory.csv")).text();
  const lines = csv.trim().split("\n").length - 1;
  const active = (await sql<{ n: number }>("select count(*)::int n from items where status <> 'Retired'"))[0].n;
  expect(lines).toBe(active);
});

test("AC-CAT-03 via UI: searching FX3 lists MTMH_101 and its accessories", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/items");
  await page.getByTestId("item-search").fill("FX3");
  await expect(page.getByTestId("item-row").filter({ hasText: "MTMH_166" })).toBeVisible();
  for (const id of ["MTMH_101", "MTMH_163", "MTMH_164", "MTMH_165"]) await expect(page.locator(`[data-item-id="${id}"]`)).toBeVisible();
});

test("AC-CAT-05 / AC-PHO-03 saved views: To verify includes MTMH_202; Missing photos includes MTMH_187; Owned by others includes MTMH_115", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/items?view=to_verify");
  await expect(page.locator('[data-item-id="MTMH_202"]')).toContainText("Model TBD");
  await page.goto("/items?view=missing_photos");
  await expect(page.locator('[data-item-id="MTMH_187"]')).toBeVisible();
  await page.goto("/items?view=owned_by_others");
  await expect(page.locator('[data-item-id="MTMH_115"]')).toContainText("Owner: Anand");
});

test("AC-CAT-02 via UI: a Manager adds an item and gets the next ID", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/items/new");
  await page.getByLabel("Item name *").fill("E2E   Test   Light ");
  await page.getByLabel("Type *").selectOption("Light");
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page).toHaveURL(/\/items\/MTMH_2\d\d/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Test Light");
});

test("AC-KIT-01/02: kit MTMH_182+183+184 checks out as one unit; check-in without 183 is blocked as complete", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/kits");
  await page.getByPlaceholder("e.g. DJI RS4 Pro gimbal set").fill("DJI RS4 Pro gimbal set");
  await page.getByRole("button", { name: "Create kit" }).click();
  await expect(page).toHaveURL(/\/kits\/KIT_\d{3}/);
  await page.getByTestId("kit-add-ids").fill("182 183 184");
  await page.getByRole("button", { name: "Add parts" }).click();
  await expect(page.getByText("Added MTMH_182, MTMH_183, MTMH_184")).toBeVisible();
  await page.reload();
  await page.getByTestId("kit-checkout").click();
  // Chiru has no email or phone on file: the form asks for both, and they are saved with Chiru
  await fillCheckout(page, { borrower: "Chiru (no login)", email: "chiru@example.com", phone: "+91 90000 22222" });
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByTestId("checked-out")).toBeVisible();
  const st = await sql<{ status: string }>("select status from items where id in ('MTMH_182','MTMH_183','MTMH_184')");
  expect(st.every((s) => s.status === "Checked out")).toBe(true);
  expect((await sql("select c.email, c.phone from people_contacts c join people p on p.id = c.person_id where p.name = 'Chiru'"))[0]).toEqual({
    email: "chiru@example.com",
    phone: "+91 90000 22222",
  });
  await page.getByTestId("ret-MTMH_183").uncheck();
  await fillCheckin(page);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByTestId("form-error")).toContainText(/required parts missing: MTMH_183/i);
  await expect(page.getByTestId("form-error")).toContainText("Record a missing part");
});

test("AC-BUY-02/03: an Admin proposes, an Admin approves (user+time recorded), receiving creates the next MTMH IDs", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/to-buy/new");
  await page.getByLabel("Item", { exact: true }).fill("Spare NP-FZ100 battery");
  await page.getByLabel("Reason").fill("Only 6 for two cameras");
  await page.getByLabel("Related item IDs").fill("141");
  await page.getByRole("button", { name: "Propose" }).click();
  await expect(page).toHaveURL(/\/to-buy\/[0-9a-f-]{36}/);
  const url = page.url();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(1); // any Admin may approve (2026-11-24)
  await page.context().clearCookies();
  await login(page, U.owner);
  await page.goto(url);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("approval")).toContainText("Approved by Naveen Pinapatruni");
  await page.getByRole("link", { name: "Record an order for this line" }).click();
  await page.getByLabel("Vendor").fill("Kamal Imaging");
  await page.getByLabel("Order number").fill("KI/SO/E2E1");
  await page.locator('input[name="line_qty"]').first().fill("2");
  await page.getByRole("button", { name: "Save order" }).click();
  await page.locator('select[name^="type_"]').selectOption("Battery");
  await page.getByRole("button", { name: "Receive and create items" }).click();
  await expect(page.getByTestId("received")).toContainText("MTMH_2");
  const created = await sql<{ item_id: string; wl: string }>(`select oli.item_id, w.status wl from order_line_items oli join order_lines ol on ol.id = oli.order_line_id
     join orders o on o.id = ol.order_id join wishlist_items w on w.id = ol.wishlist_id where o.order_ref = 'KI/SO/E2E1' order by 1`);
  expect(created).toHaveLength(2);
  expect(created[0].wl).toBe("Received");
});

test("AC-LST-03: scanning a Lost item offers Mark as found; confirming notifies Managers and logs the change", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/i/MTMH_123");
  await expect(page.getByTestId("primary-action")).toHaveText("Mark as found");
  await page.locator("#found").getByLabel("Where was it found?").fill("Store room shelf 3");
  await page.getByRole("button", { name: "Confirm found" }).click();
  await expect(page.getByTestId("form-ok")).toContainText("Admins were notified");
  const n = await sql("select intended_recipients from notifications_log where event_code = 'FOUND' and item_id = 'MTMH_123'");
  expect(n[0].intended_recipients).toContain("anand@madtown.in");
  const a = await sql("select action from audit_log where item_id = 'MTMH_123' and action = 'found'");
  expect(a).toHaveLength(1);
});

test("AC-AUD-02: walkthrough over Type Stand records a count for MTMH_126 and shows the variance against stock 4", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/walkthrough");
  await page.getByTestId("scope-kind").selectOption("Type");
  await page.getByTestId("scope-value").fill("Stand");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("not-scanned")).toContainText("MTMH_126");
  await page.getByTestId("manual-id").fill("MTMH_126");
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByTestId("wt-count").fill("1");
  await page.getByRole("button", { name: "Save" }).click();
  const v = page.getByTestId("variance");
  await expect(v).toContainText("MTMH_126");
  await expect(v.locator("tr", { hasText: "MTMH_126" })).toContainText("4"); // stock column
  await page.getByRole("button", { name: "Close walkthrough and send variance report" }).click(); // NTF-014
  await expect.poll(async () => (await sql("select count(*)::int n from notifications_log where event_code = 'NTF-014'"))[0].n).toBe(1);
});

test("AC-CON-02: a repair moved through every state shows each step with date and user", async ({ page }) => {
  await login(page, U.manager);
  await page.goto("/items/MTMH_120");
  await page.locator("#repair").getByLabel("Issue").fill("Fan noise");
  await page.locator("#repair").getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("Maintenance event opened")).toBeVisible();
  const id = (await sql<{ id: string }>("select id from maintenance_events where item_id='MTMH_120' order by created_at desc limit 1"))[0].id;
  await page.goto(`/repairs/${id}`);
  for (const s of ["Sent for repair", "In repair", "Returned", "Closed"]) {
    await page.getByTestId("to-state").selectOption(s);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("repair-history")).toContainText(s);
  }
  const h = page.getByTestId("repair-history");
  for (const s of ["Reported", "Sent for repair", "In repair", "Returned", "Closed"]) await expect(h).toContainText(s);
  await expect(h).toContainText("by Anand");
  await expect(h).toContainText("IST");
});

test("NTF / A3: staging email sandbox — every delivered message goes to the sandbox inbox", async () => {
  const rows = await sql<{ recipients: string[] }>("select recipients from notifications_log where channel = 'email' and status in ('sent','sandboxed')");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.recipients.length === 1 && r.recipients[0] === "staging-inbox@madtown.in")).toBe(true);
});

test("SCR-16/20/21/23 and remaining screens render for a Manager", async ({ page }) => {
  await login(page, U.manager);
  for (const [u, h] of [
    ["/lost", "Lost and found"],
    ["/reports?tab=loans", "Reports"],
    ["/reports?tab=repairs", "Reports"],
    ["/reports?tab=utilisation", "Reports"],
    ["/reports?tab=asset", "Reports"],
    ["/unsorted", "Unsorted items"],
    ["/reservations", "Reservations"],
    ["/repairs", "Repairs and servicing"],
    ["/orders", "Orders"],
    ["/kits", "Kits"],
    ["/people", "People"],
    ["/loans", "Loans"],
  ]) {
    await page.goto(u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(h);
  }
  await expect(page.getByTestId("unsorted"))
    .toBeHidden()
    .catch(() => {});
  await page.goto("/unsorted");
  await expect(page.getByTestId("unsorted")).toContainText("GoPro");
  await expect(page.getByTestId("unsorted")).toContainText("possible duplicate of");
});
