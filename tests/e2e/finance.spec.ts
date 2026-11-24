import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";

test("AC-NFR-02: Staff cannot see purchase price on screen, in the API, in exports or by guessing IDs", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/items/MTMH_203");
  await expect(page.getByText("Purchase details")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("21,999");
  const api = await page.request.get("/api/items/MTMH_203");
  expect(api.ok()).toBe(true);
  const body = await api.text();
  expect(body).not.toContain("21999");
  expect(body).not.toContain("21,999");
  const j = JSON.parse(body);
  expect(j.fin).toBeNull();
  expect(j.item.notes).toContain("Rs ▒▒▒");
  const csv = await (await page.request.get("/api/export/inventory.csv")).text();
  expect(csv).not.toContain("21,999");
  expect(csv).not.toMatch(/Purchase price/);
  expect((await page.request.get("/api/export/asset-value.csv")).status()).toBe(403);
  // invoice photos (financial evidence) are not served to Staff
  const inv = await page.request.get("/api/photos/00000000-0000-0000-0000-000000000000/file");
  expect([403, 404]).toContain(inv.status());
});

test("an Admin sees the price", async ({ page }) => {
  await login(page, U.owner);
  await page.goto("/items/MTMH_203");
  await expect(page.getByTestId("price")).toHaveText("Rs 21,999");
  const csv = await (await page.request.get("/api/export/inventory.csv")).text();
  expect(csv).toMatch(/Purchase price/);
});

test("Staff see only the desk; Admin pages and exports are refused (2026-11-24)", async ({ page }) => {
  await login(page, U.team);
  // no menu link to an Admin page anywhere on the page (desktop sidebar or phone drawer)
  for (const href of [
    "/labels",
    "/unsorted",
    "/lost",
    "/people",
    "/reservations",
    "/repairs",
    "/walkthrough",
    "/to-buy",
    "/orders",
    "/reports",
    "/audit-log",
    "/import",
    "/settings",
  ])
    await expect(page.locator(`a[href="${href}"]`), href).toHaveCount(0);
  for (const path of ["/", "/items", "/kits", "/loans", "/scan"]) {
    await page.goto(path);
    await expect(page, path).not.toHaveURL(/\/forbidden/);
  }
  for (const path of [
    "/to-buy",
    "/orders",
    "/repairs",
    "/people",
    "/reports",
    "/settings",
    "/walkthrough",
    "/reservations",
    "/lost",
    "/labels",
    "/audit-log",
    "/items/new",
    "/items/MTMH_101/edit",
  ]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/forbidden/);
  }
  expect((await page.request.get("/api/export/inventory.csv")).status()).toBe(403);
  // the desk itself works: item page offers check-out, and photos can be taken
  await page.goto("/items/MTMH_101");
  await expect(page.getByTestId("primary-action")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  const r = await page.request.post("/api/photos", { data: { item_id: "MTMH_101", kind: "Check-out" } });
  expect(r.status()).toBe(200);
});
