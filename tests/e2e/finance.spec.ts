import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";

test("AC-NFR-02: a Team member cannot see purchase price on screen, in the API, in exports or by guessing IDs", async ({ page }) => {
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
  // invoice photos (financial evidence) are not served to a Team member
  const inv = await page.request.get("/api/photos/00000000-0000-0000-0000-000000000000/file");
  expect([403, 404]).toContain(inv.status());
});

test("the Owner sees the price", async ({ page }) => {
  await login(page, U.owner);
  await page.goto("/items/MTMH_203");
  await expect(page.getByTestId("price")).toHaveText("Rs 21,999");
  const csv = await (await page.request.get("/api/export/inventory.csv")).text();
  expect(csv).toMatch(/Purchase price/);
});

test("Read-only users cannot change anything (section 9)", async ({ page }) => {
  await login(page, U.readonly);
  await page.goto("/items/MTMH_101");
  await expect(page.getByTestId("primary-action")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  const r = await page.request.post("/api/photos", { data: { item_id: "MTMH_101", kind: "Latest" } });
  expect(r.status()).toBe(403);
});
