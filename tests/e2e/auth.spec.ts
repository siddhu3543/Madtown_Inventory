import { test, expect } from "@playwright/test";
import { login, U, PW, sql } from "./helpers";

test("AC-NFR-01: an account outside madtown.in cannot sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("someone@gmail.com");
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("form-error")).toContainText("Only @madtown.in accounts");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated pages and APIs are refused", async ({ page, request }) => {
  await page.goto("/items/MTMH_101");
  await expect(page).toHaveURL(/\/login\?next=/);
  const r = await request.get("/api/items/MTMH_203");
  expect(r.status()).toBe(401);
});

test("NFR-006: offboarding revokes an active session immediately", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await login(a, U.team2);
  const ctxO = await browser.newContext();
  const o = await ctxO.newPage();
  await login(o, U.owner);
  await o.goto("/settings");
  const row = o.getByTestId("users-table").locator("tr", { hasText: U.team2 });
  await row.getByRole("button", { name: "Offboard" }).click();
  await row.getByRole("button", { name: "Confirm" }).click(); // in-page confirmation dialog (replaces window.confirm)
  await expect(o.getByTestId("offboarded")).toContainText(`Access revoked for ${U.team2}`);
  await expect(o.getByTestId("users-table").locator("tr", { hasText: U.team2 })).toContainText("(deactivated)");
  await a.goto("/items");
  await expect(a).toHaveURL(/\/login/);
  const r = await a.request.get("/api/items/index");
  expect(r.status()).toBe(401);
  await sql("update users set active = true, session_version = session_version + 1 where login_email = $1", [U.team2]);
  await ctxA.close();
  await ctxO.close();
});
